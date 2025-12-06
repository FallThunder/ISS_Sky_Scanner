import logging
import math
import requests
from typing import Dict, Any, List, Optional, Tuple
from google.cloud import firestore
from datetime import datetime, timezone, timedelta
from collections import OrderedDict
from skyfield.api import load, EarthSatellite

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firestore client
try:
    db = firestore.Client()
    logger.info("Successfully initialized Firestore client")
except Exception as e:
    logger.error(f"Failed to initialize Firestore client: {str(e)}")
    raise

collection_name = 'iss_loc_predictions'

# Default ISS orbital parameters (fallback values)
DEFAULT_INCLINATION = 51.6  # degrees
DEFAULT_ORBITAL_PERIOD = 92.9  # minutes
DEFAULT_TIME_INTERVAL = 5.0  # minutes between data points

# Earth rotation rate
EARTH_ROTATION_RATE = 360 / (24 * 60)  # degrees per minute = 0.25


def fetch_tle_data() -> Optional[Tuple[str, str]]:
    """
    Fetch TLE data from ARISS.
    
    Returns:
        Tuple of (tle_line1, tle_line2) or None if fetch fails
    """
    try:
        logger.info("Fetching TLE data from ARISS...")
        response = requests.get('https://live.ariss.org/iss.txt', timeout=10)
        response.raise_for_status()
        
        text = response.text.strip()
        lines = text.split('\n')
        
        if len(lines) < 3:
            logger.warning("Invalid TLE format")
            return None
        
        # Return TLE lines 1 and 2 (skip line 0 which is the name)
        return (lines[1].strip(), lines[2].strip())
        
    except Exception as e:
        logger.error(f"Failed to fetch TLE data: {str(e)}")
        return None


def get_sgp4_position(tle_line1: str, tle_line2: str, 
                      target_time: datetime) -> Optional[Dict[str, float]]:
    """
    Calculate ISS position using SGP4/TLE at a specific time.
    
    Args:
        tle_line1: First line of TLE
        tle_line2: Second line of TLE
        target_time: Target datetime (timezone-aware)
        
    Returns:
        Dictionary with 'latitude' and 'longitude' in degrees, or None if calculation fails
    """
    try:
        # Load timescale
        ts = load.timescale()
        
        # Create satellite object from TLE
        satellite = EarthSatellite(tle_line1, tle_line2, 'ISS', ts)
        
        # Convert datetime to skyfield time
        t = ts.from_datetime(target_time)
        
        # Calculate position
        geocentric = satellite.at(t)
        subpoint = geocentric.subpoint()
        
        latitude = subpoint.latitude.degrees
        longitude = subpoint.longitude.degrees
        
        # Normalize longitude
        longitude = normalize_longitude(longitude)
        
        return {
            'latitude': latitude,
            'longitude': longitude
        }
        
    except Exception as e:
        logger.error(f"Error calculating SGP4 position: {str(e)}")
        return None


def load_tle_parameters() -> Dict[str, float]:
    """
    Fetch and parse TLE data from ARISS to get orbital parameters.
    
    Returns:
        Dictionary with 'inclination' (degrees) and 'orbital_period' (minutes)
        Falls back to defaults if fetch fails or data is invalid
    """
    try:
        tle_data = fetch_tle_data()
        if not tle_data:
            logger.warning("Could not fetch TLE data, using defaults")
            return _default_params()
        
        tle_line1, tle_line2 = tle_data
        
        # Parse line 2: Contains inclination and mean motion
        fields = tle_line2.split()
        
        if len(fields) < 8:
            logger.warning(f"Invalid TLE line 2 format: expected 8+ fields, got {len(fields)}")
            return _default_params()
        
        # Extract inclination (field 2) and mean motion (field 7)
        inclination = float(fields[2])
        mean_motion = float(fields[7])  # revolutions per day
        
        # Calculate orbital period in minutes
        orbital_period = (24 * 60) / mean_motion if mean_motion > 0 else DEFAULT_ORBITAL_PERIOD
        
        # Validate values
        if math.isnan(inclination) or inclination <= 0 or inclination > 90:
            logger.warning(f"Invalid inclination value {inclination}, using default")
            inclination = DEFAULT_INCLINATION
        
        if math.isnan(orbital_period) or orbital_period <= 0:
            logger.warning(f"Invalid orbital_period value {orbital_period}, using default")
            orbital_period = DEFAULT_ORBITAL_PERIOD
        
        logger.info(f"TLE parameters loaded: inclination={inclination:.4f}°, period={orbital_period:.2f} min")
        return {'inclination': inclination, 'orbital_period': orbital_period}
        
    except Exception as e:
        logger.warning(f"Failed to load TLE parameters ({str(e)}), using defaults")
        return _default_params()


