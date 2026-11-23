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

### Aktualizacja 23.11.2026, po południu

- Repo `panelpilot` jest **publiczne**; integracja zainstalowana u właściciela przez HACS.
- APK zainstalowane na NSPanel Pro 120 przez `tools/install-panel.ps1`. Ekran konfiguracji działa, mDNS znalazł HA. Ekran zgłasza 750×1262 w pionie; panel wisi poziomo, więc potrzebny jest obrót 90° albo 270°.
- v0.1.1: ekran konfiguracji przepisany na HTML (`android/app/src/main/assets/setup.html`, most JS `Setup` w `SetupActivity`) w stylu terminala HUD inspirowanym Evangelionem (czarne tło, pomarańcz, sześciokąty, pasy ostrzegawcze). Bez logo i nazw z anime. Obrót działa od razu jako podgląd. Podgląd w przeglądarce: `tools/serve.ps1`, potem `/setup/setup.html`.
- Właściciel uznał v0.1.1 za „zbyt agresywne”. Spośród 4 pokazanych wariantów wybrał „D · Nocne szkło” (spokojne karty, cienkie linie, delikatne sześciokąty), ale w kolorach: **czysta czerń, intensywna czerwień #ee1c25, biały tekst**. Kolor ustala projekt, nie użytkownik (wyraźnie tak chciał). To jest v0.1.2.
- Tę estetykę można zaproponować jako motyw pulpitu.

### v0.1.3: uwagi właściciela po pierwszym użyciu (8 punktów)

1. Nie znalazł jasności → zakładka nazywa się „Panele i jasność”, a na panelu w ustawieniach (koło zębate) jest suwak jasności z „Automatycznie”.
2. Kolor tła ikon → motyw: „Tło ikon: kolorowe kółko” plus kolor; per kafelek `iconBg`.
3. „Formatowanie przycisków się rozjeżdża” (zrzut: kafelki ucięte z lewej) → `#root` bez obrotu ma teraz 100% zamiast px z `innerWidth`. **Nie potwierdzono**, czy to była przyczyna; zapytać, czy zrzut był z panelu, czy z edytora.
4. Ukrycie paska stron → `dashboard.nav = false` (wtedy przycisk ustawień w rogu).
5. Gesty → `dashboard.gestures.{up,down,left,right}` = default/none/next/prev/page/saver/bell/settings/service.
6. Ikony powiadomień na wygaszaczu → `saver.alerts` (pokazują się tylko aktywne encje).
7. Domofon: furtka, brama, rozmowa → przyciski z trybem `hold`/`tap`, szybkie „+ Furtka/+ Brama”, opis, że rozmowa wymaga go2rtc.
8. Edytor nie w menu bocznym → opcja integracji „Pokaż edytor w menu bocznym” (domyślnie wyłączona), link w „Konfiguruj”, `configuration_url` urządzenia, powiadomienie HA przy parowaniu.

### v0.1.4 i v0.1.5

- Punkt 3 wyjaśniony: chodziło o układ treści kafelka, nie ucinanie. v0.1.4: układ (`layout` row/center), wielkość ikony (`iconSize`), styl włączonego kafelka (`theme.onStyle = outline`). Wzór właściciela: ciemny kafelek, cienka żółta ramka, **poświata na zewnątrz** (bez żółtego środka; poprawione w 0.1.5).
- v0.1.5: zakładka „Panele i jasność” nie zapisuje od razu, tylko przyciskiem Zapisz (`pEdits`); przytrzymanie wygaszacza zbliżeniem najwyżej 3 min (u właściciela wygaszacz nie włączał się wcale; nie wiadomo, czy czujnik utknął na „blisko”); osobna zakładka Gesty; kafelki, które się nie mieszczą: wybór, × usuwa, „Przenieś na nową stronę”, „Wstaw w największe wolne miejsce”; wygaszacz: ikona i podpis każdej pozycji, wielkość, pogoda (ikona, temperatura, opis).
- Edytor otwiera się na zakładce paneli, gdy jakiś panel czeka na kod.

### v0.1.6 i v0.1.7

- 0.1.6: po przeładowaniu wpisu integracji panel zostawał przypięty do starego `Hub` (rozłączony w HA, stary kod). Teraz unload wysyła `reload`, panel co minutę robi `panelpilot/ping` i subskrybuje od nowa, a `config` niesie `version` (zmiana = przeładowanie strony). Edytor startuje w formacie panelu pokazującego dany pulpit.
- 0.1.7 (prośba właściciela: obsługa innych tabletów): **własne formaty** `c_…` (nazwa, w×h w px CSS do podglądu, siatka do 24×24, max 12) w `hub.formats`, WS `panelpilot/admin/formats_save`; panel dostaje je w `config.formats`; ustawienie panelu `settings.format` (auto / wbudowany / własny). W edytorze „+ Format”, „Edytuj format”, pole „Format ekranu” przy panelu.

### v0.1.8 (5 uwag właściciela)

