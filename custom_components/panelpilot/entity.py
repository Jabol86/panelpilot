"""Wspólna podstawa encji panelu."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, SIGNAL_NEW_PANEL, SIGNAL_PANEL
from .hub import Hub


@callback
def setup_panels(hass: HomeAssistant, entry, add: Callable, make: Callable[[Hub, str], list[Entity]]) -> None:
    """Dodaje encje dla istniejących i nowo podłączonych paneli."""
    hub: Hub = hass.data[DOMAIN]

    @callback
    def new_panel(pid: str) -> None:
        add(make(hub, pid))

    for pid in list(hub.panels):
        new_panel(pid)
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_NEW_PANEL, new_panel))


class PanelEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    key = ""
    needs_connection = True

    def __init__(self, hub: Hub, pid: str) -> None:
        self.hub = hub
        self.pid = pid
        self._attr_unique_id = f"{pid}_{self.key}"
        self._attr_translation_key = self.key

    @property
    def panel(self) -> dict[str, Any]:
        return self.hub.panels.get(self.pid, {})

    @property
    def state_data(self) -> dict[str, Any]:
        rt = self.hub.runtime.get(self.pid)
        return rt.state if rt else {}

    @property
    def available(self) -> bool:
        rt = self.hub.runtime.get(self.pid)
        return rt is not None and (rt.connected or not self.needs_connection)

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self.pid)}, name=self.panel.get("name", "Panel"), manufacturer="PanelPilot",
            model=self.panel.get("model") or None, sw_version=self.panel.get("app") or None,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_PANEL.format(self.pid), self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()
