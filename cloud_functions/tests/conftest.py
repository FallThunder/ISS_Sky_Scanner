"""Shared helpers for Cloud Function unit tests.

Each function directory has its own top-level `main.py` / `utils.py`, so
`load_function` imports them fresh (clearing the module cache) with the
Firestore client mocked out, letting tests run without GCP credentials.
"""
import importlib
import os
import sys
from unittest import mock

import pytest

FUNCTIONS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_function(name: str):
    """Imports (utils, main) for the named function directory."""
    for module in ('utils', 'main', 'config'):
        sys.modules.pop(module, None)
    sys.path.insert(0, os.path.join(FUNCTIONS_DIR, name))
    try:
        with mock.patch('google.cloud.firestore.Client'):
            utils = importlib.import_module('utils')
            main = importlib.import_module('main')
    finally:
        sys.path.pop(0)
    return utils, main


class FakeDoc:
    """Minimal stand-in for a Firestore DocumentSnapshot."""

    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


def fake_db(docs):
    """Returns (db, query) mocks whose query streams the given dicts."""
    query = mock.MagicMock()
    query.where.return_value = query
    query.order_by.return_value = query
    query.limit.return_value = query
    query.stream.return_value = iter(FakeDoc(d) for d in docs)
    db = mock.MagicMock()
    db.collection.return_value = query
    return db, query


ERROR_ENTRY = {
    'timestamp': '2026-10-25T05:30:00+00:00', 'is_error_entry': True,
    'isEmpty': True, 'latitude': None, 'longitude': None, 'location': None,
    'diagnostics': {}
}
VALID_ENTRY = {
    'timestamp': '2026-10-25T05:30:00+00:00', 'latitude': 10.0,
    'longitude': 20.0, 'location': 'Over the Pacific Ocean',
    'country_code': ''
}


def pytest_configure(config):
    config.addinivalue_line(
        'markers', 'network: test calls live public APIs (TLE / ISS position)'
    )


@pytest.fixture
def flask_app():
    import flask
    return flask.Flask('test')
