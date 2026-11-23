"""Integracja PanelPilot."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .const import DOMAIN, EDITOR_PATH, PLATFORMS, STATIC_URL, VERSION
from .http import PairView
from .hub import Hub

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
FRONTEND = Path(__file__).parent / "frontend"

_TARGET = {vol.Optional("device_id"): vol.All(cv.ensure_list, [cv.string])}


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    websocket.async_register(hass)
    hass.http.register_view(PairView())
    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(FRONTEND), False)])

    def targets(call: ServiceCall) -> tuple[Hub, list[str]]:
        hub = hass.data.get(DOMAIN)
        if hub is None:
            raise ServiceValidationError("Integracja PanelPilot nie jest uruchomiona")
        if "device_id" not in call.data:
            return hub, list(hub.panels)
        registry, out = dr.async_get(hass), []
        for did in call.data["device_id"]:
            device = registry.async_get(did)
            out += [i[1] for i in device.identifiers if i[0] == DOMAIN and i[1] in hub.panels] if device else []
        return hub, out

    @callback
    def show_message(call: ServiceCall) -> None:
        hub, panels = targets(call)
        for pid in panels:
            hub.command(pid, "message", title=call.data.get("title"), message=call.data["message"], seconds=call.data["seconds"])

    @callback
    def open_doorbell(call: ServiceCall) -> None:
        hub, panels = targets(call)
        for pid in panels:
            hub.command(pid, "doorbell")

    hass.services.async_register(
        DOMAIN,
        "show_message",
        show_message,
        vol.Schema({**_TARGET, vol.Required("message"): cv.string, vol.Optional("title"): cv.string, vol.Optional("seconds", default=0): vol.All(vol.Coerce(int), vol.Range(0, 3600))}),
    )
    hass.services.async_register(DOMAIN, "open_doorbell", open_doorbell, vol.Schema(_TARGET))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hub = Hub(hass)
    await hub.async_load()
    hass.data[DOMAIN] = hub
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    if EDITOR_PATH not in hass.data.get(frontend.DATA_PANELS, {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=EDITOR_PATH,
            webcomponent_name="panelpilot-editor",
            module_url=f"{STATIC_URL}/editor.js?v={VERSION}",
            sidebar_title="PanelPilot",
            sidebar_icon="mdi:tablet-dashboard",
            require_admin=True,
            config={"static": STATIC_URL, "version": VERSION},
        )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    frontend.async_remove_panel(hass, EDITOR_PATH)
    hub: Hub = hass.data.pop(DOMAIN)
    await hub.async_flush()
    return True


async def async_remove_config_entry_device(hass: HomeAssistant, entry: ConfigEntry, device: dr.DeviceEntry) -> bool:
    """Usunięcie urządzenia w HA usuwa też panel i jego konto."""
    hub: Hub = hass.data[DOMAIN]
    for domain, pid in device.identifiers:
        if domain == DOMAIN:
            await hub.async_delete_panel(pid)
    return True


@callback
def async_remove_device(hass: HomeAssistant, pid: str) -> None:
    registry = dr.async_get(hass)
    if device := registry.async_get_device(identifiers={(DOMAIN, pid)}):
        registry.async_remove_device(device.id)