def _default_params() -> Dict[str, float]:
    """Return default orbital parameters"""
    return {
        'inclination': DEFAULT_INCLINATION,
        'orbital_period': DEFAULT_ORBITAL_PERIOD
    }


def normalize_longitude(lon: float) -> float:
    """Normalize longitude to [-180, 180] range"""
    while lon > 180:
        lon -= 360
    while lon < -180:
        lon += 360
    return lon


def calculate_orbital_phase(current_lat: float, lat_velocity: float, 
                            inclination: float) -> float:
    """
    Calculate current orbital phase from latitude and velocity direction.
    
    Args:
        current_lat: Current latitude in degrees
        lat_velocity: Latitude velocity in degrees per minute (positive = northward)
        inclination: Orbital inclination in degrees
    
    Returns:
        Current orbital phase in radians [0, 2π]
    """
    # Normalize latitude to [-1, 1] range based on inclination
    normalized_lat = max(-1, min(1, current_lat / inclination))
    
    # Calculate principal phase (always in [-π/2, π/2])
    principal_phase = math.asin(normalized_lat)
    
    # Determine quadrant based on velocity direction
    if lat_velocity >= 0:
        # Ascending: phase in [0, π/2] (north) or [3π/2, 2π] (south)
        if current_lat >= 0:
            current_phase = principal_phase
        else:
            current_phase = 2 * math.pi + principal_phase
    else:
        # Descending: phase in [π/2, π] (north) or [π, 3π/2] (south)
        current_phase = math.pi - principal_phase
    
    # Normalize to [0, 2π]
    return current_phase % (2 * math.pi)


def calculate_ascending_node_longitude(current_lon: float, current_phase: float,
                                        inclination: float) -> float:
    """
    Calculate the longitude of the ascending node from current position and phase.
    
    Args:
        current_lon: Current longitude in degrees
        current_phase: Current orbital phase in radians
        inclination: Orbital inclination in degrees
    
    Returns:
        Longitude of the ascending node in degrees [-180, 180]
    """
    inc_rad = math.radians(inclination)
    
    # Calculate longitude offset from ascending node using spherical trig
    sin_phase = math.sin(current_phase)
    cos_phase = math.cos(current_phase)
    
    lon_offset = math.atan2(sin_phase * math.cos(inc_rad), cos_phase)
    
    # Ascending node longitude = current_lon - lon_offset
    ascending_node_lon = current_lon - math.degrees(lon_offset)
    
    return normalize_longitude(ascending_node_lon)


def predict_position(current_lat: float, current_lon: float,
                     previous_lat: float, previous_lon: float,
                     minutes_ahead: float,
                     time_interval_minutes: float = DEFAULT_TIME_INTERVAL) -> Dict:
    """
    Predict ISS latitude and longitude at a future time using orbital mechanics.
    
    Args:
        current_lat: Current latitude in degrees
        current_lon: Current longitude in degrees
        previous_lat: Previous latitude in degrees
        previous_lon: Previous longitude in degrees
        minutes_ahead: Minutes into the future to predict
        time_interval_minutes: Time interval between current and previous points
    
    Returns:
        Dictionary with predicted latitude and longitude
    """
    # Load TLE parameters
    tle_params = load_tle_parameters()
    inclination = tle_params['inclination']
    orbital_period = tle_params['orbital_period']
    inc_rad = math.radians(inclination)
    
    # Calculate latitude velocity and current orbital phase
    lat_velocity = (current_lat - previous_lat) / time_interval_minutes
    current_phase = calculate_orbital_phase(current_lat, lat_velocity, inclination)
    
    # Calculate ascending node longitude (accounts for current position)
    ascending_node_lon = calculate_ascending_node_longitude(
        current_lon, current_phase, inclination
    )
    
    # Angular velocities
    omega_orbital = (2 * math.pi) / orbital_period  # rad/min
    omega_earth = (2 * math.pi) / (24 * 60)  # rad/min
    
    # Predict future orbital phase
    future_phase = (current_phase + omega_orbital * minutes_ahead) % (2 * math.pi)
    
    # Predict latitude: lat = inclination * sin(phase)
    predicted_lat = inclination * math.sin(future_phase)
    
    # Predict longitude:
    # 1. Calculate longitude offset from ascending node at future phase
    sin_future = math.sin(future_phase)
    cos_future = math.cos(future_phase)
    future_lon_offset = math.atan2(sin_future * math.cos(inc_rad), cos_future)
    
    # 2. Ascending node drifts west due to Earth rotation
    node_drift = -math.degrees(omega_earth * minutes_ahead)
    future_node_lon = ascending_node_lon + node_drift
    
    # 3. Predicted longitude = future node position + offset from node
    predicted_lon = future_node_lon + math.degrees(future_lon_offset)
    predicted_lon = normalize_longitude(predicted_lon)
    
    return {
        'latitude': predicted_lat,
        'longitude': predicted_lon
    }


