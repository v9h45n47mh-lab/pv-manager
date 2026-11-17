"""PV Manager: local dashboard card and central per-card configuration."""
from __future__ import annotations

import asyncio
from pathlib import Path

try:
    import probatio as vol
except ImportError:
    import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import callback
from homeassistant.helpers.storage import Store

DOMAIN = "pv_manager"
VERSION = "1.0.3"
ENTITY_KEYS = ("solar", "grid", "home", "battery", "soc", "solar_energy", "import_energy",
               "export_energy", "home_energy", "charge_energy", "discharge_energy")
CARD_ID = vol.All(str, vol.Length(min=1, max=100), vol.Match(r"^[A-Za-z0-9_-]+$"))
SETTINGS = vol.Schema({
    vol.Optional("title"): vol.All(str, vol.Length(min=1, max=100)),
    vol.Optional("animated"): bool,
    vol.Optional("grid_positive"): vol.In(("import", "export")),
    vol.Optional("battery_positive"): vol.In(("charge", "discharge")),
    **{vol.Optional(key): vol.All(str, vol.Length(max=255),
        vol.Match(r"^(sensor\.[a-z0-9_]+)?$")) for key in ENTITY_KEYS},
})


async def async_setup(hass, config):
    """Register assets and commands once, independent of config-entry reloads."""
    store = Store(hass, 1, DOMAIN + ".cards")
    hass.data[DOMAIN] = {"store": store, "cards": await store.async_load() or {}, "lock": asyncio.Lock()}
    await hass.http.async_register_static_paths([
        StaticPathConfig("/pv-manager", str(Path(__file__).parent / "frontend"), False)
    ])
    frontend.add_extra_js_url(hass, f"/pv-manager/pv-manager-card.js?v={VERSION}")
    websocket_api.async_register_command(hass, ws_config)
    websocket_api.async_register_command(hass, ws_save)
    return True


async def async_setup_entry(hass, entry):
    return True


async def async_unload_entry(hass, entry):
    return True


@websocket_api.websocket_command({vol.Required("type"): "pv_manager/config",
                                 vol.Required("card_id"): CARD_ID})
@callback
def ws_config(hass, connection, msg):
    settings = dict(hass.data[DOMAIN]["cards"].get(msg["card_id"], {}))
    for key in ENTITY_KEYS:
        if settings.get(key) and not connection.user.permissions.check_entity(settings[key], POLICY_READ):
            settings[key] = ""
    connection.send_result(msg["id"], {"settings": settings,
        "admin": connection.user.is_admin, "version": VERSION})


@websocket_api.websocket_command({vol.Required("type"): "pv_manager/save",
    vol.Required("card_id"): CARD_ID, vol.Required("settings"): SETTINGS})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    data = hass.data[DOMAIN]
    async with data["lock"]:
        cards = {**data["cards"], msg["card_id"]: dict(msg["settings"])}
        try:
            await data["store"].async_save(cards)
        except (OSError, ValueError):
            connection.send_error(msg["id"], "save_failed", "Einstellungen konnten nicht gespeichert werden.")
            return
        data["cards"] = cards
    connection.send_result(msg["id"], {"saved": True})
