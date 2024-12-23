import functions_framework
from flask import jsonify, request
from utils import generate_location_fun_fact

@functions_framework.http
def iss_api_get_loc_fact(request):
    """Generates location-based fun facts.
    Args:
        request (flask.Request): The request object with location parameter.
    Returns:
        JSON: Returns a fun fact about the provided location.
    """
    try:
        # Get location from request parameters
        location = request.args.get('location', '')
        if not location:
            return jsonify({
                "error": "Location parameter is required",
                "status": "error"
            }), 400

        # Generate fact for current location
        fun_fact, error_info = generate_location_fun_fact(location)

        # Prepare response
        response_data = {
            'location': location,
            'fact': fun_fact,
            'status': 'success',
            'version': '1.0'
        }
        if error_info:
            response_data['debug'] = error_info

        return jsonify(response_data)

    except Exception as err:
        print(f"An error occurred: {err}")
        return jsonify({
            "error": str(err),
            "status": "error"
        }), 500
