"""Parowanie panelu kodem (bez logowania, wyłącznie z sieci lokalnej)."""

from __future__ import annotations

from http import HTTPStatus
from ipaddress import ip_address
from pathlib import Path
import re

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.util.network import is_local

from .const import DOMAIN, VERSION
from .model import InvalidData


class StaticView(HomeAssistantView):
    """Pliki edytora i panelu z nagłówkiem no-cache.

    Przeglądarka zawsze pyta, czy plik się zmienił (zwykle dostaje krótkie 304),
    więc po aktualizacji integracji nie zostaje stary widgets.js czy panel.js w podglądzie edytora.
    """

    requires_auth = False
    name = "panelpilot:static"

    def __init__(self, url: str, root: Path) -> None:
        self.url = url + "/{path:.+}"
        self._root = root.resolve()

    async def get(self, request: web.Request, path: str) -> web.StreamResponse:
        hass = request.app[KEY_HASS]
        file = await hass.async_add_executor_job(self._find, path)
        if file is None:
            raise web.HTTPNotFound()
        headers = {"Cache-Control": "no-cache"}
        if file.name in _STAMPED:
            # Odnośniki do naszych plików dostają ?v=wersja: stare kopie z pamięci przeglądarki nie zostaną użyte.
            text = await hass.async_add_executor_job(file.read_text, "utf-8")
            text = _STAMPED[file.name].sub(lambda m: f"{m.group(1)}?v={VERSION}{m.group(2)}", text)
            kind = "text/html" if file.suffix == ".html" else "text/javascript"
            return web.Response(text=text, content_type=kind, charset="utf-8", headers=headers)
        return web.FileResponse(file, headers=headers)

    def _find(self, path: str) -> Path | None:
        file = (self._root / path).resolve()
        return file if self._root in file.parents and file.is_file() else None


_STAMPED = {
    "index.html": re.compile(r'((?:src|href)="[\w-]+\.(?:js|css))(")'),
    "editor.js": re.compile(r"(from '\./[\w-]+\.js)(')"),
}


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
