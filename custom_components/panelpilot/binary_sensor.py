"""Zbliżenie do panelu i połączenie."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory

from .entity import PanelEntity, setup_panels


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    setup_panels(hass, entry, async_add_entities, lambda hub, pid: [Proximity(hub, pid), Connected(hub, pid)])


class Proximity(PanelEntity, BinarySensorEntity):
    key = "proximity"
    _attr_device_class = BinarySensorDeviceClass.OCCUPANCY

    @property
    def is_on(self) -> bool | None:
        return self.state_data.get("proximity")

    @property
    def extra_state_attributes(self) -> dict[str, float] | None:
        """Surowy odczyt czujnika (aplikacja 0.1.4+): pomaga sprawdzić, czy czujnik w ogóle reaguje."""
        raw = self.state_data.get("proximity_raw")
        return {"raw": raw} if raw is not None else None


class Connected(PanelEntity, BinarySensorEntity):
    key = "connection"
    needs_connection = False
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    @property
    def is_on(self) -> bool:
        rt = self.hub.runtime.get(self.pid)
        return rt is not None and rt.connected
