# PanelPilot

Panel ścienny dla Home Assistant na **Sonoff NSPanel Pro 86** (kwadrat) i **NSPanel Pro 120** (prostokąt, pion i poziom) oraz inne ekrany z Androidem 8+.

*Home Assistant wall panel for NSPanel Pro: visual dashboard editor inside HA, full HTML/CSS/JS mode, screensaver, sensors, doorbell with two-way audio. The interface is Polish only for now.*

> **Wersja testowa 0.1.0.** Integracja ma testy automatyczne na Home Assistant 2026.10, a interfejs sprawdzono w przeglądarce. Nie sprawdzono jeszcze na fizycznym panelu: obrotu, czujników, mikrofonu ani rozmowy przez domofon.

## Co potrafi

| | |
|---|---|
| **Edytor w Home Assistant** | pozycja „PanelPilot” w menu bocznym; przeciąganie i zmiana rozmiaru kafelków na żywym podglądzie |
| **Wybór encji** | pogodę, czujniki, światła itd. wskazujesz z wyszukiwarki; nic nie jest wybierane za Ciebie |
| **Trzy układy** | osobne rozmieszczenie dla kwadratu, pionu i poziomu; motywy, kolory, tapeta |
| **Pełna dowolność** | własne kafelki HTML, cały ekran w HTML + CSS + JS z dostępem do WebSocketu albo gotowy moduł JS |
| **Wygaszacz** | zegar, duże czujniki lub czarny ekran; budzi dotyk, zbliżenie, dzwonek i automatyzacja |
| **Czujniki** | światło i zbliżenie jako encje HA, automatyczna jasność |
| **Domofon** | okno po dzwonku, obraz WebRTC, rozmowa, bramy na przytrzymanie |
| **Muzyka** | odtwarzacz, głośność, wyjście, przyciski stacji z dowolną akcją |
| **Sterowanie z HA** | ekran i jasność, strona, pulpit, obrót, wiadomości, odświeżenie |

## Instalacja

### 1. Integracja

[![Dodaj w HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Jabol86&repository=panelpilot&category=integration)

1. W HACS pobierz **PanelPilot** i uruchom ponownie Home Assistant. (Bez HACS: skopiuj `custom_components/panelpilot` do `config/custom_components`).
2. *Ustawienia → Urządzenia oraz usługi → Dodaj integrację → PanelPilot*. Nie ma nic do wypełniania.

### 2. Aplikacja na panelu

1. W eWeLink otwórz ustawienia panelu, dotknij *Device ID* kilka razy i włącz ADB (producent zastrzega, że może to wpłynąć na gwarancję).
2. Pobierz `panelpilot.apk` z [wydań](https://github.com/Jabol86/panelpilot/releases).
3. Windows: `.\tools\install-panel.ps1 -Ip ADRES_PANELU -Apk .\panelpilot.apk`

Ręcznie, na dowolnym systemie:

```bash
adb connect ADRES_PANELU:5555
adb install -r panelpilot.apk
adb shell pm grant pl.panelpilot.app android.permission.RECORD_AUDIO
adb shell cmd package set-home-activity pl.panelpilot.app/.MainActivity
adb shell am start -n pl.panelpilot.app/.MainActivity
```

### 3. Połączenie

1. Na panelu wybierz Home Assistant znaleziony w sieci oraz kształt ekranu: **kwadrat** lub **prostokąt**.
2. Panel pokaże **6-cyfrowy kod**. W HA otwórz *PanelPilot → Panele* i zatwierdź go. Hasło nie jest potrzebne.
3. W edytorze kliknij *Wybierz, co pokazać*.

Gdy ekran się nie obraca, zaznacz w aplikacji *Obracaj obraz w aplikacji*.

## Własny kod

**Kafelek „Własny HTML”**: wartości `{{sensor.x}}`, `{{sensor.x|0}}`, `{{weather.x.attributes.temperature}}`.

**Tryb „Własny kod”** daje cały ekran. W JS są dostępne:

| Nazwa | Co to |
|---|---|
| `root` | korzeń Twojego HTML |
| `hass` | `states`, `callService`, `callWS`, `connection.subscribeMessage` jak w kartach HA |
| `panel` | `onState(fn)`, `service()`, `forecast()`, `history()`, `sensors`, `format`, `toast()` |

W HTML: `data-text`, `data-toggle`, `data-service` + `data-entity` + `data-json`, `data-state`.

**Tryb „Moduł JS z pliku”** wczytuje element taki jak w `panel_custom`, np. `/local/moj-panel/panel.js`. Elementy frontendu HA (`ha-*`) nie są dostępne, poza `ha-icon`.

Kod pulpitu działa z uprawnieniami panelu, więc importuj pulpity tylko z zaufanych źródeł.

## Domofon i rozmowa

Wybierz dzwonek i kamerę w zakładce *Domofon*. Do rozmowy podaj adres własnego [go2rtc](https://github.com/AlexxIT/go2rtc) i nazwę strumienia, którego źródło obsługuje dźwięk zwrotny. Panel nie łączy się z adresem go2rtc sam: sygnalizację przekazuje integracja.

## Bezpieczeństwo

- Panel dostaje własne konto bez uprawnień administratora, działające tylko w sieci lokalnej. Usunięcie panelu kasuje to konto.
- Parowanie działa tylko z sieci lokalnej, kod jest ważny 10 minut i wymaga zatwierdzenia przez administratora.
- Edytor i zapis pulpitów są tylko dla administratora.
- Aplikacja łączy się z HA przez tunel dostępny wyłącznie na samym panelu (`localhost`), żeby mikrofon działał także przy http.

## Rozwój

- `python tests/test_model.py` – testy bez HA; `pytest tests` – z `pytest-homeassistant-custom-component`
- `tools/serve.ps1` – edytor na zmyślonych danych
- `tools/build-apk.ps1` – budowanie APK

Licencja: [MIT](LICENSE). Projekt niezależny od Home Assistant i Sonoff/ITEAD.
