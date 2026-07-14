#!/bin/bash
set -e

EXTENSION_UUID="pingbar@hossein"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Uninstalling PingBar extension..."

gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null || true
rm -rf "$EXTENSION_DIR"

echo "Extension removed."
echo "Restart GNOME Shell: Alt+F2 → type 'r' → Enter"
