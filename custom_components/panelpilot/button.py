"""Przyciski: odśwież panel, pokaż domofon."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory

from .entity import PanelEntity, setup_panels


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    setup_panels(hass, entry, async_add_entities, lambda hub, pid: [Reload(hub, pid), Doorbell(hub, pid)])


class Reload(PanelEntity, ButtonEntity):
    key = "reload"
    _attr_entity_category = EntityCategory.CONFIG

    async def async_press(self) -> None:
        self.hub.command(self.pid, "reload")


class Doorbell(PanelEntity, ButtonEntity):
    key = "doorbell"

    async def async_press(self) -> None:
        self.hub.command(self.pid, "doorbell")
