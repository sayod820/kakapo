# ══════════════════════════════════════════════════════════════
# KAKAPO — локальный агент синхронизации с кассой GBS Market
#
# Нужен, когда касса стоит в локальной сети магазина за обычным
# роутером, а backend KAKAPO работает в облаке (Hetzner) и не может
# достучаться до кассы напрямую. Этот скрипт запускается на ТОЙ ЖЕ
# машине, что и касса (или там, где GBS Market реально слушает
# localhost), читает данные через её собственный JSON API
# (http://localhost:8419) и сам отправляет их наружу — на публичный
# адрес KAKAPO. Входящих подключений к кассе не требуется, поэтому
# ничего не нужно настраивать в роутере/файрволе магазина.
#
# Настройка:
#   1. Положите рядом со скриптом файл gbs-agent.config.json
#      (см. пример gbs-agent.config.example.json).
#   2. Проверьте вручную: powershell -File gbs-local-agent.ps1
#      Должно вывести "OK: goods=N documents=M".
#   3. Чтобы агент работал постоянно — добавьте в Планировщик заданий
#      Windows задачу с триггером "При входе в систему" и повтором
#      каждые 15 минут, команда:
#      powershell.exe -ExecutionPolicy Bypass -File "полный\путь\gbs-local-agent.ps1"
# ══════════════════════════════════════════════════════════════

param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'gbs-agent.config.json')
)

function Write-Log($msg) {
  $line = "$(Get-Date -Format o) $msg"
  Write-Output $line
  try { Add-Content -Path (Join-Path $PSScriptRoot 'gbs-agent.log') -Value $line } catch {}
}

if (-not (Test-Path $ConfigPath)) {
  Write-Log "ERROR: не найден файл настроек $ConfigPath"
  exit 1
}

try {
  $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
} catch {
  Write-Log "ERROR: не удалось прочитать конфиг: $($_.Exception.Message)"
  exit 1
}

$gbsBase = "$($config.gbsIp.TrimEnd('/')):$($config.gbsPort)/api/v1"
$authPair = "$($config.gbsUser):$($config.gbsPass)"
$authBytes = [System.Text.Encoding]::UTF8.GetBytes($authPair)
$gbsHeaders = @{ Authorization = 'Basic ' + [Convert]::ToBase64String($authBytes) }

function Get-GbsPaginated {
  param([string]$Path, [hashtable]$Query)
  $items = @()
  $page = 1
  $totalPages = 1
  do {
    $qs = @("page=$page", "page_size=200")
    foreach ($key in $Query.Keys) { $qs += "$key=$([uri]::EscapeDataString([string]$Query[$key]))" }
    $queryString = $qs -join '&'
    $url = $gbsBase + $Path + '?' + $queryString
    $resp = Invoke-RestMethod -Uri $url -Headers $gbsHeaders -Method Get -TimeoutSec 20
    if ($resp.Status -and $resp.Status -ne 'Ok') { throw "касса вернула Status=$($resp.Status)" }
    if ($resp.Data) { $items += $resp.Data }
    $totalPages = [int]($resp.TotalPages)
    if ($totalPages -lt 1) { $totalPages = 1 }
    $page++
  } while ($page -le $totalPages)
  return $items
}

try {
  $goods = Get-GbsPaginated -Path '/goods' -Query @{}

  $dateStart = (Get-Date).AddDays(-3).ToString('yyyy-MM-dd')
  $dateEnd = (Get-Date).ToString('yyyy-MM-dd')
  $documents = Get-GbsPaginated -Path '/documents' -Query @{ type = 'Sale'; date_start = $dateStart; date_end = $dateEnd }

  $payload = @{ goods = $goods; documents = $documents } | ConvertTo-Json -Depth 12 -Compress

  $ingestUrl = "$($config.kakapoUrl.TrimEnd('/'))/gbs/ingest"
  $ingestHeaders = @{ 'X-GBS-Ingest-Token' = $config.ingestToken }
  $result = Invoke-RestMethod -Uri $ingestUrl -Method Post -Body $payload -ContentType 'application/json; charset=utf-8' -Headers $ingestHeaders -TimeoutSec 30

  if ($result.ok) {
    Write-Log "OK: goods=$($goods.Count) documents=$($documents.Count) matched=$($result.products.matched) updated=$($result.products.updated) imported=$($result.sales.imported)"
  } else {
    Write-Log "ПРИНЯТО С ОШИБКАМИ: $($result.errors -join '; ')"
  }
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}
