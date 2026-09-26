#!/usr/bin/env bash
# Qwen Code against halogen-flash-server (:8731).
# The llama.cpp Flash-Next launcher is desktop/launch.sh (:8008).
# Start the engine first:
#   /ML_AI/AILeeMnq/scripts/serve-halogen-flash.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:8731/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-local}"
export OPENAI_MODEL="${OPENAI_MODEL:-qwen3.8-flash-next}"
export QWEN_MODEL="${QWEN_MODEL:-qwen3.8-flash-next}"
if ! curl -sf --max-time 3 "${OPENAI_BASE_URL}/models" >/dev/null; then
  echo "halogen-flash is not answering at ${OPENAI_BASE_URL}." >&2
  echo "Start it, then run this again:" >&2
  echo "  /ML_AI/AILeeMnq/scripts/serve-halogen-flash.sh" >&2
  exit 1
fi
cd "${QWEN_CODE_CWD:-/ML_AI}"
if [[ ! -f "$ROOT/dist/cli.js" ]]; then
  echo "Qwen Code is not built. From $ROOT run: npm install && npm run build" >&2
  exit 1
fi
exec node "$ROOT/scripts/cli-entry.js" "$@"
