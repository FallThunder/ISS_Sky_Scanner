"""Local smoke test for the Gemini fun-fact generator.

Calls generate_location_fun_fact() directly against Vertex AI using your
Application Default Credentials, without deploying the function.

Usage:
    gcloud auth application-default login
    pip install -r requirements.txt
    python test_local.py "Paris, France"
"""
import sys

from config import GEMINI_SETTINGS
from utils import generate_location_fun_fact


def main():
    location = sys.argv[1] if len(sys.argv) > 1 else 'Over the Pacific Ocean'
    print(f"Model: {GEMINI_SETTINGS['model']} ({GEMINI_SETTINGS['location']})")
    print(f"Location: {location}")

    fact, error_info = generate_location_fun_fact(location)
    print(f"Fact: {fact}")
    if error_info:
        print(f"Error: {error_info['error_message']}")
        print(error_info['traceback'])
        sys.exit(1)


if __name__ == '__main__':
    main()
