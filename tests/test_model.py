"""Testy modelu danych (bez Home Assistanta): python tests/test_model.py"""

import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).parent.parent / "custom_components" / "panelpilot" / "model.py"
spec = importlib.util.spec_from_file_location("model", PATH)
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class Dashboard(unittest.TestCase):
    def test_starter_is_empty_except_clock(self):
        d = model.starter_dashboard()
        self.assertEqual([t["type"] for t in d["pages"][0]["tiles"]], ["clock"])
        self.assertEqual(d["mode"], "tiles")

    def test_layout_outside_screen_is_dropped(self):
        tile = {"type": "sensor", "l": {"square": [5, 0, 2, 1], "portrait": [4, 9, 2, 1], "landscape": False}}
        out = model.clean_tile(tile)
        self.assertEqual(out["l"], {"portrait": [4, 9, 2, 1], "landscape": False})

    def test_custom_fields_survive(self):
        out = model.clean_tile({"type": "moj_kafelek", "dowolne": {"a": 1}})
        self.assertEqual(out["dowolne"], {"a": 1})

    def test_page_names_unique(self):
        d = model.clean_dashboard({"pages": [{"name": "A", "tiles": []}, {"name": "A", "tiles": []}]})
        self.assertEqual([p["name"] for p in d["pages"]], ["A", "A (2)"])

    def test_bad_input(self):
        for bad in (None, {}, {"pages": []}, {"pages": [1]}, {"pages": [{"tiles": [{"type": "../x"}]}]}):
            with self.assertRaises(model.InvalidData):
                model.clean_dashboard(bad)

    def test_module_address(self):
        ok = model.clean_dashboard({"pages": [{"tiles": []}], "mode": "module", "module": "/local/x/p.js", "element": "moj-panel"})
        self.assertEqual((ok["mode"], ok["module"], ok["element"]), ("module", "/local/x/p.js", "moj-panel"))
        for bad in ("//evil/x.js", "javascript:alert(1)", "/a b.js"):
            with self.assertRaises(model.InvalidData):
                model.clean_dashboard({"pages": [{"tiles": []}], "module": bad})


