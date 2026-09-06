# NARCHI V5 — Architecture Documentation

> **Version:** 5.0.0 | **Status:** Production-Ready | **Last Updated:** 2026-07-13

---

## 🎯 Vision & Principles

NARCHI V5 is an **industrial-grade BIM Audit & Costing Engine** built for:
- **Zero-downtime operation** — Hot migrations, graceful degradation
- **Multi-tenant isolation** — Structural data separation at DB level
- **Security-first** — OWASP 2026, SOC2, Argon2id, JWT with session invalidation
- **Observability-native** — Structured JSON logging, Prometheus, distributed tracing
- **Developer experience** — Type-safe, modular, testable, well-documented

### Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Explicit over implicit** | No magic, all dependencies visible |
| **Fail fast, fail safe** | Circuit breakers, rate limits, quotas |
| **Zero-trust architecture** | Tenant isolation, signed URLs, input validation |
| **Observability by default** | Correlation IDs, structured logs, metrics |
| **Container-native** | cgroups-aware, health checks, resource limits |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL CLIENTS                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Browser   │  │   Mobile    │  │   Revit     │  │   CI/CD / API       │ │
│  │   (React)   │  │   App       │  │   Plugin    │  │   Clients           │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────┼─────────────────────┼────────────┘
          │                │                │                     │
          ▼                ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NGINX (Frontend Container)                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  • Static Assets (React SPA)        • Rate Limiting (Auth: 10/min)      │ │
│  │  • WASM Assets (web-ifc)            • CSP, HSTS, COOP/COEP              │ │
│  │  • Reverse Proxy → Backend          • WebSocket Upgrade (/chat/ws)      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FASTAPI BACKEND (4 Workers)                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Middleware Stack (outer→inner):                                        │ │
│  │  1. PrometheusMetricsMiddleware  2. CORS (hardened)  3. TenantIsolation │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  API Routers (v1):                                                       │ │
│  │  • /auth          — JWT, cookies, guest login, password migration       │ │
│  │  • /projects      — Multi-tenant CRUD, IFC upload, status tracking      │ │
│  │  • /ifc           — Native parsing, QTO extraction, 3D viewer data      │ │
│  │  • /prices/de     — German price DB (BKI/STLB/Destatis 2026)            │ │
│  │  • /billing       — Subscriptions, quotas, FinOps                       │ │
│  │  • /chat          — WebSocket real-time, AI copilot                     │ │
│  │  • /reports       — PDF/Excel generation, DIN 276, HOAI                 │ │
│  │  • /health|metrics — Observability endpoints                            │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│   POSTGRESQL 16     │   │      REDIS 7        │   │   CELERY WORKER     │
│   (Primary + Replica)│   │   (Cache + Rate     │   │   (4 Concurrency)   │
│   • ACID + MVCC     │   │    Limiting +       │   │   • IFC Parsing     │ │
│   • Row-Level       │   │    Sessions)        │   │   • Report Gen      │ │
│     Security        │   │   • Pub/Sub (Chat)  │   │   • Email Tasks     │ │
│   • Partitioning    │   │   • Celery Broker   │   │   • Price Import    │ │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

---

## 📦 Backend Module Structure

