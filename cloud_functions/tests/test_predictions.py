"""Prediction generation tests against SGP4 ground truth.

These fetch the live ISS TLE from ARISS, so they need network access
(marked `network`; skip with `pytest -m "not network"`).
"""
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest
from skyfield.api import EarthSatellite, load

from conftest import FakeDoc, load_function

pytestmark = pytest.mark.network

utils, _ = load_function('iss_api_generate_predictions')
TLE = utils.fetch_tle_data()
TS = load.timescale()


def truth(dt):
    satellite = EarthSatellite(TLE[0], TLE[1], 'ISS', TS)
    subpoint = satellite.at(TS.from_datetime(dt)).subpoint()
    return subpoint.latitude.degrees, subpoint.longitude.degrees


class FakeQuery:
    """Applies the `<` / `>=` timestamp filters the code uses."""

    def __init__(self, docs):
        self.docs = docs
        self.filters = []

    def where(self, *args):
        self.filters.append(args)
        return self

    def order_by(self, *args, **kwargs):
        return self

    def stream(self):
        out = self.docs
        for field, op, value in self.filters:
            if op == '<':
                out = [d for d in out if d[field] < value]
            if op == '>=':
                out = [d for d in out if d[field] >= value]
        out = sorted(out, key=lambda d: d['timestamp'], reverse=True)
        return iter(FakeDoc(d) for d in out)


def use_history(history):
    """Points utils.db at fake history; returns the dict stored docs land in."""
    stored = {}
    collection = mock.MagicMock()
    collection.where.side_effect = FakeQuery(history).where
    collection.document.side_effect = lambda doc_id: mock.MagicMock(
        set=lambda data: stored.__setitem__(doc_id, data))
    utils.db = mock.MagicMock()
    utils.db.collection.return_value = collection
    return stored


def valid(dt):
    lat, lon = truth(dt)
    return {'timestamp': dt.isoformat(), 'latitude': lat, 'longitude': lon}


def error(dt):
    return {'timestamp': dt.replace(second=0).isoformat(),
            'is_error_entry': True, 'latitude': None, 'longitude': None}


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


def generate(history_builder):
    """Runs generate_predictions for a fix 23s past the latest 5-min mark."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    source = now - timedelta(minutes=now.minute % 5, seconds=now.second - 23)
    lat, lon = truth(source)
    stored = use_history(history_builder(source))
    result = utils.generate_predictions(
        source.isoformat(), lat, lon, 'doc1', 'somewhere', '')
    assert result.get('status') == 'success', result
    (doc,) = stored.values()
    return doc['predictions']


def first_prediction_error(predictions):
    first = predictions[0]
    true_lat, true_lon = truth(datetime.fromisoformat(first['timestamp']))
    return (abs(first['latitude'] - true_lat),
            angle_diff(first['longitude'], true_lon))


def test_normal_case_is_close_to_sgp4():
    predictions = generate(lambda s: [valid(s - timedelta(minutes=5))])
    assert len(predictions) == 19
    lat_err, lon_err = first_prediction_error(predictions)
    assert lat_err < 2.5 and lon_err < 1.0


def test_skips_error_entry_before_source():
    predictions = generate(lambda s: [
        valid(s - timedelta(minutes=10)), error(s - timedelta(minutes=5))])
    assert len(predictions) == 19


def test_outage_falls_back_to_sgp4_previous_position():
    predictions = generate(lambda s: [valid(s - timedelta(minutes=60))] + [
        error(s - timedelta(minutes=m)) for m in (5, 10, 15, 20, 25)])
    assert len(predictions) == 19
    lat_err, lon_err = first_prediction_error(predictions)
    assert lat_err < 2.5 and lon_err < 1.0


def test_fetches_tle_once_per_call():
    calls = []
    original = utils.fetch_tle_data
    with mock.patch.object(utils, 'fetch_tle_data',
                           side_effect=lambda: calls.append(1) or original()):
        generate(lambda s: [valid(s - timedelta(minutes=5))])
    assert len(calls) == 1
