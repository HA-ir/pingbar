#!/bin/bash
set -e

EXTENSION_UUID="pingbar@hossein"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing PingBar extension..."

# Compile schemas
echo "Compiling schemas..."
glib-compile-schemas "$SOURCE_DIR/schemas/"

# Create extension directory
mkdir -p "$EXTENSION_DIR"

# Copy files (not symlinks, so GNOME picks them up reliably)
cp "$SOURCE_DIR/metadata.json" "$EXTENSION_DIR/"
cp "$SOURCE_DIR/extension.js" "$EXTENSION_DIR/"
cp "$SOURCE_DIR/prefs.js" "$EXTENSION_DIR/"
cp "$SOURCE_DIR/stylesheet.css" "$EXTENSION_DIR/"
cp -r "$SOURCE_DIR/schemas" "$EXTENSION_DIR/"

echo "Extension installed to: $EXTENSION_DIR"
echo ""
echo "To activate:"
echo "  1. Restart GNOME Shell: Alt+F2 → type 'r' → Enter"
echo "  2. Enable: gnome-extensions enable $EXTENSION_UUID"
echo ""
echo "Or open GNOME Extensions app and toggle it on."