```
backend/app/
├── core/                    # Infrastructure (no business logic)
│   ├── config.py           # Pydantic Settings (env-driven)
│   ├── database.py         # SQLAlchemy engines, RoutingSession
│   ├── logging.py          # Structured JSON logging + correlation IDs
│   ├── security/           # Auth package (modular)
│   │   ├── config.py       # SECRET_KEY, Argon2 hasher, tenant context
│   │   ├── passwords.py    # Hash/verify (Argon2id + SHA-256 fallback)
│   │   ├── jwt.py          # Token create/decode
│   │   ├── dependencies.py # FastAPI deps (get_current_user, RBAC)
│   │   ├── admin.py        # Default admin/guest seeding
│   │   ├── password_migration.py  # SHA-256 → Argon2id migration
│   │   ├── cookie_adapter.py      # Dynamic Secure/SameSite
│   │   └── __init__.py   # Unified exports
│   ├── middleware.py       # TenantIsolation, RateLimit
│   ├── telemetry.py        # Prometheus, Sentry
│   ├── exceptions.py       # Global error handlers
│   ├── cors.py             # Hardened CORS config
│   ├── celery_app.py       # Celery config
│   └── __init__.py         # Core public API
│
├── models/                  # SQLAlchemy ORM (data layer only)
│   ├── base.py             # Base, UUIDMixin, HasTenantColumn
│   ├── user.py
│   ├── project.py
│   ├── subscription.py
│   ├── audit_log.py
│   ├── chat.py
│   ├── feedback.py
│   └── german_price/       # 8 tables + 4 SQL functions
│       ├── regions.py
│       ├── indices.py
│       ├── labor_rates.py
│       ├── materials.py
│       ├── benchmarks.py
│       ├── price_items.py
│       ├── suppliers.py
│       └── sustainability.py
│
├── schemas/                 # Pydantic (API contracts)
│   ├── auth.py
│   ├── project.py
│   ├── subscription.py
│   ├── german_price.py
│   └── common.py           # Pagination, ErrorResponse
│
├── services/                # Business logic (stateless, testable)
│   ├── auth_service.py
│   ├── project_service.py
│   ├── quota_service.py
│   ├── storage_service.py
│   ├── german_price_service.py
│   ├── estimation_service.py
│   ├── ifc_parser_service.py
│   ├── subscription_service.py
│   └── email_service.py
│
├── api/                     # Controllers (thin, delegate to services)
│   ├── deps.py             # Reusable FastAPI dependencies
│   └── v1/
│       ├── auth.py
│       ├── projects.py
│       ├── prices_de.py
│       ├── subscriptions.py
│       ├── ifc.py
│       ├── chat.py
│       ├── reports.py
│       └── health.py
│
├── workers/                 # Celery tasks
│   ├── ifc_tasks.py
│   ├── report_tasks.py
│   └── email_tasks.py
│
├── cli/                     # Typer commands
│   ├── migrate.py
│   ├── seed.py
│   ├── import_prices.py
│   └── dev.py
│
├── main.py                  # App factory + lifespan
├── lifespan.py              # Startup/shutdown events
└── __init__.py
```

---

## 🔐 Security Architecture

### Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   NGINX     │────▶│  FastAPI    │────▶│  PostgreSQL │
│  (Browser)  │     │  (Proxy)    │     │  (Auth)     │     │  (Users)    │
└─────────────┘     └─────────────┘     └──────┬──────┘     └─────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    ▼                           ▼                           ▼
            ┌───────────────┐           ┌───────────────┐           ┌───────────────┐
            │ HttpOnly      │           │ Authorization │           │ Refresh Token │
            │ Cookie        │           │ Header        │           │ (7 days)      │
            │ (15 min)      │           │ Bearer JWT    │           │ HttpOnly      │
            └───────────────┘           └───────────────┘           └───────────────┘
                    │                           │                           │
                    └───────────────────────────┼───────────────────────────┘
                                                ▼
                                    ┌───────────────────────┐
                                    │  verify_password()    │
                                    │  Argon2id (primary)   │
                                    │  SHA-256 (legacy)     │
                                    │  Auto-migration       │
                                    └───────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │  create_access_token()│
                                    │  JWT HS256            │
                                    │  pw_stamp (8 chars)   │
                                    │  tenant_id embedded   │
                                    └───────────────────────┘
```

### Password Migration (Zero-Downtime)

```python
# On every successful login:
is_valid, new_hash = PasswordMigrationService.verify_and_migrate(
    plain_password, user.hashed_password
)

if new_hash:  # Legacy SHA-256 detected
    user.hashed_password = new_hash  # Re-hash to Argon2id
    user.password_migrated_at = datetime.utcnow()
    db.commit()
```

### Multi-Tenant Isolation (Structural)

```sql
-- Every table with HasTenantColumn has:
tenant_id VARCHAR(255) NOT NULL

-- SQLAlchemy event listeners auto-inject:
-- SELECT: WHERE tenant_id = current_tenant_id
-- INSERT: tenant_id = current_tenant_id
```

---

## 📊 German Price Database (BKI/STLB-Bau/Destatis 2026)

### Schema Overview

| Table | Records | Purpose |
|-------|---------|---------|
| `de_regions_2026` | 38 | Cost indices by region (Bundesland/Stadt) |
| `de_price_index_2026` | 15+ | Destatis quarterly indices 2024-2026 |
| `de_labor_rates_2026` | 19×5 | BRTV-Bau hourly rates (5 regions) |
| `de_material_prices_2026` | 400+ | Material prices with CO₂/recycling |
| `de_building_benchmarks_2026` | 8 | DIN 276 benchmarks by building type |
| `de_price_items_2026` | 200+ | STLB-Bau items mapped to IFC entities |
| `de_suppliers_2026` | 50+ | Supplier catalog with terms |
| `de_sustainability_data` | 200+ | EPD/GWP per EN 15804+A2 |

### SQL Functions (Server-Side)

```sql
-- Regional price correction
de_get_regional_price_2026(base_price, region_code, price_type)

-- Quick building estimate
de_quick_estimate_2026(building_type, bgf_m2, region, standard)

