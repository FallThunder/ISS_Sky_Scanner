# ISS Location Display (ESP32)

This Arduino sketch runs on an ESP32 microcontroller to display the current location of the International Space Station (ISS) along with interesting facts about the location it's flying over.

## Hardware Requirements

- ESP32 Development Board
- 16x2 RGB LCD Display (I2C)
- Seeed Grove Base Shield v2
- Grove 4-pin I2C cable

## Hardware Setup

1. **LCD to Grove Shield**
   - Connect the LCD display to any I2C port on the Grove Shield using the 4-pin Grove cable

2. **Grove Shield to ESP32**
   - 5V → 5V
   - GND → GND
   - SDA → GPIO21
   - SCL → GPIO22

Note: The Grove Shield simplifies connections and protects against wiring errors. The shield handles the proper routing of I2C signals between the LCD and ESP32.

## Development Environment

This project uses PlatformIO for development. You can either:

1. **Use VS Code with PlatformIO**:
   - Install VS Code
   - Install PlatformIO IDE extension
   - Open this folder directly
   - Use PlatformIO toolbar for build/upload

2. **Use VS Code Tasks** (from any folder):
   - Cmd+Shift+P → "Tasks: Run Task"
   - Choose:
     - "PlatformIO: Build ESP Display"
     - "PlatformIO: Upload ESP Display"
     - "PlatformIO: Monitor ESP Display"

## Initial Setup

1. **Configuration**
   - Copy `include/secrets.h.example` to `include/secrets.h`
   - Update with your credentials:
     ```cpp
     #define WIFI_SSID "your_wifi_ssid"
     #define WIFI_PASSWORD "your_wifi_password"
     #define API_KEY "your_iss_bff_esp_api_key"  // From ISS BFF ESP service
     ```

2. **Dependencies**
   PlatformIO will automatically install:
   - Grove RGB LCD Library
   - ArduinoJson
   - ESP32 Core Libraries

## Features

- Real-time ISS location tracking
- Location-based interesting facts
- Automatic timezone detection
- Scrolling display for long text
- Visual feedback through RGB backlight:
  - Green: Successful update
  - White (105 brightness): Normal operation
  - Red: WiFi error
  - Blue: API error

## Operation

The display shows:
- Line 1: ISS location and local time
- Line 2: Interesting fact about the location

Update Intervals:
- ISS data: Every 5 minutes
- Display scroll: Every 450ms
- End-of-scroll pause: 1 second

## Troubleshooting

1. **Display Issues**
   - Check Grove Shield connections
   - Verify I2C pins (21, 22)
   - Check LCD backlight indicators

2. **Network Issues**
   - Verify WiFi credentials
   - Check API key
   - Monitor Serial output (115200 baud)

3. **Data Issues**
   - Check Serial Monitor for API responses
   - Verify JSON parsing output
   - Check timezone detection

## Contributing

1. Follow naming conventions:
   - Files start with "iss_"
   - Clear, descriptive variable names
   - Function names indicate action

2. Code Style:
   - Comment all functions
   - Document parameters and return values
   - Keep functions focused and small
   - Use constants for configuration

## Security

- Credentials stored in `secrets.h` (gitignored)
- API key required for data access
- HTTPS for API communication
- Limited retry attempts

## Related Components

- Backend API: `iss_api_bff_esp`
- Web Interface: `iss_web_display`
- Configuration: `secrets.h`
