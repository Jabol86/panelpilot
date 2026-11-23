"""Wybór strony, pulpitu i obrotu."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.const import EntityCategory

from .entity import PanelEntity, setup_panels
from .model import ROTATIONS


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    setup_panels(hass, entry, async_add_entities, lambda hub, pid: [Page(hub, pid), Dashboard(hub, pid), Rotation(hub, pid)])


class Page(PanelEntity, SelectEntity):
    key = "page"

    @property
    def options(self) -> list[str]:
        return list(dict.fromkeys(self.state_data.get("pages") or []))

    @property
    def current_option(self) -> str | None:
        page = self.state_data.get("page")
        return page if page in self.options else None

    async def async_select_option(self, option: str) -> None:
        self.hub.command(self.pid, "page", page=option)


class Dashboard(PanelEntity, SelectEntity):
    key = "dashboard"
    needs_connection = False

    @property
    def options(self) -> list[str]:
        return list(self.hub.dashboard_names().values())

    @property
    def current_option(self) -> str | None:
        return self.hub.dashboard_names().get(self.panel.get("dashboard", ""))

    async def async_select_option(self, option: str) -> None:
        for did, name in self.hub.dashboard_names().items():
            if name == option:
                self.hub.save_panel(self.pid, {"dashboard": did})
                return


class Rotation(PanelEntity, SelectEntity):
    key = "rotation"
    needs_connection = False
    _attr_entity_category = EntityCategory.CONFIG
    _attr_options = [str(r) for r in ROTATIONS]

    @property
    def current_option(self) -> str | None:
        rotation = (self.panel.get("settings") or {}).get("rotation")
        return None if rotation is None else str(rotation)

    async def async_select_option(self, option: str) -> None:
        self.hub.save_panel(self.pid, {"settings": {"rotation": int(option)}})
