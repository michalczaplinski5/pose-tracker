# PoseTracker — Gesture Studio

Aplikacja do sterowania wirtualnym kursorem dłonią w przeglądarce. Model **MediaPipe Hand Landmarker** śledzi 21 punktów na każdej dłoni. Przesuwasz palec wskazujący, aby poruszać kursorem, i łączysz go z kciukiem, aby kliknąć.

**Strona:** https://michalczaplinski5.github.io/pose-tracker/

## Tryb 1: w przeglądarce (bez instalacji)

1. Otwórz stronę w Chrome lub Edge na komputerze.
2. Kliknij **Uruchom kamerę** i przyznaj dostęp.
3. Poczekaj na napis **Śledzenie aktywne**. Przy pierwszym użyciu pobiera się biblioteka i model.
4. Ustaw dłoń w kadrze i przesuwaj palec wskazujący. Turkusowy kursor będzie poruszał się po strefie testowej po prawej.
5. Naprowadź kursor na **A**, **B** lub **C**. Złącz czubki kciuka i palca wskazującego na ok. 0,1 s — nastąpi kliknięcie. Rozsuń palce przed kolejnym kliknięciem.
6. Kliknij **Ustawienia zaawansowane**, aby włączyć dodatkowo sylwetkę (33 punkty) lub twarz (478 punktów), wybrać dłoń i zmienić wygładzanie.

**Ważne:** na GitHub Pages jest to myszka **tylko wewnątrz pola testowego na tej stronie**. Zwykła strona WWW nie może sterować kursorem całego Windowsa.

## Co się zmieniło w V3

- Jednoznaczny przepływ: **kamera → wykrycie dłoni → ruch kursora → kliknięcie**.
- Śledzenie dłoni włącza się automatycznie — żadnego ukrytego przełącznika sterowania.
- **Hand Landmarker jest jedynym modelem ładowanym domyślnie.** To skraca start i redukuje obciążenie przeglądarki.
- Model sylwetki i model twarzy ładowane są dopiero po włączeniu w ustawieniach.
- Wyraźne komunikaty etapów uruchamiania i błędów kamery.
- Regulowane wygładzanie kursora, histereza szczypnięcia, blokowanie wielokrotnych kliknięć.
- Układ kamery i nakładki canvas korzysta z tego samego `object-fit: contain`, aby rysunek pokrywał się z obrazem.
- Wprowadzone ograniczenie częstotliwości wnioskowania do ok. 25 Hz.

## Tryb 2: prawdziwa myszka Windows (eksperymentalny)

Tryb lokalny wymaga Pythona i połączenia z osobnym programem na tym samym komputerze. Nie działa na zdalnej stronie GitHub Pages.

1. Pobierz repozytorium jako ZIP, rozpakuj i otwórz PowerShell w katalogu projektu.
2. Zainstaluj zależność:

   ```powershell
   py -m pip install -r requirements.txt
   ```

3. Uruchom:

   ```powershell
   py desktop_bridge.py
   ```

4. Otwórz **http://127.0.0.1:8765**.
5. Uruchom kamerę, sprawdź działanie wskaźnika w polu testowym, a następnie świadomie kliknij **Uzbrój mysz**.

Most działa na **127.0.0.1** i wymaga uzbrojenia. Awaryjnie można kliknąć STOP, nacisnąć Esc na aktywnej stronie lub zatrzymać serwer Ctrl+C. PyAutoGUI posiada również własny mechanizm failsafe.

Nie używaj prototypu do sterowania rzeczywistym robotem lub realizacji funkcji bezpieczeństwa. Sterowanie robotem wymaga osobnego projektu interfejsu, oceny ryzyka i niezależnych zabezpieczeń.

## Testy

Statycznie sprawdzono składnię JavaScript i powiązania elementów HTML. W kontrolowanym teście z atrapą modelu MediaPipe zweryfikowano: uruchomienie kamery, śledzenie dłoni, przesunięcie kursora, kliknięcie przycisku oraz obsługę utraty śledzenia i zatrzymania kamery.

**Nie zastępuje to testu end-to-end na fizycznej kamerze**, rzeczywistym modelu AI i docelowej przeglądarce.

## Struktura

- `index.html` — interfejs.
- `styles.css` — wygląd strony.
- `app.js` — logika MediaPipe i gestów.
- `desktop_bridge.py` — opcjonalny lokalny most do kursora systemowego.
- `requirements.txt` — pakiet PyAutoGUI.

Technologie: JavaScript, MediaPipe Tasks Vision, Canvas 2D, opcjonalnie Python/PyAutoGUI. Bez backendu w GitHub Pages.

Dokumentacja: [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker), [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker), [Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker).
