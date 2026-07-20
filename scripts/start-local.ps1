# KAKAPO — запуск backend + frontend на ПК
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== KAKAPO локальный запуск ===" -ForegroundColor Green

Write-Host "Backend..."
$ApiDir = Join-Path $Root "server\kakapo-api"
if (-not (Test-Path (Join-Path $ApiDir "node_modules"))) { npm install --prefix $ApiDir }
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "npm run dev" -WorkingDirectory $ApiDir -WindowStyle Normal

Start-Sleep -Seconds 3

Set-Location $Root

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
  Write-Host "Устанавливаю зависимости frontend..."
  npm install
}

Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8000" -ForegroundColor Cyan
npm run dev
