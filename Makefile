# ============================================================================
# NARCHI V5 — Development & Operations Makefile
# Unified commands for local dev, testing, Docker, and deployment
# ============================================================================

.PHONY: help dev build test lint docker-up docker-down docker-logs docker-clean \
        db-migrate db-seed db-import-prices db-reset \
        frontend-dev frontend-build frontend-test \
        backend-dev backend-test backend-shell security security-python security-frontend dependency-check \
        deploy-prod deploy-staging

# Default target
help:
	@echo "NARCHI V5 — Available Commands"
	@echo ""
	@echo "Development:"
	@echo "  make dev              - Start full stack (Docker Compose)"
	@echo "  make frontend-dev     - Start frontend only (Vite HMR)"
	@echo "  make backend-dev      - Start backend only (Uvicorn reload)"
	@echo ""
	@echo "Database:"
	@echo "  make db-migrate       - Run Alembic migrations"
	@echo "  make db-seed          - Seed default data (admins, plans)"
	@echo "  make db-import-prices - Import German price DB from PDF"
	@echo "  make db-reset         - Drop all tables and recreate"
	@echo ""
	@echo "Testing:"
	@echo "  make test             - Run all tests"
	@echo "  make backend-test     - Run backend tests only"
	@echo "  make frontend-test    - Run frontend tests only"
	@echo "  make lint             - Run static type/lint checks"
	@echo "  make security         - Bandit + pip-audit + npm audit + OWASP Dependency-Check"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up        - Build and start all containers"
	@echo "  make docker-down      - Stop and remove containers"
	@echo "  make docker-logs      - Follow container logs"
	@echo "  make docker-clean     - Remove all images, volumes, cache"
	@echo "  make docker-rebuild   - Full rebuild (no cache)"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-prod      - Production deployment (DEPLOY_PROD.ps1 equivalent)"
	@echo "  make deploy-staging   - Staging deployment"
	@echo ""
	@echo "Utilities:"
	@echo "  make backend-shell    - Shell into backend container"
	@echo "  make db-shell         - PostgreSQL shell"
	@echo "  make redis-shell      - Redis CLI"

# ============================================================================
# DEVELOPMENT
# ============================================================================

dev: docker-up

frontend-dev:
	cd frontend && npm run dev

backend-dev:
	cd backend && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# ============================================================================
# DATABASE
# ============================================================================

db-migrate:
	cd backend && python -m alembic upgrade head

db-seed:
	cd backend && python -m app.scripts.seed_subscriptions

db-import-prices:
	cd backend && python -m app.scripts.import_german_prices_2026

db-setup: db-migrate db-seed db-import-prices

db-reset:
	cd backend && python -m alembic downgrade base && python -m alembic upgrade head

# ============================================================================
# TESTING
# ============================================================================

test: backend-test frontend-test

backend-test:
	cd backend && python -m pytest tests/ -v --cov=app --cov-report=term-missing

frontend-test:
	cd frontend && npm run test

lint:
	cd backend && ruff check app tests
	cd frontend && npm run typecheck

security: security-python security-frontend dependency-check

security-python:
	cd backend && bandit -c pyproject.toml -r app
	cd backend && pip-audit -r requirements.txt

security-frontend:
	cd frontend && npm audit --audit-level=high

dependency-check:
	@mkdir -p security-reports/dependency-check
	docker run --rm \
	  -v "$(CURDIR):/src:ro" \
	  -v "$(CURDIR)/security-reports/dependency-check:/report" \
	  owasp/dependency-check:12.1.3 \
	  --project NARCHI-V5 --scan /src/backend --scan /src/frontend \
	  --format HTML --format JSON --out /report --failOnCVSS 7

# ============================================================================
# DOCKER
# ============================================================================

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down -v --remove-orphans

docker-logs:
	docker compose logs -f --tail=100

docker-clean:
	docker compose down -v --remove-orphans --rmi all
	docker builder prune -f
	docker system prune -f

docker-rebuild: docker-clean docker-up

# ============================================================================
# DEPLOYMENT
# ============================================================================

deploy-prod:
	@echo "🚀 Production Deployment"
	@if command -v powershell.exe >/dev/null 2>&1; then \
		powershell.exe -ExecutionPolicy Bypass -File DEPLOY_PROD.ps1; \
	else \
		docker compose down -v --remove-orphans && \
		docker builder prune -f && \
		docker compose build --no-cache && \
		docker compose up -d --force-recreate; \
	fi

deploy-staging:
	@echo "🚀 Staging Deployment"
	docker compose -f docker-compose.yml -f docker-compose.staging.yml down -v --remove-orphans
	docker compose -f docker-compose.yml -f docker-compose.staging.yml build --no-cache
	docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --force-recreate

# ============================================================================
# UTILITIES
# ============================================================================

backend-shell:
	docker compose exec backend bash

db-shell:
	docker compose exec db psql -U $${POSTGRES_USER:-narchi} -d $${POSTGRES_DB:-narchi_v3}

redis-shell:
	docker compose exec redis redis-cli

# Health checks
health:
	@curl -sf http://localhost:8000/health | jq . || echo "Backend unhealthy"
	@curl -sf http://localhost:8080/ | grep -q "NARCHI" && echo "Frontend OK" || echo "Frontend unhealthy"

# Database backup/restore
db-backup:
	docker compose exec -T db pg_dump -U $${POSTGRES_USER:-narchi} $${POSTGRES_DB:-narchi_v3} > backup_$$(date +%Y%m%d_%H%M%S).sql

db-restore:
	@read -p "Backup file: " file; \
	docker compose exec -T db psql -U $${POSTGRES_USER:-narchi} -d $${POSTGRES_DB:-narchi_v3} < $$file

# Generate requirements
requirements:
	cd backend && pip freeze > requirements.txt

# Update dependencies
update-deps:
	cd backend && pip install --upgrade pip && pip install -U -r requirements.txt
	cd frontend && npm update