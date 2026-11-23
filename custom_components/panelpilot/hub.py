"""Stan integracji: zapisane pulpity i panele oraz kanał do podłączonych paneli."""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
from typing import Any

from homeassistant.components import persistent_notification
from homeassistant.components.websocket_api import ActiveConnection
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import DOMAIN, EDITOR_PATH, MAX_PANELS, SIGNAL_ADMIN, SIGNAL_NEW_PANEL, SIGNAL_PANEL

PAIRING_NOTICE = "panelpilot_pairing"
from .model import (
    DEFAULT_SETTINGS,
    ID_RE,
    ROTATIONS,
    SHAPES,
    InvalidData,
    Pairing,
    clean_dashboard,
    clean_doorbell,
    clean_settings,
    new_id,
    public_doorbell,
    starter_dashboard,
)

_LOGGER = logging.getLogger(__name__)


@dataclass
class Runtime:
    """To, co panel ostatnio o sobie zgłosił."""

    subscribers: dict[tuple[int, int], tuple[ActiveConnection, int]] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)

    @property
    def connected(self) -> bool:
        return bool(self.subscribers)


class Hub:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, 1, DOMAIN, private=True, atomic_writes=True)
        self.dashboards: dict[str, dict[str, Any]] = {}
        self.panels: dict[str, dict[str, Any]] = {}
        self.doorbell: dict[str, Any] = clean_doorbell({})
        self.runtime: dict[str, Runtime] = {}
        self.pairing = Pairing()

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.dashboards = data.get("dashboards", {})
        self.panels = data.get("panels", {})
        self.doorbell = data.get("doorbell") or clean_doorbell({})
        self.runtime = {pid: Runtime() for pid in self.panels}

    def ensure_dashboard(self) -> None:
        """Na start pusty pulpit; zawartość wybiera użytkownik w edytorze."""
        if self.dashboards:
            return
        self.dashboards[new_id()] = {**starter_dashboard(), "rev": 1}
        self.save()

    @callback
    def save(self) -> None:
        self._store.async_delay_save(self._data, 1)

    @callback
    def _data(self) -> dict[str, Any]:
        return {"dashboards": self.dashboards, "panels": self.panels, "doorbell": self.doorbell}

    async def async_flush(self) -> None:
        await self._store.async_save(self._data())

    # ---- pulpity ----

    def default_dashboard(self) -> str:
        self.ensure_dashboard()
        return next(iter(self.dashboards))

    def save_dashboard(self, dash_id: str | None, data: Any, rev: int | None) -> tuple[str, int]:
        clean = clean_dashboard(data)
        if dash_id is None:
            dash_id, rev_now = new_id(), 0
        else:
            if dash_id not in self.dashboards:
                raise InvalidData("Nie ma takiego pulpitu")
            rev_now = self.dashboards[dash_id].get("rev", 0)
            if rev is not None and rev != rev_now:
                raise InvalidData("CONFLICT")
        self.dashboards[dash_id] = {**clean, "rev": rev_now + 1}
        self.save()
        for pid, panel in self.panels.items():
            if panel["dashboard"] == dash_id:
                self.push_config(pid)
                self.notify(pid)
        self.notify_admin()
        return dash_id, rev_now + 1

    def delete_dashboard(self, dash_id: str) -> None:
        if len(self.dashboards) <= 1:
            raise InvalidData("Musi zostać co najmniej jeden pulpit")
        if self.dashboards.pop(dash_id, None) is None:
            raise InvalidData("Nie ma takiego pulpitu")
        fallback = next(iter(self.dashboards))
        for pid, panel in self.panels.items():
            if panel["dashboard"] == dash_id:
                panel["dashboard"] = fallback
                self.push_config(pid)
                self.notify(pid)
        self.save()
        self.notify_admin()

    def dashboard_names(self) -> dict[str, str]:
        """id -> jednoznaczna nazwa (na potrzeby encji select)."""
        out: dict[str, str] = {}
        for did, d in self.dashboards.items():
            name, n = d["name"], 2
            while name in out.values():
                name = f"{d['name']} ({n})"
                n += 1
            out[did] = name
        return out

    def save_doorbell(self, data: Any) -> None:
        self.doorbell = clean_doorbell(data)
        self.save()
        for pid in self.panels:
            self.push_config(pid)
        self.notify_admin()

    # ---- panele ----

    def register(self, info: dict[str, Any], user_id: str, is_admin: bool) -> dict[str, Any]:
        pid = info["device_id"]
        if not ID_RE.match(pid):
            raise InvalidData("Nieprawidłowy identyfikator panelu")
        panel = self.panels.get(pid)
        new = panel is None
        if panel is None:
            if len(self.panels) >= MAX_PANELS:
                raise InvalidData("Zbyt wiele paneli")
            settings = dict(DEFAULT_SETTINGS)
            if info.get("rotation") in ROTATIONS:
                settings["rotation"] = info["rotation"]
            panel = {"name": info["name"][:40] or "Panel", "dashboard": self.default_dashboard(), "settings": settings, "user_id": user_id, "own_user": False}
            self.panels[pid] = panel
            self.runtime[pid] = Runtime()
        elif panel["user_id"] != user_id and not is_admin:
            raise PermissionError
        if panel["dashboard"] not in self.dashboards:
            panel["dashboard"] = self.default_dashboard()
        panel["model"] = info["model"][:60]
        panel["app"] = info["app"][:30]
        panel["size"] = info["size"][:20]
        if info["shape"] in SHAPES and (new or info["shape"] != "auto"):
            panel["shape"] = info["shape"]
        panel.setdefault("shape", "auto")
        self.save()
        if new:
            async_dispatcher_send(self.hass, SIGNAL_NEW_PANEL, pid)
        self.notify(pid)
        self.notify_admin()
        return panel

    def allowed(self, pid: str, user_id: str, is_admin: bool) -> bool:
        panel = self.panels.get(pid)
        return panel is not None and (is_admin or panel["user_id"] == user_id)

    def save_panel(self, pid: str, data: dict[str, Any]) -> None:
        panel = self.panels.get(pid)
        if panel is None:
            raise InvalidData("Nie ma takiego panelu")
        if str(data.get("name", "")).strip():
            panel["name"] = str(data["name"]).strip()[:40]
        if data.get("dashboard") in self.dashboards:
            panel["dashboard"] = data["dashboard"]
        if data.get("shape") in SHAPES:
            panel["shape"] = data["shape"]
        if "settings" in data:
            panel["settings"] = clean_settings(data["settings"], panel["settings"])
        self.save()
        self.push_config(pid)
        self.notify(pid)
        self.notify_admin()

    async def async_delete_panel(self, pid: str) -> None:
        panel = self.panels.pop(pid, None)
        self.runtime.pop(pid, None)
        if panel and panel.get("own_user"):
            # Konto utworzone przy parowaniu znika razem z panelem (token przestaje działać).
            if user := await self.hass.auth.async_get_user(panel["user_id"]):
                if not user.is_admin and not user.is_owner and not user.credentials:
                    await self.hass.auth.async_remove_user(user)
        self.save()
        self.notify_admin()

    @callback
    def config_event(self, pid: str) -> dict[str, Any]:
        panel = self.panels[pid]
        return {
            "type": "config",
            "panel": {"name": panel["name"], "shape": panel["shape"], "settings": panel["settings"]},
            "dashboard": self.dashboards[panel["dashboard"]],
            "doorbell": public_doorbell(self.doorbell),
        }

    @callback
    def push_config(self, pid: str) -> None:
        self.send(pid, self.config_event(pid))

    @callback
    def send(self, pid: str, payload: dict[str, Any]) -> bool:
        rt = self.runtime.get(pid)
        if rt is None or not rt.subscribers:
            return False
        for connection, msg_id in list(rt.subscribers.values()):
            connection.send_event(msg_id, payload)
        return True

    @callback
    def command(self, pid: str, command: str, **data: Any) -> bool:
        return self.send(pid, {"type": "command", "command": command, **data})

    @callback
    def add_subscriber(self, pid: str, connection: ActiveConnection, msg_id: int):
        key = (id(connection), msg_id)
        rt = self.runtime[pid]
        rt.subscribers[key] = (connection, msg_id)
        self.notify(pid)
        self.notify_admin()

        @callback
        def remove() -> None:
            rt.subscribers.pop(key, None)
            self.notify(pid)
            self.notify_admin()

        return remove

    @callback
    def update_state(self, pid: str, state: dict[str, Any]) -> None:
        self.runtime[pid].state = state
        self.notify(pid)

    @callback
    def notify(self, pid: str) -> None:
        async_dispatcher_send(self.hass, SIGNAL_PANEL.format(pid))

    @callback
    def notify_admin(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_ADMIN)
        # Edytora zwykle nie ma w menu bocznym, więc o czekającym panelu mówi powiadomienie HA.
        # Bez nazwy z panelu: przychodzi z sieci bez logowania i nie powinna trafić do treści z linkami.
        if self.pairing.pending():
            persistent_notification.async_create(
                self.hass,
                f"Nowy panel czeka na zatwierdzenie. [Otwórz PanelPilot](/{EDITOR_PATH}) i porównaj kod z ekranem panelu.",
                title="PanelPilot", notification_id=PAIRING_NOTICE,
            )
        else:
            persistent_notification.async_dismiss(self.hass, PAIRING_NOTICE)

    def admin_data(self) -> dict[str, Any]:
        self.ensure_dashboard()
        return {
            "dashboards": self.dashboards,
            "doorbell": self.doorbell,
            "panels": {
                pid: {**{k: v for k, v in p.items() if k != "user_id"}, "connected": self.runtime[pid].connected, "state": self.runtime[pid].state}
                for pid, p in self.panels.items()
            },
            "pairing": self.pairing.pending(),
        }
