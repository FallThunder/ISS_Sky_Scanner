"""Offline reverse geocoding in iss_api_get_realtime_loc (no network)."""
import pytest

from conftest import load_function

utils, _ = load_function('iss_api_get_realtime_loc')


@pytest.mark.parametrize('lat, lon, expected_name, expected_code', [
    (48.85, 2.35, 'Paris, France', 'FR'),  # Natural Earth ISO_A2 is -99
    (40.78, -73.97, 'New York, United States of America', 'US'),
    (35.0, 18.0, 'Over the Mediterranean Sea', ''),
    (-48.88, -123.39, 'Over the South Pacific Ocean', ''),  # Point Nemo
    (51.64, 100.0, 'Hövsgöl, Mongolia', 'MN'),  # ISS max latitude
])
def test_known_places(lat, lon, expected_name, expected_code):
    result = utils.reverse_geocode(lat, lon)
    assert result['location_name'] == expected_name
    assert result['country_code'] == expected_code


@pytest.mark.parametrize('lon', [179.99, -179.99, 180.0, -180.0])
def test_antimeridian(lon):
    assert 'Pacific Ocean' in utils.reverse_geocode(10.0, lon)['location_name']


def test_coastal_point_inside_state_but_outside_coarse_country():
    # 50m country polygons miss this stretch of coast; 10m states don't
    result = utils.reverse_geocode(33.9, 10.1)
    assert result['location_name'] == 'Gabès, Tunisia'
    assert result['country_code'] == 'TN'


def test_every_point_gets_a_name():
    # A coarse sweep of the ISS's latitude band never returns None or a
    # placeholder: gaps between simplified polygons fall back to the
    # nearest water body
    for lat in range(-51, 52, 3):
        for lon in range(-180, 180, 7):
            result = utils.reverse_geocode(float(lat), float(lon))
            assert result and result['location_name'], (lat, lon)
            assert 'unavailable' not in result['location_name'].lower()


def test_returns_none_instead_of_raising(monkeypatch):
    monkeypatch.setattr(utils, '_geocoder', None)
    monkeypatch.setattr(utils, 'GEODATA_PATH', '/nonexistent/geodata.json')
    assert utils.reverse_geocode(0.0, 0.0) is None
    monkeypatch.setattr(utils, '_geocoder', None)
