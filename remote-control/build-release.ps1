#!/usr/bin/env pwsh
# Build script for FP Remote Control - produces x64 and x86 release binaries

$ErrorActionPreference = "Stop"

Write-Host "Building FP Remote Control..." -ForegroundColor Cyan

# x64
Write-Host "`n=== Building x64 ===" -ForegroundColor Green
cargo build --release --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw "x64 build failed" }

# x86
Write-Host "`n=== Building x86 ===" -ForegroundColor Green
cargo build --release --target i686-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw "x86 build failed" }

# Create dist folder
$dist = Join-Path $PSScriptRoot "dist"
New-Item -ItemType Directory -Path $dist -Force | Out-Null

Copy-Item "target\x86_64-pc-windows-msvc\release\fp-remote-control.exe" "$dist\fp-remote-control-x64.exe" -Force
Copy-Item "target\i686-pc-windows-msvc\release\fp-remote-control.exe" "$dist\fp-remote-control-x86.exe" -Force

$x64Size = [math]::Round((Get-Item "$dist\fp-remote-control-x64.exe").Length / 1MB, 1)
$x86Size = [math]::Round((Get-Item "$dist\fp-remote-control-x86.exe").Length / 1MB, 1)

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "  x64: dist\fp-remote-control-x64.exe ($x64Size MB)"
Write-Host "  x86: dist\fp-remote-control-x86.exe ($x86Size MB)"

Write-Host "`n=== MSI Installer ===" -ForegroundColor Cyan
Write-Host "To build the MSI installer, install WiX Toolset v3 and run:"
Write-Host "  candle.exe -dCargoTargetDir=target\x86_64-pc-windows-msvc wix\main.wxs -out dist\main.wixobj"
Write-Host "  light.exe dist\main.wixobj -out dist\fp-remote-control-x64.msi"
Write-Host ""
Write-Host "Or install cargo-wix: cargo install cargo-wix"
Write-Host "  cargo wix --nocapture"
