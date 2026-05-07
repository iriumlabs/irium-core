#!/usr/bin/env bash
# ============================================================
# Irium Core GUI — Setup & Run Script
# ============================================================
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$PROJECT_DIR/src-tauri/binaries"
cd "$PROJECT_DIR"

# ── Detect platform ──────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS-$ARCH" in
  Linux-x86_64)  TARGET="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64) TARGET="aarch64-unknown-linux-gnu" ;;
  Darwin-x86_64) TARGET="x86_64-apple-darwin" ;;
  Darwin-arm64)  TARGET="aarch64-apple-darwin" ;;
  MINGW*|MSYS*|CYGWIN*)
    TARGET="x86_64-pc-windows-msvc"
    EXE=".exe"
    ;;
  *)
    echo "⚠  Unsupported platform: $OS-$ARCH"
    TARGET="unknown"
    ;;
esac
EXE="${EXE:-}"

echo "──────────────────────────────────────────────────────────"
echo "  Irium Core GUI  |  Platform: $OS-$ARCH  |  Target: $TARGET"
echo "──────────────────────────────────────────────────────────"

# ── Check dependencies ───────────────────────────────────────
check() {
  command -v "$1" &>/dev/null || { echo "✗ Missing: $1 — install it and retry."; exit 1; }
}
check node
check npm
check cargo

# ── Download or link Irium binaries ─────────────────────────
mkdir -p "$BINARIES_DIR"

install_binary() {
  local name="$1"
  local src
  src=$(command -v "$name" 2>/dev/null || true)
  local dest="$BINARIES_DIR/${name}-${TARGET}${EXE}"

  if [ -f "$dest" ]; then
    echo "✓ $name binary already in binaries/"
    return
  fi

  if [ -n "$src" ] && [ -f "$src" ]; then
    echo "→ Copying system $name → binaries/"
    cp "$src" "$dest"
    chmod +x "$dest"
    echo "✓ $name installed from system PATH"
  else
    echo "→ Downloading $name from iriumlabs/irium GitHub releases…"
    RELEASE_URL="https://github.com/iriumlabs/irium/releases/latest/download/${name}-${TARGET}${EXE}"
    if curl -fsSL --progress-bar -o "$dest" "$RELEASE_URL"; then
      chmod +x "$dest"
      echo "✓ $name downloaded"
    else
      echo "⚠  Could not download $name. Install iriumd manually or run:"
      echo "   curl -fsSL https://raw.githubusercontent.com/iriumlabs/irium/main/install.sh | bash"
      echo "   Then re-run this script."
    fi
  fi
}

install_binary iriumd
install_binary irium-wallet
install_binary irium-miner

# ── Install npm dependencies ─────────────────────────────────
if [ ! -d node_modules ]; then
  echo "→ Installing npm dependencies…"
  npm install
  echo "✓ npm dependencies installed"
else
  echo "✓ node_modules already present"
fi

# ── Choose action ────────────────────────────────────────────
ACTION="${1:-dev}"

case "$ACTION" in
  dev)
    echo ""
    echo "→ Starting Irium Core GUI in development mode…"
    echo "  (Tauri will compile the Rust backend on first run — this may take a few minutes)"
    echo ""
    npm run tauri dev
    ;;
  build)
    echo ""
    echo "→ Building Irium Core GUI release binary…"
    npm run tauri build
    echo ""
    echo "✓ Build complete. Find your installer in: src-tauri/target/release/bundle/"
    ;;
  *)
    echo "Usage: $0 [dev|build]"
    exit 1
    ;;
esac
