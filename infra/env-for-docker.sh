#!/usr/bin/env sh
# BEACON — render ../.env into infra/.env.docker for docker compose (finding: docker env-file parser).
#
# WHY THIS EXISTS. The same .env is read by TWO DIFFERENT parsers: Next.js's dotenv (strips inline
# `value  # comment` comments) and docker's env-file parser (does NOT — the comment becomes part of the
# value, and the fail-fast config validation then rejects every flag at container boot). This script is
# the bridge: it strips inline comments (a `#` preceded by whitespace) and blank/comment lines, writing a
# docker-safe render. Values containing '#' with no preceding whitespace (URL fragments, keys) survive.
#
# Regenerated on EVERY `npm run docker:up`, and gitignored like every other .env derivative — it contains
# the same secrets .env does. Never edit it by hand; edit ../.env.
set -eu
cd "$(dirname "$0")"
if [ ! -f ../.env ]; then
  echo "infra/env-for-docker.sh: no ../.env found — docker will run on compose defaults (offline profile)" >&2
  : > .env.docker
  exit 0
fi
sed -E -e 's/[[:space:]]+#.*$//' -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' -e 's/^([A-Z0-9_]+)="(.*)"$/\1=\2/' ../.env > .env.docker
echo "rendered infra/.env.docker ($(wc -l < .env.docker) vars) from ../.env"
