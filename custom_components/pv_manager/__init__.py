"""PV Manager: local dashboard card and central per-card configuration."""
from __future__ import annotations

import asyncio
from pathlib import Path

try:
    import probatio as vol
except ImportError:
    import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import frontend, lovelace, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.core import callback
from homeassistant.helpers.storage import Store

DOMAIN = "pv_manager"
VERSION = "1.0.9"
CARD_PATH = "/pv-manager/pv-manager-card.js"
CARD_URL = f"{CARD_PATH}?v={VERSION}"
LOADER_URL = f"/pv-manager/pv-manager-loader.js?v={VERSION}"
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
    websocket_api.async_register_command(hass, ws_config)
    websocket_api.async_register_command(hass, ws_save)
    return True


def _dashboard_resources(hass):
    """Get the resource collection on current and older Home Assistant releases."""
    data = hass.data[getattr(lovelace, "LOVELACE_DATA", lovelace.DOMAIN)]
    return data["resources"] if isinstance(data, dict) else data.resources


async def async_setup_entry(hass, entry):
    """Load the card through the dashboard's resource collection."""
    resources = _dashboard_resources(hass)
    await resources.async_get_info()
    resource = next(
        (item for item in resources.async_items() if item["url"].split("?", 1)[0] == CARD_PATH),
        None,
    )
    if isinstance(resources, ResourceStorageCollection):
        data = {"url": CARD_URL, "res_type": "module"}
        if resource is None:
            await resources.async_create_item(data)
        elif resource["url"] != CARD_URL or resource["type"] != "module":
            await resources.async_update_item(resource["id"], data)
    elif resource is None or resource["type"] != "module":
        # YAML resources are managed by the user's configuration.
        frontend.add_extra_js_url(hass, LOADER_URL)
    return True


async def async_unload_entry(hass, entry):
    return True


async def async_remove_entry(hass, entry):
    """Clean up the resource installed by PV Manager on integration removal."""
    resources = _dashboard_resources(hass)
    if isinstance(resources, ResourceStorageCollection):
        await resources.async_get_info()
        for item in resources.async_items():
            if item["url"] == CARD_URL:
                await resources.async_delete_item(item["id"])
    elif LOADER_URL in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls:
        frontend.remove_extra_js_url(hass, LOADER_URL)


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
