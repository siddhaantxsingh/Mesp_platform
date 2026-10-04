# MESP platform developer commands. See README for prerequisites.
.PHONY: install vectors test test-py test-api test-web e2e lint dev-api dev-web up down load

install:
	pip install -e packages/protocol/python -e replay -e simulator -e "services/gateway[sim,serial,ble]" -e "apps/api[dev]"
	npm ci

vectors:            ## regenerate firmware conformance vectors
	./firmware-harness/build.sh

lint:
	ruff check .
	npm -w apps/web run lint

test-py:
	pytest -q packages/protocol/python/tests simulator/tests replay/tests services/gateway/tests
	cd apps/api && pytest -q
	pytest -q tests/integration

test-web:
	npm -w apps/web run test
	npm -w packages/protocol/ts run test

test: lint test-py test-web

dev-api:            ## API in demo mode on :8000 (SQLite)
	cd apps/api && MESP_JWT_SECRET=dev-only-secret-change-me-000000 uvicorn mesp_api.main:app --reload --port 8000

dev-web:            ## console on :5173 (proxies /api to :8000)
	npm -w apps/web run dev

e2e:
	npm -w apps/web run e2e

up:
	docker compose up --build -d

down:
	docker compose down

load:
	python tests/load/ingest_load.py concurrent --devices 8 --seconds 30
