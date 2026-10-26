"""Builds the offline reverse-geocoding data for iss_api_get_realtime_loc.

Downloads Natural Earth (public domain, https://www.naturalearthdata.com/)
marine, country and state/province polygons, simplifies them and writes
iss_api_get_realtime_loc/geodata.json, which the function loads at startup.

Run from the repository root (needs network and shapely):
    pip install "shapely>=2.0,<3" requests
    python cloud_functions/tools/build_geodata.py
"""
import json
import os

import requests
from shapely.geometry import mapping, shape

NATURAL_EARTH_VERSION = 'v5.1.2'
BASE_URL = (
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
    f'{NATURAL_EARTH_VERSION}/geojson'
)
OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'iss_api_get_realtime_loc', 'geodata.json'
)

# Simplification tolerance in degrees (~0.02 deg is ~2 km): far finer than
# the ISS ground footprint, and keeps the file a few MB.
TOLERANCE = 0.02
COORD_DECIMALS = 3


def fetch(name: str) -> dict:
    """Downloads one Natural Earth GeoJSON layer."""
    url = f'{BASE_URL}/{name}.geojson'
    print(f'Downloading {url}')
    response = requests.get(url, timeout=300)
    response.raise_for_status()
    return response.json()


def compact_geometry(geometry: dict) -> dict:
    """Simplifies a geometry and rounds its coordinates."""
    geom = shape(geometry).simplify(TOLERANCE, preserve_topology=True)
    if not geom.is_valid:
        geom = geom.buffer(0)

    def round_coords(coords):
        if isinstance(coords[0], (int, float)):
            return [round(c, COORD_DECIMALS) for c in coords]
        return [round_coords(c) for c in coords]

    simplified = mapping(geom)
    return {
        'type': simplified['type'],
        'coordinates': round_coords(simplified['coordinates']),
    }


def country_code(props: dict) -> str:
    """ISO 3166-1 alpha-2 code; Natural Earth uses -99 when ISO_A2 is unset."""
    for key in ('ISO_A2_EH', 'ISO_A2', 'iso_a2'):
        code = props.get(key)
        if code and code != '-99':
            return code
    return ''


def main():
    marine = [
        {
            'name': f['properties']['name'],
            'kind': f['properties']['featurecla'],
            'geometry': compact_geometry(f['geometry']),
        }
        for f in fetch('ne_10m_geography_marine_polys')['features']
        if f['properties'].get('name') and f['geometry']
    ]
    countries = [
        {
            # ADMIN is the full name ("Democratic Republic of the Congo",
            # not NAME's "Dem. Rep. Congo") and matches the states' 'admin'
            'name': f['properties']['ADMIN'],
            'code': country_code(f['properties']),
            'geometry': compact_geometry(f['geometry']),
        }
        for f in fetch('ne_50m_admin_0_countries')['features']
        if f['geometry']
    ]
    states = [
        {
            'name': f['properties']['name'],
            'country': f['properties']['admin'],
            'geometry': compact_geometry(f['geometry']),
        }
        for f in fetch('ne_10m_admin_1_states_provinces')['features']
        if f['properties'].get('name') and f['geometry']
    ]

    data = {
        'source': f'Natural Earth {NATURAL_EARTH_VERSION} (public domain)',
        'marine': marine,
        'countries': countries,
        'states': states,
    }
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    size_mb = os.path.getsize(OUTPUT_PATH) / 1e6
    print(
        f'Wrote {OUTPUT_PATH} ({size_mb:.1f} MB): {len(marine)} marine, '
        f'{len(countries)} countries, {len(states)} states'
    )


if __name__ == '__main__':
    main()
