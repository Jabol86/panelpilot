"""Ekran panelu jako światło (włącz, wyłącz, jasność)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.light import ATTR_BRIGHTNESS, ColorMode, LightEntity

from .entity import PanelEntity, setup_panels


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    setup_panels(hass, entry, async_add_entities, lambda hub, pid: [Screen(hub, pid)])


class Screen(PanelEntity, LightEntity):
    key = "screen"
    _attr_color_mode = ColorMode.BRIGHTNESS
    _attr_supported_color_modes = {ColorMode.BRIGHTNESS}

    @property
    def is_on(self) -> bool | None:
        return self.state_data.get("screen_on")

    @property
    def brightness(self) -> int | None:
        return self.state_data.get("brightness")

    async def async_turn_on(self, **kwargs: Any) -> None:
        self.hub.command(self.pid, "screen", on=True, brightness=kwargs.get(ATTR_BRIGHTNESS))

    async def async_turn_off(self, **kwargs: Any) -> None:
        self.hub.command(self.pid, "screen", on=False, brightness=None)
