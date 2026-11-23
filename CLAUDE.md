# PanelPilot: kontekst dla Claude

Streszczenie pierwszej rozmowy z właścicielem projektu (22–23.11.2026), żeby kolejna sesja wiedziała, gdzie skończyliśmy.

## Właściciel i sposób pracy

- Rozmawiamy po polsku. O właścicielu pisz w formie neutralnej („zrobiłeś/aś”), nie zgaduj płci.
- **Nic nie wybieraj za użytkownika.** Pulpit startowy jest pusty, ma tylko zegar. Pogodę, czujniki i inne encje wskazuje się z listy. Jest też pełna dowolność: HTML, CSS i JS z WebSocketem albo moduł JS. Tak właściciel poprawił wcześniejsze założenie, że pulpit wygeneruje się sam.
- Instalacja ma być jak najprostsza dla innych ludzi, nie tylko dla właściciela.
- Do repo nie trafiają encje właściciela, adresy IP, e-mail ani klucz podpisu APK.
- Wysyłka na GitHub tylko za zgodą właściciela.
- Do folderów Home Assistanta właściciela (udział `\\HOMEASSISTANT\config`) nie zaglądaj i nic tam nie zapisuj bez wyraźnej zgody.

## Skąd projekt

Właściciel używał [WallGlass](https://github.com/paweb88/wallglass), ale na **Sonoff NSPanel Pro 120** WallGlass się nie obraca: manifest wymusza `portrait`, a układ jest pod 480×480. Wcześniej właściciel miał własny pulpit `tablet-dashboard` w HTML, CSS i JS w `/config/www`. Postanowiliśmy napisać wszystko od nowa: integrację HA, APK na NSPanel Pro z wyborem kwadrat/prostokąt i edytor pulpitu w HA. Gotowa alternatywa to panel-assistant.io; właściciel o niej wie.

Fakty o NSPanel Pro 120: Android 8.1, 750×1334 przy 240 dpi. Czujniki światła i zbliżenia są dostępne przez SensorManager; na firmware 4.x zbliżenie jest binarne. Firmware 4.0.12 ma WebView 129.

## Budowa

- `custom_components/panelpilot`: integracja z konfiguracją z interfejsu. Daje:
  - parowanie 6-cyfrowym kodem: tylko z sieci lokalnej, kod ważny 10 minut, zatwierdza administrator; panel dostaje własne konto bez praw administratora, działające tylko lokalnie;
  - polecenia WebSocket i zapis w Store;
  - encje: ekran (light), strona, pulpit i obrót (select), natężenie światła (sensor), zbliżenie i połączenie (binary_sensor), przyciski odświeżenia i dzwonka;
  - usługi `show_message` i `open_doorbell`;
  - przekazywanie sygnalizacji WebRTC do go2rtc użytkownika.
- `frontend/`:
  - edytor w menu bocznym (`editor.js`) z zakładkami Kafelki, Wygląd, Wygaszacz, Domofon, CSS i JS, Eksport i Panele, z kreatorem „Wybierz, co pokazać”, cofaniem zmian i wykrywaniem konfliktów zapisu;
  - strona panelu (`index.html`, `panel.js`, `widgets.js` z 20 typami kafelków, `doorbell.js`, `code.js`);
  - formaty ekranu: kwadrat 480×480 (siatka 6×5), pion 500×889 (6×10), poziom 889×500 (10×5).
- `android/`: aplikacja `pl.panelpilot.app` w czystym Javie, bez bibliotek, minSdk 26. Ma:
  - WebView i tunel na `localhost:18123`, żeby mikrofon działał też przez http;
  - czujniki, jasność, obrót, wyszukiwanie HA przez mDNS;
  - ekran wyboru kształtu ekranu; aplikacja może zastąpić ekran główny.
- `tests/`: 13 testów modelu (`python tests/test_model.py`) i 6 testów na HA (`pytest tests`). `tests/editor.html` i `tests/panel.html` to atrapy do przeglądarki.
- `tools/`: `serve.ps1` (podgląd edytora), `build-apk.ps1`, `install-panel.ps1` (instalacja przez ADB).

## Stan na 23.11.2026

- Repo jest **prywatne**. Właściciel chce je upublicznić dopiero, gdy wszystko zadziała na prawdziwym panelu. Na pytanie o upublicznienie odpowiedział: „jeszcze nie”.
- Wydanie wstępne v0.1.0 z `panelpilot.apk` (SHA-256 `c3c0f592973c466acf1a511d7c4dce70d0c68a1e792bd9f0fec47d013bd156e9`).
- CI przechodzi: testy na HA 2026.10.4, hassfest i kompilacja APK.
- Edytor i panel sprawdzono tylko w przeglądarce, na atrapie HA.
- **Niesprawdzone:** fizyczny panel (obrót, czujniki, jasność, mikrofon, rozmowa, mDNS), prawdziwy HA właściciela, dźwięk domofonu przez go2rtc, Winamp, `tablet-dashboard` właściciela jako moduł, HACS.

## Instalacja przez HACS

Właściciel chce instalować PanelPilot z GitHuba przez HACS. To **integracja**, nie dodatek Supervisora. HACS nie widzi prywatnych repozytoriów. Kiedy właściciel się zgodzi:

1. Upublicznij repo.
2. Zmień v0.1.0 na zwykłe wydanie, bo HACS domyślnie pomija wydania wstępne.
3. W HA: *HACS → ⋮ → Niestandardowe repozytoria*, adres repo, typ „Integracja”, potem *Pobierz*, restart HA i dodanie integracji.

Później można zgłosić projekt do domyślnej listy HACS. Do tego czasu integrację można skopiować ręcznie do `config/custom_components/`.

## Pliki poza repo

Te pliki są w osobnym **prywatnym** repo `Jabol86/panelpilot-prywatne`, którego nigdy nie upubliczniamy. Jego README mówi, gdzie je skopiować. Nigdy nie wrzucaj ich do tego repo.

- `android/panelpilot.keystore` i `android/keystore.properties`: **klucz podpisu APK** (w prywatnym repo: `klucz/`).
  - **Uwaga:** `tools/build-apk.ps1` przy braku klucza tworzy nowy. APK podpisany nowym kluczem nie zainstaluje się na panelu z wersją z v0.1.0; trzeba by ją najpierw odinstalować.
  - Przed budowaniem wydania sprawdź, czy klucz z prywatnego repo jest w `android/`.
- `_private/moj-pulpit.json`: pulpit właściciela z jego encjami, do wczytania w edytorze w zakładce *Eksport*. Ma 3 strony: Dom, Energia i Muzyka. Stacje radia nie mają jeszcze akcji.
- `_private/prototyp`: stary prototyp z encjami właściciela.
- `_private/wydanie.md`: opis wydania v0.1.0.
- Narzędzia budowania (JDK 17, Gradle, Android SDK, Python, git, gh) były w `%TEMP%\dpb` na domowym komputerze. W biurze trzeba je zainstalować od nowa albo zdać się na CI.

## Czekamy od właściciela

- YAML karty Winampa: encja i akcje 8 stacji (Eska2, ZET, RMF, RMF Classic, RMF MAXX, Eska i dwie niepewne), ewentualnie logo stacji.
- Wersja firmware panelu i czy ADB jest włączone.
- Wynik pierwszej próby na panelu.

## Proponowane kolejne funkcje

1. Instalacja APK z poziomu HA przez ADB (wpisujesz IP panelu).
2. Aktualizacja aplikacji z HA jednym przyciskiem.
3. Angielska wersja interfejsu.
4. Alarm z klawiaturą PIN, interkom między panelami.
5. Asystent głosowy, komunikaty TTS, timery.
6. Gotowe szablony pulpitów, zdjęcia na wygaszaczu.

Kolejność zaproponowana właścicielowi: najpierw próba na panelu, potem punkty 1 i 3.
