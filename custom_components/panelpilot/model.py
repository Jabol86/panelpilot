"""Czysty model danych (bez Home Assistanta): wartości domyślne, walidacja, parowanie."""

from __future__ import annotations

import json
import re
import secrets
import time
from typing import Any

MAX_DASHBOARD_BYTES = 512 * 1024
MAX_CODE = 100_000
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ENTITY_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
FORMATS = {"square": (6, 5), "portrait": (6, 10), "landscape": (10, 5)}
# Własne formaty (inne tablety): identyfikator c_…, siatka do 24×24, najwyżej 12 formatów.
CUSTOM_FMT_RE = re.compile(r"^c_[a-z0-9]{1,12}$")
MAX_GRID = 24
MAX_FORMATS = 12
SHAPES = ("auto", "square", "rect")
ROTATIONS = (0, 90, 180, 270)
MODES = ("tiles", "code", "module")
GESTURES = ("up", "down", "left", "right")
NAV_STYLES = ("dots", "tabs", "none")
NIGHT_MODES = ("both", "hours", "lux")
GESTURE_KINDS = ("default", "none", "next", "prev", "page", "home", "saver", "bell", "settings", "service")

DEFAULT_SETTINGS: dict[str, Any] = {
    "rotation": 0,
    "dayBrightness": 80,
    "nightBrightness": 8,
    "darkLux": 8,
    "nightFrom": 22,
    "nightTo": 6,
    # both = noc w godzinach nocnych albo gdy ciemno; hours = tylko zegar; lux = tylko czujnik światła
    "nightMode": "both",
    "wakeOnProximity": True,
    "proximityHold": True,
    # Niektóre czujniki zgłaszają „blisko” i „daleko” odwrotnie.
    "proximityInvert": False,
    # auto = wykryj z rozmiaru ekranu; albo square/portrait/landscape, albo własny format c_…
    "format": "auto",
}
_NUMBER_LIMITS = {
    "dayBrightness": (1, 100),
    "nightBrightness": (1, 100),
    "darkLux": (0, 10000),
    "nightFrom": (0, 23),
    "nightTo": (0, 23),
}


class InvalidData(ValueError):
    """Dane z edytora lub panelu są nieprawidłowe."""


def new_id() -> str:
    return secrets.token_hex(6)


def _text(value: Any, limit: int = 120) -> str:
    return str(value if value is not None else "").strip()[:limit]


def _module(value: Any) -> str:
    text = _text(value, 300)
    if text and not re.match(r"^(/(?!/)|https?://)[^\s\"'<>]+$", text):
        raise InvalidData("Adres modułu musi zaczynać się od / albo http")
    return text


def _element(value: Any) -> str:
    text = _text(value, 60)
    if text and not re.match(r"^[a-z][a-z0-9]*(-[a-z0-9]+)+$", text):
        raise InvalidData("Nazwa elementu musi zawierać myślnik, np. tablet-dashboard")
    return text


def _rect(value: Any, fmt: str) -> list[int] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in value):
        return None
    x, y, w, h = value
    # Własny format może się później zmienić, więc tu tylko górna granica; resztę sprawdza układ na panelu.
    cols, rows = FORMATS.get(fmt, (MAX_GRID, MAX_GRID))
    if x < 0 or y < 0 or w < 1 or h < 1 or x + w > cols or y + h > rows:
        return None
    return [x, y, w, h]


def clean_tile(tile: Any) -> dict[str, Any]:
    if not isinstance(tile, dict) or not ID_RE.match(str(tile.get("type", ""))):
        raise InvalidData("Kafelek bez poprawnego typu")
    out = dict(tile)
    if not ID_RE.match(str(tile.get("id", ""))):
        out["id"] = new_id()
    layout = tile.get("l") if isinstance(tile.get("l"), dict) else {}
    clean: dict[str, Any] = {}
    custom = [k for k in layout if isinstance(k, str) and CUSTOM_FMT_RE.match(k)][:MAX_FORMATS]
    for fmt in [*FORMATS, *custom]:
        if layout.get(fmt) is False:
            clean[fmt] = False
        elif (rect := _rect(layout.get(fmt), fmt)) is not None:
            clean[fmt] = rect
    out["l"] = clean
    return out


