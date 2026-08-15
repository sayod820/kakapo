#Requires -Version 5.1
<#
.SYNOPSIS
  Собирает debug APK KAKAPO Trade (Capacitor).

.NOTES
  Нужны JDK 17+ и Android SDK.
  Локальные копии: .tools/jdk-17, .tools/android-sdk
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Find-JavaHome {
  if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    return $env:JAVA_HOME
  }
  $candidates = @(
    (Join-Path $Root '.tools\jdk-17'),
    'C:\Program Files\Microsoft\jdk-17*',
    'C:\Program Files\Eclipse Adoptium\jdk-17*',
    'C:\Program Files\Java\jdk-17*'
  )
  foreach ($pattern in $candidates) {
    $hit = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit -and (Test-Path (Join-Path $hit.FullName 'bin\java.exe'))) {
      return $hit.FullName
    }
  }
  return $null
}

function Find-AndroidSdk {
  if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { return $env:ANDROID_HOME }
  if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { return $env:ANDROID_SDK_ROOT }
  $bundled = Join-Path $Root '.tools\android-sdk'
  if (Test-Path $bundled) { return $bundled }
  $local = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  if (Test-Path $local) { return $local }
  return $null
}

function Get-ShortPath([string]$Path) {
  try {
    return (New-Object -ComObject Scripting.FileSystemObject).GetFolder($Path).ShortPath
  } catch {
    return $Path
  }
}

function Find-GradleBat {
  $manual = Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.2.1-all\manual\gradle-8.2.1\bin\gradle.bat'
  if (Test-Path $manual) { return $manual }
  $hit = Get-ChildItem (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.2.1-all') -Recurse -Filter 'gradle.bat' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bin\\gradle\.bat$' } |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

$javaHome = Find-JavaHome
$sdk = Find-AndroidSdk

if (-not $javaHome) {
  Write-Host @'
ERROR: JDK 17 не найден.
Установите Android Studio или OpenJDK 17, затем снова:
  .\build-apk.ps1
'@ -ForegroundColor Red
  exit 1
}
if (-not $sdk) {
  Write-Host @'
ERROR: Android SDK не найден.
Запустите .\setup-android-sdk.ps1 или установите Android Studio, затем снова:
  .\build-apk.ps1
'@ -ForegroundColor Red
  exit 1
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

# Short path avoids Cyrillic encoding issues in Gradle on Windows
$sdkForGradle = Get-ShortPath $sdk
$localProps = Join-Path $Root 'android\local.properties'
$sdkEscaped = $sdkForGradle -replace '\\', '/'
Set-Content -Path $localProps -Value "sdk.dir=$sdkEscaped" -Encoding ASCII

Write-Host "JAVA_HOME=$javaHome"
Write-Host "ANDROID_HOME=$sdk"
Write-Host "sdk.dir=$sdkEscaped"
Write-Host 'npm install + cap sync...'
npm install --silent
if (-not (Test-Path (Join-Path $Root 'www\trade\index.html'))) {
  Write-Host 'www/trade missing: run npm run android:build-ui from kakapo root' -ForegroundColor Yellow
}
npx cap sync android

Write-Host 'Gradle assembleDebug...'
Push-Location (Join-Path $Root 'android')
try {
  $gradleBat = Find-GradleBat
  if ($gradleBat) {
    & $gradleBat assembleDebug --no-daemon
  } else {
    & .\gradlew.bat assembleDebug --no-daemon
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

$apk = Join-Path $Root 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) {
  Write-Host 'APK не найден после сборки' -ForegroundColor Red
  exit 1
}

$outDir = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outApk = Join-Path $outDir 'KAKAPO-Trade-debug.apk'
Copy-Item $apk $outApk -Force

$releaseApk = Join-Path $Root 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
if (Test-Path $releaseApk) {
  Copy-Item $releaseApk (Join-Path $outDir 'KAKAPO-Trade-release-unsigned.apk') -Force
}

Write-Host "OK: $outApk" -ForegroundColor Green
Write-Host "bytes: $((Get-Item $outApk).Length)"
