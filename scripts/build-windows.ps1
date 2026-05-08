# Irium Core — Windows production build script
# Usage: .\scripts\build-windows.ps1
# Requirements: Node.js 18+, Rust 1.70+, MSVC Build Tools

param(
  [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path $PSScriptRoot -Parent

Write-Host "==> Irium Core Windows Build" -ForegroundColor Cyan

# 1. Check toolchain versions
Write-Host "--> Checking toolchain..." -ForegroundColor Yellow
$nodeVersion = node --version 2>&1
$cargoVersion = cargo --version 2>&1
Write-Host "    Node:  $nodeVersion"
Write-Host "    Cargo: $cargoVersion"

# 2. Install npm dependencies
if (-not $SkipInstall) {
  Write-Host "--> Installing npm dependencies..." -ForegroundColor Yellow
  Push-Location $ProjectRoot
  npm ci
  Pop-Location
}

# 3. Verify sidecar binaries exist
Write-Host "--> Verifying sidecar binaries..." -ForegroundColor Yellow
$binaries = @(
  "binaries\iriumd-x86_64-pc-windows-msvc.exe",
  "binaries\irium-wallet-x86_64-pc-windows-msvc.exe",
  "binaries\irium-miner-x86_64-pc-windows-msvc.exe"
)
$missing = @()
foreach ($bin in $binaries) {
  $path = Join-Path $ProjectRoot "src-tauri\$bin"
  if (-not (Test-Path $path)) {
    $missing += $bin
  }
}
if ($missing.Count -gt 0) {
  Write-Host "ERROR: Missing sidecar binaries:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Write-Host "Place the .exe files in src-tauri\binaries\ with the x86_64-pc-windows-msvc suffix." -ForegroundColor Red
  exit 1
}
Write-Host "    All binaries present." -ForegroundColor Green

# 4. Run Tauri build
Write-Host "--> Running tauri build..." -ForegroundColor Yellow
Push-Location $ProjectRoot
npm run tauri build
Pop-Location

Write-Host "==> Build complete. Installer in: src-tauri\target\release\bundle\" -ForegroundColor Green
