# Updating a user-owned relay

The upstream repository can publish source updates, but it cannot silently modify or deploy every user's Cloudflare project. Each user-owned fork controls its own deployment credentials and bindings.

This repository includes `.github/workflows/upstream-sync.yml`. In a fork, set the
`HINGE_RELAY_UPSTREAM` repository variable if the upstream is not
`Chengeeker/Hinge-Relay`; the scheduled workflow then opens a pull request after
the user-owned deployment files pass the guard. It deliberately stops when the
upstream changes a deployment file, so a schema or binding migration is never
silently overwritten.

The managed source set is:

```text
src/
tests/
.github/
package.json
package-lock.json
tsconfig.json
VERSION
API_VERSION
CONFIG_SCHEMA_VERSION
docs/
README.md
SECURITY.md
LICENSE
```

Keep these files user-owned and never overwrite them during an upstream sync:

```text
wrangler.jsonc
.dev.vars
.env*
.hinge-upstream.json
Cloudflare secrets and bindings
```

If a user changes managed source files locally, the sync workflow must stop and report a conflict instead of erasing that change. If `CONFIG_SCHEMA_VERSION` changes, perform a manual migration before deploying.
