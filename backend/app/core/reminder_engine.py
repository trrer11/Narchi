"""
NARCHI V5 — Serverseitige Terminerinnerungen (§46) : moteur PUR.

Toute la logique décisionnelle (quand déclencher, quand purger, rendu
e-mail allemand, masquage, config SMTP) vit ici — 100 % testable sans base
ni réseau. Le worker « asynchrone » et les routes ne font que l'I/O.

Honnêteté (charte §36) :
- pas de SMTP configuré → canal e-mail DÉSACTIVÉ, jamais un « envoyé » muet ;
- un rappel dont le rendez-vous est DÉJÀ passé n'est plus émis (expiré) ;
- l'e-mail ne contient que les données réelles de l'entrée (titre, date,
  heure, note) — aucune information inventée.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from typing import Iterable, Optional, Protocol
from urllib.parse import urlparse


class ReminderLike(Protocol):
    id: str
    title: str
    kind: str
    starts_at: datetime
    remind_before_h: float
    note: Optional[str]
    status: str
    fired_at: Optional[datetime]
    email_sent: bool


KIND_LABEL_DE = {
    "aufgabe": "Aufgabe",
    "termin": "Termin",
    "urlaub": "Urlaub",
    "krank": "Krankheit",
    "fortbildung": "Fortbildung",
    "konferenz": "Konferenz",
}

STATUS_PENDING = "pending"
STATUS_FIRED = "fired"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(dt: datetime) -> datetime:
    """SQLite rend du naïf : tout comparaison se fait en UTC conscient."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def fire_at(starts_at: datetime, remind_before_h: float) -> datetime:
    """Instant de déclenchement = début − le délai de rappel."""
    return ensure_aware(starts_at) - timedelta(hours=remind_before_h)


def due_reminders(reminders: Iterable[ReminderLike], now: datetime) -> list:
    """
    Rappels À DÉCLENCHER : le moment du rappel est atteint et le rendez-vous
    n'est pas encore passé. Un déclenchement en retard (serveur relancé)
    reste utile tant que l'événement est dans le futur — honnêtement marqué
    « verspätet » dans l'e-mail le cas échéant.
    """
    now = ensure_aware(now)
    out = []
    for r in reminders:
        if r.status != STATUS_PENDING:
            continue
        start = ensure_aware(r.starts_at)
        if fire_at(start, r.remind_before_h) <= now <= start:
            out.append(r)
    return out


def expired_reminders(reminders: Iterable[ReminderLike], now: datetime) -> list:
    """Rappels encore en attente dont l'événement est PASSÉ → à purger."""
    now = ensure_aware(now)
    return [r for r in reminders if r.status == STATUS_PENDING and ensure_aware(r.starts_at) < now]


def schedule_changed(row: ReminderLike, *, title: str, kind: str, starts_at: datetime, remind_before_h: float, note: Optional[str]) -> bool:
    """Changement pertinent justifiant un re-armement du rappel."""
    return (
        row.title != title
        or row.kind != kind
        or ensure_aware(row.starts_at) != ensure_aware(starts_at)
        or float(row.remind_before_h) != float(remind_before_h)
        or (row.note or None) != (note or None)
    )


# ---------------------------------------------------------------------------
# E-mail (canal désactivé honnêtement si SMTP absent)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int = 587
    user: str = ""
    password: str = ""
    sender: str = ""
    use_tls: bool = True
    timeout_s: int = 15


def smtp_config_from_settings(settings) -> Optional[SmtpConfig]:
    """None si aucun serveur SMTP n'est configuré — canal e-mail OFF (honnête)."""
    host = (getattr(settings, "SMTP_HOST", "") or "").strip()
    if not host:
        return None
    user = (getattr(settings, "SMTP_USER", "") or "").strip()
    sender = (getattr(settings, "SMTP_FROM", "") or "").strip() or user or "narchi-reminders@localhost"
    return SmtpConfig(
        host=host,
        port=int(getattr(settings, "SMTP_PORT", 587)),
        user=user,
        password=getattr(settings, "SMTP_PASSWORD", "") or "",
        sender=sender,
        use_tls=bool(getattr(settings, "SMTP_USE_TLS", True)),
    )


