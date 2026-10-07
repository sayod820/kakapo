# Hetzner Production Instructions

This directory controls production infrastructure containing real customer and business data.

## Mandatory safety

- Production inspection is read-only by default.
- Never deploy, restart services, apply a migration, restore data, rotate live configuration, or run operational reset scripts without explicit user approval for that exact action.
- Never truncate the production database or remove Docker/PostgreSQL volumes.
- Take and verify an appropriate backup before destructive, migration, restore, or high-risk infrastructure work.
- Never commit secrets, tokens, passwords, private keys, `.env` contents, database dumps, or certificate material.
- Never use root SSH, request a root password, broaden `kakapo-deploy` sudo rights, run arbitrary sudo/Docker commands, expose `deploy/hetzner/.env`, deploy an unpushed commit, or deploy a SHA different from `origin/release/online-v1`.

## Approved release workflow

- Deploy only after the user explicitly requests commit, push, and production deployment. A normal fix authorizes edit/test only; commit-only and commit-plus-push requests do not authorize deployment.
- Read applicable instructions; inspect and preserve dirty work; complete only the requested scope; run focused tests and required regressions from `docs/KAKAPO_TEST_MATRIX.md`; review the diff; and commit only intended files.
- Push `release/online-v1`, record `git rev-parse HEAD`, and verify it equals `git rev-parse origin/release/online-v1`. Do not deploy if tests fail or either SHA differs.
- The only approved privileged deploy command is `ssh kakapo-prod "sudo -n /usr/local/sbin/kakapo-deploy-online <FULL_40_CHARACTER_SHA>"`. Do not invoke other sudo, Docker, Docker Compose, migration, reset, or volume commands on production.
- Require wrapper output `KAKAPO DEPLOY SUCCESS`, the exact `SHA=<FULL_40_CHARACTER_SHA>`, and `POSTGRES_RECREATED=NO`. Then perform read-only checks of `/health`, `/ready`, `/`, the task endpoint, API/Web container health, and relevant recent logs; report the SHA, branch, tests, backup path, health, and rollback result.

## Production topology

- The release deployment for `kakapo-api`, `kakapo-web`, and `kakapo-nginx` is under `/opt/kakapo-release-online-v1.0.0/deploy/hetzner`.
- `kakapo-postgres` is the long-lived production PostgreSQL container. Normal deploys must not recreate it; the approved wrapper updates only API/Web and reloads nginx.

## Deployment boundaries

- nginx must preserve the intended web, API, WebSocket, update, health, and readiness routing boundaries.
- `/health` proves process health; `/ready` must prove PostgreSQL readiness. Verify both after an approved deployment, along with authenticated API behavior and a WebSocket connection.
- A rollback plan must identify the prior application image/source revision, compatible database state, frontend/Desktop feed state, and restore point before rollout begins.
- Database migrations and restores need explicit approval and a compatibility/rollback review; a container restart is not a rollback plan.
- Do not publish Desktop update metadata or artifacts as an incidental part of a web/API deployment.

Use `docs/KAKAPO_TEST_MATRIX.md` for pre-deploy verification. Mutating tests may run only against the guarded lab database, never production.