def get_previous_location(source_timestamp: str) -> Optional[Dict[str, Any]]:
    """
    Get the previous location entry from Firestore to calculate velocity.
    
    Args:
        source_timestamp: ISO format timestamp of current location
        
    Returns:
        Dictionary with previous location data or None if not found
    """
    try:
        logger.info("Fetching previous location from Firestore...")
        
        # Parse source timestamp
        source_dt = datetime.fromisoformat(source_timestamp.replace('Z', '+00:00'))
        
        # Query for the most recent entry before source_timestamp
        query = db.collection('iss_loc_history')\
            .where('timestamp', '<', source_timestamp)\
            .order_by('timestamp', direction=firestore.Query.DESCENDING)\
            .limit(1)
        
        docs = list(query.stream())
        
        if not docs:
            logger.warning("No previous location found in Firestore")
            return None
        
        doc = docs[0]
        data = doc.to_dict()
        
        logger.info(f"Found previous location at timestamp: {data.get('timestamp')}")
        return {
            'timestamp': data.get('timestamp'),
            'latitude': data.get('latitude'),
            'longitude': data.get('longitude')
        }
        
    except Exception as e:
        logger.error(f"Error fetching previous location: {str(e)}")
        return None


def round_timestamp_to_5_minutes(iso_timestamp: str) -> str:
    """
    Rounds an ISO timestamp to the nearest 5-minute interval.
    
    Args:
        iso_timestamp: ISO format timestamp string
        
    Returns:
        ISO format timestamp string rounded to 5-minute interval
    """
    try:
        # Parse the ISO timestamp
        dt = datetime.fromisoformat(iso_timestamp.replace('Z', '+00:00'))
        
        # Round to nearest 5 minutes
        minutes = dt.minute
        rounded_minutes = (minutes // 5) * 5
        rounded_dt = dt.replace(minute=rounded_minutes, second=0, microsecond=0)
        
        # Return in ISO format
        return rounded_dt.isoformat()
    except Exception as e:
        logger.error(f"Error rounding timestamp: {str(e)}")
        raise


def generate_predictions(
    source_timestamp: str,
    source_latitude: float,
    source_longitude: float,
    source_document_id: str,
    source_location: str,
    source_country_code: str
) -> Dict[str, Any]:
    """
    Generates 19 predictions (5, 10, 15, ..., 95 minutes ahead) for a given ISS location.
    Uses TLE + SGP4 to get the "true" current position, then uses orbital mechanics
    to predict future positions.
    
    Args:
        source_timestamp: ISO format timestamp of the source location
        source_latitude: Latitude of the source location (from NASA API, used as fallback)
        source_longitude: Longitude of the source location (from NASA API, used as fallback)
        source_document_id: Document ID from iss_loc_history collection
        source_location: Location name string
        source_country_code: Country code string
        
    Returns:
        Dictionary containing prediction data or error message
    """
    try:
        logger.info(f"Generating predictions for timestamp: {source_timestamp}")
        
        # Round timestamp to 5-minute interval for document ID and calculations
        rounded_timestamp = round_timestamp_to_5_minutes(source_timestamp)
        logger.info(f"Rounded timestamp to: {rounded_timestamp}")
        
        # Parse rounded timestamp for calculations (to ensure all predictions are on 5-minute boundaries)
        source_dt_rounded = datetime.fromisoformat(rounded_timestamp.replace('Z', '+00:00'))
        
        # Get previous location to calculate velocity for orbital mechanics predictions
        # Use original timestamp for querying (to find the actual previous location)
        previous_location = get_previous_location(source_timestamp)
        
        if not previous_location:
            error_msg = "Cannot generate predictions: previous location not found in Firestore. Need at least 2 location points to calculate velocity."
            logger.error(error_msg)
            return {'error': error_msg}
        
        previous_lat = previous_location['latitude']
        previous_lon = previous_location['longitude']
        logger.info(f"Using stored previous position: lat={previous_lat:.4f}, lon={previous_lon:.4f}")
        
        # Calculate time interval between current and previous location
        # Use rounded timestamp for consistency
        previous_dt = datetime.fromisoformat(previous_location['timestamp'].replace('Z', '+00:00'))
        time_interval_minutes = (source_dt_rounded - previous_dt).total_seconds() / 60.0
        
        # Ensure reasonable time interval (should be around 5 minutes)
        if time_interval_minutes <= 0:
            error_msg = f"Invalid time interval: {time_interval_minutes:.2f} minutes. Previous location timestamp must be before current."
            logger.error(error_msg)
            return {'error': error_msg}
        
        if time_interval_minutes > 30:
            logger.warning(f"Unusual time interval: {time_interval_minutes:.2f} minutes (expected ~5 minutes), using default")
            time_interval_minutes = DEFAULT_TIME_INTERVAL
        
        logger.info(f"Using time interval: {time_interval_minutes:.2f} minutes")
        
        # Generate 19 predictions using orbital mechanics (5, 10, 15, ..., 95 minutes ahead)
        # This ensures predictions go up to the current time when source is 95 minutes ago
        predictions = []
        for minutes_ahead in range(5, 100, 5):  # 5, 10, 15, ..., 95
            # Calculate future timestamp using rounded source timestamp (ensures predictions are on 5-minute boundaries)
            future_dt = source_dt_rounded + timedelta(minutes=minutes_ahead)
            future_timestamp = future_dt.isoformat()
            future_timestamp_unix = int(future_dt.timestamp())
            
            # Use orbital mechanics to predict position
            prediction_result = predict_position(
                current_lat=source_latitude,
                current_lon=source_longitude,
                previous_lat=previous_lat,
                previous_lon=previous_lon,
                minutes_ahead=minutes_ahead,
                time_interval_minutes=time_interval_minutes
            )
            
            prediction = {
                'minutes_ahead': minutes_ahead,
                'timestamp': future_timestamp,
                'timestamp_unix': future_timestamp_unix,
                'latitude': prediction_result['latitude'],
                'longitude': prediction_result['longitude'],
                'method': 'orbital_mechanics'
            }
            predictions.append(prediction)
        
        logger.info(f"Generated {len(predictions)} orbital mechanics predictions")
        logger.info(f"Total predictions generated: {len(predictions)} (19 orbital mechanics)")
        
        # Create document reference for source document
        source_doc_ref = db.collection('iss_loc_history').document(source_document_id)
        
        # Prepare document data
        doc_data = OrderedDict([
            ('source_timestamp', rounded_timestamp),
            ('source_timestamp_unix', int(source_dt_rounded.timestamp())),  # Use rounded timestamp for consistency
            ('source_document_id', source_document_id),
            ('source_document_ref', source_doc_ref),
            ('source_latitude', source_latitude),
            ('source_longitude', source_longitude),
            ('source_location', source_location),
            ('source_country_code', source_country_code),
            ('predictions', predictions),
            ('prediction_count', len(predictions)),
            ('generated_at', datetime.now(timezone.utc).isoformat())
        ])
        
        # Store in Firestore
        logger.info(f"Storing predictions document with ID: {rounded_timestamp}")
        doc_ref = db.collection(collection_name).document(rounded_timestamp)
        doc_ref.set(dict(doc_data))
        
        logger.info(f"Successfully stored predictions document")
        return {
            'status': 'success',
            'document_id': rounded_timestamp,
            'prediction_count': len(predictions)
        }
        
    except Exception as e:
        error_msg = f"Error generating predictions: {str(e)}"
        logger.error(error_msg)
        return {'error': error_msg}


def generate_predictions_from_location_data(location_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to generate predictions from location data dictionary.
    
    Args:
        location_data: Dictionary containing location data with keys:
            - timestamp: ISO format timestamp
            - latitude: float
            - longitude: float
            - document_id: string (document ID from iss_loc_history)
            - location: string (location name)
            - country_code: string
            
    Returns:
        Dictionary containing prediction result or error message
    """
    try:
        return generate_predictions(
            source_timestamp=location_data['timestamp'],
            source_latitude=location_data['latitude'],
            source_longitude=location_data['longitude'],
            source_document_id=location_data['document_id'],
            source_location=location_data.get('location', ''),
            source_country_code=location_data.get('country_code', '')
        )
    except KeyError as e:
        error_msg = f"Missing required field in location_data: {str(e)}"
        logger.error(error_msg)
        return {'error': error_msg}
    except Exception as e:
        error_msg = f"Error generating predictions from location data: {str(e)}"
        logger.error(error_msg)
        return {'error': error_msg}