def mask_email(email: Optional[str]) -> Optional[str]:
    """« ar***@buero.de » — jamais l'adresse complète dans l'UI/logs."""
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    keep = local[:2] if len(local) >= 2 else local[:1]
    return f"{keep}***@{domain}"


def base_url_hint(settings) -> str:
    """Lien affiché dans l'e-mail (CORS première origine = l'app)."""
    origins = getattr(settings, "CORS_ORIGINS", None) or []
    url = origins[0] if origins else "http://localhost:8080"
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else url


def human_delta_de(delta: timedelta) -> str:
    """« in 3 Stunden » / « in 45 Minuten » / «in 2 Tagen» — relatable."""
    minutes = max(0, int(delta.total_seconds() // 60))
    if minutes >= 48 * 60:
        return f"in {minutes // (24 * 60)} Tagen"
    if minutes >= 24 * 60:
        return "in 1 Tag"
    if minutes >= 90:
        return f"in {round(minutes / 60)} Stunden"
    return f"in {max(1, minutes)} Minuten"


def render_email_de(reminder: ReminderLike, *, now: datetime, app_url: str) -> tuple[str, str]:
    """Sujet + corps (texte) de la notification — données réelles seules."""
    start = ensure_aware(reminder.starts_at)
    when = start.strftime("%d.%m.%Y · %H:%M")
    label = KIND_LABEL_DE.get(reminder.kind, reminder.kind.capitalize())
    delta = human_delta_de(start - ensure_aware(now))
    # « verspätet » = déclenché si tard qu'il reste moins de la MOITIÉ du
    # préavis demandé (ex. serveur relancé) — dit honnêtement dans le mail.
    lead = timedelta(hours=max(0.0, reminder.remind_before_h))
    remaining = start - ensure_aware(now)
    late = lead.total_seconds() > 0 and remaining < lead / 2

    subject = f"NARCHI Erinnerung ({delta}): {reminder.title}"
    lines = [
        f"⏰ {label}: {reminder.title}",
        "",
        f"Beginn: {when} Uhr ({delta})",
    ]
    if late:
        lines.append("(Diese Erinnerung wurde verspätet ausgelöst — der Server war vorübergehend nicht erreichbar.)")
    if reminder.note:
        lines.extend(["", f"Notiz: {reminder.note}"])
    lines.extend(
        [
            "",
            "—",
            f"NARCHI Server-Erinnerung · {app_url}",
            "Automatisch erzeugt — bitte nicht antworten.",
        ]
    )
    return subject, "\n".join(lines)


def send_email(cfg: SmtpConfig, to: str, subject: str, body: str) -> None:
    """Envoi smtplib standard (STARTTLS configurables). Lève en cas d'échec."""
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = cfg.sender
    msg["To"] = to
    with smtplib.SMTP(cfg.host, cfg.port, timeout=cfg.timeout_s) as smtp:
        smtp.ehlo()
        if cfg.use_tls:
            smtp.starttls()
            smtp.ehlo()
        if cfg.user:
            smtp.login(cfg.user, cfg.password)
        smtp.sendmail(cfg.sender, [to], msg.as_string())


def dispatch_reminder(
    reminder: ReminderLike,
    *,
    user_email: Optional[str],
    cfg: Optional[SmtpConfig],
    now: datetime,
    app_url: str,
    mailer=send_email,
) -> str:
    """
    Déclenchement HONNÊTE d'un rappel : statut « fired » (pull in-app) et
    e-mail SEULEMENT si SMTP + destinataire existent. Retourne le canal réel :
    « email » · « inapp » · « email_failed ». Aucune exception ne fuit.
    """
    reminder.status = STATUS_FIRED
    reminder.fired_at = ensure_aware(now)
    reminder.email_sent = False
    if cfg is not None and user_email:
        subject, body = render_email_de(reminder, now=now, app_url=app_url)
        try:
            mailer(cfg, user_email, subject, body)
            reminder.email_sent = True
            return "email"
        except Exception:
            return "email_failed"
    return "inapp"
