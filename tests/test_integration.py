"""Testy integracji na prawdziwym Home Assistant (uruchamiane w GitHub Actions)."""

import asyncio

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers import entity_registry as er

CLIENT = "http://localhost:18123/"
REGISTER = {"type": "panelpilot/register", "device_id": "app_1", "name": "Hol", "model": "NSPanel Pro", "app": "0.1.0", "shape": "rect", "rotation": 90, "size": "500x889"}
STATE = {"type": "panelpilot/state", "device_id": "app_1", "screen_on": True, "brightness": 204, "page": "Dom", "pages": ["Dom", "Druga"], "lux": 42, "proximity": True, "format": "portrait"}


@pytest.fixture(autouse=True)
def _custom(_our_components, enable_custom_integrations):
    _EVENTS.clear()


@pytest.fixture
async def entry(hass):
    entry = MockConfigEntry(domain="panelpilot", title="PanelPilot")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def entity(hass, unique):
    registry = er.async_get(hass)
    return next(e.entity_id for e in registry.entities.values() if e.unique_id == f"app_1_{unique}")


# Zdarzenia, które przyszły, gdy test czekał na odpowiedź (np. config wysłany przed wynikiem zapisu).
_EVENTS: dict[int, list] = {}


async def ask(ws, msg):
    await ws.send_json_auto_id(msg)
    while True:
        answer = await ws.receive_json()
        if answer["type"] == "result":
            return answer
        if answer["type"] == "event":
            _EVENTS.setdefault(id(ws), []).append(answer["event"])


async def event(ws, timeout=10):
    if _EVENTS.get(id(ws)):
        return _EVENTS[id(ws)].pop(0)
    while True:
        answer = await asyncio.wait_for(ws.receive_json(), timeout)
        if answer["type"] == "event":
            return answer["event"]


