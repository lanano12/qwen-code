#!/usr/bin/env bash
# Qwen Code CLI against local FreeToken (:1919).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:1919/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-local}"
export OPENAI_MODEL="${OPENAI_MODEL:-Qwen3.6-35B-A3B-NVFP4}"
export QWEN_MODEL="${QWEN_MODEL:-Qwen3.6-35B-A3B-NVFP4}"
cd "${QWEN_CODE_CWD:-/ML_AI}"
if [[ ! -f "$ROOT/dist/cli.js" ]]; then
  echo "Qwen Code is not built. From $ROOT run: npm install && npm run build" >&2
  exit 1
fi
exec node "$ROOT/scripts/cli-entry.js" "$@"
