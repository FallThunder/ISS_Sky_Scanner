import json
import logging
import os
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

import requests
from shapely.geometry import Point, shape
from shapely.strtree import STRtree
from skyfield.api import EarthSatellite, load

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Per-request timeout for upstream APIs. The caller
# (iss_api_store_realtime_loc) waits 25s for this whole function, so the
# worst case here (live API + TLE fallback; geocoding is offline) must stay
# well under that.
UPSTREAM_TIMEOUT_SECONDS = 5

WHERE_THE_ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544'
TLE_URLS = [
    'https://live.ariss.org/iss.txt',
    'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE',
]
GEODATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'geodata.json')

# Note: Open Notify (api.open-notify.org) was dropped as a source. As of
# October 2026 it returns positions hours out of date while reporting the
# current timestamp, which silently corrupts the history.


def _fetch_where_the_iss() -> Dict[str, Any]:
    """Fetches the live position from wheretheiss.at."""
    response = requests.get(WHERE_THE_ISS_URL, timeout=UPSTREAM_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()
    return {
        'latitude': float(data['latitude']),
        'longitude': float(data['longitude']),
        'timestamp': int(data['timestamp'])
    }


def _fetch_tle() -> tuple[str, str]:
    """Fetches the ISS TLE, trying each of TLE_URLS in order."""
    last_error = None
    for url in TLE_URLS:
        try:
            response = requests.get(url, timeout=UPSTREAM_TIMEOUT_SECONDS)
            response.raise_for_status()
            lines = [line.strip() for line in response.text.strip().splitlines()]
            if len(lines) >= 3 and lines[1].startswith('1 ') and lines[2].startswith('2 '):
                return lines[1], lines[2]
            last_error = ValueError(f"Unexpected TLE format from {url}")
        except requests.exceptions.RequestException as e:
            last_error = e
    raise last_error


def _compute_from_tle() -> Dict[str, Any]:
    """Computes the current position by SGP4-propagating the latest TLE."""
    tle_line1, tle_line2 = _fetch_tle()
    ts = load.timescale()
    satellite = EarthSatellite(tle_line1, tle_line2, 'ISS', ts)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    subpoint = satellite.at(ts.from_datetime(now)).subpoint()
    return {
        'latitude': float(subpoint.latitude.degrees),
        'longitude': float(subpoint.longitude.degrees),
        'timestamp': int(now.timestamp())
    }


ISS_SOURCES: list[tuple[str, Callable[[], Dict[str, Any]]]] = [
    ('wheretheiss.at', _fetch_where_the_iss),
    ('tle_sgp4', _compute_from_tle),
]


def fetch_iss_location() -> Optional[Dict[str, Any]]:
    """
    Fetches the current ISS location, trying each source in ISS_SOURCES
    in order until one succeeds.

    Returns a dictionary with latitude, longitude, timestamp (unix seconds)
    and source, or None if every source fails.
    """
    for source_name, fetch in ISS_SOURCES:
        request_start = time.time()
        try:
            logger.info(f"Fetching ISS location from {source_name}")
            result = fetch()
            result['source'] = source_name
            logger.info(
                f"{source_name} responded in "
                f"{time.time() - request_start:.2f}s"
            )
            return result
        except Exception as e:
            logger.warning(
                f"{source_name} failed after "
                f"{time.time() - request_start:.2f}s "
                f"({type(e).__name__}): {e}"
            )

    logger.error("All ISS location sources failed")
    return None


class _Geocoder:
    """Offline reverse geocoder over the Natural Earth layers in geodata.json.

    Built lazily on first use (about a second) and reused across requests.
    """

    def __init__(self, path: str):
        with open(path) as f:
            data = json.load(f)
        self.marine = self._layer(data['marine'])
        self.countries = self._layer(data['countries'])
        self.states = self._layer(data['states'])
        self.country_codes = {c['name']: c['code'] for c in data['countries']}

    @staticmethod
    def _layer(features: list) -> Dict[str, Any]:
        geoms = [shape(feat['geometry']) for feat in features]
        return {
            'tree': STRtree(geoms),
            'geoms': geoms,
            'props': [{k: v for k, v in feat.items() if k != 'geometry'} for feat in features],
        }

    @staticmethod
    def _containing(layer: Dict[str, Any], point: Point) -> list:
        """Indices of the layer's polygons that contain the point."""
        return [
            i for i in layer['tree'].query(point)
            if layer['geoms'][i].covers(point)
        ]

    def lookup(self, lat: float, lon: float) -> Dict[str, Any]:
        point = Point(lon, lat)

        country_hits = self._containing(self.countries, point)
        if country_hits:
            country = self.countries['props'][country_hits[0]]
            state_hits = [
                i for i in self._containing(self.states, point)
                if self.states['props'][i]['country'] == country['name']
            ] or self._containing(self.states, point)
            parts = []
            if state_hits:
                parts.append(self.states['props'][state_hits[0]]['name'])
            parts.append(country['name'])
            return {
                'location_name': ', '.join(parts),
                'country_code': country['code'],
                'raw_data': {'country': country['name'],
                             'state': parts[0] if state_hits else None},
            }

        # The 10m state polygons follow coastlines more closely than the 50m
        # country polygons, so a coastal point can be in a state only
        state_hits = self._containing(self.states, point)
        if state_hits:
            state = self.states['props'][state_hits[0]]
            return {
                'location_name': f"{state['name']}, {state['country']}",
                'country_code': self.country_codes.get(state['country'], ''),
                'raw_data': {'country': state['country'], 'state': state['name']},
            }

        # Over water: prefer the most specific (smallest) containing body,
        # e.g. "Arabian Sea" over "Indian Ocean"; near coasts the simplified
        # polygons can leave gaps, so fall back to the nearest body
        marine_hits = self._containing(self.marine, point)
        if marine_hits:
            index = min(marine_hits, key=lambda i: self.marine['geoms'][i].area)
        else:
            index = int(self.marine['tree'].nearest(point))
        water = self.marine['props'][index]
        return {
            'location_name': f"Over the {_display_water_name(water['name'])}",
            'country_code': '',
            'raw_data': {'water_body': water['name'], 'kind': water['kind']},
        }


def _display_water_name(name: str) -> str:
    """Natural Earth spells a few names in capitals ("SOUTHERN OCEAN")."""
    return name.title() if name.isupper() else name


_geocoder: Optional[_Geocoder] = None


def reverse_geocode(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Reverse geocodes coordinates offline using Natural Earth polygons
    (geodata.json, built by cloud_functions/tools/build_geodata.py).

    Returns {'location_name', 'country_code', 'raw_data'}: "State, Country"
    over land, "Over the <water body>" over water. Returns None on failure.

    BigDataCloud's free client endpoint was dropped in October 2026: its
    terms forbid server-side use, and it started rejecting Cloud Run's IPs.
    """
    global _geocoder
    try:
        if _geocoder is None:
            start = time.time()
            _geocoder = _Geocoder(GEODATA_PATH)
            logger.info(f"Loaded offline geocoder in {time.time() - start:.2f}s")
        result = _geocoder.lookup(lat, lon)
        logger.info(f"Reverse geocoded ({lat}, {lon}): {result['location_name']}")
        return result
    except Exception as e:
        logger.error(f"Reverse geocoding failed for ({lat}, {lon}): {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None
