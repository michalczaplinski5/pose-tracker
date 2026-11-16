# PoseTracker V4 — Air Mouse Studio

Live demo: **https://michalczaplinski5.github.io/pose-tracker/?v=4**

Interfejs HMI oparty na detekcji dłoni MediaPipe. Działa jako **wirtualna mysz w przeglądarce** bez logowania, serwera aplikacyjnego i wysyłania obrazu. Można też uruchomić opcjonalną integrację z myszą Windows lokalnie.

## Wersja 4 — funkcje

| Gest | Efekt w aplikacji |
|---|---|
| Ruch palca wskazującego | Porusza kursorem w panelu testowym |
| Krótki pinch (kciuk + wskazujący) i puszczenie | Kliknięcie w zakładce **Klikanie** |
| Pinch trzymany > 430 ms, przesunięcie i puszczenie | Chwyt, przeciągnięcie i puszczenie karty w zakładce **Przeciąganie** |
| ✌️ Wskazujący + środkowy wyprostowane, pozostałe zgięte | Przewijanie listy w zakładce **Przewijanie** |
| ✊ Pięść trzymana > 850 ms | Pauza sterowania |
| 🖐️ Otwarta dłoń trzymana > 850 ms | Wznowienie sterowania |
| Przycisk **Pauza** lub klawisz **P** | Ręczna pauza/wznowienie |
| Escape | Pauza i rozbrojenie myszki systemowej |

Gesty rozpoznawane są z punktów dłoni, bez dodatkowego ciężkiego modelu klasyfikatora. **Kliknięcie jest emitowane przy rozłączeniu palców**, więc przytrzymanie nie generuje przypadkowego kliku. Debounce zabezpiecza przed wielokrotnymi kliknięciami.

### Kalibracja 4 punktów

