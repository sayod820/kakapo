# KAKAPO — скачка данных при установке (устойчиво к слабому интернету)
# Повторы, длинный таймаут, без тяжёлой истории продаж, сырой JSON без лишнего ConvertTo-Json

param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$ApiBase = "https://kakappo.shop/api/kakapo",
  [int]$MaxRetries = 8,
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::DefaultConnectionLimit = 16

function Write-ProgressLine([string]$msg) {
  Write-Host "[kakapo-bootstrap] $msg"
}

function Get-RawJson([string]$path, [switch]$Optional) {
  $url = "$ApiBase$path"
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      Write-ProgressLine "GET $path (попытка $attempt/$MaxRetries, timeout ${TimeoutSec}s)"
      # curl надежнее на слабом канале (retry внутри)
      $tmp = [System.IO.Path]::GetTempFileName()
      $curlArgs = @(
        "-fsS",
        "--connect-timeout", "30",
        "--max-time", "$TimeoutSec",
        "--retry", "3",
        "--retry-delay", "2",
        "--retry-all-errors",
        "-o", $tmp,
        $url
      )
      $p = Start-Process -FilePath "curl.exe" -ArgumentList $curlArgs -Wait -PassThru -NoNewWindow
      if ($p.ExitCode -ne 0) { throw "curl exit $($p.ExitCode)" }
      $content = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8)
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      if ([string]::IsNullOrWhiteSpace($content)) { throw "пустой ответ" }
      # минимальная проверка JSON
      if ($content.Trim()[0] -notin @('[', '{')) { throw "не JSON" }
      return $content
    }
    catch {
      Write-ProgressLine "ошибка $path : $($_.Exception.Message)"
      if ($Optional -and $attempt -ge 2) {
        Write-ProgressLine "пропуск необязательного $path"
        return "[]"
      }
      if ($attempt -ge $MaxRetries) { throw $_ }
      $delay = [Math]::Min(30, 2 * $attempt)
      Write-ProgressLine "ждём ${delay}s и повторяем…"
      Start-Sleep -Seconds $delay
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  }

  Write-ProgressLine "Проверка сервера…"
  $null = Get-RawJson "/health"

  # Только то, что нужно кассе сразу. История продаж — не блокирует установку.
  $productsJson = Get-RawJson "/products"
  $clientsJson  = Get-RawJson "/clients"
  $cardsJson    = Get-RawJson "/cards"
  $cashiersJson = Get-RawJson "/cashiers"
  $pointsJson   = Get-RawJson "/pos/points"
  $shiftsJson   = Get-RawJson "/pos/shifts" -Optional

  $posSnapshot = @"
{"cashiers":$cashiersJson,"posPoints":$pointsJson,"shifts":$shiftsJson,"sales":[],"receipts":[],"writeoffs":[],"revisions":[],"suppliers":[],"expenses":[],"financeMoves":[],"expiry":[],"financeSummary":null,"report":null}
"@

  $kvJson = @"
{"catalog_products":$productsJson,"data_clients":$clientsJson,"data_cards":$cardsJson,"data_pos_snapshot":$posSnapshot}
"@

  $stamp = (Get-Date).ToUniversalTime().ToString("o")
  $metaJson = @"
{"bootstrapComplete":true,"installComplete":true,"lastBootstrapAt":"$stamp","source":"nsis-install","apiBase":"$ApiBase","weakNet":true}
"@

  $utf8 = New-Object System.Text.UTF8Encoding $false
  $kvPath = Join-Path $OutDir "local-kv.json"
  $metaPath = Join-Path $OutDir "local-meta.json"
  $okPath = Join-Path $OutDir "INSTALL_OK"
  $queuePath = Join-Path $OutDir "local-queue.json"

  # атомарная запись: сначала .tmp
  $kvTmp = "$kvPath.tmp"
  [System.IO.File]::WriteAllText($kvTmp, $kvJson, $utf8)
  [System.IO.File]::WriteAllText($metaPath + ".tmp", $metaJson, $utf8)
  Move-Item -LiteralPath $kvTmp -Destination $kvPath -Force
  Move-Item -LiteralPath ($metaPath + ".tmp") -Destination $metaPath -Force
  [System.IO.File]::WriteAllText($queuePath, "[]", $utf8)
  [System.IO.File]::WriteAllText($okPath, $stamp, $utf8)

  $sizeKb = [Math]::Round((Get-Item -LiteralPath $kvPath).Length / 1KB)
  Write-ProgressLine "Готово: $OutDir (local-kv.json ${sizeKb} KB)"
  exit 0
}
catch {
  Write-Host "[kakapo-bootstrap] ОШИБКА: $($_.Exception.Message)"
  exit 1
}