1. Format pulpitu `dashboard.format` wybiera się przy „Nowy” i na górnym pasku (lista z „+ Nowy format…”). Panel: `settings.format` → `dashboard.format` → wykrycie z ekranu. Z ustalonym formatem pasek podglądu nie ma przełącznika.
2. Pasek stron `dashboard.nav` = `dots` (domyślnie, kropki) / `tabs` (pigułki na środku) / `none`; dawne true/false działają.
3. Domofon zawsze czarno-czerwony (#ee1c25), znacznik „Ktoś dzwoni”; po otwarciu nakładka „Otwarto” i okno zostaje `doorbell.after` s (domyślnie 10).
4. Wyrównanie `align` (left/center/right) i `valign` (top/center/bottom) w kafelku i w motywie.
5. `anim` (pulse/spin/blink/bounce/shake/glow) dla włączonego kafelka i w motywie; `rules`: [{entity?, op on/off/eq/ne/gt/lt, value, color, bg, lit, anim, icon}], działa pierwszy spełniony.

### v0.1.9 i v0.1.10

- 0.1.9: położenie treści kafelka to siatka 3×3 (`posPicker`), bo dwie osobne listy myliły (właściciel ustawił tylko pion).
- 0.1.10:
  - nagłówek strony `page.title` i `titleAlign` (#ptitle, wysokość pół wiersza przez flex 0.5 : liczba wierszy);
  - ukrywanie stanu: `tile.showState` (true/false) albo `theme.state = "hide"` (klasa `nost`);
  - panel pogody na wygaszaczu: `saver.weather` i `saver.days` (0–7);
  - w zakładce Gesty pola zależne są wcięte pod kierunkiem.

### v0.1.11

- Odtwarzacz:
  - `vol` = przyciski − i + ze wskaźnikiem (domyślnie) / `slider` / `none`, krok `volStep` (domyślnie 5%);
  - `perRow` ustala liczbę stacji w rzędzie, dzięki czemu mieszczą się w kilku rzędach;
  - okrągłe przyciski play/next.
- Strona główna `dashboard.home`: panel startuje na niej, wraca na nią po wygaszaczu i po jej zmianie. Jest gest `home`.
- Gest „Wybrana strona” zapamiętuje drogę powrotu (`back`): przeciwny kierunek wraca na stronę, z której przyszliśmy. Sprawdzone na atrapie: Dom ←Oświetlenie →Dom →Muzyka ←Dom.

### v0.1.12

Kafelek `section` (Sekcja) dzieli stronę na działy, np. „Kuchnia”, „Salon”.
- Ma flagę `thin` widżetu: wiersz z samymi sekcjami o h=1 ma 0.5fr (`DP.rowTracks`).
- Edytor (`geo`, `rowSpan`, `cell`) bierze rzeczywiste wysokości wierszy z `gridTemplateRows` podglądu.
- Nagłówek strony z 0.1.10 został, ale właścicielowi chodziło o sekcje w środku strony.

### v0.1.13

Zgłoszenie: o 23:14 panel świecił jasno, a „Zbliżenie” stale pokazywało „wykryto”.
- Tryb nocny: wcześniej z czujnikiem światła godziny były pomijane (liczyły się tylko lx). Teraz `settings.nightMode` = `both` (domyślnie: godziny nocne albo ciemno) / `hours` / `lux`. Przy zmianie dzień↔noc ręczna jasność (`manual`, z suwaka albo z encji ekranu) wraca na automatyczną.
- Zbliżenie: `settings.proximityInvert` odwraca odczyt w panel.js (`rawNear`, działa od razu po zapisie). APK bez zmian. **Nie potwierdzono** na panelu, czy czujnik jest odwrócony, czy zgłasza „daleko” poniżej `maximumRange` (wtedy odwrócenie nie pomoże i trzeba poprawić APK: `MainActivity.onSensorChanged`).

### v0.1.14

- Przyciski głośności 84×64 px (wspólne `volBox`/`volClick` w widgets.js).
- Kafelek `tv` (Telewizor): media_player + opcjonalny `remote` (Philips: `remote.send_command` z CursorUp/Down/Left/Right, Confirm, Back, Home; `keys` JSON nadpisuje kody). Zasilanie, wyciszenie, kanały (next/previous_track), źródło, głośność. Niesprawdzone z prawdziwym Philipsem.
- Kafelek `count` (Licznik włączonych): `entities`, napis „N włączone/włączonych”; w edytorze przycisk „+ Wszystkie światła” (pole `quick`, pomija grupy świateł).
- `navOrder()` w panel.js: przy `dashboard.home` i ≥3 stronach główna na środku paska; strona z gestu `left` po prawej, z `right` po lewej, reszta na zmianę. Gesty next/prev idą w tej kolejności.

### v0.1.15

Zgłoszenie: „mam najnowszą wersję, ale wielu funkcji nie mam w edytorze”. Przyczyna: podgląd w edytorze (iframe tworzony przez JS) i pliki index.html/widgets.js nie miały wersji w adresie, więc przeglądarka brała stare kopie; Ctrl+F5 ich nie odświeża. Teraz `StaticView` w http.py zamiast `register_static_paths`: `Cache-Control: no-cache`, a w index.html i w importach editor.js dopisuje `?v=VERSION`; iframe też ma `?v=`.

### v0.1.16 (APK 0.1.3)

- Przyciski głośności szersze, nie wyższe (96×48): wyższe rozjeżdżały kafelek.
- Kafelek `tv` od nowa: `sources` [{name, image, match?, service?, data?}] jako przyciski z logo (domyślnie `select_source`, aplikacje z własną akcją); bieżące źródło rozpoznawane po app_name → media_channel → media_title → source; tło `.tv-bg` = logo źródła albo `entity_picture`; przycisk zasilania; „Pilot” przełącza siatkę źródeł na strzałki; kanały opcjonalnie (`ch`). W edytorze `tvSources` z „+ Wszystkie źródła z telewizora”.
- Licznik: `.st.keep` nie chowa się przy `theme.state = hide` (u właściciela stan był ukryty, dlatego nie było liczby).
- Wygaszacz: `saver.alertText`, `saver.alertIcons`, `saver.alertStyle` (plain/frame/icon).
- APK 0.1.3: `Tunnel.open()` – jeden tunel na proces, ponowne użycie przy tym samym adresie HA, ponawianie bind, automatyczna ponowna próba zamiast stałego błędu EADDRINUSE. `build-apk.ps1` woła Gradle przez cmd (ostrzeżenia javac przerywały skrypt).

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
