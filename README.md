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


---

## V5 — HoloDesk: przestrzenny pulpit gestowy

**Uruchom:** https://michalczaplinski5.github.io/pose-tracker/desk.html

HoloDesk to osobny eksperyment (pliki \`desk.html\`, \`desk.css\`, \`desk.js\`, \`desk-engine.mjs\`), który **nie zastępuje** V4 Air Mouse ani wcześniejszego HoloLab.

### Funkcje

- Pulpit **CSS 3D** z czterema przestrzennymi oknami: galeria, podgląd 3D, notatki i statystyki.
- Obracanie/powiększanie i przesuwanie okien myszką, a po uruchomieniu kamery także **chwytanie i przemieszczanie gestem szczypnięcia**.
- **Dwa jednoczesne szczypnięcia obiema dłońmi:** skalowanie i obracanie wybranego okna oraz przesuwanie środka między dłońmi.
- **Bezwładność po puszczeniu**: okno kontynuuje ruch i stopniowo wyhamowuje, z ograniczeniem do obszaru roboczego.
- **Otwarta dłoń przez 0,7 sekundy:** menu kołowe do wybierania lub przywracania okien, resetowania układu i zamykania menu.
- **Pięść przez 0,95 sekundy:** pauza; otwarta dłoń przez 0,9 sekundy wznawia gesty. Przycisk Pauza działa niezależnie.
- **Import JPG/PNG/WebP/GIF**: pliki z lokalnego dysku pojawiają się jako nowe, ruchome okna. Maksymalnie 10 zdjęć po 18 MB każde.
- **Import samodzielnego GLB** (do 40 MB): wizualizacja 3D w oknie przy użyciu Three.js i GLTFLoader. Domyślnie okno zawiera proceduralny model testowy. Wczytany model można obracać myszą wewnątrz okna.
- Notatki automatycznie zapisują się w lokalnym \`localStorage\`; zdjęcia i modele **nie są wysyłane** do serwera i nie zostają zachowane między sesjami.
- Można przeciągnąć zdjęcie lub plik GLB z Eksploratora na pulpit.
- Wersja bez kamery jest pełnoprawnym demonstratorem: przeciąganie okien za nagłówki, skalowanie kółkiem, wybieranie menu, otwieranie i zamykanie paneli.

### Szybki test

1. Otwórz \`desk.html\`.
2. Bez włączania kamery przeciągnij okno za nagłówek. Puść z rozpędem, aby zobaczyć bezwładność.
3. Najedź myszką na okno i użyj kółka, aby zmienić jego rozmiar.
4. Kliknij **Menu gestowe** i wybierz panel.
5. Dodaj zdjęcie i plik \`.glb\` przyciskami na pasku narzędzi.
6. Włącz kamerę. Palcem wskazującym celuj w panel i wykonaj **pinch (kciuk + wskazujący)**, aby go chwycić.
7. Złącz palce obu rąk, aby skalować i obracać zaznaczony panel.
8. Przytrzymaj otwartą dłoń, aby wywołać menu kołowe, potem wskaż jego opcję i wykonaj pinch.

**Skróty:** M — menu, P — pauza, R — reset układu, Esc — zamknij menu.

### Technologia i ograniczenia

HoloDesk używa MediaPipe Hand Landmarker (po 21 punktów na dłoń), CSS transforms z perspektywą, lokalnego JavaScript i osobnego modułu Three.js do modeli GLB. Biblioteki i modele pobierane są z CDN przy pierwszym użyciu; przetwarzanie klatek kamery i import plików pozostają na urządzeniu. **Nie jest to prawdziwy hologram ani metrologiczne śledzenie 3D**: jedna kamera RGB daje przede wszystkim współrzędne obrazu 2D, a operacje przestrzenne są mapowane na wirtualny pulpit.

Nie należy używać HoloDesk do sterowania rzeczywistymi robotami, maszynami ani jako funkcji bezpieczeństwa.

### Testy

GitHub Actions wykonuje \`node --test tests/*.test.mjs\`, sprawdzając automaty gestów i bezwładność V5, wcześniejsze gesty V4 i HoloLab oraz składnię modułów. Testy nie zastępują walidacji na kamerze i w docelowej przeglądarce.


### HoloDesk V5.1 — łatwiejsze sterowanie dłonią

Wersja V5.1 poprawia przede wszystkim obsługę kamery i rozpoznawanie gestów, nie tylko wygląd.

- **Potwierdzanie pinch w czasie** i progi histerezy: pojedyncza błędna klatka nie powinna natychmiast chwytać lub upuszczać panelu. Zmniejsza to przypadkowe drgania.
- **Łatwiejsze wskazywanie okien**: wybieranie najbliższego panelu w promieniu 64 pikseli, widoczne podświetlenie celu i etykieta kursora.
- **Adaptacyjny filtr kursora**: wygładzanie przy nieruchomej dłoni i szybsza reakcja na zdecydowany ruch.
- **Kalibracja dwóch punktów**: ustaw palec w wygodnym lewym górnym, następnie prawym dolnym rogu przestrzeni ruchu; zatwierdź szczypnięciem lub przyciskiem.
- **Panel „Control Tuning”**: zakres ruchu, stabilizacja i łatwość chwytu. Wartości są zapisywane lokalnie w przeglądarce.
- **Diagnostyka gestu na żywo**: widoczny rodzaj gestu i współczynnik pinch. Po utracie dłoni kursor jest ukrywany, a chwyt bezpiecznie przerywany.
- **Lepsza detekcja przy częściowym zasłonięciu dłoni**: rozpoznawanie otwartej dłoni / pięści na podstawie kątów palców i tolerancja krótkiego zaniku śledzenia.
- Kamera próbuje użyć rozdzielczości **960 × 540** (jeśli obsługuje) przy 30 kl./s; MediaPipe ładuje się na GPU, a jeśli niedostępne — CPU.

**Praktyczny test:** włącz kamerę, skieruj wyprostowany palec na wybrane okno (powinno się podświetlić), zetknij kciuk z palcem wskazującym na krótką chwilę, przesuń dłoń i rozsuń palce. Jeśli kursor nie obejmuje całego pulpitu, wybierz **Kalibruj rękę** i zaznacz wygodny zakres ruchu. Jeśli gest pinch wykrywany jest za rzadko, zwiększ **Łatwość chwytu** do 80–90%.

**Uwaga:** automatyczne testy syntetycznych punktów i Chromium nie zastępują oceny na rzeczywistym obrazie kamery. Jakość pozostaje zależna od oświetlenia, kadrowania dłoni i wydajności urządzenia.
