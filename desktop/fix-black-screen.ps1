#Requires -Version 5.1
# Чинит чёрный экран кассы: пишет URL https://kakappo.shop/trade в userData Electron
$ErrorActionPreference = 'Stop'
$candidates = @(
  "$env:APPDATA\kakapo-trade-desktop",
  "$env:APPDATA\KAKAPO Kassa",
  "$env:APPDATA\kakapo-tj"
)
$src = Join-Path $PSScriptRoot 'fix-user-config.json'
$json = Get-Content $src -Raw
$written = $false
foreach ($dir in $candidates) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dest = Join-Path $dir 'config.json'
  Set-Content -Path $dest -Value $json -Encoding UTF8
  Write-Host "OK: $dest"
  $written = $true
}
if ($written) {
  Write-Host ""
  Write-Host "Закройте KAKAPO Касса и откройте снова."
  Write-Host "Или из папки desktop: npm start"
}
