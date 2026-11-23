"""Parowanie panelu kodem (bez logowania, wyłącznie z sieci lokalnej)."""

from __future__ import annotations

from http import HTTPStatus
from ipaddress import ip_address

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.util.network import is_local

from .const import DOMAIN
from .model import InvalidData


class PairView(HomeAssistantView):
    url = "/api/panelpilot/pair"
    name = "api:panelpilot:pair"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hub = request.app[KEY_HASS].data.get(DOMAIN)
        if hub is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        try:
            local = is_local(ip_address(request.remote or ""))
        except ValueError:
            local = False
        if not local:
            return web.Response(status=HTTPStatus.FORBIDDEN)
        try:
            data = await request.json()
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            return web.Response(status=HTTPStatus.BAD_REQUEST)

        if "secret" in data:
            alive, token = hub.pairing.collect(str(data["secret"]))
            if not alive:
                return web.Response(status=HTTPStatus.GONE)
            return self.json({"refresh_token": token if token != "pending" else None})

        try:
            started = hub.pairing.start(
                str(data.get("device_id", "")), str(data.get("name", "")), str(data.get("model", "")), str(data.get("client_id", "")), str(request.remote)
            )
        except InvalidData:
            return web.Response(status=HTTPStatus.BAD_REQUEST)
        if started is None:
            return web.Response(status=HTTPStatus.TOO_MANY_REQUESTS)
        hub.notify_admin()
        return self.json(started)
