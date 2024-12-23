from google.cloud import firestore
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_last_stored_location():
    """
    Retrieves the latest ISS location entry from Firestore.
    
    Returns:
        dict: The latest location data if found, None otherwise
    """
    try:
        # Initialize Firestore client
        db = firestore.Client()
        
        # Query the collection for the latest entry
        logger.info("Querying Firestore for latest ISS location...")
        docs = db.collection('iss_loc_history') \
                 .order_by('timestamp', direction=firestore.Query.DESCENDING) \
                 .limit(1) \
                 .stream()
        
        # Get the first (latest) document
        for doc in docs:
            logger.info(f"Found location data with timestamp: {doc.get('timestamp')}")
            return doc.to_dict()
        
        logger.warning("No location data found in Firestore")
        return None
        
    except Exception as e:
        logger.error(f"Error retrieving location from Firestore: {str(e)}")
        raise