async def test_panel_flow(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    assert (await ask(ws, REGISTER))["success"]
    assert (await ask(ws, {"type": "panelpilot/subscribe", "device_id": "app_1"}))["success"]
    cfg = await event(ws)
    assert cfg["type"] == "config"
    assert cfg["panel"]["shape"] == "rect"
    assert cfg["panel"]["settings"]["rotation"] == 90
    assert "go2rtc" not in cfg["doorbell"]
    assert (await ask(ws, STATE))["success"]
    await hass.async_block_till_done()
    assert hass.states.get(entity(hass, "illuminance")).state == "42.0"
    assert hass.states.get(entity(hass, "proximity")).state == "on"
    assert hass.states.get(entity(hass, "connection")).state == "on"
    assert hass.states.get(entity(hass, "screen")).attributes["brightness"] == 204
    assert hass.states.get(entity(hass, "page")).attributes["options"] == ["Dom", "Druga"]

    await hass.services.async_call("light", "turn_off", {"entity_id": entity(hass, "screen")}, blocking=True)
    assert await event(ws) == {"type": "command", "command": "screen", "on": False, "brightness": None}
    await hass.services.async_call("select", "select_option", {"entity_id": entity(hass, "page"), "option": "Druga"}, blocking=True)
    assert (await event(ws))["page"] == "Druga"
    await hass.services.async_call("panelpilot", "show_message", {"message": "x"}, blocking=True)
    assert (await event(ws))["message"] == "x"
    await hass.services.async_call("select", "select_option", {"entity_id": entity(hass, "rotation"), "option": "270"}, blocking=True)
    assert (await event(ws))["panel"]["settings"]["rotation"] == 270


async def test_reload_reconnect(hass, entry, hass_ws_client):
    """Po przeładowaniu integracji panel dostaje „reload”, a ping mówi, że trzeba subskrybować od nowa."""
    ws = await hass_ws_client(hass)
    assert (await ask(ws, REGISTER))["success"]
    assert (await ask(ws, {"type": "panelpilot/subscribe", "device_id": "app_1"}))["success"]
    cfg = await event(ws)
    assert cfg["version"]
    assert (await ask(ws, {"type": "panelpilot/ping", "device_id": "app_1"}))["result"] == {"subscribed": True}
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert await event(ws) == {"type": "command", "command": "reload"}
    assert (await ask(ws, {"type": "panelpilot/ping", "device_id": "app_1"}))["result"] == {"subscribed": False}
    assert (await ask(ws, {"type": "panelpilot/subscribe", "device_id": "app_1"}))["success"]
    assert (await ask(ws, {"type": "panelpilot/ping", "device_id": "app_1"}))["result"] == {"subscribed": True}


async def test_editor(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    assert (await ask(ws, {"type": "panelpilot/admin/subscribe"}))["success"]
    data = await event(ws)
    did, dash = next(iter(data["dashboards"].items()))
    assert [t["type"] for t in dash["pages"][0]["tiles"]] == ["clock"]
    dash["mode"] = "code"
    dash["html"] = "<b>x</b>"
    save = {"type": "panelpilot/admin/dashboard_save", "dashboard_id": did, "rev": dash["rev"], "data": dash}
    assert (await ask(ws, save))["result"]["rev"] == dash["rev"] + 1
    assert (await ask(ws, save))["error"]["code"] == "conflict"
    bad = await ask(ws, {"type": "panelpilot/admin/dashboard_save", "dashboard_id": did, "data": {"pages": []}})
    assert bad["error"]["code"] == "invalid"


async def test_custom_format(hass, entry, hass_ws_client):
    """Własny format trafia do panelu; po jego usunięciu panel wraca do wykrywania."""
    ws = await hass_ws_client(hass)
    assert (await ask(ws, REGISTER))["success"]
    assert (await ask(ws, {"type": "panelpilot/subscribe", "device_id": "app_1"}))["success"]
    await event(ws)
    tablet = {"c_tab": {"name": "Tablet", "w": 1280, "h": 800, "cols": 10, "rows": 6}}
    assert (await ask(ws, {"type": "panelpilot/admin/formats_save", "data": tablet}))["success"]
    assert (await event(ws))["formats"]["c_tab"]["rows"] == 6
    assert (await ask(ws, {"type": "panelpilot/admin/panel_save", "device_id": "app_1", "data": {"settings": {"format": "c_tab"}}}))["success"]
    assert (await event(ws))["panel"]["settings"]["format"] == "c_tab"
    assert (await ask(ws, {"type": "panelpilot/admin/formats_save", "data": {}}))["success"]
    cfg = await event(ws)
    assert cfg["formats"] == {} and cfg["panel"]["settings"]["format"] == "auto"
    bad = await ask(ws, {"type": "panelpilot/admin/formats_save", "data": {"c_x": {"w": 1, "h": 1, "cols": 1, "rows": 1}}})
    assert bad["error"]["code"] == "invalid"


# Usunięcie konta zrywa gniazdo po stronie HA; zostaje zegar heartbeat z aiohttp (nie nasz).
@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_pairing(hass, entry, hass_ws_client, hass_client_no_auth):
    http = await hass_client_no_auth()
    start = await (await http.post("/api/panelpilot/pair", json={"device_id": "app_1", "name": "Hol", "model": "NSPanel", "client_id": CLIENT})).json()
    poll = await (await http.post("/api/panelpilot/pair", json={"secret": start["secret"]})).json()
    assert poll == {"refresh_token": None}
    admin = await hass_ws_client(hass)
    assert (await ask(admin, {"type": "panelpilot/admin/pair_approve", "code": "000000" if start["code"] != "000000" else "111111", "name": "X"}))["error"]["code"] == "expired"
    assert (await ask(admin, {"type": "panelpilot/admin/pair_approve", "code": start["code"], "name": "Hol"}))["success"]
    token = (await (await http.post("/api/panelpilot/pair", json={"secret": start["secret"]})).json())["refresh_token"]
    assert token
    assert (await http.post("/api/panelpilot/pair", json={"secret": start["secret"]})).status == 410

    # Token działa w standardowym logowaniu HA, z pasującym client_id.
    wrong = await http.post("/auth/token", data={"grant_type": "refresh_token", "refresh_token": token, "client_id": "http://inny/"})
    assert wrong.status == 400
    good = await http.post("/auth/token", data={"grant_type": "refresh_token", "refresh_token": token, "client_id": CLIENT})
    assert good.status == 200
    access = (await good.json())["access_token"]

    panel = await hass_ws_client(hass, access)
    assert (await ask(panel, REGISTER))["success"]
    assert (await ask(panel, {"type": "panelpilot/subscribe", "device_id": "app_1"}))["success"]
    # Konto panelu nie ma dostępu do edytora i jest tylko lokalne.
    assert (await ask(panel, {"type": "panelpilot/admin/subscribe"}))["error"]["code"] == "unauthorized"
    user = next(u for u in await hass.auth.async_get_users() if u.name == "PanelPilot: Hol")
    assert user.local_only and not user.is_admin

    # Usunięcie panelu kasuje konto.
    assert (await ask(admin, {"type": "panelpilot/admin/panel_delete", "device_id": "app_1"}))["success"]
    assert await hass.auth.async_get_user(user.id) is None
    await panel.close()
    await admin.close()
    await hass.async_block_till_done()


async def test_panel_of_other_user(hass, entry, hass_ws_client, hass_read_only_access_token):
    admin = await hass_ws_client(hass)
    assert (await ask(admin, REGISTER))["success"]
    other = await hass_ws_client(hass, hass_read_only_access_token)
    assert (await ask(other, REGISTER))["error"]["code"] == "unauthorized"
    assert (await ask(other, STATE))["error"]["code"] == "unauthorized"


async def test_webrtc(hass, entry, hass_ws_client, aioclient_mock):
    ws = await hass_ws_client(hass)
    await ask(ws, REGISTER)
    offer = {"type": "panelpilot/webrtc", "device_id": "app_1", "sdp": "v=0"}
    assert (await ask(ws, offer))["error"]["code"] == "not_configured"
    assert (await ask(ws, {"type": "panelpilot/admin/doorbell_save", "data": {"go2rtc": "http://go2rtc.test:1984", "stream": "brama"}}))["success"]
    aioclient_mock.post("http://go2rtc.test:1984/api/webrtc?src=brama", json={"type": "answer", "sdp": "ok"})
    assert (await ask(ws, offer))["result"] == {"sdp": "ok"}


async def test_go2rtc_detect(hass, entry, hass_ws_client, aioclient_mock):
    """Bez adresu integracja używa go2rtc znalezionego w HA (tu: wbudowanego na porcie 11984)."""
    ws = await hass_ws_client(hass)
    await ask(ws, REGISTER)
    aioclient_mock.get("http://localhost:11984/api/streams", json={"brama": {}, "ogrod": {}})
    found = (await ask(ws, {"type": "panelpilot/admin/go2rtc_detect"}))["result"]
    assert found == {"url": "http://localhost:11984", "streams": ["brama", "ogrod"]}
    assert (await ask(ws, {"type": "panelpilot/admin/doorbell_save", "data": {"stream": "brama"}}))["success"]
    aioclient_mock.post("http://localhost:11984/api/webrtc?src=brama", json={"type": "answer", "sdp": "ok2"})
    assert (await ask(ws, {"type": "panelpilot/webrtc", "device_id": "app_1", "sdp": "v=0"}))["result"] == {"sdp": "ok2"}


async def test_static_and_unload(hass, entry, hass_client_no_auth):
    http = await hass_client_no_auth()
    for name in ("index.html", "editor.js", "ui.js", "samples.js", "panel.js"):
        r = await http.get(f"/panelpilot_static/{name}")
        assert r.status == 200
        assert r.headers["Cache-Control"] == "no-cache"
    # Odnośniki do własnych plików mają numer wersji, żeby przeglądarka nie brała starych kopii.
    html = await (await http.get("/panelpilot_static/index.html")).text()
    assert 'src="widgets.js?v=' in html and 'href="panel.css?v=' in html
    js = await (await http.get("/panelpilot_static/editor.js")).text()
    assert "from './ui.js?v=" in js
    from custom_components.panelpilot import FRONTEND
    from custom_components.panelpilot.http import StaticView

    view = StaticView("/panelpilot_static", FRONTEND)
    assert view._find("../manifest.json") is None and view._find("panel.js") is not None
    assert (await http.get("/panelpilot_static/brak.js")).status == 404
    assert "panelpilot" in hass.data["frontend_panels"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "panelpilot" not in hass.data["frontend_panels"]
    assert (await http.post("/api/panelpilot/pair", json={})).status == 404
    assert await hass.config_entries.async_setup(entry.entry_id)
