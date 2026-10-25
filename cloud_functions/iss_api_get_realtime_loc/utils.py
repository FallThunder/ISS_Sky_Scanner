import logging
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

import requests
from skyfield.api import EarthSatellite, load

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Per-request timeout for upstream APIs. The caller
# (iss_api_store_realtime_loc) waits 25s for this whole function, so the
# worst case here (live API, TLE fallback + geocode) must stay well under
# that.
UPSTREAM_TIMEOUT_SECONDS = 5

WHERE_THE_ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544'
TLE_URLS = [
    'https://live.ariss.org/iss.txt',
    'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE',
]
GEOCODE_URL = 'https://api-bdc.io/data/reverse-geocode-client'

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


def reverse_geocode(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Reverse geocodes coordinates using BigDataCloud API to get location details.
    Returns location details if successful.
    """
    params = {'latitude': lat, 'longitude': lon, 'localityLanguage': 'en'}
    request_start = time.time()

    try:
        logger.info(f"Calling BigDataCloud reverse geocoding API for lat={lat}, lon={lon}")
        response = requests.get(
            GEOCODE_URL, params=params, timeout=UPSTREAM_TIMEOUT_SECONDS
        )
        request_duration = time.time() - request_start

        logger.info(f"BigDataCloud API responded in {request_duration:.2f} seconds with status {response.status_code}")
        response.raise_for_status()
        location_data = response.json()

        # Check if it's over a water body
        locality_info = location_data.get('localityInfo', {}).get('informative', [])
        water_keywords = ['ocean', 'sea']
        location_name = None
        country_code = location_data.get('countryCode', '')  # Get country code

        # First check for water bodies
        for info in locality_info:
            name = info.get('name', '').lower()
            if any(keyword in name for keyword in water_keywords):
                location_name = f"Over the {info.get('name')}"
                break

        # If not over water, check for land locations
        if not location_name:
            location_components = []

            # Add components in order of specificity
            if location_data.get('locality'):
                location_components.append(location_data['locality'])
            elif location_data.get('city'):
                location_components.append(location_data['city'])

            if location_data.get('principalSubdivision'):
                location_components.append(location_data['principalSubdivision'])

            if location_data.get('countryName'):
                location_components.append(location_data['countryName'])

            location_name = ", ".join(location_components) if location_components else "Over Ocean"

        result = {
            'location_name': location_name,
            'country_code': country_code,  # Add country code to the response
            'raw_data': location_data
        }
        logger.info(f"Successfully reverse geocoded location: {location_name}")
        return result

    except requests.exceptions.RequestException as e:
        logger.error(
            f"BigDataCloud API request failed after "
            f"{time.time() - request_start:.2f}s "
            f"({type(e).__name__}): {e}"
        )
        return None
    except Exception as e:
        logger.error(f"Unexpected error reverse geocoding location: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None