-- Full-text price search (pg_trgm)
de_search_prices_2026(query, kg_code, kategorie, limit)

-- IFC quantity-based estimate
de_estimate_by_ifc_2026(quantities_jsonb, region, standard)
```

### API Endpoints

```
GET  /api/v5/prices/de/regions
GET  /api/v5/prices/de/indices
GET  /api/v5/prices/de/labor-rates
GET  /api/v5/prices/de/materials
GET  /api/v5/prices/de/benchmarks
POST /api/v5/prices/de/estimate/quick
POST /api/v5/prices/de/estimate/from-ifc
POST /api/v5/prices/de/search
GET  /api/v5/prices/de/materials/{code}/co2
GET  /api/v5/prices/de/materials/{code}/sustainability
```

---

## 📝 Structured Logging

### Configuration

```python
# app/core/logging.py
setup_logging(
    level="INFO",
    json_format=True,        # Production: JSON, Dev: pretty
    include_stdlib=True      # Capture uvicorn, sqlalchemy, etc.
)
```

### Log Format (JSON)

```json
{
  "timestamp": "2026-07-13T14:32:15.123Z",
  "level": "INFO",
  "logger": "narchi.api.auth",
  "module": "auth_routes",
  "function": "login_for_access_token",
  "line": 87,
  "request_id": "req_abc123",
  "tenant_id": "tenant-xyz789",
  "user_id": "user_123",
  "environment": "production",
  "service": "narchi-backend",
  "version": "3.15.0-PROD",
  "message": "User login successful",
  "email": "architect@example.com",
  "duration_ms": 45.2
}
```

### Correlation ID Propagation

```python
# Middleware injects request_id into context
with LoggingContext(request_id=req_id, tenant_id=tenant_id, user_id=user_id):
    logger.info("Processing request")
    # All nested logs include correlation IDs automatically
```

### Log Levels by Component

| Component | Level | Purpose |
|-----------|-------|---------|
| `narchi.api` | INFO | Request/response, auth events |
| `narchi.services` | DEBUG | Business logic tracing |
| `narchi.security` | INFO | Login, token, migration events |
| `narchi.middleware` | WARNING | Rate limits, circuit breakers |
| `narchi.database` | DEBUG | Connection pool, slow queries |
| `sqlalchemy.engine` | WARNING | SQL (INFO in DEBUG mode) |
| `uvicorn.access` | WARNING | Access logs (disabled in prod) |

---

## 🐳 Docker Deployment

### Production Stack (docker-compose.yml)

```yaml
services:
  db:
    # §51 — image locale buildée (infra/postgres) : postgres 16 + pgvector
    # + pgBackRest ; §55 — plus aucune référence postgres:16-alpine
    # (db-password-sync utilise l'image locale avec entrypoint psql).
    build: ./infra/postgres
    image: narchi-postgres:16-pgvector-pgbackrest
    healthcheck: pg_isready
    deploy:
      resources:
        limits: { cpus: '2.0', memory: 2G }

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb
    healthcheck: redis-cli ping

  backend:
    build: ./backend
    depends_on: { db: { condition: service_healthy }, redis: { condition: service_healthy } }
    healthcheck: wget -q --spider http://localhost:8000/health
    deploy:
      resources:
        limits: { cpus: '2.0', memory: 2G }

  worker:
    build: ./backend
    command: celery -A app.core.celery_app worker --concurrency=4
    deploy:
      resources:
        limits: { cpus: '2.0', memory: 4G }

  frontend:
    build: ./frontend
    ports: ["8080:80"]
    depends_on: { backend: { condition: service_healthy } }
```

### Deployment Commands

```bash
# Development
make dev                    # Full stack with hot reload

# Production (Windows PowerShell)
.\DEPLOY_PROD.ps1           # Full rebuild + deploy

# Linux/Mac
make deploy-prod            # Equivalent via Makefile

# Manual steps
docker compose down -v --remove-orphans
docker builder prune -f
docker compose build --no-cache
docker compose up -d --force-recreate
```

### Health Verification

```bash
# Backend
curl http://localhost:8000/health
# {"status":"operational","version":"3.15.0-PROD"}

# Frontend
curl -I http://localhost:8080
# 200 OK

# Metrics
curl http://localhost:8000/metrics
# Prometheus format
```

---

## 🧪 Testing Strategy

```
tests/
├── unit/                    # Pure functions, services (fast, isolated)
│   ├── test_passwords.py
│   ├── test_jwt.py
│   ├── test_quota_service.py
│   └── test_german_price_service.py
├── integration/             # DB, Redis, external APIs
│   ├── test_auth_flow.py
│   ├── test_project_crud.py
│   └── test_price_api.py
├── e2e/                     # Full stack (Playwright/Cypress)
│   ├── test_login_flow.spec.ts
│   ├── test_ifc_upload.spec.ts
│   └── test_estimation.spec.ts
└── conftest.py              # Pytest fixtures (db, client, auth)
```

### Run Tests

```bash
# Backend
cd backend
pytest tests/unit -v --cov=app
pytest tests/integration -v

