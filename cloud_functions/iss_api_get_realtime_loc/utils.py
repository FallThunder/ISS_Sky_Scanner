import requests
from typing import Dict, Any, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def fetch_iss_location() -> Optional[Dict[str, Any]]:
    """
    Fetches current ISS location from the Open Notify API (NASA).
    Returns a dictionary with latitude, longitude, and timestamp if successful.
    """
    import time
    import traceback
    nasa_api_url = 'http://api.open-notify.org/iss-now.json'
    timeout_value = 10
    
    try:
        logger.info(f"Calling NASA Open Notify API: {nasa_api_url}")
        request_start = time.time()
        response = requests.get(nasa_api_url, timeout=timeout_value)
        request_duration = time.time() - request_start
        
        logger.info(f"NASA API responded in {request_duration:.2f} seconds with status {response.status_code}")
        response.raise_for_status()
        
        data = response.json()
        
        if data.get('message') == 'success':
            result = {
                'latitude': float(data['iss_position']['latitude']),
                'longitude': float(data['iss_position']['longitude']),
                'timestamp': data['timestamp']
            }
            logger.info(f"Successfully parsed NASA API response")
            return result
        else:
            logger.warning(f"NASA API returned non-success message: {data.get('message', 'unknown')}")
            return None
            
    except requests.exceptions.Timeout as e:
        request_duration = time.time() - request_start if 'request_start' in locals() else None
        logger.error(f"NASA API timeout after {request_duration:.2f if request_duration else 'unknown'} seconds: {str(e)}")
        return None
    except requests.exceptions.RequestException as e:
        request_duration = time.time() - request_start if 'request_start' in locals() else None
        logger.error(f"NASA API request error after {request_duration:.2f if request_duration else 'unknown'} seconds: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching ISS location: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

def reverse_geocode(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Reverse geocodes coordinates using BigDataCloud API to get location details.
    Returns location details if successful.
    """
    import time
    import traceback
    geocode_url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lon}&localityLanguage=en"
    timeout_value = 10
    
    try:
        logger.info(f"Calling BigDataCloud reverse geocoding API for lat={lat}, lon={lon}")
        request_start = time.time()
        response = requests.get(geocode_url, timeout=timeout_value)
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
            
    except requests.exceptions.Timeout as e:
        request_duration = time.time() - request_start if 'request_start' in locals() else None
        logger.error(f"BigDataCloud API timeout after {request_duration:.2f if request_duration else 'unknown'} seconds: {str(e)}")
        return None
    except requests.exceptions.RequestException as e:
        request_duration = time.time() - request_start if 'request_start' in locals() else None
        logger.error(f"BigDataCloud API request error after {request_duration:.2f if request_duration else 'unknown'} seconds: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error reverse geocoding location: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None
