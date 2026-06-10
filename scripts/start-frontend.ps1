# KAKAPO — только frontend
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== KAKAPO Frontend ===" -ForegroundColor Green

foreach ($port in 3000, 3001, 3002, 3003) {
  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Освобождён порт $port" -ForegroundColor Yellow
  }
}

if (Test-Path ".next") {
  Remove-Item -Recurse -Force ".next" -ErrorAction SilentlyContinue
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Устанавливаю зависимости..."
  npm install
}

Write-Host "Запуск: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend должен быть на http://localhost:8000 (отдельное окно server)" -ForegroundColor DarkGray
npm run dev
