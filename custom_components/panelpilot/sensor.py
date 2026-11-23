"""Czujnik światła w panelu."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import LIGHT_LUX

from .entity import PanelEntity, setup_panels


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    setup_panels(hass, entry, async_add_entities, lambda hub, pid: [Illuminance(hub, pid)])


class Illuminance(PanelEntity, SensorEntity):
    key = "illuminance"
    _attr_device_class = SensorDeviceClass.ILLUMINANCE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = LIGHT_LUX
    _attr_suggested_display_precision = 0

    @property
    def native_value(self) -> float | None:
        return self.state_data.get("lux")
