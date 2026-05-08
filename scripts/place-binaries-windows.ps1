# Place Irium sidecar binaries for Windows x86_64
# Run from the repo root: .\scripts\place-binaries-windows.ps1

$ErrorActionPreference = "Stop"
$TRIPLE = "x86_64-pc-windows-msvc"
$DEST = "$PSScriptRoot\..\src-tauri\binaries"
$SIDECARS = @("iriumd", "irium-wallet", "irium-miner")

New-Item -ItemType Directory -Force -Path $DEST | Out-Null

foreach ($name in $SIDECARS) {
    $src = $null
    $destFile = "$DEST\$name-$TRIPLE.exe"

    # 1. Already placed with correct triple name
    if (Test-Path $destFile) {
        Write-Host "[ok] $name-$TRIPLE.exe already present" -ForegroundColor Green
        continue
    }

    # 2. Check PATH
    $inPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($inPath) {
        $src = $inPath.Source
        Write-Host "[found] $name in PATH: $src"
    }

    # 3. Check common install locations
    if (-not $src) {
        $candidates = @(
            "$env:LOCALAPPDATA\irium\$name.exe",
            "$env:ProgramFiles\irium\$name.exe",
            "$env:USERPROFILE\.irium\bin\$name.exe"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { $src = $c; break }
        }
    }

    if ($src) {
        Copy-Item $src $destFile -Force
        Write-Host "[copied] $src -> $destFile" -ForegroundColor Cyan
    } else {
        Write-Warning "$name not found. Download from https://github.com/iriumlabs/irium/releases and place at $destFile"
    }
}

Write-Host ""
Write-Host "Verifying..." -ForegroundColor Yellow
foreach ($name in $SIDECARS) {
    $destFile = "$DEST\$name-$TRIPLE.exe"
    if (Test-Path $destFile) {
        $ver = & $destFile --version 2>&1 | Select-Object -First 1
        Write-Host "[ok] $name : $ver" -ForegroundColor Green
    } else {
        Write-Warning "[missing] $destFile"
    }
}
