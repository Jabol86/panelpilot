"""Dodanie integracji: jedno kliknięcie, bez pól do wypełniania. Opcje: edytor w menu bocznym albo nie."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from .const import CONF_SIDEBAR, DOMAIN, EDITOR_PATH


class PanelPilotConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Panel Pilot", data={}, options={CONF_SIDEBAR: False})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> OptionsFlow:
        return PanelPilotOptions()


class PanelPilotOptions(OptionsFlow):
    """„Konfiguruj” przy integracji: link do edytora i wybór, czy ma być w menu bocznym."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        current = self.config_entry.options.get(CONF_SIDEBAR, False)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({vol.Required(CONF_SIDEBAR, default=current): bool}),
            description_placeholders={"editor": f"/{EDITOR_PATH}"},
        )
