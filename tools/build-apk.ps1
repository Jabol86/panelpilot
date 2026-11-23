# Buduje APK. Narzędzia: JDK 17, Gradle 8.7+, Android SDK (platform 34, build-tools 34).
# Budowanie w krótkiej ścieżce, bo Windows ogranicza długość ścieżek.
param([string]$Tools = (Join-Path $env:LOCALAPPDATA 'Temp\dpb'))
$ErrorActionPreference = 'Stop'
$src = (Resolve-Path (Join-Path $PSScriptRoot '..\android')).Path
$env:JAVA_HOME = (Get-ChildItem (Join-Path $Tools 'jdk') -Directory)[0].FullName
$env:ANDROID_HOME = Join-Path $Tools 'sdk'
$env:GRADLE_USER_HOME = Join-Path $Tools 'g'

# Stały klucz podpisu: bez niego nowa wersja nie zainstaluje się na starą. Zrób kopię i nie publikuj.
$ks = Join-Path $src 'panelpilot.keystore'
if (-not (Test-Path $ks)) {
  $bytes = New-Object byte[] 18
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pass = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', 'x'
  & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $ks -storetype PKCS12 -alias panelpilot -keyalg RSA -keysize 2048 -validity 10000 -storepass $pass -keypass $pass -dname 'CN=PanelPilot' | Out-Null
  [IO.File]::WriteAllText((Join-Path $src 'keystore.properties'), "storeFile=panelpilot.keystore`nalias=panelpilot`npassword=$pass`n")
}

$work = Join-Path $Tools 'w'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
Copy-Item $src $work -Recurse
$gradle = (Get-ChildItem (Join-Path $Tools 'gradle') -Directory)[0].FullName
# Przez cmd: ostrzeżenia kompilatora na stderr nie przerywają skryptu (ErrorActionPreference = Stop).
cmd /c "`"$(Join-Path $gradle 'bin\gradle.bat')`" -p `"$work`" --no-daemon --console=plain :app:assembleRelease 2>&1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$out = Join-Path $PSScriptRoot '..\dist'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $work 'app\build\outputs\apk\release\app-release.apk') (Join-Path $out 'panelpilot.apk') -Force
Get-Item (Join-Path $out 'panelpilot.apk') | ForEach-Object { "$($_.Name) $($_.Length) B" }
