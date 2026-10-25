"""iss_api_get_realtime_loc source fallback tests (live public APIs)."""
import pytest

from conftest import load_function

pytestmark = pytest.mark.network

utils, _ = load_function('iss_api_get_realtime_loc')


def test_primary_source():
    location = utils.fetch_iss_location()
    assert location['source'] == 'wheretheiss.at'
    assert -52 < location['latitude'] < 52


def test_falls_back_to_tle(monkeypatch):
    monkeypatch.setattr(utils, 'WHERE_THE_ISS_URL',
                        'https://api.wheretheiss.invalid/x')
    location = utils.fetch_iss_location()
    assert location['source'] == 'tle_sgp4'
    assert -52 < location['latitude'] < 52


def test_all_sources_down_returns_none(monkeypatch):
    monkeypatch.setattr(utils, 'WHERE_THE_ISS_URL',
                        'https://api.wheretheiss.invalid/x')
    monkeypatch.setattr(utils, 'TLE_URLS', ['https://tle.invalid/x'])
    assert utils.fetch_iss_location() is None
