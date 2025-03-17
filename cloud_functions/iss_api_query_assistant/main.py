import functions_framework
from flask import jsonify, request
import logging
from utils import query_gemini, extract_response_text, get_cors_headers, get_gemini_api_key, query_database, format_database_response, store_feedback
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2 import id_token
import google.auth

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.http
def iss_api_query_assistant(request):
    """
    HTTP Cloud Function to handle ISS-related queries using Gemini.
    
    Args:
        request (flask.Request): The request object
        
    Returns:
        flask.Response: JSON response with the answer
    """
    # Handle CORS preflight request
    if request.method == 'OPTIONS':
        logger.info("Handling CORS preflight request")
        headers = get_cors_headers(is_preflight=True)
        return ('', 204, headers)

    try:
        # Get request data
        request_json = request.get_json(silent=True)
        logger.info(f"Received request: {request_json}")
        
        if not request_json or 'query' not in request_json:
            logger.error("No query provided in request")
            return jsonify({
                'error': 'No query provided',
                'status': 'error'
            }), 400, get_cors_headers()

        # Get the user's query
        user_query = request_json['query'].strip()
        logger.info(f"Processing query: {user_query}")
        
        if not user_query:
            logger.error("Empty query provided")
            return jsonify({
                'error': 'Empty query provided',
                'status': 'error'
            }), 400, get_cors_headers()

        # Get API key
        logger.info("Getting Gemini API key")
        api_key = get_gemini_api_key()
        
        # Query Gemini
        logger.info("Querying Gemini API")
        response = query_gemini(user_query, api_key)
        answer = extract_response_text(response)
        logger.info(f"Raw Gemini response: {answer}")
        
        # Parse the response to get the action and data
        try:
            import json
            logger.info("Parsing Gemini response")
            response_data = json.loads(answer.strip('`json\n'))
            message = response_data.get('message', '')
            action = response_data.get('action', '')
            data = response_data.get('data', {})
            logger.info(f"Parsed response - Message: {message}, Action: {action}, Data: {data}")
            
            # If this is a database query, execute it
            if action == 'query_db' and data:
                try:
                    logger.info(f"Executing database query with data: {data}")
                    # Execute the query
                    db_response = query_database(data, None)
                    logger.info(f"Database response received: {db_response}")
                    
                    # Format the response
                    db_message = db_response  # Already formatted by query_database
                    logger.info(f"Formatted database message: {db_message}")
                    
                    # Prepare the response JSON
                    response_json = {
                        "message": db_message,
                        "action": "query_db",
                        "data": data
                    }
                    logger.info(f"Preparing response JSON: {response_json}")
                    
                    # Return the database results in the main response
                    return jsonify({
                        'response': f'```json\n{json.dumps(response_json)}\n```\n',
                        'status': 'success'
                    }), 200, get_cors_headers()
                    
                except Exception as db_error:
                    logger.error(f'Database query error: {str(db_error)}')
                    logger.error(f'Error type: {type(db_error)}')
                    logger.error(f'Error args: {db_error.args}')
                    if hasattr(db_error, '__traceback__'):
                        import traceback
                        logger.error(f'Traceback: {traceback.format_exc()}')
                    
                    error_json = {
                        "message": "I encountered an issue retrieving that information. Please try again!",
                        "action": "query_db",
                        "data": data
                    }
                    logger.info(f"Preparing error response JSON: {error_json}")
                    
                    return jsonify({
                        'response': f'```json\n{json.dumps(error_json)}\n```\n',
                        'status': 'success'
                    }), 200, get_cors_headers()
            
            # If this is a feedback submission, store it
            elif action == 'store_feedback' and data:
                try:
                    logger.info(f"Attempting to store feedback: {data}")
                    store_feedback(data, None)
                    logger.info("Feedback stored successfully")
                    
                    # Return success message
                    return jsonify({
                        'response': answer,
                        'status': 'success'
                    }), 200, get_cors_headers()
                    
                except Exception as feedback_error:
                    logger.error(f'Feedback storage error: {str(feedback_error)}')
                    logger.error(f'Error type: {type(feedback_error)}')
                    logger.error(f'Error args: {feedback_error.args}')
                    if hasattr(feedback_error, '__traceback__'):
                        import traceback
                        logger.error(f'Traceback: {traceback.format_exc()}')
                    
                    error_json = {
                        "message": "I encountered an issue storing your feedback. Please try again!",
                        "action": "store_feedback",
                        "data": data
                    }
                    logger.info(f"Preparing feedback error response JSON: {error_json}")
                    
                    return jsonify({
                        'response': f'```json\n{json.dumps(error_json)}\n```\n',
                        'status': 'success'
                    }), 200, get_cors_headers()
            
            # For non-database queries, just return the AI response
            logger.info("Returning direct AI response")
            return jsonify({
                'response': answer,
                'status': 'success'
            }), 200, get_cors_headers()
            
        except Exception as parse_error:
            logger.error(f'Error parsing Gemini response: {str(parse_error)}')
            return jsonify({
                'error': 'Error processing the response',
                'status': 'error'
            }), 500, get_cors_headers()
            
    except Exception as e:
        logger.error(f'Unexpected error: {str(e)}')
        return jsonify({
            'error': 'Internal server error',
            'status': 'error'
        }), 500, get_cors_headers()
