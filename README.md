# ISS Sky Scanner

A real-time International Space Station (ISS) tracking system with location history, future predictions, and AI-powered location insights. Features a web interface and ESP32 hardware display.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [APIs](#apis)
- [Setup & Deployment](#setup--deployment)
- [Usage](#usage)
- [Contributing](#contributing)
- [License & Credits](#license--credits)

## Features

- **Real-time ISS Tracking**: Location stored every 5 minutes with coordinates and location names
- **Interactive History Slider**: Browse ISS locations from 24 hours in the past to 90 minutes in the future
- **Future Position Predictions**: Predict ISS locations up to 95 minutes ahead using orbital mechanics
- **Prediction Metrics**: Compare actual positions against predictions made 30, 60 and 90 minutes earlier
- **AI-Powered Chat Assistant**: Ask questions about ISS location history using Google Gemini 3.5 Flash-Lite
- **Location-Based Fun Facts**: Automatically generated interesting facts about locations the ISS passes over
- **Interactive World Map**: Visualize ISS location on a dark-themed Leaflet map with world wrap support
- **ESP32 Hardware Display**: Physical display showing ISS location and fun facts on a 16x2 RGB LCD
- **Data Persistence**: Historical location data stored in Firestore for querying and analysis

## Architecture

The system follows a microservices architecture with clear separation of concerns:

```
Cloud Scheduler (*/5 min) → Pub/Sub (iss_locator_trigger)
        ↓
iss_api_store_realtime_loc ──→ iss_api_get_realtime_loc ──→ wheretheiss.at
        │                                  │                 (fallback: TLE + SGP4)
        │                                  └──  offline reverse geocoding (Natural Earth)
        ├──→ Firestore: iss_loc_history
        └──→ iss_api_generate_predictions ──→ Firestore: iss_loc_predictions

Web app (docs/)
  ├── iss_api_bff_web ──────────→ iss_api_query_loc_history + iss_api_get_loc_fact (Gemini)
  ├── iss_api_bff_web_predictions → Firestore: iss_loc_predictions
  ├── iss_api_query_time_range ──→ Firestore: iss_loc_history
  └── iss_api_query_assistant ───→ Gemini API + iss_api_query_loc_history

ESP32 display → iss_api_bff_esp → iss_api_query_loc_history + iss_api_get_loc_fact
```

Failed location fetches are stored as error entries (`is_error_entry: true`,
null coordinates) so the history shows gaps; consumers that need a real
position query with `valid_only=true`.

### Component Breakdown

1. **Backend APIs (Google Cloud Functions)**
   - Internal APIs: Handle data fetching, storage, and processing
   - BFF APIs: Backend-for-Frontend services that aggregate data for clients
   - Query APIs: Enable complex queries on historical data
   - AI Services: Gemini-powered chat assistant and fact generation

2. **Frontend (Web App)**
   - Static HTML/CSS/JavaScript application
   - Modular ES6 JavaScript architecture
   - Real-time map updates with Leaflet
   - Interactive history slider with predictions

3. **IoT (ESP32)**
   - Arduino-based firmware using PlatformIO
   - 16x2 RGB LCD display via I2C
   - WiFi connectivity for API calls
   - Automatic timezone detection

4. **Database (Firestore)**
   - `iss_loc_history`: timestamp, coordinates, location name, country code
     (plus error entries for failed fetches)
   - `iss_loc_predictions`: one document per 5-minute source timestamp with
     19 predictions (+5 to +95 minutes)
   - `iss_sky_scanner_feedback`: user feedback

5. **AI Services (Gemini 3.5 Flash-Lite)**
   - Location fact generation
   - Natural language query processing
   - Database query generation from user questions

## Technology Stack

### Backend
- **Language**: Python 3.12 (Cloud Functions runtime `python312`)
- **Framework**: Flask (via functions-framework)
- **Platform**: Google Cloud Functions (2nd generation)
- **Authentication**: Google Cloud IAM, API keys via Secret Manager
- **Scheduling**: Cloud Scheduler + Pub/Sub

### Frontend
- **Languages**: HTML5, CSS3, JavaScript (ES6 modules)
- **Maps**: Leaflet.js with Esri dark gray canvas tiles
- **Icons**: Font Awesome
- **Architecture**: Modular JavaScript with classes

### Database
- **Platform**: Google Cloud Firestore
- **Structure**: Document-based NoSQL

### AI & External Services
- **AI Model**: Google Gemini 3.5 Flash-Lite on Vertex AI
- **ISS Data**: wheretheiss.at, with SGP4 propagation of the ARISS/CelesTrak TLE as fallback
- **Geocoding**: Offline, from Natural Earth polygons (`cloud_functions/tools/build_geodata.py`)

### IoT
- **Hardware**: ESP32 Development Board
- **Display**: 16x2 RGB LCD (I2C)
- **Framework**: PlatformIO
- **Libraries**: Grove RGB LCD, ArduinoJson

### Infrastructure
- **Cloud Provider**: Google Cloud Platform
- **Deployment**: Cloud Functions, Cloud Run
- **Secrets Management**: Google Secret Manager
- **Monitoring**: Cloud Logging

## Project Structure

```
ISS_Sky_Scanner/
├── cloud_functions/                  # Backend APIs (one deployable function per dir)
│   ├── config/                       # Shared deploy config + deploy_all_functions.sh
│   ├── tests/                        # pytest suite for the functions
│   ├── iss_api_bff_esp/              # BFF for ESP32 IoT app
│   ├── iss_api_bff_web/              # BFF for web app (location + fun fact)
│   ├── iss_api_bff_web_predictions/  # BFF for web app (predictions)
│   ├── iss_api_generate_predictions/ # Orbital mechanics predictions
│   ├── iss_api_get_loc_fact/         # Gemini fact generation
│   ├── iss_api_get_realtime_loc/     # Fetch current ISS location
│   ├── iss_api_query_assistant/      # AI chat assistant
│   ├── iss_api_query_loc_history/    # Query location history
│   ├── iss_api_query_time_range/     # Query by time range (public)
│   ├── iss_api_store_feedback/       # Store user feedback
│   └── iss_api_store_realtime_loc/   # Scheduled: store location + trigger predictions
├── docs/                             # Web frontend (GitHub Pages)
│   ├── css/                          # Stylesheets
│   ├── js/
│   │   ├── config.js                 # API configuration
│   │   ├── main.js                   # Map view: map, slider, auto-refresh
│   │   ├── locationHistory.js        # 24h history fetch/normalisation
│   │   ├── historySlider.js          # Slider component
│   │   ├── metricsTable*.js          # Metrics Tables view
│   │   ├── chat.js                   # Chat assistant (also takes feedback)
│   │   └── message.js                # Website message banner
│   └── index.html
├── iss_display_apps/
│   └── iss_esp_display/              # ESP32 display (PlatformIO)
└── ISS_Tracker_Call_Flow.md          # Call flow documentation
```

### Naming Conventions

- All component names begin with `iss_` prefix
- API names: `iss_api_*`
- Web components: `iss_web_*` (future)
- IoT components: `iss_esp_*`
- Files: lowercase with underscores (snake_case)
- Functions: lowercase with underscores (PEP 8)
- Classes: PascalCase

## APIs

The system consists of 11 independently deployable Cloud Functions:

### Internal APIs (Require Authentication)

1. **iss_api_get_realtime_loc**
   - Fetches current ISS location from wheretheiss.at (TLE/SGP4 fallback)
   - Reverse geocodes coordinates offline (Natural Earth oceans/seas, countries, states)
   - Returns timestamp, coordinates, and location details
   - [API README](cloud_functions/iss_api_get_realtime_loc/README.md)

2. **iss_api_store_realtime_loc**
   - Triggered by Pub/Sub every 5 minutes
   - Calls `iss_api_get_realtime_loc` and stores data in Firestore
   - Stores an error entry if the fetch fails
   - Then calls `iss_api_generate_predictions`
   - [API README](cloud_functions/iss_api_store_realtime_loc/README.md)

3. **iss_api_get_loc_fact**
   - Uses Gemini 3.5 Flash-Lite (Vertex AI) to generate fun facts about locations
   - Accepts location name as parameter
   - Returns formatted fact with metadata
   - [API README](cloud_functions/iss_api_get_loc_fact/README.md)

4. **iss_api_query_loc_history**
   - Queries Firestore with advanced filters
   - Supports time ranges, country codes, coordinate ranges
   - Returns filtered location history
   - [API README](cloud_functions/iss_api_query_loc_history/README.md)

5. **iss_api_query_time_range**
   - Simplified time-based query API
   - Fetches location history for specified minutes (1-1440)
   - CORS-enabled for web access
   - [API README](cloud_functions/iss_api_query_time_range/README.md)

6. **iss_api_store_feedback**
   - Stores user feedback in Firestore
   - Validates feedback data structure
   - IAM-protected (plus an API key); not callable from the browser
   - [API README](cloud_functions/iss_api_store_feedback/README.md)

7. **iss_api_generate_predictions**
   - Called by `iss_api_store_realtime_loc` after each stored location
   - Generates 19 orbital-mechanics predictions (+5 to +95 minutes)
   - Stores them in `iss_loc_predictions`
   - [API README](cloud_functions/iss_api_generate_predictions/README.md)

### Backend-for-Frontend (BFF) APIs (Public with API Keys)

8. **iss_api_bff_web**
   - Aggregates data for web application
   - Combines location data with fun facts
   - CORS-enabled, API key protected
   - [API README](cloud_functions/iss_api_bff_web/README.md)

9. **iss_api_bff_web_predictions**
   - Current (future) predictions plus predictions made 30/60/90 minutes ago
   - CORS-enabled, API key protected
   - [API README](cloud_functions/iss_api_bff_web_predictions/README.md)

10. **iss_api_bff_esp**
   - Aggregates data for ESP32 IoT display
   - Optimized response format for hardware
   - CORS-enabled, API key protected
   - [API README](cloud_functions/iss_api_bff_esp/README.md)

### AI Services

11. **iss_api_query_assistant**
   - Natural language query processing using Gemini
   - Converts questions to database queries
   - Handles feedback submissions
   - CORS-enabled
   - [API README](cloud_functions/iss_api_query_assistant/README.md)

### Authentication

- **Internal APIs**: Require Google Cloud IAM authentication (ID tokens)
- **BFF APIs**: Require API keys passed as query parameters
- **API Keys**: Stored in Google Secret Manager
- **Service Account**: Used for inter-service communication

For detailed API documentation, see individual README files in each API directory.

## Setup & Deployment

### Prerequisites

- Python 3.12+
- Google Cloud SDK (gcloud)
- Google Cloud Project with billing enabled
- Service account with appropriate permissions
- Access to required GCP APIs (see `cloud_functions/config/deployment_config.sh`)

### Required GCP APIs

```bash
# Enable required APIs
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable eventarc.googleapis.com
gcloud services enable pubsub.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable generativelanguage.googleapis.com
```

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ISS_Sky_Scanner
   ```

2. **Set up Python environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r cloud_functions/<api_name>/requirements.txt
   ```

3. **Configure environment variables**
   - Copy `iss_display_apps/iss_esp_display/include/secrets.h.example` to `secrets.h`
   - Update API keys and credentials
   - Set `GOOGLE_APPLICATION_CREDENTIALS` for local testing

4. **Run locally**
   ```bash
   cd cloud_functions/<api_name>
   functions-framework --target <function_name> --debug
   ```

5. **Run the unit tests**
   ```bash
   pip install -r cloud_functions/tests/requirements-dev.txt \
       $(for f in cloud_functions/iss_api_*/requirements.txt; do echo -r $f; done)
   pytest cloud_functions/tests              # all tests
   pytest cloud_functions/tests -m "not network"   # skip live-API tests
   ```

6. **Test deployed endpoints**
   ```bash
   ./test_function.sh
   ```

### GCP Deployment

1. **Configure deployment settings**
   ```bash
   source cloud_functions/config/deployment_config.sh
   ```

2. **Deploy individual APIs**
   ```bash
   cd cloud_functions/<api_name>
   ./deploy.sh
   ```

   Or deploy everything (project setup once, then two parallel waves):
   ```bash
   ./cloud_functions/config/deploy_all_functions.sh
   ./cloud_functions/config/deploy_all_functions.sh iss_api_bff_web   # a subset
   ```

   Project-wide setup (APIs, IAM roles, Firestore indexes) lives in
   `cloud_functions/config/setup_project.sh`; it is idempotent.

3. **Set up Pub/Sub trigger** (for `iss_api_store_realtime_loc`)
   ```bash
   # Create Pub/Sub topic
   gcloud pubsub topics create iss_locator_trigger
   
   # Create Cloud Scheduler job (runs every 5 minutes)
   gcloud scheduler jobs create pubsub iss-location-scheduler \
     --schedule="*/5 * * * *" \
     --topic=iss_locator_trigger \
     --message-body='{"trigger": "scheduled"}'
   ```

4. **Store secrets in Secret Manager**
   ```bash
   echo -n "your-api-key" | gcloud secrets create iss-sky-scanner-web-api-key --data-file=-
   echo -n "your-api-key" | gcloud secrets create iss-sky-scanner-esp-api-key --data-file=-
   echo -n "your-api-key" | gcloud secrets create iss-feedback-api-key --data-file=-
   ```

5. **Deploy web frontend**
   - Upload `docs/` directory to Cloud Storage or hosting service
   - Update `docs/js/config.js` with deployed API URLs

### Environment Variables & Secrets

All sensitive data is stored in Google Secret Manager:
- `iss-sky-scanner-web-api-key`: API key for web BFF
- `iss-sky-scanner-esp-api-key`: API key for ESP32 BFF
- `iss-feedback-api-key`: API key for the feedback function

Service accounts are used for inter-service authentication. The fun-fact
and chat functions call Gemini through Vertex AI with the service account
(`roles/aiplatform.user`), so they need no API key.

## Usage

### Web Application

1. Open `docs/index.html` in a web browser (or deploy to a web server)
2. The application automatically:
   - Fetches current ISS location
   - Displays location on interactive map
   - Shows fun fact about the location
   - Loads location history
   - Generates future predictions

3. **Interactive Features**:
   - Use the history slider to browse locations from -24h to +90m (predictions)
   - Use navigation markers (-24h, Now, +90m) and step buttons for quick jumps
   - Switch to the **Metrics Tables** tab to compare actual positions with earlier predictions
   - Click chat button for AI assistant
   - Map automatically updates when selecting historical locations

4. **Auto-refresh**: Data refreshes every 5 minutes automatically

### ESP32 Display

1. **Hardware Setup**:
   - Connect ESP32 to Grove Base Shield v2
   - Connect 16x2 RGB LCD to I2C port on Grove Shield
   - Connect Grove Shield to ESP32 (5V, GND, SDA→GPIO21, SCL→GPIO22)

2. **Software Setup**:
   ```bash
   cd iss_display_apps/iss_esp_display
   # Copy and configure secrets.h
   cp include/secrets.h.example include/secrets.h
   # Edit include/secrets.h with your credentials
   ```

3. **Build and Upload**:
   ```bash
   # Using PlatformIO CLI
   pio run --target upload
   
   # Or using VS Code PlatformIO extension
   # Click "Upload" in PlatformIO toolbar
   ```

4. **Monitor**:
   ```bash
   pio device monitor
   ```

5. **Display Features**:
   - Line 1: Current location and local time
   - Line 2: Fun fact about the location
   - RGB backlight indicates status:
     - Green: Successful update
     - White: Normal operation
     - Red: WiFi error
     - Blue: API error
   - Updates every 5 minutes

### API Usage Examples

**Web BFF API**:
```bash
curl "https://your-bff-url?api_key=your-api-key"
```

**Query Location History**:
```bash
curl "https://your-api-url/iss_api_query_time_range?minutes=60"
```

**Chat Assistant**:
```bash
curl -X POST "https://your-api-url/iss_api_query_assistant" \
  -H "Content-Type: application/json" \
  -d '{"query": "When was the ISS last over France?"}'
```

## Contributing

### Code Style

- **Python**: Follow PEP 8 guidelines
  - 4 spaces per indentation level
  - Maximum 79 characters per line (code), 72 for comments
  - Use snake_case for functions and variables
  - Use PascalCase for classes
  - Include docstrings for all public functions

- **JavaScript**: Follow ES6 module patterns
  - Use classes for complex components
  - Modular file structure
  - Descriptive variable names
  - Comment complex logic

### Naming Conventions

- All components must start with `iss_` prefix
- Files: lowercase with underscores
- Functions: lowercase with underscores
- Classes: PascalCase
- Constants: UPPER_CASE

### Project Structure Guidelines

- Keep `main.py` files lightweight
- Place utility functions in `utils.py`
- Include comprehensive docstrings
- Implement proper error handling
- Use early returns for error conditions
- Log all errors with context

### Testing

- Write unit tests for all functions
- Include test scripts (`test_function.sh`) for APIs
- Test both success and error cases
- Use descriptive test function names

### Security

- Never commit secrets or API keys
- Use environment variables or Secret Manager
- Add sensitive files to `.gitignore`
- Validate all inputs
- Use proper authentication for APIs

### Pull Request Process

1. Create a feature branch
2. Follow code style guidelines
3. Add tests for new functionality
4. Update documentation as needed
5. Ensure all tests pass
6. Submit pull request with clear description

## License & Credits

### Author

**Pratyush Siva**
- GitHub: [@FallThunder](https://github.com/FallThunder)
- Portfolio: [fallthunder.github.io](https://fallthunder.github.io)

### External Services & APIs

- **ISS Location Data**: [Where the ISS at?](https://wheretheiss.at/), TLEs from [ARISS](https://live.ariss.org/) and [CelesTrak](https://celestrak.org/)
- **Reverse Geocoding**: [Natural Earth](https://www.naturalearthdata.com/) (public domain)
- **AI Model**: [Google Gemini](https://ai.google.dev/)
- **Maps**: [Leaflet.js](https://leafletjs.com/) with [Esri](https://www.esri.com/) tiles
- **Icons**: [Font Awesome](https://fontawesome.com/)

### Infrastructure

- **Cloud Platform**: Google Cloud Platform
- **Database**: Google Cloud Firestore
- **Functions**: Google Cloud Functions (2nd generation)
- **Secrets**: Google Secret Manager

### Acknowledgments

This project demonstrates a full-stack IoT and web application using modern cloud services, AI integration, and real-time data processing. The architecture emphasizes modularity, scalability, and security best practices.

---

**Note**: I am actively seeking volunteer opportunities to contribute my software development skills. Feel free to reach out!
