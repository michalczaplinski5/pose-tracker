# PoseTracker

Aplikacja do śledzenia sylwetki w czasie rzeczywistym za pomocą kamery i **MediaPipe Pose Landmarker**. Wykrywa punkty ciała, rysuje szkielet i wyświetla liczbę FPS. Działa bez backendu, bez nagrywania i wysyłania obrazu z kamery.

## GitHub Pages

W repozytorium wybierz **Settings → Pages → Build and deployment → Deploy from a branch**, następnie ustaw **main** i **/(root)**, kliknij **Save**.

Adres po wdrożeniu: https://michalczaplinski5.github.io/pose-tracker/

Kamera wymaga HTTPS i zgody użytkownika.

## Lokalnie

Uruchom serwer statyczny w katalogu repozytorium:

```bash
python -m http.server 8000
```

Otwórz http://localhost:8000.

## Pliki

- `index.html` — interfejs
- `styles.css` — wygląd i responsywność
- `app.js` — obsługa kamery i modelu MediaPipe

Biblioteka oraz model AI ładowane są z zewnętrznych serwerów przy uruchomieniu. Analiza wideo odbywa się w przeglądarce.

Referencja: https://stainedmentor.github.io/Form/ — własna implementacja podobnej funkcjonalności.
