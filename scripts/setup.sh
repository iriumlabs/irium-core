#!/usr/bin/env bash
# Detect OS and run the correct binary placement script
# Run from the repo root: bash scripts/setup.sh

set -euo pipefail

OS="$(uname -s)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$OS" in
    Darwin)  bash "$SCRIPT_DIR/place-binaries-macos.sh" ;;
    Linux)   bash "$SCRIPT_DIR/place-binaries-linux.sh" ;;
    MINGW*|MSYS*|CYGWIN*) powershell -ExecutionPolicy Bypass -File "$SCRIPT_DIR/place-binaries-windows.ps1" ;;
    *)       echo "Unsupported OS: $OS"; exit 1 ;;
esac
