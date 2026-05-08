#!/usr/bin/env bash
# Place Irium sidecar binaries for Linux
# Run from the repo root: bash scripts/place-binaries-linux.sh

set -euo pipefail

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  TRIPLE="x86_64-unknown-linux-gnu" ;;
    aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
    *)       echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/../src-tauri/binaries"
SIDECARS=("iriumd" "irium-wallet" "irium-miner")

mkdir -p "$DEST"

for name in "${SIDECARS[@]}"; do
    destFile="$DEST/$name-$TRIPLE"

    if [[ -f "$destFile" ]]; then
        echo "[ok] $name-$TRIPLE already present"
        continue
    fi

    src=""

    # 1. Check PATH
    if command -v "$name" &>/dev/null; then
        src="$(command -v "$name")"
        echo "[found] $name in PATH: $src"
    fi

    # 2. Check common install locations
    if [[ -z "$src" ]]; then
        for candidate in \
            "$HOME/.irium/bin/$name" \
            "/usr/local/bin/$name" \
            "/usr/bin/$name"
        do
            if [[ -f "$candidate" ]]; then src="$candidate"; break; fi
        done
    fi

    if [[ -n "$src" ]]; then
        cp "$src" "$destFile"
        chmod +x "$destFile"
        echo "[copied] $src -> $destFile"
    else
        echo "[warning] $name not found. Download from https://github.com/iriumlabs/irium/releases and place at $destFile"
    fi
done

echo ""
echo "Verifying..."
for name in "${SIDECARS[@]}"; do
    destFile="$DEST/$name-$TRIPLE"
    if [[ -f "$destFile" ]]; then
        ver=$("$destFile" --version 2>&1 | head -1 || echo "unknown")
        echo "[ok] $name : $ver"
    else
        echo "[missing] $destFile"
    fi
done
