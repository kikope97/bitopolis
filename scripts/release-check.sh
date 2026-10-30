#!/usr/bin/env bash
# Decide si esta ejecución publica una versión nueva (lo usa el CI).
# Salida (GITHUB_OUTPUT): version=X.Y.Z y new=true|false.
# Es nueva si: push a main, versión distinta de 0.0.0 y sin etiqueta vX.Y.Z en el repo.
set -euo pipefail
v=$(node -p "require('./package.json').version")
new=false
if [ "${GITHUB_EVENT_NAME:-}" = "push" ] && [ "${GITHUB_REF:-}" = "refs/heads/main" ] && [ "$v" != "0.0.0" ]; then
  if ! gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/v${v}" >/dev/null 2>&1; then new=true; fi
fi
echo "version=$v" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "new=$new" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "Versión $v · nueva: $new"