def _gesture(value: Any) -> dict[str, Any]:
    """Co robi przesunięcie palcem: default = strony w lewo/prawo, nic w górę/dół."""
    if not isinstance(value, dict) or value.get("kind") not in GESTURE_KINDS:
        return {"kind": "default"}
    out: dict[str, Any] = {"kind": value["kind"]}
    if out["kind"] == "page":
        out["page"] = _text(value.get("page"), 30)
    if out["kind"] == "service":
        out["service"] = _text(value.get("service"), 80)
        out["data"] = value.get("data") if isinstance(value.get("data"), dict) else {}
    return out


def _int(value: Any, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _entities(value: Any, limit: int) -> list[str]:
    return [e for e in value or [] if isinstance(e, str) and ENTITY_RE.match(e)][:limit]


def clean_dashboard(data: Any) -> dict[str, Any]:
    """Sprawdza pulpit z edytora; nieznane pola kafelków zostają (własne kafelki)."""
    if not isinstance(data, dict) or not isinstance(data.get("pages"), list) or not data["pages"]:
        raise InvalidData("Pulpit musi mieć co najmniej jedną stronę")
    if len(json.dumps(data)) > MAX_DASHBOARD_BYTES:
        raise InvalidData("Pulpit jest za duży")
    pages = []
    for i, page in enumerate(data["pages"][:20]):
        if not isinstance(page, dict):
            raise InvalidData("Nieprawidłowa strona")
        tiles = page.get("tiles")
        if not isinstance(tiles, list) or len(tiles) > 200:
            raise InvalidData("Nieprawidłowa lista kafelków")
        clean_page = {"name": _text(page.get("name"), 30) or f"Strona {i + 1}", "tiles": [clean_tile(t) for t in tiles]}
        # Nagłówek nad kafelkami (wysokość pół wiersza), np. „Kuchnia”.
        if title := _text(page.get("title"), 60):
            clean_page["title"] = title
            clean_page["titleAlign"] = page.get("titleAlign") if page.get("titleAlign") in ("left", "center", "right") else "left"
        pages.append(clean_page)
    # Nazwa strony jest wartością encji select, więc musi być jednoznaczna.
    seen: set[str] = set()
    for page in pages:
        base, n = page["name"], 2
        while page["name"] in seen:
            page["name"] = f"{base} ({n})"
            n += 1
        seen.add(page["name"])
    saver = data.get("saver") if isinstance(data.get("saver"), dict) else {}
    try:
        seconds = max(0, min(86400, int(saver.get("seconds", 60))))
    except (TypeError, ValueError):
        seconds = 60
    theme = data.get("theme") if isinstance(data.get("theme"), dict) else {}
    gestures = data.get("gestures") if isinstance(data.get("gestures"), dict) else {}
    nav = data.get("nav")
    fmt = data.get("format")
    return {
        # Pasek stron: kropki (domyślnie), nazwy stron albo brak. Dawne true/false też działają.
        "nav": nav if nav in NAV_STYLES else "none" if nav is False else "dots",
        # Format, w którym pulpit jest projektowany; panel bez własnego wyboru go używa. Pusty = z ekranu panelu.
        "format": fmt if isinstance(fmt, str) and (fmt in FORMATS or CUSTOM_FMT_RE.match(fmt)) else "",
        "gestures": {g: _gesture(gestures.get(g)) for g in GESTURES},
        # Strona główna: od niej panel startuje i do niej wraca po wygaszaczu (nazwa strony, pusta = pierwsza).
        "home": home if (home := _text(data.get("home"), 30)) in {p["name"] for p in pages} else "",
        "name": _text(data.get("name"), 40) or "Pulpit",
        "mode": data.get("mode") if data.get("mode") in MODES else "tiles",
        "html": str(data.get("html") or "")[:MAX_CODE],
        "code": str(data.get("code") or "")[:MAX_CODE],
        "module": _module(data.get("module")),
        "element": _element(data.get("element")),
        "watch": [e for e in data.get("watch") or [] if isinstance(e, str) and ENTITY_RE.match(e)][:500],
        "pages": pages,
        "theme": {str(k)[:20]: v for k, v in theme.items() if isinstance(v, (str, int, float))},
        "saver": {
            "seconds": seconds,
            "style": _text(saver.get("style"), 20) or "zegar",
            "entities": _entities(saver.get("entities"), 8),
            "names": {k: _text(v, 40) for k, v in (saver.get("names") or {}).items() if isinstance(k, str)},
            "icons": {k: _text(v, 60) for k, v in (saver.get("icons") or {}).items() if isinstance(k, str) and ENTITY_RE.match(k)},
            "size": saver.get("size") if saver.get("size") in ("S", "M", "L", "XL") else "M",
            # Ikony powiadomień: pokazują się tylko, gdy encja jest „aktywna” (otwarte, włączone, problem…).
            "alerts": _entities(saver.get("alerts"), 12),
            # Własny napis i ikona powiadomienia; wygląd: plain (ikona i napis), frame (w cienkiej ramce), icon (sama ikona).
            "alertText": {k: _text(v, 40) for k, v in (saver.get("alertText") or {}).items() if isinstance(k, str) and ENTITY_RE.match(k) and _text(v, 40)},
            "alertIcons": {k: _text(v, 60) for k, v in (saver.get("alertIcons") or {}).items() if isinstance(k, str) and ENTITY_RE.match(k) and _text(v, 60)},
            "alertStyle": saver.get("alertStyle") if saver.get("alertStyle") in ("plain", "frame", "icon") else "plain",
            # Panel pogody pod zegarem: bieżące warunki i prognoza na kilka dni.
            "weather": w if isinstance(w := saver.get("weather"), str) and re.match(r"^weather\.[a-z0-9_]+$", w) else "",
            "days": _int(saver.get("days"), 0, 7, 5),
        },
        "css": str(data.get("css") or "")[:MAX_CODE],
        "js": str(data.get("js") or "")[:MAX_CODE],
    }


def clean_settings(data: Any, current: dict[str, Any] | None = None) -> dict[str, Any]:
    out = {**DEFAULT_SETTINGS, **(current or {})}
    if not isinstance(data, dict):
        return out
    for key, (low, high) in _NUMBER_LIMITS.items():
        if key in data:
            try:
                out[key] = max(low, min(high, int(data[key])))
            except (TypeError, ValueError):
                pass
    if data.get("rotation") in ROTATIONS:
        out["rotation"] = data["rotation"]
    for key in ("wakeOnProximity", "proximityHold", "proximityInvert"):
        if isinstance(data.get(key), bool):
            out[key] = data[key]
    if data.get("nightMode") in NIGHT_MODES:
        out["nightMode"] = data["nightMode"]
    fmt = data.get("format")
    if isinstance(fmt, str) and (fmt == "auto" or fmt in FORMATS or CUSTOM_FMT_RE.match(fmt)):
        out["format"] = fmt
    return out


def clean_formats(data: Any) -> dict[str, dict[str, Any]]:
    """Własne formaty ekranu: nazwa, rozmiar w pikselach CSS (do podglądu) i siatka kafelków."""
    if not isinstance(data, dict):
        raise InvalidData("Nieprawidłowa lista formatów")
    if len(data) > MAX_FORMATS:
        raise InvalidData(f"Najwyżej {MAX_FORMATS} własnych formatów")
    out: dict[str, dict[str, Any]] = {}
    for fid, f in data.items():
        if not isinstance(fid, str) or not CUSTOM_FMT_RE.match(fid) or not isinstance(f, dict):
            raise InvalidData("Nieprawidłowy format")

        def num(key: str, low: int, high: int) -> int:
            try:
                value = int(f.get(key))
            except (TypeError, ValueError) as err:
                raise InvalidData(f"Format „{_text(f.get('name'), 30)}”: brak wartości {key}") from err
            if not low <= value <= high:
                raise InvalidData(f"Format „{_text(f.get('name'), 30)}”: {key} musi być od {low} do {high}")
            return value

        out[fid] = {
            "name": _text(f.get("name"), 30) or "Mój ekran",
            "w": num("w", 200, 4000), "h": num("h", 200, 4000),
            "cols": num("cols", 1, MAX_GRID), "rows": num("rows", 1, MAX_GRID),
        }
    return out


def clean_doorbell(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        data = {}
    go2rtc = _text(data.get("go2rtc"), 200).rstrip("/")
    if go2rtc and not re.match(r"^https?://[^\s/?#@]+(/[^\s?#]*)?$", go2rtc):
        raise InvalidData("Adres go2rtc musi wyglądać jak http://192.168.1.10:1984")
    entity = _text(data.get("entity"))
    camera = _text(data.get("camera"))
    actions = []
    for a in (data.get("actions") or [])[:4]:
        if isinstance(a, dict) and ENTITY_RE.match(str(a.get("entity", ""))):
            actions.append({
                "name": _text(a.get("name"), 30) or a["entity"], "entity": a["entity"], "icon": _text(a.get("icon"), 60),
                # hold = przytrzymaj (bezpieczniej), tap = jedno dotknięcie
                "mode": "tap" if a.get("mode") == "tap" else "hold",
            })
    try:
        seconds = max(10, min(600, int(data.get("seconds", 60))))
    except (TypeError, ValueError):
        seconds = 60
    try:
        after = max(0, min(120, int(data.get("after", 10))))
    except (TypeError, ValueError):
        after = 10
    return {
        "name": _text(data.get("name"), 40) or "Domofon",
        # Ile sekund okno zostaje po otwarciu furtki lub bramy (z potwierdzeniem na ekranie).
        "after": after,
        "entity": entity if ENTITY_RE.match(entity) else "",
        "camera": camera if ENTITY_RE.match(camera) else "",
        "go2rtc": go2rtc,
        "stream": _text(data.get("stream"), 80),
        "talk": bool(data.get("talk")),
        "chime": data.get("chime") is not False,
        "seconds": seconds,
        "actions": actions,
    }


def public_doorbell(d: dict[str, Any]) -> dict[str, Any]:
    """To, co dostaje panel: bez adresu go2rtc."""
    out = {k: v for k, v in d.items() if k not in ("go2rtc", "stream")}
    out["own"] = bool(d.get("go2rtc") and d.get("stream"))
    return out


def starter_dashboard() -> dict[str, Any]:
    """Pusty pulpit: co się pojawi, wybiera użytkownik w edytorze."""
    return clean_dashboard({"name": "Pulpit", "pages": [{"name": "Dom", "tiles": [{"type": "clock"}]}]})


class Pairing:
    """Kody parowania w pamięci. Token wydawany jest raz i tylko po zatwierdzeniu przez administratora."""

    TTL = 600
    MAX_PENDING = 5

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._items: dict[str, dict[str, Any]] = {}

    def _purge(self) -> None:
        now = self._clock()
        self._items = {k: v for k, v in self._items.items() if now - v["at"] < self.TTL}

    def start(self, device_id: str, name: str, model: str, client_id: str, remote: str) -> dict[str, str] | None:
        self._purge()
        if not ID_RE.match(device_id):
            raise InvalidData("device_id")
        if not re.match(r"^https?://[^\s/?#@]+/$", client_id) or len(client_id) > 200:
            raise InvalidData("client_id")
        # Ponowna próba tego samego urządzenia z tego samego adresu zastępuje poprzednią.
        for key in [k for k, v in self._items.items() if v["device_id"] == device_id and v["remote"] == remote]:
            del self._items[key]
        if len(self._items) >= self.MAX_PENDING:
            return None
        codes = {v["code"] for v in self._items.values()}
        while (code := f"{secrets.randbelow(1_000_000):06d}") in codes:
            pass
        secret = secrets.token_urlsafe(32)
        self._items[secret] = {
            "code": code, "device_id": device_id, "name": _text(name, 40) or "Panel", "model": _text(model, 60),
            "client_id": client_id, "remote": remote, "at": self._clock(), "token": None,
        }
        return {"code": code, "secret": secret}

    def pending(self) -> list[dict[str, str]]:
        self._purge()
        return [{k: v[k] for k in ("code", "name", "model", "remote", "device_id")} for v in self._items.values() if not v["token"]]

    def find(self, code: str) -> dict[str, Any] | None:
        self._purge()
        return next((v for v in self._items.values() if secrets.compare_digest(v["code"], str(code)) and not v["token"]), None)

    def reject(self, code: str) -> None:
        self._items = {k: v for k, v in self._items.items() if v["code"] != code}

    def collect(self, secret: str) -> tuple[bool, str | None]:
        """(czy kod jeszcze żyje, token gdy zatwierdzono)."""
        self._purge()
        item = self._items.get(secret)
        if item is None:
            return False, None
        if item["token"]:
            del self._items[secret]
            return True, item["token"]
        return True, None
