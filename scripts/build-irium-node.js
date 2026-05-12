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
// Order matters only for log readability — these all build in parallel. The
// fourth entry (irium-explorer) was missing originally, which made
// `tauri build --target X` fail in CI because tauri.conf.json declares
// `binaries/irium-explorer` in externalBin but the script never produced
// the corresponding sidecar with the target-triple suffix.
const BINARIES     = ['iriumd', 'irium-wallet', 'irium-miner', 'irium-explorer'];
// GPU miner needs the `gpu` cargo feature + an OpenCL ICD on the build host.
// Built separately so a missing OpenCL.lib doesn't block the core binaries.
const GPU_BINARY   = 'irium-miner-gpu';

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

// ─── Bootstrap line-ending normalization ─────────────────────────────────────
// On Windows, git's default core.autocrlf=true converts these files from LF
// to CRLF on checkout. iriumd uses include_str! to embed the signed seedlist
// (and signature) into the binary at compile time — include_str! reads bytes
// verbatim, so any CRLF in these files gets baked in. The signature was made
// over LF bytes, so the on-disk content at runtime won't verify and iriumd
// falls back to "no signed seeds → 0 peers". Strip \r before cargo runs.

const BOOTSTRAP_DIR = path.join(SOURCE_DIR, 'bootstrap');
const BOOTSTRAP_FILES_TO_NORMALIZE = [
  'seedlist.txt',
  'seedlist.txt.sig',
  'banned_peers.sample',
  'banned_peers.sample.sig',
  path.join('trust', 'allowed_signers'),
  path.join('trust', 'allowed_anchor_signers'),
  path.join('trust', 'allowed_ban_signers'),
];

function normalizeBootstrapLineEndings() {
  if (os.platform() !== 'win32') return;   // only Windows checkouts get corrupted
  if (!fs.existsSync(BOOTSTRAP_DIR)) return;
  for (const rel of BOOTSTRAP_FILES_TO_NORMALIZE) {
    const p = path.join(BOOTSTRAP_DIR, rel);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    const stripped = Buffer.from(buf.filter((b) => b !== 0x0D));
    if (stripped.length !== buf.length) {
      fs.writeFileSync(p, stripped);
      console.log(`  normalized bootstrap/${rel.replace(/\\/g, '/')}: ${buf.length} -> ${stripped.length} bytes`);
    }
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────

function build() {
  console.log(`\nBuilding irium node binaries (${TARGET}) …`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  First build: 30–90 minutes  |  Incremental: 1–5 minutes');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Normalize signed bootstrap files BEFORE cargo runs — include_str! bakes
  // their byte content into the binary, and CRLF corruption breaks runtime
  // signature verification.
  normalizeBootstrapLineEndings();

  // Build all three core binaries. Works whether they share a workspace or are
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

  // GPU miner is built separately with `--features gpu`. It links against
  // OpenCL.lib, so on Windows it requires an OpenCL ICD (NVIDIA/AMD driver
  // or Intel SDK). On failure, log a warning and continue — the GPU tab
  // will show "No GPU detected" but the rest of the app still works.
  console.log('\n── GPU miner (optional) ─────────────────────────────────────');
  try {
    execSync(`cargo build --release --features gpu --bin ${GPU_BINARY}`, {
      cwd: SOURCE_DIR, stdio: 'inherit',
    });
  } catch {
    console.log(`\n⚠  GPU miner build failed — likely missing OpenCL SDK.`);
    console.log(`    GPU tab will be unavailable. Install your GPU vendor's`);
    console.log(`    OpenCL runtime (NVIDIA/AMD driver, Intel OpenCL SDK) to`);
    console.log(`    enable it. Core binaries are unaffected.\n`);
  }
}

function copyBinaries() {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });

  // In Tauri dev mode the sidecar is resolved next to the compiled app binary
  // (src-tauri/target/debug/ on Windows). Copy there too so `tauri dev` works
  // without requiring a full `tauri build` first.
  const debugDir = path.join(ROOT, 'src-tauri', 'target', 'debug');
  const hasDebugDir = fs.existsSync(debugDir);

  const copyOne = (name, required) => {
    const src  = srcPath(name);
    const dest = destPath(name);

    if (!fs.existsSync(src)) {
      return required ? { missing: true } : { skipped: true };
    }

    fs.copyFileSync(src, dest);
    if (hasDebugDir) {
      try { fs.copyFileSync(src, path.join(debugDir, `${name}-${TARGET}${EXE}`)); } catch {}
    }
    if (EXE === '') {
      try { fs.chmodSync(dest, 0o755); } catch {}
      if (hasDebugDir) {
        try { fs.chmodSync(path.join(debugDir, `${name}-${TARGET}`), 0o755); } catch {}
      }
    }
    console.log(`  ✓  ${path.basename(dest)}`);
    return { ok: true };
  };

  const missing = [];
  for (const name of BINARIES) {
    const r = copyOne(name, true);
    if (r.missing) missing.push(name);
  }

  // GPU binary is optional — only copy if the build step succeeded.
  const gpuRes = copyOne(GPU_BINARY, false);
  if (gpuRes.skipped) {
    console.log(`  ⚠  ${GPU_BINARY} not built (skipped) — GPU tab will be unavailable.`);
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
