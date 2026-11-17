"""Exercise real integration setup, assets, permissions and recorder WebSocket schema."""
import asyncio
from pathlib import Path
import shutil
import tempfile

from aiohttp import ClientSession
from homeassistant import bootstrap, loader
from homeassistant.core import HomeAssistant
from homeassistant.auth.const import GROUP_ID_ADMIN

async def main():
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / 'custom_components' / 'pv_manager'
        shutil.copytree(Path(__file__).resolve().parents[1] / 'custom_components' / 'pv_manager', target)
        hass = HomeAssistant(directory)
        loader.async_setup(hass)
        try:
            config = {'homeassistant': {'latitude': 0, 'longitude': 0, 'elevation': 0,
                       'time_zone': 'Europe/Berlin', 'unit_system': 'metric'},
                      'http': {'server_port': 8123}, 'recorder': {}}
            assert await bootstrap.async_from_config_dict(config, hass) is hass
            await hass.async_start()
            flow = await hass.config_entries.flow.async_init('pv_manager', context={'source': 'user'})
            assert flow['type'] == 'form', flow
            flow = await hass.config_entries.flow.async_configure(flow['flow_id'], {})
            assert flow['type'] == 'create_entry', flow
            await hass.async_block_till_done()
            async with ClientSession() as session:
                for name in ['pv-manager-card.js', 'data.js', 'family-ui/1.9.2/family-ui.js']:
                    async with session.get('http://127.0.0.1:8123/pv-manager/' + name) as response:
                        assert response.status == 200, (name, response.status)
                        assert 'javascript' in response.headers['Content-Type'], response.headers
                async def connect(admin):
                    user = await hass.auth.async_create_user('Admin' if admin else 'Viewer', group_ids=[GROUP_ID_ADMIN] if admin else [])
                    refresh = await hass.auth.async_create_refresh_token(user, client_id="http://localhost/")
                    token = hass.auth.async_create_access_token(refresh)
                    ws = await session.ws_connect('http://127.0.0.1:8123/api/websocket')
                    assert (await ws.receive_json())['type'] == 'auth_required'
                    await ws.send_json({'type': 'auth', 'access_token': token})
                    assert (await ws.receive_json())['type'] == 'auth_ok'
                    return ws
                async def request(ws, number, command):
                    await ws.send_json({'id': number, **command})
                    return await ws.receive_json()
                ws = await connect(True)
                result = await request(ws, 1, {'type': 'pv_manager/config', 'card_id': 'smoke'})
                assert result['success'] and result['result']['admin'], result
                result = await request(ws, 2, {'type': 'pv_manager/save', 'card_id': 'smoke', 'settings': {'title': 'Roof PV', 'solar': 'sensor.pv', 'animated': True, 'grid_positive': 'import'}})
                assert result['success'], result
                assert (await request(ws, 3, {'type': 'pv_manager/config', 'card_id': 'smoke'}))['result']['settings']['title'] == 'Roof PV'
                result = await request(ws, 4, {'type': 'recorder/statistics_during_period', 'start_time': '2026-11-01T00:00:00Z', 'end_time': '2026-11-02T00:00:00Z', 'statistic_ids': ['sensor.pv'], 'period': '5minute', 'types': ['mean'], 'units': {'power': 'W'}})
                assert result['success'], result
                result = await request(ws, 5, {'type': 'recorder/statistics_during_period', 'start_time': '2026-11-01T00:00:00Z', 'end_time': '2026-11-02T00:00:00Z', 'statistic_ids': ['sensor.energy'], 'period': 'day', 'types': ['change'], 'units': {'energy': 'kWh'}})
                assert result['success'], result
                result = await request(ws, 6, {'type': 'pv_manager/save', 'card_id': 'smoke', 'settings': {'solar': 'light.invalid'}})
                assert not result['success'], result
                await ws.close()
                viewer = await connect(False)
                result = await request(viewer, 1, {'type': 'pv_manager/save', 'card_id': 'smoke', 'settings': {'title': 'Forbidden'}})
                assert not result['success'], result
                await viewer.close()
            assert await hass.config_entries.async_reload(flow['result'].entry_id)
            await hass.async_block_till_done()
            assert hass.data['pv_manager']['cards']['smoke']['title'] == 'Roof PV'
            print('Official HA smoke OK: config flow, reload, nested JavaScript assets, persisted settings, validation, admin permission and recorder query schemas')
        finally:
            await hass.async_stop()

asyncio.run(main())
