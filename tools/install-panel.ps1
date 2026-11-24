# Instaluje Panel Pilot na panelu (NSPanel Pro lub inny Android 8+) przez ADB po Wi-Fi.
# Opis: docs/instalacja-panelu.md
#
# Najprosciej, bez pobierania repo (PowerShell na Windows):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Jabol86/panelpilot/main/tools/install-panel.ps1))) -Ip 192.168.1.50
#
# Brakujace adb (Android platform-tools od Google) i najnowsze APK z GitHuba skrypt pobiera sam
# do %LOCALAPPDATA%\PanelPilot.
param(
  [Parameter(Mandatory)][string]$Ip,
  [string]$Apk,          # wlasny plik APK; bez tego najnowsze wydanie z GitHuba
  [switch]$NoHome,       # nie zastepuj ekranu glownego (eWeLink zostaje)
  [switch]$KeepAdb,      # ADB po Wi-Fi dziala tez po restarcie panelu (wymaga roota)
  [string]$TimeZone,     # np. Europe/Warsaw (wymaga roota, potem restart panelu)
  [switch]$Uninstall,    # usun Panel Pilot i wroc do poprzedniego ekranu
  [int]$WaitSeconds = 90
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$pkg = 'pl.panelpilot.app'
$dir = Join-Path $env:LOCALAPPDATA 'PanelPilot'
if ($Ip -notmatch ':') { $Ip = "${Ip}:5555" }

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
# throw zamiast exit: exit zamknalby okno PowerShell, gdy skrypt idzie przez irm
function Stop-Install($text) { throw "BLAD: $text" }

# --- adb ---
$adb = $null
$cmd = Get-Command adb -ErrorAction SilentlyContinue
if ($cmd) { $adb = $cmd.Source }
foreach ($p in @((Join-Path $dir 'platform-tools\adb.exe'), 'C:\Program Files\platform-tools\adb.exe')) {
  if (-not $adb -and (Test-Path -LiteralPath $p)) { $adb = $p }
}
if (-not $adb) {
  Write-Step 'Pobieram Android platform-tools (adb) od Google'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $zip = Join-Path $dir 'platform-tools.zip'
  try { Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip }
  catch { Stop-Install "Nie udalo sie pobrac platform-tools: $($_.Exception.Message)" }
  Expand-Archive $zip $dir -Force
  Remove-Item $zip
  $adb = Join-Path $dir 'platform-tools\adb.exe'
}

function Invoke-Adb {
  $out = & $adb -s $Ip @args 2>&1 | ForEach-Object { "$_" }
  $script:AdbCode = $LASTEXITCODE
  $out
}

# --- polaczenie ---
Write-Step "Lacze z panelem $Ip"
& $adb connect $Ip | Out-Host
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$asked = $false
while ($true) {
  $state = (& $adb -s $Ip get-state 2>&1 | ForEach-Object { "$_" }) -join ' '
  if ($state -match '^device') { break }
  if ($state -match 'unauthorized' -and -not $asked) {
    Write-Host 'Na ekranie panelu pojawilo sie pytanie o debugowanie USB/ADB.' -ForegroundColor Yellow
    Write-Host 'Zaznacz "Zawsze zezwalaj z tego komputera" i dotknij "Zezwol".' -ForegroundColor Yellow
    $asked = $true
  }
  if ((Get-Date) -gt $deadline) {
    if ($state -match 'unauthorized') { Stop-Install 'Panel nie zatwierdzil polaczenia. Uruchom skrypt ponownie i zatwierdz pytanie na ekranie.' }
    Stop-Install "Panel $Ip nie odpowiada ($state). Sprawdz adres IP i czy ADB jest wlaczone w eWeLink."
  }
  Start-Sleep -Seconds 2
  if ($state -notmatch 'unauthorized') { & $adb connect $Ip | Out-Null }
}
$model = (Invoke-Adb shell getprop ro.product.model) -join ''
$android = (Invoke-Adb shell getprop ro.build.version.release) -join ''
Write-Host "Polaczono: $model, Android $android"

if ($Uninstall) {
  Write-Step 'Usuwam Panel Pilot'
  Invoke-Adb uninstall $pkg | Out-Host
  Write-Host 'Gotowe. Panel wroci do poprzedniego ekranu glownego (po restarcie lub gescie Home).'
  return
}

# --- APK ---
if (-not $Apk) {
  Write-Step 'Pobieram najnowsze APK z GitHuba'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $Apk = Join-Path $dir 'panelpilot.apk'
  try { Invoke-WebRequest -UseBasicParsing 'https://github.com/Jabol86/panelpilot/releases/latest/download/panelpilot.apk' -OutFile $Apk }
  catch { Stop-Install "Nie udalo sie pobrac APK: $($_.Exception.Message)" }
}
if (-not (Test-Path -LiteralPath $Apk)) { Stop-Install "Nie ma pliku $Apk" }

Write-Step 'Instaluje aplikacje'
$out = Invoke-Adb install -r $Apk
$out | Out-Host
if (($out -join ' ') -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
  Stop-Install 'Na panelu jest Panel Pilot podpisany innym kluczem. Usun go: dodaj -Uninstall, potem zainstaluj ponownie.'
}
if (($out -join ' ') -notmatch 'Success') { Stop-Install 'Instalacja sie nie powiodla (komunikat powyzej).' }

Write-Step 'Uprawnienia i ekran glowny'
Invoke-Adb shell pm grant $pkg android.permission.RECORD_AUDIO | Out-Host
if ($NoHome) { Write-Host 'Pomijam ustawienie ekranu glownego (-NoHome).' }
else {
  Invoke-Adb shell cmd package set-home-activity "$pkg/.MainActivity" | Out-Host
  Write-Host 'Panel Pilot jest ekranem glownym: uruchomi sie po restarcie, a gest Home do niego wraca.'
}

if ($KeepAdb -or $TimeZone) {
  $root = (Invoke-Adb shell su 0 id) -join ' '
  if ($root -notmatch 'uid=0') { Write-Host 'Brak roota na tym urzadzeniu: pomijam -KeepAdb i -TimeZone.' -ForegroundColor Yellow }
  else {
    if ($KeepAdb) {
      Invoke-Adb shell su 0 setprop persist.adb.tcp.port 5555 | Out-Host
      Write-Host 'ADB po Wi-Fi zostanie wlaczone takze po restarcie.'
    }
    if ($TimeZone) {
      Invoke-Adb shell su 0 setprop persist.sys.timezone $TimeZone | Out-Host
      Write-Host "Strefa czasowa: $TimeZone (zadziala po restarcie panelu)."
    }
  }
}

Write-Step 'Uruchamiam'
Invoke-Adb shell am start -n "$pkg/.MainActivity" | Out-Host
Write-Host "`nGotowe. Na panelu wybierz Home Assistant i ksztalt ekranu, potem zatwierdz kod w HA: Panel Pilot -> Panele." -ForegroundColor Green
