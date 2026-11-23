# Instaluje PanelPilot na panelu przez ADB (Windows).
# Przyklad:  .\install-panel.ps1 -Ip 192.168.1.50 -Apk .\panelpilot.apk
param(
  [Parameter(Mandatory)][string]$Ip,
  [Parameter(Mandatory)][string]$Apk,
  [switch]$NoHome   # nie ustawiaj jako ekranu glownego
)
$ErrorActionPreference = 'Stop'
if ($Ip -notmatch ':') { $Ip = "${Ip}:5555" }
if (-not (Test-Path -LiteralPath $Apk)) { throw "Nie ma pliku $Apk" }
$cmd = Get-Command adb -ErrorAction SilentlyContinue
$adb = if ($cmd) { $cmd.Source } else { 'C:\Program Files\platform-tools\adb.exe' }
if (-not (Test-Path -LiteralPath $adb)) { throw 'Brak adb. Pobierz Android platform-tools: https://developer.android.com/tools/releases/platform-tools' }

function Invoke-Adb { & $adb @args; if ($LASTEXITCODE -ne 0) { throw "adb $args - blad $LASTEXITCODE" } }

Invoke-Adb connect $Ip
$state = & $adb -s $Ip get-state
if ($state -ne 'device') { throw "Panel $Ip nie odpowiada (stan: $state). Czy ADB jest wlaczone?" }
Invoke-Adb -s $Ip install -r $Apk
Invoke-Adb -s $Ip shell pm grant pl.panelpilot.app android.permission.RECORD_AUDIO
if (-not $NoHome) { Invoke-Adb -s $Ip shell cmd package set-home-activity pl.panelpilot.app/.MainActivity }
Invoke-Adb -s $Ip shell am start -n pl.panelpilot.app/.MainActivity
Write-Host 'Gotowe. Dokoncz konfiguracje na ekranie panelu.'
