#!/usr/bin/env bash
# Copy glen-harness at the commit named in HARNESS_REF into vendor/glen-harness/.
# The page and the worker import it by relative path, so it loads from the same
# origin as the app, pinned, with nothing resolved at runtime. CI re-runs this
# and fails if the committed copy differs.
set -euo pipefail
cd "$(dirname "$0")/.."
ref=$(tr -d '[:space:]' < HARNESS_REF)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q https://github.com/SchmidtDSE/glen-harness.git "$tmp"
git -C "$tmp" checkout -q "$ref"
rm -rf vendor/glen-harness
mkdir -p vendor/glen-harness
cp -r "$tmp/src/." vendor/glen-harness/
cp "$tmp/LICENSE" vendor/glen-harness/LICENSE
echo "vendor/glen-harness <- SchmidtDSE/glen-harness@$ref"
