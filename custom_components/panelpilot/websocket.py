"""Polecenia WebSocket: dla paneli (użytkownik panelu) i dla edytora (administrator)."""

from __future__ import annotations

import logging
from typing import Any

from aiohttp import ClientTimeout
import voluptuous as vol

from homeassistant.auth.const import GROUP_ID_USER
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_ADMIN
from .hub import Hub
from .model import InvalidData

_LOGGER = logging.getLogger(__name__)


@callback
def async_register(hass: HomeAssistant) -> None:
    for command in (
        ws_register, ws_subscribe, ws_ping, ws_state, ws_webrtc, ws_go2rtc_detect,
        ws_admin_subscribe, ws_dashboard_save, ws_dashboard_delete, ws_doorbell_save, ws_formats_save,
        ws_panel_save, ws_panel_delete, ws_panel_command, ws_pair_approve, ws_pair_reject,
    ):
        websocket_api.async_register_command(hass, command)


def _hub(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> Hub | None:
    hub = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja PanelPilot nie jest uruchomiona")
    return hub


def _panel_hub(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> Hub | None:
    hub = _hub(hass, connection, msg)
    if hub is None:
        return None
    if not hub.allowed(msg["device_id"], connection.user.id, connection.user.is_admin):
        connection.send_error(msg["id"], "unauthorized", "Ten panel należy do innego użytkownika albo nie jest zarejestrowany")
        return None
    return hub


# ---- panel ----


@websocket_api.websocket_command(
    {
        vol.Required("type"): "panelpilot/register",
        vol.Required("device_id"): str,
        vol.Required("name"): str,
        vol.Required("model"): str,
        vol.Required("app"): str,
        vol.Required("shape"): str,
        vol.Required("rotation"): int,
        vol.Required("size"): str,
    }
)
@callback
def ws_register(hass, connection, msg) -> None:
    if (hub := _hub(hass, connection, msg)) is None:
        return
    try:
        hub.register(msg, connection.user.id, connection.user.is_admin)
    except PermissionError:
        connection.send_error(msg["id"], "unauthorized", "Panel należy do innego użytkownika")
        return
    except InvalidData as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/subscribe", vol.Required("device_id"): str})
@callback
def ws_subscribe(hass, connection, msg) -> None:
    if (hub := _panel_hub(hass, connection, msg)) is None:
        return
    connection.subscriptions[msg["id"]] = hub.add_subscriber(msg["device_id"], connection, msg["id"])
    connection.send_result(msg["id"])
    connection.send_event(msg["id"], hub.config_event(msg["device_id"]))


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/ping", vol.Required("device_id"): str})
@callback
def ws_ping(hass, connection, msg) -> None:
    """Panel pyta co minutę, czy integracja go widzi; po przeładowaniu integracji subskrybuje od nowa."""
    hub = hass.data.get(DOMAIN)
    connection.send_result(msg["id"], {"subscribed": bool(hub and hub.is_subscribed(msg["device_id"], connection))})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "panelpilot/state",
        vol.Required("device_id"): str,
        vol.Required("screen_on"): bool,
        vol.Required("brightness"): vol.All(int, vol.Range(0, 255)),
        vol.Required("page"): vol.All(str, vol.Length(max=60)),
        vol.Required("pages"): vol.All([vol.All(str, vol.Length(max=60))], vol.Length(max=200)),
        vol.Required("lux"): vol.Any(None, vol.Coerce(float)),
        vol.Required("proximity"): vol.Any(None, bool),
        vol.Required("format"): str,
    }
)
@callback
def ws_state(hass, connection, msg) -> None:
    if (hub := _panel_hub(hass, connection, msg)) is None:
        return
    hub.update_state(msg["device_id"], {k: msg[k] for k in ("screen_on", "brightness", "page", "pages", "lux", "proximity", "format")})
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): "panelpilot/webrtc", vol.Required("device_id"): str, vol.Required("sdp"): vol.All(str, vol.Length(max=100_000))}
)
@websocket_api.async_response
async def ws_webrtc(hass, connection, msg) -> None:
    """Przekazuje ofertę WebRTC do go2rtc wskazanego przez administratora (adres nigdy nie pochodzi od panelu)."""
    if (hub := _panel_hub(hass, connection, msg)) is None:
        return
    bell = hub.doorbell
    # Pusty adres = go2rtc znalezione w Home Assistant (integracja go2rtc, WebRTC Camera albo dodatek).
    url = bell["go2rtc"] or ((await go2rtc_detect(hass)).get("url") if bell["stream"] else "")
    if not url or not bell["stream"]:
        connection.send_error(msg["id"], "not_configured", "go2rtc nie jest skonfigurowane")
        return
    try:
        resp = await async_get_clientsession(hass).post(
            f"{url}/api/webrtc", params={"src": bell["stream"]}, json={"type": "offer", "sdp": msg["sdp"]}, timeout=ClientTimeout(total=12)
        )
        async with resp:
            if resp.status not in (200, 201):
                raise ValueError(f"go2rtc HTTP {resp.status}")
            answer = await resp.json(content_type=None)
        sdp = answer["sdp"]
    except Exception as err:  # noqa: BLE001 - każda awaria go2rtc kończy się obrazem zastępczym na panelu
        _LOGGER.warning("go2rtc: %s", err)
        connection.send_error(msg["id"], "go2rtc", "go2rtc nie odpowiada poprawnie")
        return
    connection.send_result(msg["id"], {"sdp": sdp})