class Other(unittest.TestCase):
    def test_settings_clamped(self):
        s = model.clean_settings({"dayBrightness": 500, "rotation": 45, "nightFrom": "x", "wakeOnProximity": False})
        self.assertEqual((s["dayBrightness"], s["rotation"], s["nightFrom"], s["wakeOnProximity"]), (100, 0, 22, False))

    def test_doorbell(self):
        d = model.clean_doorbell({"go2rtc": "http://192.0.2.1:1984/", "stream": "brama", "actions": [{"name": "F", "entity": "switch.f"}, {"entity": "zle"}]})
        self.assertEqual(d["go2rtc"], "http://192.0.2.1:1984")
        self.assertEqual(len(d["actions"]), 1)
        pub = model.public_doorbell(d)
        self.assertTrue(pub["own"])
        self.assertNotIn("go2rtc", pub)
        with self.assertRaises(model.InvalidData):
            model.clean_doorbell({"go2rtc": "ftp://x"})

    def test_custom_formats(self):
        f = model.clean_formats({"c_tab": {"name": "Tablet", "w": 1280, "h": 800, "cols": 10, "rows": 6}})
        self.assertEqual(f["c_tab"]["cols"], 10)
        for bad in ({"zle": {"w": 1, "h": 1, "cols": 1, "rows": 1}}, {"c_a": {"w": 1280, "h": 800, "cols": 99, "rows": 6}}, {"c_a": {"w": "x"}}, []):
            with self.assertRaises(model.InvalidData):
                model.clean_formats(bad)
        t = model.clean_tile({"type": "toggle", "l": {"c_tab": [8, 4, 2, 2], "c_zly!": [0, 0, 1, 1], "portrait": [0, 0, 2, 1]}})
        self.assertEqual(t["l"], {"portrait": [0, 0, 2, 1], "c_tab": [8, 4, 2, 2]})
        self.assertEqual(model.clean_settings({"format": "c_tab"})["format"], "c_tab")
        self.assertEqual(model.clean_settings({"format": "../x"})["format"], "auto")

    def test_doorbell_action_mode(self):
        d = model.clean_doorbell({"actions": [{"entity": "switch.a", "mode": "tap"}, {"entity": "switch.b", "mode": "zle"}]})
        self.assertEqual([a["mode"] for a in d["actions"]], ["tap", "hold"])

    def test_nav_gestures_alerts(self):
        d = model.clean_dashboard({
            "pages": [{"tiles": []}], "nav": False,
            "gestures": {"up": {"kind": "page", "page": "Energia"}, "down": {"kind": "service", "service": "script.turn_on", "data": "zle"}, "left": {"kind": "hack"}},
            "saver": {"alerts": ["binary_sensor.drzwi", "zle"]},
        })
        self.assertEqual(d["nav"], "none")
        self.assertEqual(d["gestures"]["up"], {"kind": "page", "page": "Energia"})
        self.assertEqual(d["gestures"]["down"], {"kind": "service", "service": "script.turn_on", "data": {}})
        self.assertEqual(d["gestures"]["left"], {"kind": "default"})
        self.assertEqual(d["gestures"]["right"], {"kind": "default"})
        self.assertEqual(d["saver"]["alerts"], ["binary_sensor.drzwi"])
        s = model.clean_dashboard({"pages": [{"tiles": []}], "saver": {"icons": {"weather.dom": "sun", "zle": "x"}, "size": "XXXL"}})["saver"]
        self.assertEqual((s["icons"], s["size"]), ({"weather.dom": "sun"}, "M"))
        base = {"pages": [{"tiles": []}]}
        self.assertEqual(model.clean_dashboard(base)["nav"], "dots")
        self.assertEqual(model.clean_dashboard({**base, "nav": True})["nav"], "dots")
        self.assertEqual(model.clean_dashboard({**base, "nav": "tabs"})["nav"], "tabs")

    def test_dashboard_format(self):
        base = {"pages": [{"tiles": []}]}
        self.assertEqual(model.clean_dashboard(base)["format"], "")
        self.assertEqual(model.clean_dashboard({**base, "format": "landscape"})["format"], "landscape")
        self.assertEqual(model.clean_dashboard({**base, "format": "c_tab"})["format"], "c_tab")
        self.assertEqual(model.clean_dashboard({**base, "format": "<x>"})["format"], "")

    def test_page_title_and_saver_weather(self):
        d = model.clean_dashboard({"pages": [{"tiles": [], "title": "Kuchnia", "titleAlign": "zle"}, {"tiles": [], "title": "  "}],
                                   "saver": {"weather": "weather.dom", "days": 9}})
        self.assertEqual((d["pages"][0]["title"], d["pages"][0]["titleAlign"]), ("Kuchnia", "left"))
        self.assertNotIn("title", d["pages"][1])
        self.assertEqual((d["saver"]["weather"], d["saver"]["days"]), ("weather.dom", 7))
        self.assertEqual(model.clean_dashboard({"pages": [{"tiles": []}], "saver": {"weather": "sensor.x"}})["saver"]["weather"], "")

    def test_home_page(self):
        pages = [{"name": "Dom", "tiles": []}, {"name": "Muzyka", "tiles": []}]
        self.assertEqual(model.clean_dashboard({"pages": pages, "home": "Muzyka"})["home"], "Muzyka")
        self.assertEqual(model.clean_dashboard({"pages": pages, "home": "Brak"})["home"], "")
        g = model.clean_dashboard({"pages": pages, "gestures": {"up": {"kind": "home"}}})["gestures"]["up"]
        self.assertEqual(g, {"kind": "home"})

    def test_doorbell_after(self):
        self.assertEqual(model.clean_doorbell({})["after"], 10)
        self.assertEqual(model.clean_doorbell({"after": 500})["after"], 120)
        self.assertEqual(model.clean_doorbell({"after": "x"})["after"], 10)


class Pairing(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.p = model.Pairing(clock=lambda: self.now)

    def start(self, device="app_1", remote="192.0.2.5"):
        return self.p.start(device, "Panel", "NSPanel", "http://localhost:18123/", remote)

    def test_flow(self):
        s = self.start()
        self.assertEqual(len(s["code"]), 6)
        self.assertEqual(self.p.collect(s["secret"]), (True, None))
        self.p.find(s["code"])["token"] = "T"
        self.assertEqual(self.p.pending(), [])
        self.assertIsNone(self.p.find(s["code"]))
        self.assertEqual(self.p.collect(s["secret"]), (True, "T"))
        self.assertEqual(self.p.collect(s["secret"]), (False, None))

    def test_expiry_and_limit(self):
        s = self.start()
        self.now = 601
        self.assertIsNone(self.p.find(s["code"]))
        self.assertEqual(self.p.collect(s["secret"]), (False, None))
        for i in range(5):
            self.assertIsNotNone(self.start(f"app_{i}"))
        self.assertIsNone(self.start("app_9"))

    def test_other_address_does_not_replace(self):
        s = self.start()
        self.start(remote="192.0.2.99")
        self.assertIsNotNone(self.p.find(s["code"]))

    def test_secret_not_listed(self):
        self.start()
        self.assertNotIn("secret", self.p.pending()[0])

    def test_bad_client(self):
        for bad in ("javascript:x", "http://a/b", "http://u@a/"):
            with self.assertRaises(model.InvalidData):
                self.p.start("app_1", "P", "M", bad, "192.0.2.5")


if __name__ == "__main__":
    unittest.main()
