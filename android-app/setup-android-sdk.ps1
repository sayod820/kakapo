#Requires -Version 5.1
<#
  Downloads Android command-line tools into android-app/.tools/android-sdk
  and installs platform-tools + build-tools + platform android-34.
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $Root '.tools'
$sdk = Join-Path $tools 'android-sdk'
$jdk = Join-Path $tools 'jdk-17'
$zip = Join-Path $tools 'cmdline-tools.zip'

if (-not (Test-Path (Join-Path $jdk 'bin\java.exe'))) {
  Write-Host 'ERROR: JDK missing. Run resume-jdk download first.' -ForegroundColor Red
  exit 1
}

$env:JAVA_HOME = $jdk
$env:Path = "$(Join-Path $jdk 'bin');$env:Path"

New-Item -ItemType Directory -Force -Path $sdk | Out-Null

if (-not (Test-Path (Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
  Write-Host 'Downloading Android cmdline-tools...'
  $url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
  for ($i = 1; $i -le 30; $i++) {
    $size = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
    Write-Host "ATTEMPT $i size=$size"
    if ($size -gt 100MB) { break }
    curl.exe -L -C - --retry 3 --retry-delay 2 -o $zip $url
    if ($LASTEXITCODE -eq 0 -and ((Get-Item $zip).Length -gt 100MB)) { break }
    Start-Sleep -Seconds 2
  }
  if (-not (Test-Path $zip) -or ((Get-Item $zip).Length -lt 100MB)) {
    Write-Host 'Failed to download cmdline-tools' -ForegroundColor Red
    exit 1
  }
  $tmp = Join-Path $tools 'cmdline-tmp'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $dest = Join-Path $sdk 'cmdline-tools\latest'
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Move-Item $inner.FullName $dest
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

Write-Host 'Accepting licenses...'
$yes = ("y`n" * 50)
$yes | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null

Write-Host 'Installing SDK packages...'
& $sdkmanager --sdk_root=$sdk `
  'platform-tools' `
  'platforms;android-34' `
  'build-tools;34.0.0'

Write-Host "SDK_OK=$sdk"
