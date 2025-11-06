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

- **Real-time ISS Tracking**: Live location updates every 5 minutes with coordinates and location names
- **Interactive History Slider**: Browse past ISS locations with a time-based slider (up to 24 hours in the past)
- **Future Position Predictions**: Predict ISS locations up to 24 hours ahead using orbital mechanics
- **AI-Powered Chat Assistant**: Ask questions about ISS location history using Google Gemini 1.5 Flash
- **Location-Based Fun Facts**: Automatically generated interesting facts about locations the ISS passes over
- **Interactive World Map**: Visualize ISS location on a dark-themed Leaflet map with world wrap support
- **ESP32 Hardware Display**: Physical display showing ISS location and fun facts on a 16x2 RGB LCD
- **Data Persistence**: Historical location data stored in Firestore for querying and analysis

## Architecture

The system follows a microservices architecture with clear separation of concerns:

```
ISS Public API → iss_api_get_realtime_loc → iss_api_store_realtime_loc → Firestore
                                                      ↓
                                            (Every 5 minutes via Pub/Sub)
                                                      ↓
                                    iss_api_get_last_stored_loc ← iss_api_get_loc_fact
                                                      ↓
                                    ┌─────────────────┴─────────────────┐
                                    ↓                                   ↓
                            iss_api_bff_web                    iss_api_bff_esp
                                    ↓                                   ↓
                              Web Interface                    ESP32 Display
```

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
   - Collection: `iss_loc_history`
   - Stores timestamp, coordinates, location details, country codes
   - Enables historical queries and analysis

5. **AI Services (Gemini 1.5 Flash)**
   - Location fact generation
   - Natural language query processing
   - Database query generation from user questions

## Technology Stack

### Backend
- **Language**: Python 3.10
- **Framework**: Flask (via functions-framework)
- **Platform**: Google Cloud Functions (2nd generation)
- **Authentication**: Google Cloud IAM, API keys via Secret Manager
- **Scheduling**: Cloud Scheduler + Pub/Sub

### Frontend
- **Languages**: HTML5, CSS3, JavaScript (ES6 modules)
- **Maps**: Leaflet.js with CartoDB dark theme
- **Icons**: Font Awesome
- **Architecture**: Modular JavaScript with classes

### Database
- **Platform**: Google Cloud Firestore
- **Structure**: Document-based NoSQL

### AI & External Services
- **AI Model**: Google Gemini 1.5 Flash
- **ISS Data**: Open Notify API
- **Geocoding**: BigDataCloud Reverse Geocoding API

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
├── cloud_functions/          # Backend APIs
│   ├── config/                # Deployment configuration
│   ├── iss_api_bff_esp/       # BFF for ESP32 IoT app
│   ├── iss_api_bff_web/       # BFF for web app
│   ├── iss_api_get_loc_fact/  # Gemini fact generation
│   ├── iss_api_get_realtime_loc/  # Fetch current ISS location
│   ├── iss_api_query_assistant/   # AI chat assistant
│   ├── iss_api_query_loc_history/ # Query location history
│   ├── iss_api_query_time_range/  # Query by time range
│   ├── iss_api_store_feedback/    # Store user feedback
│   └── iss_api_store_realtime_loc/ # Store location in Firestore
├── docs/                      # Web frontend
│   ├── assets/               # Images and icons
│   ├── css/                  # Stylesheets
│   ├── js/                   # JavaScript modules
│   │   ├── config.js         # API configuration
│   │   ├── main.js           # Main application logic
│   │   ├── chat.js           # Chat widget
│   │   ├── locationHistory.js # History management
│   │   ├── historySlider.js  # Slider component
│   │   ├── issPrediction.js  # Orbital prediction
│   │   └── message.js        # Message handling
│   └── index.html            # Main HTML file
├── iss_display_apps/         # IoT applications
│   └── iss_esp_display/      # ESP32 display app
│       ├── src/              # Source code
│       ├── include/          # Headers (secrets.h)
│       └── platformio.ini    # PlatformIO config
└── ISS_Tracker_Call_Flow.md  # Architecture documentation
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

The system consists of 10 independently deployable Cloud Functions:

### Internal APIs (Require Authentication)

1. **iss_api_get_realtime_loc**
   - Fetches current ISS location from Open Notify API
   - Reverse geocodes coordinates using BigDataCloud
   - Returns timestamp, coordinates, and location details
   - [API README](cloud_functions/iss_api_get_realtime_loc/README.md)

2. **iss_api_store_realtime_loc**
   - Triggered by Pub/Sub every 5 minutes
   - Calls `iss_api_get_realtime_loc` and stores data in Firestore
   - Handles location data persistence
   - [API README](cloud_functions/iss_api_store_realtime_loc/README.md)

3. **iss_api_get_loc_fact**
   - Uses Gemini 1.5 Flash to generate fun facts about locations
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
   - CORS-enabled with API key protection
   - [API README](cloud_functions/iss_api_store_feedback/README.md)

### Backend-for-Frontend (BFF) APIs (Public with API Keys)

7. **iss_api_bff_web**
   - Aggregates data for web application
   - Combines location data with fun facts
   - CORS-enabled, API key protected
   - [API README](cloud_functions/iss_api_bff_web/README.md)

8. **iss_api_bff_esp**
   - Aggregates data for ESP32 IoT display
   - Optimized response format for hardware
   - CORS-enabled, API key protected
   - [API README](cloud_functions/iss_api_bff_esp/README.md)

### AI Services

9. **iss_api_query_assistant**
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

- Python 3.10+
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

5. **Test endpoints**
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

3. **Set up Pub/Sub trigger** (for `iss_api_store_realtime_loc`)
   ```bash
   # Create Pub/Sub topic
   gcloud pubsub topics create iss-location-updates
   
   # Create Cloud Scheduler job (runs every 5 minutes)
   gcloud scheduler jobs create pubsub iss-location-scheduler \
     --schedule="*/5 * * * *" \
     --topic=iss-location-updates \
     --message-body='{"trigger": "scheduled"}'
   ```

4. **Store secrets in Secret Manager**
   ```bash
   echo -n "your-api-key" | gcloud secrets create iss-sky-scanner-web-api-key --data-file=-
   echo -n "your-api-key" | gcloud secrets create iss-sky-scanner-esp-api-key --data-file=-
   echo -n "your-gemini-key" | gcloud secrets create gemini-api-key --data-file=-
   ```

5. **Deploy web frontend**
   - Upload `docs/` directory to Cloud Storage or hosting service
   - Update `docs/js/config.js` with deployed API URLs

### Environment Variables & Secrets

All sensitive data is stored in Google Secret Manager:
- `iss-sky-scanner-web-api-key`: API key for web BFF
- `iss-sky-scanner-esp-api-key`: API key for ESP32 BFF
- `gemini-api-key`: Google Gemini API key

Service accounts are used for inter-service authentication.

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
   - Use the history slider to browse past locations (-24h to now)
   - Use navigation markers (-24h, Now, +24h) for quick jumps
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

- **ISS Location Data**: [Open Notify API](http://api.open-notify.org/)
- **Reverse Geocoding**: [BigDataCloud API](https://www.bigdatacloud.com/)
- **AI Model**: [Google Gemini 1.5 Flash](https://ai.google.dev/)
- **Maps**: [Leaflet.js](https://leafletjs.com/) with [CartoDB](https://carto.com/)
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

