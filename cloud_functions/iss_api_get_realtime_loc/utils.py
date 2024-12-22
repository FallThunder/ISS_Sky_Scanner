import requests
from typing import Dict, Any, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def fetch_iss_location() -> Optional[Dict[str, Any]]:
    """
    Fetches current ISS location from the Open Notify API.
    Returns a dictionary with latitude, longitude, and timestamp if successful.
    """
    try:
        response = requests.get('http://api.open-notify.org/iss-now.json', timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data['message'] == 'success':
            return {
                'latitude': float(data['iss_position']['latitude']),
                'longitude': float(data['iss_position']['longitude']),
                'timestamp': data['timestamp']
            }
        return None
    except Exception as e:
        logger.error(f"Error fetching ISS location: {str(e)}")
        return None

def reverse_geocode(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Reverse geocodes coordinates using BigDataCloud API to get location details.
    Returns location details if successful.
    """
    try:
        response = requests.get(
            f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lon}&localityLanguage=en",
            timeout=10
        )
        response.raise_for_status()
        location_data = response.json()
        
        # Check if it's over a water body
        locality_info = location_data.get('localityInfo', {}).get('informative', [])
        water_keywords = ['ocean', 'sea']
        location_name = None
        
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
            
        return {
            'location_name': location_name,
            'raw_data': location_data
        }
            
    except Exception as e:
        logger.error(f"Error reverse geocoding location: {str(e)}")
        return None
