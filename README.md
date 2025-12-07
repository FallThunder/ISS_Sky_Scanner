# ISS Sky Scanner

A real-time International Space Station (ISS) tracking system with location history, future predictions, and AI-powered location insights. Features a web interface.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [APIs](#apis)
- [Usage](#usage)
- [Contributing](#contributing)
- [License & Credits](#license--credits)

## Features

- **Real-time ISS Tracking**: Live location updates every 5 minutes with coordinates and location names
- **Interactive History Slider**: Browse past ISS locations with a time-based slider (up to 24 hours in the past)
- **Future Position Predictions**: Predict ISS locations up to 24 hours ahead using orbital mechanics
- **Location-Based Fun Facts**: Automatically generated interesting facts about locations the ISS passes over
- **Interactive World Map**: Visualize ISS location on a dark-themed Leaflet map with world wrap support
- **Data Persistence**: Historical location data stored in Firestore for querying and analysis

## Architecture

The application should have two pages:
1. Map Page: Display the current ISS location on a map and the history of the ISS locations.
2. Metrics Page: Display the metrics of the ISS locations over the last 90 minutes.
Use buttons to switch between the pages.

### Page Specifications - Map Page:
Display the following information:
- Current ISS location on a map with a popup showing the coordinates, location name, and flag
- Location-based fun facts
- History of the ISS locations (for the last 24 hours) and future position predictions (for the next 90 minutes) on a map
- Interactive world map with world wrap support (markers on both sides of the dateline)
- Center-on-ISS button to center the map on the ISS location
- History slider to browse past locations (-24h to now to +90m)
- Navigation markers (-24h, Now, +90m) for quick jumps
- Prediction path overlay (dashed red line) to show the future position predictions

### Page Specifications - Metrics Page:
We will work on this page later. Simply create a dummy hello world page with a button to switch to the map page.

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

## Technology Stack

### Frontend
- **Languages**: HTML5, CSS3, JavaScript (ES6 modules)
- **Maps**: Leaflet.js with CartoDB dark theme
- **Icons**: Font Awesome
- **Architecture**: Modular JavaScript with classes

## Project Structure

```
ISS_Sky_Scanner/
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
└── ISS_Tracker_Call_Flow.md  # Architecture documentation
```

### Naming Conventions

- All component names begin with `iss_` prefix
- Web components: `iss_web_*`
- Files: lowercase with underscores (snake_case)
- Functions: lowercase with underscores (PEP 8)
- Classes: PascalCase

## APIs
This web front end should use the following APIs:

### Backend-for-Frontend (BFF) APIs (Public with API Keys)

1. **iss_api_query_time_range**
   - Returns data for the last 24 hours of ISS locations. 
   Example:
```bash
curl 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_time_range?minutes=1440'
```
   
2. **iss_api_bff_web**
   - Returns data for the current ISS location and fun fact
   Example:
```bash
curl 'https://iss-api-bff-web-cklav7ht2q-ue.a.run.app/?api_key=BY4FlGM1Kau2eHP6sJR9AiLuvg81ckGo'
```

3. **iss_api_bff_web_predictions**
   - Returns data for predictions made at 90, 60, and 30 minutes ago
   Example:
```bash
curl 'https://iss-api-bff-web-predictions-cklav7ht2q-ue.a.run.app/?api_key=BY4FlGM1Kau2eHP6sJR9AiLuvg81ckGo'
```

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
   - Use navigation markers (-24h, Now, +90m) for quick jumps
   - Map automatically updates when selecting historical locations

4. **Auto-refresh**: Data refreshes every 5 minutes automatically


## Contributing

### Code Style

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


### Security

- Never commit secrets or API keys
- Use environment variables or Secret Manager
- Add sensitive files to `.gitignore`
- Validate all inputs

### Pull Request Process

1. Create a feature branch
2. Follow code style guidelines
4. Update documentation as needed
5. Submit pull request with clear description

## License & Credits

### Author

**Pratyush Siva**
- GitHub: [@FallThunder](https://github.com/FallThunder)
- Portfolio: [fallthunder.github.io](https://fallthunder.github.io)

### External Services & APIs

- **Maps**: [Leaflet.js](https://leafletjs.com/) with [CartoDB](https://carto.com/)
- **Icons**: [Font Awesome](https://fontawesome.com/)


### Acknowledgments

This project demonstrates a full-stack IoT and web application using modern cloud services, AI integration, and real-time data processing. The architecture emphasizes modularity, scalability, and security best practices.

---

**Note**: I am actively seeking volunteer opportunities to contribute my software development skills. Feel free to reach out!
