#!/usr/bin/env bash
# Native Qwen Code window (Tauri 2) against halogen-flash-server (:8731).
# The terminal launcher is desktop/launch-halogen.sh.
# An engine that is already listening on :8731 is detected by the window.
# If it is not up, the AI Server page can start it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$ROOT/packages/desktop-shell"
RUNTIME="$SHELL_DIR/runtime/qwen-code"
BINARY="$SHELL_DIR/src-tauri/target/release/qwen-code-desktop"
API="${OPENAI_BASE_URL:-http://127.0.0.1:8731/v1}"

fail() {
  echo "$1" >&2
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Qwen Code (Halogen)" "$1" || true
  fi
  exit 1
}

if [[ ! -x "$RUNTIME/node/bin/node" || ! -f "$RUNTIME/lib/cli-entry.js" ]]; then
  fail "Desktop runtime is missing at $RUNTIME. From $SHELL_DIR run: QWEN_DESKTOP_SKIP_BUILD=1 npm run build:runtime --workspaces=false"
fi
if [[ ! -x "$BINARY" ]]; then
  fail "Desktop binary is missing at $BINARY. From $SHELL_DIR run: npx tauri build --no-bundle"
fi

export OPENAI_BASE_URL="$API"
export OPENAI_API_KEY="${OPENAI_API_KEY:-local}"
export OPENAI_MODEL="${OPENAI_MODEL:-qwen3.8-flash-next}"
export QWEN_MODEL="${QWEN_MODEL:-qwen3.8-flash-next}"
export QWEN_DESKTOP_WORKSPACE="${QWEN_DESKTOP_WORKSPACE:-/ML_AI}"
export QWEN_DESKTOP_RUNTIME_DIR="$RUNTIME"
export QWEN_DESKTOP_DISABLE_UPDATES=1
export QWEN_CODE_SUPPRESS_YOLO_WARNING="${QWEN_CODE_SUPPRESS_YOLO_WARNING:-1}"

exec "$BINARY"
