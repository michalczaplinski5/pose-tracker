"""Integration tests for the local bridge with a fake PyAutoGUI module."""
from __future__ import annotations

import importlib.util
import json
import sys
import threading
import types
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


FAKE = types.ModuleType("pyautogui")
FAKE.events = []
FAKE.FAILSAFE = True
FAKE.PAUSE = 0.0
FAKE.FailSafeException = type("FailSafeException", (Exception,), {})
FAKE.size = lambda: (1920, 1080)
FAKE.moveTo = lambda x, y, duration=0: FAKE.events.append(("move", x, y))
FAKE.click = lambda button="left": FAKE.events.append(("click", button))
FAKE.mouseDown = lambda button="left": FAKE.events.append(("down", button))
FAKE.mouseUp = lambda button="left": FAKE.events.append(("up", button))
FAKE.scroll = lambda amount: FAKE.events.append(("scroll", amount))
sys.modules["pyautogui"] = FAKE

MODULE_PATH = Path(__file__).resolve().parents[1] / "desktop_bridge.py"
spec = importlib.util.spec_from_file_location("pose_tracker_bridge", MODULE_PATH)
bridge = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.BridgeHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        with bridge.state.lock:
            bridge.state.armed = False
            bridge.state.mouse_down = False
            bridge.state.last_packet = 0
            bridge.state.last_click = 0
            bridge.state.scroll_remainder = 0
        FAKE.events.clear()

    def req(self, path, payload=None, origin="http://127.0.0.1:8765"):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            self.url + path,
            data=data,
            headers={"Origin": origin, "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def test_health(self):
        status, response = self.req("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(response["available"])

    def test_cannot_move_when_disarmed(self):
        status, _ = self.req("/api/mouse", {"event": "move", "x": .5, "y": .5})
        self.assertEqual(status, 409)
        self.assertFalse(FAKE.events)

    def test_wrong_origin_rejected(self):
        status, _ = self.req("/api/arm", {"armed": True}, origin="https://example.com")
        self.assertEqual(status, 403)

    def test_arm_click_and_disarm(self):
        self.assertEqual(self.req("/api/arm", {"armed": True})[0], 200)
        self.assertEqual(self.req("/api/mouse", {"event": "click", "x": .5, "y": .5})[0], 200)
        self.assertIn(("click", "left"), FAKE.events)
        self.assertEqual(self.req("/api/arm", {"armed": False})[0], 200)

    def test_drag_and_release_on_disarm(self):
        self.req("/api/arm", {"armed": True})
        self.assertEqual(self.req("/api/mouse", {"event": "down", "x": .5, "y": .5})[0], 200)
        self.assertTrue(bridge.state.mouse_down)
        self.req("/api/arm", {"armed": False})
        self.assertFalse(bridge.state.mouse_down)
        self.assertIn(("down", "left"), FAKE.events)
        self.assertIn(("up", "left"), FAKE.events)

    def test_scroll_command(self):
        self.req("/api/arm", {"armed": True})
        self.assertEqual(self.req("/api/mouse", {"event": "scroll", "x": .5, "y": .5, "scroll": 2.3})[0], 200)
        self.assertIn(("scroll", 2), FAKE.events)

    def test_reject_invalid_coordinates_and_scroll(self):
        self.req("/api/arm", {"armed": True})
        self.assertEqual(self.req("/api/mouse", {"event": "move", "x": 12, "y": .5})[0], 400)
        self.assertEqual(self.req("/api/mouse", {"event": "scroll", "x": .5, "y": .5, "scroll": 50})[0], 400)


if __name__ == "__main__":
    unittest.main()
