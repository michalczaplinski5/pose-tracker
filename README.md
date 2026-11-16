# PoseTracker RobotLab

Interfejs człowiek–komputer (HMI) do rozpoznawania sylwetki i dłoni w przeglądarce, sterowania wirtualnym kursorem oraz opcjonalnie systemową myszą przez lokalny program.

**Wersja online:** https://michalczaplinski5.github.io/pose-tracker/

## Co potrafi

- **33 punkty sylwetki** — MediaPipe Pose Landmarker, wybór Lite / Full / Heavy.
- **42 punkty obu dłoni** — MediaPipe Hand Landmarker, 21 punktów na dłoń.
- **478 punktów twarzy (opcjonalnie)** — MediaPipe Face Landmarker; włączane na żądanie, przetwarzane rzadziej niż ręce ze względu na wydajność.
- Łącznie do **553 punktów** dla jednej osoby, dwóch dłoni i jednej twarzy.
- Wirtualny kursor prowadzony czubkiem palca wskazującego.
- Kliknięcie gestem **pinch** (zbliżenie kciuka i palca wskazującego), ze skalowaniem do wielkości dłoni, histerezą i krótkim opóźnieniem przeciw przypadkowym kliknięciom.
- Wygładzanie kursora, wybór lewej lub prawej dłoni, odbicie lustrzane.
- Panel testowy z przyciskami A/B/C i licznikiem kliknięć.
- Opcjonalne sterowanie kursorem systemowym przez lokalny skrypt Python.

## GitHub Pages

Pliki \`index.html\`, \`app.js\`, \`styles.css\` działają bez instalacji backendu. GitHub Pages: **Settings → Pages → Deploy from a branch → main → /(root)**.

Strona online nie może legalnie uzyskać bezpośredniego dostępu do kursora całego systemu. Wirtualny kursor i kliknięcia dotyczą wyłącznie pola demonstracyjnego w przeglądarce.

## Windows — sterowanie prawdziwą myszką

Aby sterować kursorem Windows, potrzebny jest **lokalny most**. Nie uruchamia się on na GitHub Pages.

1. Pobierz repozytorium (Git → Code → Download ZIP) i wypakuj.
2. Otwórz terminal w katalogu zawierającym \`desktop_bridge.py\`.
3. Zainstaluj zależność:

   \`\`\`powershell
   py -m pip install -r requirements.txt
   \`\`\`

4. Uruchom:

   \`\`\`powershell
   py desktop_bridge.py
   \`\`\`

5. Otwórz **http://127.0.0.1:8765** (nie adres GitHub Pages).
6. Kliknij **Uruchom kamerę**, zaznacz **Włącz sterowanie gestami** i upewnij się, że kursorem można poruszać w obszarze testowym.
7. Kliknij **Uzbrój mysz systemową**. Od tej chwili wskazujący palec przesuwa kursor głównego ekranu, a gest szczypnięcia uruchamia kliknięcie lewym przyciskiem.

**Zatrzymanie:** przycisk **STOP — rozbrój**, klawisz **Esc** (gdy strona ma fokus), **Ctrl+C** w terminalu, ewentualnie fizyczne przesunięcie kursora do narożnika ekranu (PyAutoGUI fail-safe). Most automatycznie rozbraja się po utracie dłoni lub około 2 sekundach bez nowych danych. Uruchamiaj to tylko na komputerze, do którego masz pełne uprawnienia.

Most słucha **wyłącznie** \`127.0.0.1:8765\`. Komendy wymagają zgodnego \`Origin\` i formatu JSON. Nie otwieraj tego portu do sieci ani nie uruchamiaj kodu mostu na obcym komputerze.

### Wskazówki do śledzenia

- Kamera na wysokości głowy lub tułowia; dłoń w całości w kadrze.
- Równomierne oświetlenie i możliwie proste tło.
- Wybierz **Lite** dla słabszego urządzenia lub wyłącz twarz.
- Przy łączeniu trzech modeli FPS będzie zwykle niższy niż z jednym modelem.
- Wartości \`worldLandmarks\` są estymacją modelu, nie dokładnym, skalibrowanym pomiarem 3D.

## Architektura

\`\`\`text
Kamera użytkownika
  ├── Pose Landmarker (33) ─┐
  ├── Hand Landmarker (2×21) ├─> Overlay Canvas + panel statystyk
  └── Face Landmarker (478) ─┘
               |
        palec wskazujący + pinch
               |
        filtr + normalizacja + histereza
               |
        ├── wirtualna mysz w przeglądarce (GitHub Pages)
        └── opcjonalny loopback HTTP -> desktop_bridge.py -> PyAutoGUI -> Windows
\`\`\`

**Uwaga robotyczna:** sterowanie gestami nie jest funkcją bezpieczeństwa maszyny. Nie wolno używać go bezpośrednio do ruchu rzeczywistych robotów ani zastępować nim E-Stop, enable/hold-to-run, ograniczeń bezpieczeństwa lub potwierdzeń operatora. Ewentualna integracja z UR powinna być osobnym, zabezpieczonym etapem, poprzedzonym walidacją oraz oceną ryzyka.

## Zawartość repozytorium

- \`index.html\` — interfejs.
- \`styles.css\` — styl.
- \`app.js\` — analiza obrazu i gesty.
- \`desktop_bridge.py\` — opcjonalny lokalny serwer i sterowanie myszą.
- \`requirements.txt\` — zależność do lokalnego mostu.

## Źródła API

- [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- [Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
- [PyAutoGUI](https://pyautogui.readthedocs.io/en/latest/)

Analiza wideo odbywa się lokalnie w przeglądarce. Przy pierwszym uruchomieniu biblioteka WebAssembly i modele pobierane są z CDN / Google Cloud Storage. Program nie nagrywa i nie przesyła strumienia wideo.
