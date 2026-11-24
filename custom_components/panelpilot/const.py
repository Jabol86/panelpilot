"""Stałe integracji Panel Pilot."""

DOMAIN = "panelpilot"
VERSION = "0.1.29"
PLATFORMS = ["binary_sensor", "button", "light", "select", "sensor"]

STATIC_URL = "/panelpilot_static"
EDITOR_PATH = "panelpilot"
CONF_SIDEBAR = "sidebar"

SIGNAL_NEW_PANEL = "panelpilot_new_panel"
SIGNAL_PANEL = "panelpilot_panel_{}"
SIGNAL_ADMIN = "panelpilot_admin"

MAX_PANELS = 30