# Frontend
cd frontend
npm run test
npm run test:e2e
```

---

## 📈 Observability Stack

### Metrics (Prometheus)

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Requests by method, path, status |
| `http_request_duration_seconds` | Histogram | Latency percentiles |
| `db_pool_usage` | Gauge | SQLAlchemy pool utilization |
| `celery_tasks_total` | Counter | Tasks by name, status |
| `auth_login_total` | Counter | Logins by result (success/failed) |
| `quota_usage_percent` | Gauge | Per-tenant storage usage |

### Dashboards (Grafana)

1. **System Overview** — CPU, Memory, Disk, Network
2. **API Performance** — Latency, Error Rate, Throughput
3. **Business Metrics** — Active Tenants, Projects, Estimations
4. **Security** — Failed Logins, Rate Limits, Quota Exceeded
5. **Database** — Connections, Query Duration, Cache Hit Ratio

### Alerting Rules

```yaml
groups:
- name: narchi.rules
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
    for: 2m
    labels: { severity: critical }
    annotations: { summary: "High 5xx error rate" }

  - alert: DatabaseConnectionsHigh
    expr: db_pool_usage > 0.9
    for: 5m
    labels: { severity: warning }
    annotations: { summary: "DB pool near exhaustion" }

  - alert: CircuitBreakerOpen
    expr: cpu_usage_percent > 80
    for: 1m
    labels: { severity: critical }
    annotations: { summary: "CPU circuit breaker triggered" }
```

---

## 🔄 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
stages:
  - lint:        ruff, mypy, eslint, prettier
  - test:        unit + integration (parallel)
  - build:       Docker multi-arch (amd64/arm64)
  - scan:        Trivy (vulns), Syft (SBOM), Cosign (sign)
  - deploy-staging:  Auto on main branch
  - deploy-prod:     Manual approval, tag-based
```

---

## 📋 Operational Runbooks

### Incident: Backend Unhealthy

```bash
# 1. Check logs
docker logs backend --tail 100 -f

# 2. Check dependencies
docker ps --format "table {{.Names}}\t{{.Status}}"
curl -sf http://localhost:8000/health

# 3. Common fixes
# - DB connection: check pg_isready, pg_stat_activity
# - Redis: redis-cli ping, check memory
# - Migration: alembic current, alembic upgrade head
```

### Incident: High Memory (OOM Risk)

```bash
# Check container stats
docker stats backend worker

# Reduce workers or increase limits
# docker-compose.yml: deploy.resources.limits.memory
```

### Incident: Quota Exceeded

```bash
# Check tenant usage
docker exec backend python -c "
from app.database import SessionLocal
from app.services.quota_service import QuotaService
db = SessionLocal()
print(QuotaService.get_quota_status(db, 'tenant-xyz'))
"

# Upgrade plan or increase override
```

---

## 🗂️ File Inventory (Key Files)

| File | Purpose |
|------|---------|
| `backend/app/main.py` | App factory, lifespan, middleware stack |
| `backend/app/core/logging.py` | Structured logging configuration |
| `backend/app/core/security/__init__.py` | Unified security exports |
| `backend/app/core/security/passwords.py` | Argon2id + legacy SHA-256 |
| `backend/app/core/security/jwt.py` | Token creation/decoding |
| `backend/app/core/security/dependencies.py` | FastAPI auth deps + RBAC |
| `backend/app/core/security/password_migration.py` | Hot migration service |
| `backend/app/core/tenant_interceptor.py` | SQLAlchemy tenant isolation |
| `backend/app/database.py` | Master-Replica routing session |
| `backend/app/models/german_price/*.py` | 8 price tables |
| `backend/app/services/german_price_service.py` | Price DB business logic |
| `backend/app/api/price_routes.py` | Price REST API |
| `frontend/src/lib/ifc/WasmCorsGateway.ts` | WASM loading with CORS handling |
| `docker-compose.yml` | Production stack definition |
| `Makefile` | Unified dev/ops commands |

---

## 📚 References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Argon2id Parameters](https://github.com/P-H-C/phc-winner-argon2)
- [SQLAlchemy 2.0 ORM](https://docs.sqlalchemy.org/en/20/orm/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [Docker Compose Production](https://docs.docker.com/compose/production/)

---

*Generated with ❤️ for NARCHI V5 — Industrial-Grade BIM Intelligence*