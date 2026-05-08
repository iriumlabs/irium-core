#!/usr/bin/env node
/**
 * build-irium-node.js
 *
 * Compiles iriumd, irium-wallet, and irium-miner from the irium-source git
 * submodule and places the resulting binaries in src-tauri/binaries/ using
 * Tauri's sidecar naming convention (<name>-<target-triple>[.exe]).
 *
 * Flags:
 *   --force   Skip cache check and always rebuild
 *   --check   Exit 0 if binaries are up-to-date, 1 if a rebuild is needed
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '..');
const SOURCE_DIR   = path.join(ROOT, 'irium-source');
const BINARIES_DIR = path.join(ROOT, 'src-tauri', 'binaries');
const BINARIES     = ['iriumd', 'irium-wallet', 'irium-miner'];

const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');

// ─── Platform ─────────────────────────────────────────────────────────────────

function getTargetTriple() {
  const platform = os.platform();
  const arch     = os.arch();
  const key      = `${platform}-${arch}`;
  const triples  = {
    'win32-x64':    'x86_64-pc-windows-msvc',
    'linux-x64':    'x86_64-unknown-linux-gnu',
    'linux-arm64':  'aarch64-unknown-linux-gnu',
    'darwin-x64':   'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
  };
  const triple = triples[key];
  if (!triple) {
    console.error(`\nUnsupported platform: ${platform} ${arch}`);
    console.error('Supported: win32-x64, linux-x64, linux-arm64, darwin-x64, darwin-arm64\n');
    process.exit(1);
  }
  return triple;
}

const TARGET = getTargetTriple();
const EXE    = os.platform() === 'win32' ? '.exe' : '';

const destPath = (name) => path.join(BINARIES_DIR, `${name}-${TARGET}${EXE}`);
const srcPath  = (name) => path.join(SOURCE_DIR, 'target', 'release', `${name}${EXE}`);

// ─── Submodule guard ──────────────────────────────────────────────────────────

function ensureSubmodule() {
  if (!fs.existsSync(path.join(SOURCE_DIR, 'Cargo.toml'))) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  ERROR: irium-source/ submodule is not initialised.');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('  Run the following and then retry:\n');
    console.error('    git submodule update --init --recursive\n');
    process.exit(1);
  }
}

// ─── Cache check ──────────────────────────────────────────────────────────────

function sourceCommitMs() {
  const r = spawnSync('git', ['log', '-1', '--format=%ct', 'irium-source'], {
    cwd: ROOT, encoding: 'utf8',
  });
  const t = parseInt(r.stdout?.trim(), 10);
  return isNaN(t) ? 0 : t * 1000;
}

function binaryMtimeMs(name) {
  try { return fs.statSync(destPath(name)).mtimeMs; } catch { return 0; }
}

function isStale() {
  if (FORCE) return true;

  for (const name of BINARIES) {
    if (!fs.existsSync(destPath(name))) {
      console.log(`  missing: ${name}-${TARGET}${EXE}`);
      return true;
    }
  }

  const latestSource  = sourceCommitMs();
  const oldestBinary  = Math.min(...BINARIES.map(binaryMtimeMs));

  if (latestSource > oldestBinary) {
    console.log('  irium-source has newer commits — rebuild required');
    return true;
  }

  return false;
}

// ─── Build ────────────────────────────────────────────────────────────────────

function build() {
  console.log(`\nBuilding irium node binaries (${TARGET}) …`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  First build: 30–90 minutes  |  Incremental: 1–5 minutes');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Build all three binaries. Works whether they share a workspace or are
  // separate crates — cargo resolves which packages define each binary name.
  const binFlags = BINARIES.map((b) => `--bin ${b}`).join(' ');
  try {
    execSync(`cargo build --release ${binFlags}`, {
      cwd: SOURCE_DIR, stdio: 'inherit',
    });
  } catch {
    // Fall back to building the entire release target (picks up all [[bin]] entries).
    console.log('\nRetrying with full workspace build …\n');
    execSync('cargo build --release', { cwd: SOURCE_DIR, stdio: 'inherit' });
  }
}

function copyBinaries() {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });

  const missing = [];
  for (const name of BINARIES) {
    const src  = srcPath(name);
    const dest = destPath(name);

    if (!fs.existsSync(src)) {
      missing.push(name);
      continue;
    }

    fs.copyFileSync(src, dest);

    // Mark executable on Unix
    if (EXE === '') {
      try { fs.chmodSync(dest, 0o755); } catch {}
    }

    console.log(`  ✓  ${path.basename(dest)}`);
  }

  if (missing.length > 0) {
    console.error('\n⚠  The following binaries were not found after the build:');
    missing.forEach((n) => console.error(`     ${n}`));
    console.error('\n   Check that each name matches a [[bin]] in irium-source/Cargo.toml.\n');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

ensureSubmodule();

if (CHECK) {
  process.exit(isStale() ? 1 : 0);
}

if (!isStale()) {
  console.log('\n✓  Node binaries are up to date.\n');
  console.log('   Use  npm run build:node -- --force  to rebuild anyway.\n');
  process.exit(0);
}

build();
copyBinaries();
console.log('\n✓  Node binaries ready.\n');