# ---- go2rtc w Home Assistant ----

# Typowe adresy: wbudowane go2rtc w HA, dodatek go2rtc (AlexxIT) i go2rtc obok HA.
_GO2RTC_GUESSES = ("http://localhost:11984", "http://127.0.0.1:1984", "http://a889bffc-go2rtc:1984", "http://localhost:1984")
_GO2RTC_CACHE = f"{DOMAIN}_go2rtc"


def _go2rtc_candidates(hass: HomeAssistant) -> list[str]:
    """Adresy z konfiguracji HA (integracje go2rtc i WebRTC Camera), potem typowe."""
    found: list[str] = []
    for domain in ("go2rtc", "webrtc"):
        for entry in hass.config_entries.async_entries(domain):
            for source in (entry.options, entry.data):
                if isinstance(url := source.get("url"), str):
                    found.append(url)
    data = hass.data.get("go2rtc")
    for value in (data, getattr(data, "url", None), getattr(data, "_url", None)):
        if isinstance(value, str):
            found.append(value)
    out: list[str] = []
    for url in [*found, *_GO2RTC_GUESSES]:
        url = url.rstrip("/")
        if url.startswith(("http://", "https://")) and url not in out:
            out.append(url)
    return out


async def go2rtc_detect(hass: HomeAssistant, refresh: bool = False) -> dict[str, Any]:
    """Pierwszy odpowiadający go2rtc i jego strumienie; wynik zapamiętany do restartu HA."""
    if not refresh and (cached := hass.data.get(_GO2RTC_CACHE)) is not None:
        return cached
    session = async_get_clientsession(hass)
    result: dict[str, Any] = {"url": "", "streams": []}
    for url in _go2rtc_candidates(hass):
        try:
            async with session.get(f"{url}/api/streams", timeout=ClientTimeout(total=3)) as resp:
                if resp.status != 200:
                    continue
                streams = await resp.json(content_type=None)
        except Exception:  # noqa: BLE001 - adres nie odpowiada, próbujemy następny
            continue
        if isinstance(streams, dict):
            result = {"url": url, "streams": sorted(str(k) for k in streams)}
            break
    # Zapamiętujemy tylko znalezione go2rtc: przy braku następna próba sprawdzi adresy od nowa.
    if result["url"]:
        hass.data[_GO2RTC_CACHE] = result
    return result


# ---- edytor (administrator) ----


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/go2rtc_detect"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_go2rtc_detect(hass, connection, msg) -> None:
    connection.send_result(msg["id"], await go2rtc_detect(hass, refresh=True))


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/subscribe"})
@websocket_api.require_admin
@callback
def ws_admin_subscribe(hass, connection, msg) -> None:
    if _hub(hass, connection, msg) is None:
        return

    @callback
    def push() -> None:
        if (hub := hass.data.get(DOMAIN)) is not None:
            connection.send_event(msg["id"], hub.admin_data())

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_ADMIN, push)
    connection.send_result(msg["id"])
    push()


