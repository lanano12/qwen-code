#!/usr/bin/env bash
# Install Qwen Code icon + Desktop shortcut + GNOME dock pin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ICON_DIR="$ROOT/icons"
NAME="qwen-code"
DESKTOP_ID="QwenCode.desktop"

chmod +x "$ROOT/install-desktop.sh" "$ROOT/launch.sh"

if command -v magick >/dev/null 2>&1 && [[ -f "$ICON_DIR/${NAME}.png" ]]; then
  magick "$ICON_DIR/${NAME}.png" -resize 64x64 "$ICON_DIR/${NAME}-64.png"
  magick "$ICON_DIR/${NAME}.png" -resize 128x128 "$ICON_DIR/${NAME}-128.png"
  magick "$ICON_DIR/${NAME}.png" -resize 256x256 "$ICON_DIR/${NAME}-256.png"
fi

mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$HOME/.local/share/applications"
if [[ -f "$ICON_DIR/${NAME}.svg" ]]; then
  cp -f "$ICON_DIR/${NAME}.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/${NAME}.svg"
fi

for sz in 64 128 256; do
  mkdir -p "$HOME/.local/share/icons/hicolor/${sz}x${sz}/apps"
  src="$ICON_DIR/${NAME}-${sz}.png"
  if [[ -f "$src" ]]; then
    cp -f "$src" "$HOME/.local/share/icons/hicolor/${sz}x${sz}/apps/${NAME}.png"
  elif [[ -f "$ICON_DIR/${NAME}.png" ]]; then
    cp -f "$ICON_DIR/${NAME}.png" "$HOME/.local/share/icons/hicolor/${sz}x${sz}/apps/${NAME}.png"
  fi
done

cp -f "$ROOT/$DESKTOP_ID" "$HOME/.local/share/applications/$DESKTOP_ID"
cp -f "$ROOT/$DESKTOP_ID" "$HOME/Desktop/$DESKTOP_ID"
chmod +x "$HOME/Desktop/$DESKTOP_ID"

if command -v gio >/dev/null 2>&1; then
  gio set "$HOME/Desktop/$DESKTOP_ID" metadata::trusted true 2>/dev/null || true
fi

gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

if command -v gsettings >/dev/null 2>&1 && gsettings list-keys org.gnome.shell 2>/dev/null | grep -qx favorite-apps; then
  python3 - <<'PY'
import ast, subprocess
raw = subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "favorite-apps"], text=True
).strip()
apps = ast.literal_eval(raw)
target = "QwenCode.desktop"
if target not in apps:
    if "DeepSeekHarness.desktop" in apps:
        apps.insert(apps.index("DeepSeekHarness.desktop") + 1, target)
    elif "GrokComboTUI.desktop" in apps:
        apps.insert(apps.index("GrokComboTUI.desktop") + 1, target)
    else:
        apps.append(target)
    literal = "[" + ", ".join("'" + a.replace("'", r"\'") + "'" for a in apps) + "]"
    subprocess.check_call(["gsettings", "set", "org.gnome.shell", "favorite-apps", literal])
    print(f"Pinned {target} to dock favorites")
else:
    print(f"{target} already on dock favorites")
PY
fi

echo "Installed Qwen Code → ~/Desktop and applications (icon: $ICON_DIR/${NAME}.png)"
