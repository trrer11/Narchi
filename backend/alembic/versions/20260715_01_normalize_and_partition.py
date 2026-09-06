"""Normalize chat/DIN data and partition immutable audit logs.

Revision ID: 20260715_01
Revises: ceefc6047fdd
Create Date: 2026-07-15
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260715_01"
down_revision: Union[str, Sequence[str], None] = "ceefc6047fdd"
branch_labels = None
depends_on = None


def _month_start(year: int, month: int) -> datetime:
    return datetime(year, month, 1, tzinfo=timezone.utc)


def _shift_month(value: datetime, offset: int) -> datetime:
    month_index = value.year * 12 + value.month - 1 + offset
    return _month_start(month_index // 12, month_index % 12 + 1)


def _create_audit_partition(connection, start: datetime) -> None:
    end = _shift_month(start, 1)
    name = f"audit_logs_{start.year:04d}_{start.month:02d}"
    # Les bornes sont calculées en interne (jamais depuis une entrée utilisateur)
    # et rendues littéralement pour que `alembic --sql` produise un DDL valide.
    lower = start.strftime("%Y-%m-%dT00:00:00+00:00")
    upper = end.strftime("%Y-%m-%dT00:00:00+00:00")
    connection.execute(
        sa.text(
            f"CREATE TABLE IF NOT EXISTS {name} PARTITION OF audit_logs "
            f"FOR VALUES FROM ('{lower}') TO ('{upper}')"
        )
    )


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # ------------------------------------------------------------------
    # 1. Chat membership: CSV -> table de jointure indexée.
    # ------------------------------------------------------------------
    op.add_column(
        "chat_channels",
        sa.Column("tenant_id", sa.String(), nullable=True, index=True),
    )
    op.add_column(
        "chat_messages",
        sa.Column("tenant_id", sa.String(), nullable=True, index=True),
    )
    op.create_table(
        "chat_channel_members",
        sa.Column("channel_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["chat_channels.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("channel_id", "user_id"),
    )
    op.create_index("idx_ccm_user_id", "chat_channel_members", ["user_id"])
    op.create_index(
        "idx_ccm_tenant_user", "chat_channel_members", ["tenant_id", "user_id"]
    )

    if is_postgres:
        op.execute(
            """
            UPDATE chat_channels AS channel
               SET tenant_id = COALESCE(
                   (SELECT MIN(project.tenant_id)
                      FROM projects AS project
                     WHERE project.id = channel.project_id),
                   (SELECT MIN(member_user.tenant_id)
                      FROM regexp_split_to_table(channel.member_ids, ',') AS member_id
                      JOIN users AS member_user ON member_user.id = member_id
                     WHERE member_id <> ''),
                   'tenant-legacy'
               )
            """
        )
        op.execute(
            """
            INSERT INTO chat_channel_members (channel_id, user_id, tenant_id)
            SELECT channel.id, member_user.id, channel.tenant_id
              FROM chat_channels AS channel
              CROSS JOIN LATERAL regexp_split_to_table(channel.member_ids, ',') AS member_id
              JOIN users AS member_user ON member_user.id = member_id
             WHERE member_id <> ''
            ON CONFLICT DO NOTHING
            """
        )
        op.execute(
            """
            UPDATE chat_messages AS message
               SET tenant_id = channel.tenant_id
              FROM chat_channels AS channel
             WHERE channel.id = message.channel_id
            """
        )
    else:
        op.execute("UPDATE chat_channels SET tenant_id = 'tenant-local'")
        op.execute("UPDATE chat_messages SET tenant_id = 'tenant-local'")

    op.alter_column("chat_channels", "tenant_id", nullable=False)
    op.alter_column("chat_messages", "tenant_id", nullable=False)
    op.create_index(
        "idx_chat_channels_tenant_project",
        "chat_channels",
        ["tenant_id", "project_id"],
    )
    op.create_index(
        "idx_chat_messages_tenant_channel_created",
        "chat_messages",
        ["tenant_id", "channel_id", "created_at", "id"],
    )
    op.create_index(
        "idx_chat_channels_tenant_created_id",
        "chat_channels",
        ["tenant_id", "created_at", "id"],
    )
    op.create_index(
        "idx_projects_tenant_created_id",
        "projects",
        ["tenant_id", "created_at", "id"],
    )
    if is_postgres:
        op.drop_column("chat_channels", "member_ids")

    # ------------------------------------------------------------------
    # 2. DIN 276: JSON -> lignes relationnelles agrégeables par kg_code.
    # ------------------------------------------------------------------
    op.create_table(
        "cost_estimation_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("estimation_id", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("kg_code", sa.String(length=16), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("per_m2", sa.Numeric(16, 2), nullable=False),
        sa.Column("share_pct", sa.Numeric(7, 3), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["estimation_id"], ["cost_estimations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "estimation_id", "kg_code", name="uq_cost_item_estimation_kg"
        ),
    )
    op.create_index(
        "ix_cost_estimation_items_estimation_id",
        "cost_estimation_items",
        ["estimation_id"],
    )
    op.create_index(
        "ix_cost_estimation_items_kg_code",
        "cost_estimation_items",
        ["kg_code"],
    )
    op.create_index(
        "idx_cost_items_tenant_kg_estimation",
        "cost_estimation_items",
        ["tenant_id", "kg_code", "estimation_id"],
    )

    if is_postgres:
        op.execute(
            """
            INSERT INTO cost_estimation_items
                (id, estimation_id, tenant_id, kg_code, label, amount, per_m2, share_pct)
            SELECT gen_random_uuid()::text,
                   estimation.id,
                   estimation.tenant_id,
                   COALESCE(item->>'code', 'UNKNOWN'),
                   COALESCE(item->>'label', ''),
                   COALESCE((item->>'amount')::numeric, 0),
                   COALESCE((item->>'perM2')::numeric, 0),
                   COALESCE((item->>'share_pct')::numeric, 0)
              FROM cost_estimations AS estimation
              CROSS JOIN LATERAL jsonb_array_elements(estimation.kg_breakdown::jsonb) AS item
            ON CONFLICT (estimation_id, kg_code) DO NOTHING
            """
        )
        op.drop_column("cost_estimations", "kg_breakdown")

    # Métadonnées Stripe nécessaires aux webhooks et au metered billing.
    op.add_column("subscriptions", sa.Column("external_customer_id", sa.String(), nullable=True))
    op.add_column("subscriptions", sa.Column("external_subscription_item_id", sa.String(), nullable=True))
    op.create_index(
        "ix_subscriptions_external_customer_id",
        "subscriptions",
        ["external_customer_id"],
        unique=True,
    )
    op.create_index(
        "ix_subscriptions_external_subscription_item_id",
        "subscriptions",
        ["external_subscription_item_id"],
        unique=True,
    )

    # ------------------------------------------------------------------
    # 3. audit_logs -> RANGE(created_at), index tenant/date, append-only SQL.
    # ------------------------------------------------------------------
    if is_postgres:
        for index_name in (
            "ix_audit_logs_action",
            "ix_audit_logs_id",
            "ix_audit_logs_tenant_id",
            "ix_audit_logs_user_id",
            "ix_audit_logs_created_at",
        ):
            op.execute(f"DROP INDEX IF EXISTS {index_name}")

        op.rename_table("audit_logs", "audit_logs_legacy")
        # PostgreSQL conserve le nom global de l'index de PK lors du renommage
        # de table. Sans renommage explicite, la nouvelle PK audit_logs_pkey
        # entre en collision avec l'index de la table legacy.
        op.execute(
            "ALTER TABLE audit_logs_legacy "
            "RENAME CONSTRAINT audit_logs_pkey TO audit_logs_legacy_pkey"
        )
        op.execute(
            """
            CREATE TABLE audit_logs (
                id VARCHAR NOT NULL,
                tenant_id VARCHAR NOT NULL,
                user_id VARCHAR NULL,
                action VARCHAR NOT NULL,
                ip_address VARCHAR NULL,
                user_agent VARCHAR NULL,
                payload JSONB NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at)
            """
        )

        now = datetime.now(timezone.utc)
        # Horizon historique déterministe pour rendre la migration compatible
        # avec le mode Alembic --sql sans requête runtime sur l'ancienne table.
        first = _month_start(2020, 1)
        cursor = first
        last = _shift_month(_month_start(now.year, now.month), 25)
        while cursor < last:
            _create_audit_partition(bind, cursor)
            cursor = _shift_month(cursor, 1)
        op.execute(
            "CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT"
        )
        op.execute(
            """
            INSERT INTO audit_logs
                (id, tenant_id, user_id, action, ip_address, user_agent, payload, created_at)
            SELECT id, tenant_id, user_id, action, ip_address, user_agent,
                   payload::jsonb, created_at
              FROM audit_logs_legacy
            """
        )
        op.drop_table("audit_logs_legacy")
        op.create_index(
            "idx_audit_logs_tenant_created",
            "audit_logs",
            ["tenant_id", "created_at"],
        )
        op.create_index(
            "idx_audit_logs_tenant_action_created",
            "audit_logs",
            ["tenant_id", "action", "created_at"],
        )
        op.execute(
            """
            CREATE OR REPLACE FUNCTION narchi_reject_audit_mutation()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'audit_logs is append-only';
            END;
            $$
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_audit_logs_immutable
            BEFORE UPDATE OR DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION narchi_reject_audit_mutation()
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs")
        op.execute("DROP FUNCTION IF EXISTS narchi_reject_audit_mutation()")
        op.rename_table("audit_logs", "audit_logs_partitioned")
        op.execute(
            "ALTER TABLE audit_logs_partitioned "
            "RENAME CONSTRAINT audit_logs_pkey TO audit_logs_partitioned_pkey"
        )
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=True),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("ip_address", sa.String(), nullable=True),
            sa.Column("user_agent", sa.String(), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.execute(
            """
            INSERT INTO audit_logs
            SELECT id, tenant_id, user_id, action, ip_address, user_agent,
                   payload::json, created_at
              FROM audit_logs_partitioned
            """
        )
        op.drop_table("audit_logs_partitioned")

        op.add_column(
            "cost_estimations", sa.Column("kg_breakdown", sa.JSON(), nullable=True)
        )
        op.execute(
            """
            UPDATE cost_estimations AS estimation
               SET kg_breakdown = grouped.items::json
              FROM (
                  SELECT estimation_id,
                         jsonb_agg(jsonb_build_object(
                             'code', kg_code,
                             'label', label,
                             'amount', amount,
                             'perM2', per_m2,
                             'share_pct', share_pct
                         ) ORDER BY kg_code) AS items
                    FROM cost_estimation_items
                   GROUP BY estimation_id
              ) AS grouped
             WHERE grouped.estimation_id = estimation.id
            """
        )
        op.alter_column("cost_estimations", "kg_breakdown", nullable=False)

        op.add_column(
            "chat_channels",
            sa.Column("member_ids", sa.String(), nullable=True),
        )
        op.execute(
            """
            UPDATE chat_channels AS channel
               SET member_ids = COALESCE(grouped.member_ids, '')
              FROM (
                  SELECT channel_id, string_agg(user_id, ',' ORDER BY user_id) AS member_ids
                    FROM chat_channel_members
                   GROUP BY channel_id
              ) AS grouped
             WHERE grouped.channel_id = channel.id
            """
        )
        op.execute("UPDATE chat_channels SET member_ids = '' WHERE member_ids IS NULL")
        op.alter_column("chat_channels", "member_ids", nullable=False)

    op.drop_index("ix_subscriptions_external_subscription_item_id", table_name="subscriptions")
    op.drop_index("ix_subscriptions_external_customer_id", table_name="subscriptions")
    op.drop_column("subscriptions", "external_subscription_item_id")
    op.drop_column("subscriptions", "external_customer_id")
    op.drop_table("cost_estimation_items")
    op.drop_table("chat_channel_members")
    op.drop_index("idx_projects_tenant_created_id", table_name="projects")
    op.drop_index("idx_chat_channels_tenant_created_id", table_name="chat_channels")
    op.drop_index("idx_chat_messages_tenant_channel_created", table_name="chat_messages")
    op.drop_index("idx_chat_channels_tenant_project", table_name="chat_channels")
    op.drop_column("chat_messages", "tenant_id")
    op.drop_column("chat_channels", "tenant_id")