1. Uruchom kamerę i otwórz **Ustawienia zaawansowane → Kalibracja 4 punktów**.
2. Ustaw dłoń w pozycji, w której chcesz mapować kursor na **lewy górny róg** panelu. Wykonaj krótki pinch i puść albo kliknij **Zapisz punkt**.
3. Powtórz dla prawego górnego, lewego dolnego i prawego dolnego narożnika.
4. Po poprawnej kalibracji zakres współrzędnych zostaje zapisany w \`localStorage\` w bieżącej przeglądarce. Dla odbicia lustrzanego i zwykłego zakresy są oddzielne.
5. Przycisk **Reset** usuwa kalibrację dla aktualnej orientacji.

Kalibracja jest osiowa (mapuje średnie granice X/Y), więc nie zastępuje pełnej kalibracji homograficznej systemu wizyjnego.

### Stabilizacja

Moduł \`gesture-engine.mjs\` używa wariantu filtru **One Euro** z adaptacyjną charakterystyką, zależną od prędkości ruchu. Dostępna jest regulacja stabilizacji, czułości i martwej strefy. Po utracie dłoni filtr resetuje się, aby uniknąć skoku kursora.

### Opcjonalna detekcja

Domyślnie wczytywany jest tylko **Hand Landmarker (21 × 2 punkty)**. W ustawieniach można dołączyć Pose Landmarker (33 punkty sylwetki, modele Lite/Full/Heavy) i Face Landmarker (478 punktów twarzy). Dodatkowe modele obniżają wydajność na słabszych urządzeniach.

## Uruchomienie na Windows — prawdziwa myszka systemowa

**Uwaga:** tryb GitHub Pages steruje tylko przyciskami i elementami w obrębie aplikacji. Zwykła strona WWW nie może sterować kursorem systemowym.

Jeżeli chcesz sterować pulpitem Windows:

1. Pobierz repozytorium ZIP i rozpakuj folder.
2. Otwórz PowerShell w rozpakowanym katalogu.
3. Zainstaluj zależności: \`py -m pip install -r requirements.txt\`.
4. Uruchom: \`py desktop_bridge.py\`.
5. Otwórz **http://127.0.0.1:8765** (nie adres GitHub Pages).
6. Uruchom kamerę, sprawdź gesty i kliknij **Uzbrój mysz** w dodatkowym panelu.

Tryb lokalny obsługuje kliknięcie, \`mouseDown\` / \`mouseUp\` (przeciąganie) oraz scroll. Polecenia przesyłane są wyłącznie na \`127.0.0.1\`.

**Bezpieczeństwo:** most jest domyślnie rozbrojony i wymaga ręcznego uzbrojenia. STOP, Escape, zamknięcie/ukrycie strony lub utrata dłoni rozbraja most. Serwer ma watchdog: po ok. 2 s bez komend rozbraja się i zwalnia lewy przycisk myszy, nawet gdy strona przestanie wysyłać żądania. Ustawiony jest również PyAutoGUI \`FAILSAFE\` (róg ekranu); Ctrl+C zatrzymuje skrypt.

To prototyp HMI **nieprzeznaczony do bezpośredniego ruchu prawdziwego robota ani do realizacji funkcji bezpieczeństwa**. Integrację z robotem należy zaprojektować jako odrębny, nadzorowany i oceniony pod względem ryzyka moduł.

## Testy

W repozytorium działają automatyczne testy:

- **17 testów jednostkowych** logiki w \`tests/engine.test.mjs\`: rozpoznawanie gestów, próg i histereza pinch, krótki klik, przeciąganie, przewijanie, pauza i wznowienie, kalibracja oraz filtracja sygnału.
- **GitHub Actions** (\`.github/workflows/verify.yml\`) uruchamia testy na Node 22, sprawdza składnię \`app.js\` i kompilację składniową \`desktop_bridge.py\`.
- Dodatkowo wykonano symulację przepływu interfejsu z atrapą kamery i modelu MediaPipe: uruchamianie, kliknięcie, zmiana zakładek, przeciąganie, scroll, pauza, kalibracja i zatrzymanie.

Lokalnie:

\`\`\`bash
node --test tests/engine.test.mjs
node --input-type=module --check < app.js
python -m py_compile desktop_bridge.py
\`\`\`

Testy syntetyczne nie zastępują testu end-to-end na rzeczywistym obrazie z kamery i systemie Windows.

## Architektura

- \`index.html\` — responsywny panel Gesture Studio.
- \`styles.css\` — wizualizacje, zakładki i interakcje.
- \`app.js\` — obsługa kamery, MediaPipe, interfejsu i kolejki poleceń lokalnej myszki.
- \`gesture-engine.mjs\` — czyste, testowalne obliczenia gestów, filtrowanie, kalibracja i automat stanów.
- \`desktop_bridge.py\` — opcjonalny most do lokalnej myszy.
- \`tests/engine.test.mjs\` — testy jednostkowe.

Moduły MediaPipe/WebAssembly i modele pobierane są z CDN i Google Cloud Storage przy pierwszym uruchomieniu. Analiza obrazu jest lokalna, bez wysyłania wideo na serwer.

Dokumentacja:
[MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker) ·
[Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) ·
[PyAutoGUI](https://pyautogui.readthedocs.io/).

---

## HoloLab — sterowanie przestrzenne inspirowane filmowymi interfejsami

**Otwórz:** https://michalczaplinski5.github.io/pose-tracker/holo.html

To **osobny tryb eksperymentalny**. Air Mouse V4 nadal działa pod adresem głównym. HoloLab pokazuje 3D holograficzny rdzeń energetyczny lub uproszczony model ramienia robota (wizualizacja, nie model kinematyczny UR20).

**Sterowanie dłonią (kamera):**

- Jedna dłoń: wskaż obiekt i **złącz kciuk z palcem wskazującym** (pinch). Poruszaj dłonią, aby obracać obiekt. Rozsuń palce, aby puścić.
- Dwie dłonie: wykonaj pinch **obiema dłońmi**. Oddalanie / zbliżanie dłoni zmienia skalę modelu; skręcanie pary dłoni obraca obiekt; przesuwanie obu rąk razem przemieszcza go.
- Możesz też skierować kursor dłoni na holograficzny przycisk **ENERGY CORE** lub **ROBOT ARM** i wykonać pinch, aby przełączyć obiekt.
- Przytrzymanie **pięści** przez ponad 0,85 s wstrzymuje rozpoznawanie manipulacji; po pauzie przytrzymanie **otwartej dłoni** wznawia. Jest też przycisk Pauza.
- Klawisze: **1** / **2** przełączają obiekty, **R** resetuje położenie, **spacja** przełącza pauzę, **Esc** wstrzymuje sterowanie.

**Bez kamery:** naciśnij lewy przycisk myszy na obiekcie i przeciągnij, aby obracać; kółko myszy zmienia skalę. Obsługiwane są także zdarzenia dotykowe przez interfejs wskaźnika przeglądarki.

**Technicznie:** MediaPipe Hand Landmarker (po 21 punktów na każdą dłoń) oraz Three.js (scena WebGL). Moduł \`holo-gestures.mjs\` zawiera osobny automat gestów: śledzenie dwóch dłoni, histerezę szczypnięcia, sterowanie jedną lub dwiema dłońmi, pauzę i obsługę utraty śledzenia. \`holo-scene.mjs\` realizuje rendering i animację, a \`holo.js\` integruje kamerę i UI.

**Ograniczenia:** jedna kamera RGB nie mierzy precyzyjnie ruchu dłoni w przestrzeni; skalowanie z dwóch dłoni jest mapowaniem odległości na **obrazie 2D**, a nie precyzyjnym pomiarem 3D. HoloLab nie łączy się z rzeczywistym robotem. Interakcja jest tylko demonstracją HMI, nie funkcją bezpieczeństwa.

**Testy:** \`node --test tests/*.test.mjs\` sprawdza zarówno gesty V4, jak i HoloLab. GitHub Actions uruchamia testy oraz kontroluje składnię wszystkich modułów JavaScript i lokalnego mostu Python.
