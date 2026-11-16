"""
PoseTracker RobotLab — opcjonalny lokalny most dla myszki systemowej.

Wymagania: Python 3.10+, pip install pyautogui
Uruchom: python desktop_bridge.py
Otwórz:  http://127.0.0.1:8765

Bezpieczeństwo:
- HTTP nasłuchuje wyłącznie na 127.0.0.1 (nigdy w sieci LAN)
- żądania sterujące wymagają dokładnego Origin i application/json
- sterowanie jest domyślnie rozbrojone, wymaga ręcznego uzbrojenia w UI
- po 2 sekundach bez komend most automatycznie się rozbraja
- PyAutoGUI FAILSAFE pozostaje włączony
- Ctrl+C kończy proces
"""

from __future__ import annotations

import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

try:
    import pyautogui
except ImportError as exc:
    raise SystemExit(
        "Brakuje PyAutoGUI. Zainstaluj: python -m pip install pyautogui"
    ) from exc

HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent
PERMITTED_ORIGINS = {
    f"http://{HOST}:{PORT}",
    f"http://localhost:{PORT}",
}
INACTIVITY_LIMIT = 2.0
MIN_CLICK_GAP = 0.40

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.01


class BridgeState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.armed = False
        self.last_packet = 0.0
        self.last_click = 0.0


state = BridgeState()


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "PoseTrackerLocalBridge/1.0"

    def send_bytes(self, data: bytes, content_type: str = "text/plain", status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def json_reply(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_bytes(data, "application/json; charset=utf-8", status)

    def do_GET(self) -> None:
        route = urlsplit(self.path).path
        if route == "/api/health":
            with state.lock:
                active = state.armed and time.monotonic() - state.last_packet <= INACTIVITY_LIMIT
                if not active:
                    state.armed = False
            return self.json_reply({"available": True, "armed": active})

        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/index.html": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/styles.css": ("styles.css", "text/css; charset=utf-8"),
        }
        item = files.get(route)
        if item is None:
            return self.json_reply({"error": "Not found"}, 404)
        name, mime = item
        try:
            contents = (ROOT / name).read_bytes()
            self.send_bytes(contents, mime)
        except FileNotFoundError:
            self.json_reply({"error": "Missing app files"}, 500)

    def do_POST(self) -> None:
        route = urlsplit(self.path).path
        if route not in {"/api/arm", "/api/mouse"}:
            return self.json_reply({"error": "Not found"}, 404)
        if self.headers.get("Origin") not in PERMITTED_ORIGINS:
            return self.json_reply({"error": "Incorrect origin"}, 403)
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.json_reply({"error": "JSON required"}, 415)

        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not (1 <= size <= 512):
                return self.json_reply({"error": "Invalid request size"}, 400)
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("Expected object")
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.json_reply({"error": "Invalid JSON"}, 400)

        if route == "/api/arm":
            if type(payload.get("armed")) is not bool:
                return self.json_reply({"error": "Expected armed boolean"}, 400)
            with state.lock:
                state.armed = payload["armed"]
                state.last_packet = time.monotonic() if state.armed else 0
            return self.json_reply({"armed": state.armed})

        x, y, clicked = payload.get("x"), payload.get("y"), payload.get("click", False)
        if (type(x) not in (float, int)
                or type(y) not in (float, int)
                or type(clicked) is not bool
                or not math.isfinite(x)
                or not math.isfinite(y)
                or not (0 <= x <= 1 and 0 <= y <= 1)):
            return self.json_reply({"error": "Invalid coordinates"}, 400)

        with state.lock:
            now = time.monotonic()
            if not state.armed or now - state.last_packet > INACTIVITY_LIMIT:
                state.armed = False
                return self.json_reply({"error": "Disarmed (timeout)"}, 409)
            state.last_packet = now

            # Keep the tracking target away from screen corners,
            # so PyAutoGUI's manual corner failsafe remains reachable.
            width, height = pyautogui.size()
            screen_x = round((0.035 + 0.93 * x) * (width - 1))
            screen_y = round((0.035 + 0.93 * y) * (height - 1))
            try:
                pyautogui.moveTo(screen_x, screen_y, duration=0)
                if clicked and now - state.last_click >= MIN_CLICK_GAP:
                    pyautogui.click()
                    state.last_click = now
            except pyautogui.FailSafeException:
                state.armed = False
                return self.json_reply({"error": "PyAutoGUI failsafe activated"}, 409)
            except Exception as exc:
                state.armed = False
                return self.json_reply({"error": str(exc)}, 500)
        self.json_reply({"ok": True, "armed": True})

    def log_message(self, format: str, *args: object) -> None:
        # Avoid logging each pointer movement (up to ~15 requests/s).
        if not self.path.startswith("/api/mouse"):
            super().log_message(format, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)
    print(f"PoseTracker RobotLab: http://{HOST}:{PORT}")
    print("Most lokalny: domyślnie ROZBROJONY. Aby zatrzymać: Ctrl+C.")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print("\nZatrzymano most.")
    finally:
        with state.lock:
            state.armed = False
        server.server_close()
