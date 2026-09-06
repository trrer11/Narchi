"""NARCHI V5 — Stripe Checkout, webhooks signés et facturation mesurée."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

import stripe
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.logging import get_logger
from app.models.subscription import (
    PlanTier,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)

logger = get_logger("stripe_service")
stripe.api_key = settings.STRIPE_SECRET_KEY


_STATUS_MAP = {
    "active": SubscriptionStatus.ACTIVE,
    "trialing": SubscriptionStatus.TRIALING,
    "past_due": SubscriptionStatus.PAST_DUE,
    "unpaid": SubscriptionStatus.PAST_DUE,
    "paused": SubscriptionStatus.PAUSED,
    "canceled": SubscriptionStatus.CANCELED,
    "incomplete_expired": SubscriptionStatus.CANCELED,
}


def _stripe_value(value: Any, key: str, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _utc_from_timestamp(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, tz=timezone.utc) if value else None


class StripeBillingService:
    @staticmethod
    def _require_api_key() -> None:
        if not settings.STRIPE_SECRET_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Facturation Stripe non configurée.",
            )

    def create_checkout_session(
        self,
        *,
        tenant_id: str,
        customer_email: str,
        plan: SubscriptionPlan,
        billing_period: str,
    ) -> str:
        self._require_api_key()
        yearly = billing_period == "year"
        amount = plan.price_yearly_cents if yearly else plan.price_monthly_cents
        if not amount or amount <= 0:
            raise HTTPException(status_code=400, detail="Ce plan n'est pas facturable.")

        checkout = stripe.checkout.Session.create(
            mode="subscription",
            client_reference_id=tenant_id,
            customer_email=customer_email,
            success_url=settings.STRIPE_SUCCESS_URL + "&session_id={CHECKOUT_SESSION_ID}",
            cancel_url=settings.STRIPE_CANCEL_URL,
            allow_promotion_codes=True,
            billing_address_collection="required",
            tax_id_collection={"enabled": True},
            metadata={"tenant_id": tenant_id, "plan_tier": plan.tier.value},
            subscription_data={
                "metadata": {"tenant_id": tenant_id, "plan_tier": plan.tier.value}
            },
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": amount,
                        "recurring": {"interval": "year" if yearly else "month"},
                        "product_data": {
                            "name": f"NARCHI — {plan.name}",
                            "metadata": {"plan_tier": plan.tier.value},
                        },
                    },
                }
            ],
        )
        url = _stripe_value(checkout, "url")
        if not url:
            raise HTTPException(status_code=502, detail="Stripe n'a pas retourné d'URL Checkout.")
        return url

    def construct_webhook_event(self, payload: bytes, signature: str):
        if not settings.STRIPE_WEBHOOK_SECRET:
            raise HTTPException(status_code=503, detail="Webhook Stripe non configuré.")
        try:
            return stripe.Webhook.construct_event(
                payload=payload,
                sig_header=signature,
                secret=settings.STRIPE_WEBHOOK_SECRET,
            )
        except (ValueError, stripe.error.SignatureVerificationError) as error:
            raise HTTPException(status_code=400, detail="Signature Stripe invalide.") from error

    def apply_webhook(self, event, db: Session) -> None:
        event_type = _stripe_value(event, "type", "")
        data = _stripe_value(_stripe_value(event, "data", {}), "object", {})

        if event_type == "checkout.session.completed":
            self._apply_checkout_completed(data, db)
        elif event_type in {
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        }:
            self._apply_subscription(data, db)
        else:
            logger.debug("Stripe event ignored", extra={"event_type": event_type})

    def _apply_checkout_completed(self, checkout, db: Session) -> None:
        metadata = _stripe_value(checkout, "metadata", {}) or {}
        tenant_id = _stripe_value(checkout, "client_reference_id") or _stripe_value(
            metadata, "tenant_id"
        )
        plan_tier = _stripe_value(metadata, "plan_tier")
        external_subscription_id = _stripe_value(checkout, "subscription")
        customer_id = _stripe_value(checkout, "customer")
        if not tenant_id or not plan_tier or not external_subscription_id:
            raise ValueError("Webhook Checkout incomplet")

        db.info["tenant_id"] = tenant_id
        plan = db.query(SubscriptionPlan).filter(
            SubscriptionPlan.tier == PlanTier(plan_tier)
        ).first()
        if plan is None:
            raise ValueError(f"Plan Stripe inconnu: {plan_tier}")

        subscription = (
            db.query(Subscription)
            .filter(Subscription.tenant_id == tenant_id)
            .order_by(Subscription.created_at.desc())
            .first()
        )
        if subscription is None:
            now = datetime.now(timezone.utc)
            subscription = Subscription(
                tenant_id=tenant_id,
                plan_id=plan.id,
                status=SubscriptionStatus.ACTIVE,
                billing_cycle_start=now,
                billing_cycle_end=now,
            )
            db.add(subscription)

        subscription.plan_id = plan.id
        subscription.status = SubscriptionStatus.ACTIVE
        subscription.external_customer_id = customer_id
        subscription.external_subscription_id = external_subscription_id

        remote = stripe.Subscription.retrieve(external_subscription_id)
        self._copy_remote_subscription(remote, subscription)
        db.commit()
        logger.info("Stripe checkout synchronized", extra={"tenant_id": tenant_id})

    def _apply_subscription(self, remote, db: Session) -> None:
        external_id = _stripe_value(remote, "id")
        metadata = _stripe_value(remote, "metadata", {}) or {}
        tenant_id = _stripe_value(metadata, "tenant_id")
        if not external_id:
            raise ValueError("ID abonnement Stripe absent")

        query = db.query(Subscription).execution_options(skip_tenant_filter=True)
        subscription = query.filter(
            Subscription.external_subscription_id == external_id
        ).first()
        if subscription is None and tenant_id:
            subscription = query.filter(Subscription.tenant_id == tenant_id).first()
        if subscription is None:
            logger.warning("Unknown Stripe subscription", extra={"external_id": external_id})
            return

        db.info["tenant_id"] = subscription.tenant_id
        self._copy_remote_subscription(remote, subscription)
        db.commit()

    @staticmethod
    def _copy_remote_subscription(remote, subscription: Subscription) -> None:
        subscription.external_subscription_id = _stripe_value(remote, "id")
        subscription.external_customer_id = _stripe_value(remote, "customer")
        subscription.status = _STATUS_MAP.get(
            _stripe_value(remote, "status"), SubscriptionStatus.PAST_DUE
        )
        subscription.cancel_at_period_end = bool(
            _stripe_value(remote, "cancel_at_period_end", False)
        )
        start = _utc_from_timestamp(_stripe_value(remote, "current_period_start"))
        end = _utc_from_timestamp(_stripe_value(remote, "current_period_end"))
        canceled = _utc_from_timestamp(_stripe_value(remote, "canceled_at"))
        if start:
            subscription.billing_cycle_start = start
        if end:
            subscription.billing_cycle_end = end
        subscription.canceled_at = canceled

        items = _stripe_value(_stripe_value(remote, "items", {}), "data", []) or []
        if items:
            subscription.external_subscription_item_id = _stripe_value(items[0], "id")

    def cancel_subscription(
        self,
        subscription: Subscription,
        cancel_at_period_end: bool,
    ) -> None:
        self._require_api_key()
        if not subscription.external_subscription_id:
            raise HTTPException(status_code=409, detail="Abonnement Stripe non lié.")
        if cancel_at_period_end:
            stripe.Subscription.modify(
                subscription.external_subscription_id,
                cancel_at_period_end=True,
            )
        else:
            stripe.Subscription.delete(subscription.external_subscription_id)

    @staticmethod
    def charge_ai_audit_credits(
        tenant_id: str, db: Session, tokens_used: int = 1
    ) -> bool:
        if not settings.STRIPE_SECRET_KEY:
            logger.info("Stripe metering skipped in development", extra={"tenant_id": tenant_id})
            return True

        subscription = db.query(Subscription).filter(
            Subscription.tenant_id == tenant_id,
            Subscription.external_customer_id.isnot(None),
            Subscription.status == SubscriptionStatus.ACTIVE,
        ).first()
        if subscription is None:
            logger.warning("No active metered subscription", extra={"tenant_id": tenant_id})
            return False

        try:
            stripe.billing.MeterEvent.create(
                event_name=settings.STRIPE_AI_METER_EVENT_NAME,
                identifier=str(uuid.uuid4()),
                payload={
                    "stripe_customer_id": subscription.external_customer_id,
                    "value": str(max(1, tokens_used)),
                },
            )
            return True
        except stripe.error.StripeError as error:
            logger.exception(
                "Stripe metering failed",
                extra={"tenant_id": tenant_id, "error": str(error)},
            )
            return False


stripe_billing_service = StripeBillingService()
