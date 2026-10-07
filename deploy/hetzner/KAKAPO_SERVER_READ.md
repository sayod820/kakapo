# KAKAPO server read-only access layer

Status: R1.6 local implementation only. Nothing has been installed on production.
Installation, PostgreSQL provisioning, sudoers changes, secrets, and deployment
require a separate explicit R2 approval.

## Boundary

After approved installation, allowlisted read-only investigation needs no per-query
approval. Every production mutation still requires explicit approval and its own
privileged workflow. The existing deployment command remains unchanged:

```text
ssh kakapo-prod "sudo -n /usr/local/sbin/kakapo-deploy-online <FULL_SHA>"
```

The separate read command is:

```text
ssh kakapo-prod "sudo -n /usr/local/sbin/kakapo-server-read <fixed-command>"
```

## Exact command surface

```text
status
disk
memory
load

git-head
git-status
git-log [1..50]
git-tag

containers
container-health <api|web|nginx|postgres>
logs <api|web|nginx|postgres> [1..200]

nginx-status
nginx-config-summary

health
ready
web

client <client-id>
client-phone <phone>
client-search <literal-name-fragment>
card <card-number>
debt <client-id>
sale <sale-id>
sale-number <number>
order <order-id>
shift <shift-id>
finance <entry-id>
product <product-id>
sync-head
sync-entity <entity-type> <entity-id> [1..100]
```

There is deliberately no generic file reader, filesystem path/root argument,
environment reader, shell, executable, sudo, Docker, SQL, table, collection, URL,
Git repository, or `git show` command.

## Host and container safety

- Child processes use fixed absolute executable paths, `shell: false`, a minimal
  environment, fixed timeouts, and bounded buffers.
- Docker operations are only `ps`, `inspect`, and bounded recent `logs` against
  `kakapo-api`, `kakapo-web`, `kakapo-nginx`, and `kakapo-postgres`.
- There is no Docker `exec`, `run`, Compose, restart, stop, remove, volume, image,
  down, or prune path.
- Docker inspect output is projected; environment, command, labels, mounts, raw
  JSON, and credentials are not returned.
- Git reads use only `/opt/kakapo-release-online-v1.0.0` and fixed metadata
  operations. No caller path or revision is accepted.
- nginx inspection returns container state, fixed expected topology, and fixed HTTP
  probes. It never reads nginx or certificate files.
- HTTP probes use fixed URLs, GET only, five-second timeouts, discard response
  bodies, and do not follow redirects.

Logs are restricted to the last 30 minutes, at most 200 lines, 4096 characters per
line, and 128 KiB after redaction. Redaction covers authorization/bearer values,
cookies, JWTs, passwords, tokens, sessions, API keys, connection URLs, OTP/PIN,
pairing/device secrets, phones, and email addresses. A line with an unresolved
secret marker is replaced with `[REDACTED]`.

## PostgreSQL boundary

PostgreSQL business reads use `kakapo_inspector`, filtered views in the isolated
`kakapo_inspect` schema, fixed parameterized SELECT statements, and no general
access to `docs`, `kv_meta`, or `api_sessions`.

Provisioning fails closed if a pre-existing inspector role has dangerous
attributes, memberships, active sessions, default privileges, or owns database
objects. Any pre-existing password is cleared; a new password and root-only config
must be created together through the separately approved R2 secret workflow. The
final role is required to be:

- `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`;
- `NOINHERIT`, `NOREPLICATION`, `NOBYPASSRLS`;
- connection limit 2;
- no role memberships;
- no database CREATE or TEMP;
- no writable relation/schema privileges and no sequence `USAGE`/`UPDATE`;
- no direct `docs`, `api_sessions`, or `kv_meta` SELECT;
- SELECT only on the nine named inspection views.

TEMP normally arrives through PostgreSQL `PUBLIC`. Provisioning first preserves
the effective TEMP privilege of every other existing LOGIN role with direct grants,
then removes PUBLIC TEMP and leaves no TEMP grant for the inspector. This avoids
silently removing TEMP from the current application roles.

No global function EXECUTE privilege is changed. Instead, installation fails if
the inspector can execute any non-system function. Every runtime connection repeats
the role, effective ACL, TEMP, forbidden-table, and executable-function inventory.
A later user-defined function therefore makes inspection fail closed.

Every operation additionally uses:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
```

It verifies both transaction and default read-only state, applies short local
timeouts, and always finishes with `ROLLBACK`.

The root-only connection file is `/etc/kakapo-server-read.conf`, owner `root:root`,
mode `0600`, with exactly one key:

```text
KAKAPO_INSPECT_DATABASE_URL=<read-only URL>
```

The URL must name user `kakapo_inspector`, host `kakapo-postgres`, and database
`kakapo`. Runtime replaces only that fixed host with the private `kakapo-net`
container IP obtained through fixed `docker inspect`; public IPs are rejected.

## Exact-SHA R2 installation

R2 must be separately approved. The installer accepts exactly one lowercase
40-character SHA. It creates a fresh root-owned bare repository under `/run`, with
system/global Git configuration disabled and a fixed GitHub origin. It fetches
`origin/release/online-v1`, requires equality with that remote tip, validates that
the invoked installer matches the same Git object,
extracts only fixed paths with `git archive`, rejects symlink/non-regular artifacts,
and compares SHA-256 for every extracted artifact against `git show <SHA>:<path>`.

The library is built in a root-owned temporary directory, installed under a
versioned `/usr/local/lib/kakapo-server-read-<SHA>` path, made `root:root` and
non-writable by group/other, then selected through an atomic symlink. The wrapper
and sudoers are installed from the verified staging tree. `visudo -cf` validates
the candidate and `visudo -c` validates the complete configuration. The existing
`kakapo-deploy-online` wrapper is hashed before and after installation.

Do not execute an installer directly from a mutable checkout. During R2, first
extract the installer itself from the approved Git object into a root-owned
temporary file, verify its SHA-256 against the same object, and execute that file:

```text
install-kakapo-server-read.sh <FULL_40_CHARACTER_SHA>
```

The installer stages but does not execute the PostgreSQL role SQL. Applying that
SQL and creating the root-only connection secret are separate approved R2 steps.
Do not combine R2 with a web/API deployment.

## Sudo boundary

The only new rule is:

```text
kakapo-deploy ALL=(root) NOPASSWD: /usr/local/sbin/kakapo-server-read *
```

It grants no shell, Node, Python, psql, Docker, or other executable. Installed code,
wrapper, version link, configuration, and sudoers are root-owned and not writable
by `kakapo-deploy`. The existing deployment permission is not replaced or edited.