def _admin_action(hass, connection, msg, action) -> None:
    if (hub := _hub(hass, connection, msg)) is None:
        return
    try:
        result = action(hub)
    except InvalidData as err:
        code = "conflict" if str(err) == "CONFLICT" else "invalid"
        connection.send_error(msg["id"], code, "Pulpit zmieniono w innym oknie" if code == "conflict" else str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "panelpilot/admin/dashboard_save",
        vol.Optional("dashboard_id"): vol.Any(None, str),
        vol.Optional("rev"): vol.Any(None, int),
        vol.Required("data"): dict,
    }
)
@websocket_api.require_admin
@callback
def ws_dashboard_save(hass, connection, msg) -> None:
    def action(hub: Hub) -> dict[str, Any]:
        did, rev = hub.save_dashboard(msg.get("dashboard_id"), msg["data"], msg.get("rev"))
        return {"id": did, "rev": rev}

    _admin_action(hass, connection, msg, action)


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/dashboard_delete", vol.Required("dashboard_id"): str})
@websocket_api.require_admin
@callback
def ws_dashboard_delete(hass, connection, msg) -> None:
    _admin_action(hass, connection, msg, lambda hub: hub.delete_dashboard(msg["dashboard_id"]))


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/doorbell_save", vol.Required("data"): dict})
@websocket_api.require_admin
@callback
def ws_doorbell_save(hass, connection, msg) -> None:
    _admin_action(hass, connection, msg, lambda hub: hub.save_doorbell(msg["data"]))


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/formats_save", vol.Required("data"): dict})
@websocket_api.require_admin
@callback
def ws_formats_save(hass, connection, msg) -> None:
    _admin_action(hass, connection, msg, lambda hub: hub.save_formats(msg["data"]))


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/panel_save", vol.Required("device_id"): str, vol.Required("data"): dict})
@websocket_api.require_admin
@callback
def ws_panel_save(hass, connection, msg) -> None:
    _admin_action(hass, connection, msg, lambda hub: hub.save_panel(msg["device_id"], msg["data"]))


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/panel_delete", vol.Required("device_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_panel_delete(hass, connection, msg) -> None:
    if (hub := _hub(hass, connection, msg)) is None:
        return
    from . import async_remove_device  # noqa: PLC0415 - unika cyklu importów

    await hub.async_delete_panel(msg["device_id"])
    async_remove_device(hass, msg["device_id"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "panelpilot/admin/panel_command",
        vol.Required("device_id"): str,
        vol.Required("command"): vol.In(["reload", "doorbell", "message"]),
        vol.Optional("title"): str,
        vol.Optional("message"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_panel_command(hass, connection, msg) -> None:
    def action(hub: Hub) -> None:
        if not hub.command(msg["device_id"], msg["command"], title=msg.get("title"), message=msg.get("message")):
            raise InvalidData("Panel nie jest połączony")

    _admin_action(hass, connection, msg, action)


@websocket_api.websocket_command(
    {vol.Required("type"): "panelpilot/admin/pair_approve", vol.Required("code"): str, vol.Required("name"): vol.All(str, vol.Length(min=1, max=40))}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pair_approve(hass, connection, msg) -> None:
    """Tworzy osobne, nieadministracyjne konto panelu działające tylko w sieci lokalnej."""
    if (hub := _hub(hass, connection, msg)) is None:
        return
    item = hub.pairing.find(msg["code"])
    if item is None:
        connection.send_error(msg["id"], "expired", "Kod wygasł albo jest nieprawidłowy")
        return
    pid = item["device_id"]
    item["token"] = "pending"  # drugie zatwierdzenie tego samego kodu nic nie utworzy
    try:
        old = hub.panels.get(pid)
        user = await hass.auth.async_get_user(old["user_id"]) if old and old.get("own_user") else None
        if user is None:
            user = await hass.auth.async_create_user(f"PanelPilot: {msg['name']}", group_ids=[GROUP_ID_USER], local_only=True)
        for token in list(user.refresh_tokens.values()):
            hass.auth.async_remove_refresh_token(token)
        refresh = await hass.auth.async_create_refresh_token(user, client_id=item["client_id"])
    except Exception:
        hub.pairing.reject(msg["code"])
        raise
    if old:
        old.update(user_id=user.id, own_user=True, name=msg["name"])
    else:
        info = {"device_id": pid, "name": msg["name"], "model": item["model"], "app": "", "size": "", "shape": "auto"}
        hub.register(info, user.id, False)["own_user"] = True
    hub.save()
    item["token"] = refresh.token
    hub.notify_admin()
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "panelpilot/admin/pair_reject", vol.Required("code"): str})
@websocket_api.require_admin
@callback
def ws_pair_reject(hass, connection, msg) -> None:
    def action(hub: Hub) -> None:
        hub.pairing.reject(msg["code"])
        hub.notify_admin()

    _admin_action(hass, connection, msg, action)
