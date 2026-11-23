# Instalacja aplikacji na panelu

Aplikację PanelPilot instaluje się na panel z komputera przez Wi‑Fi, za pomocą ADB. Zajmuje to około 10 minut. Najpierw zainstaluj integrację PanelPilot w Home Assistant: bez niej panel nie zaparuje się z HA.

> Na fizycznym NSPanelu ta metoda nie była jeszcze sprawdzona. Jeśli coś nie zadziała, zgłoś to w [Issues](https://github.com/Jabol86/panelpilot/issues).

## Sonoff NSPanel Pro (86 i 120)

### 1. Włącz ADB na panelu

1. Zainstaluj na telefonie aplikację **eWeLink** i dodaj panel: zeskanuj kod QR z jego ekranu.
2. W eWeLink otwórz panel i przejdź do **Ustawienia**.
3. Przewiń do **Device ID** i dotknij go 5–10 razy, aż pojawi się ostrzeżenie o trybie programisty. Zaakceptuj je.
   Sonoff uprzedza, że tryb programisty i ADB mogą wpłynąć na gwarancję.
4. W nowej sekcji dla programistów włącz **ADB**.
5. Zapisz **adres IP panelu** z eWeLink albo z routera. Najlepiej przypisz panelowi w routerze stały adres.

### 2. Zainstaluj aplikację z komputera z Windows

Otwórz **PowerShell** (menu Start, wpisz „PowerShell”). Wklej poniższe polecenie, zamień `192.168.1.50` na adres swojego panelu i naciśnij Enter:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Jabol86/panelpilot/main/tools/install-panel.ps1))) -Ip 192.168.1.50
```

Skrypt sam:

1. pobiera `adb` od Google, jeśli go nie masz,
2. łączy się z panelem; przy pierwszym połączeniu panel zapyta o zgodę: zaznacz *Zawsze zezwalaj* i dotknij *Zezwól*,
3. pobiera najnowsze `panelpilot.apk` z [wydań](https://github.com/Jabol86/panelpilot/releases) i instaluje je,
4. daje aplikacji dostęp do mikrofonu, potrzebny do rozmowy przez domofon,
5. ustawia PanelPilot jako ekran główny zamiast eWeLink,
6. uruchamia aplikację.

Pobrane pliki zapisuje w `%LOCALAPPDATA%\PanelPilot`.

### Opcje

Dopisz je na końcu polecenia, np. `-Ip 192.168.1.50 -NoHome -TimeZone Europe/Warsaw`.

| Opcja | Co robi |
|---|---|
| `-NoHome` | nie zastępuje ekranu eWeLink. Dobre na pierwszą próbę; aplikację uruchomisz wtedy poleceniem ze skryptu albo ponownym uruchomieniem skryptu |
| `-TimeZone Europe/Warsaw` | ustawia strefę czasową. Panele często mają fabrycznie `Asia/Shanghai`, przez co zegar się spieszy. Działa po restarcie panelu; wymaga roota, który NSPanel Pro ma |
| `-KeepAdb` | ADB po Wi‑Fi działa także po restarcie panelu, więc przy aktualizacjach nie trzeba go włączać w eWeLink. Wymaga roota |
| `-Apk C:\ścieżka\panelpilot.apk` | instaluje Twój plik zamiast pobierać najnowszy |
| `-Uninstall` | usuwa PanelPilot; panel wraca do ekranu eWeLink |

### Linux, macOS albo ręcznie

Potrzebujesz [Android platform-tools](https://developer.android.com/tools/releases/platform-tools) i pliku `panelpilot.apk` z [wydań](https://github.com/Jabol86/panelpilot/releases/latest):

```bash
adb connect 192.168.1.50:5555
adb install -r panelpilot.apk
adb shell pm grant pl.panelpilot.app android.permission.RECORD_AUDIO
adb shell cmd package set-home-activity pl.panelpilot.app/.MainActivity
adb shell am start -n pl.panelpilot.app/.MainActivity
```

Opcjonalnie, z rootem:

```bash
adb shell su 0 setprop persist.sys.timezone Europe/Warsaw
adb shell su 0 setprop persist.adb.tcp.port 5555
```

## 3. Połącz panel z Home Assistant

1. Na panelu wybierz swój Home Assistant z listy znalezionych w sieci. Jeśli go tam nie ma, wpisz adres, np. `http://192.168.1.10:8123`.
2. Wybierz kształt ekranu: **kwadrat** dla NSPanel Pro 86 albo **prostokąt** dla NSPanel Pro 120.
3. Panel pokaże **6-cyfrowy kod**. W HA pojawi się powiadomienie **PanelPilot**: kliknij link i zatwierdź ten kod. Hasło nie jest potrzebne. (Edytor otworzysz też w *Ustawienia → Urządzenia oraz usługi → PanelPilot → Konfiguruj*).
4. W edytorze kliknij **Wybierz, co pokazać** i dodaj kafelki. Zmiany pojawiają się na panelu od razu po zapisaniu.

## Inne tablety z Androidem 8 lub nowszym

Pobierz `panelpilot.apk` na tablet, włącz w ustawieniach *Instalowanie nieznanych aplikacji* i otwórz plik. Możesz też użyć `adb install` jak wyżej. Gdy Android zapyta, której aplikacji użyć jako ekranu głównego, wybierz **PanelPilot → Zawsze**.

## Aktualizacja

Uruchom to samo polecenie co przy instalacji. Ustawienia i parowanie zostają. Integrację w HA aktualizuje HACS.

## Problemy

| Objaw | Co zrobić |
|---|---|
| „Panel nie odpowiada” | sprawdź adres IP, to, czy ADB jest włączone, i czy komputer jest w tej samej sieci co panel |
| „Panel nie zatwierdził połączenia” | uruchom skrypt ponownie i dotknij *Zezwól* na ekranie panelu |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | na panelu jest wersja podpisana innym kluczem: usuń ją (`-Uninstall`) i zainstaluj ponownie |
| Ekran się nie obraca | w ustawieniach aplikacji zaznacz *Obracaj obraz w aplikacji* |
| Zegar pokazuje złą godzinę | dodaj `-TimeZone Europe/Warsaw` i zrestartuj panel |
| Panel nie znajduje HA | wpisz adres ręcznie; wyszukiwanie wymaga, żeby panel i HA były w tej samej sieci |
| Chcę wrócić do eWeLink | uruchom skrypt z `-Uninstall` |
