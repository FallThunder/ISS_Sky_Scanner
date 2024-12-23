/*
 * ISS Location Display for ESP32
 * =============================
 * 
 * This sketch runs on an ESP32 with an LCD display to show the current location
 * of the International Space Station (ISS) and interesting facts about the location.
 * 
 * Hardware Requirements:
 * - ESP32 Development Board
 * - RGB LCD Display (I2C)
 * 
 * Features:
 * - Connects to WiFi and fetches ISS location data every 5 minutes
 * - Displays location and facts on a 16x2 LCD screen
 * - Handles scrolling text for long messages
 * - Automatically detects and configures timezone
 * - Visual feedback through RGB LED
 * 
 * Dependencies:
 * - Wire.h: I2C communication
 * - rgb_lcd.h: LCD control
 * - WiFi.h: Network connectivity
 * - HTTPClient.h: API requests
 * - ArduinoJson.h: JSON parsing
 * - time.h: Time management
 * 
 * Author: Pratyush Siva
 * Project: ISS Sky Scanner
 * Created: December 2024
 */

#include <Wire.h>
#include <rgb_lcd.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"
#include <time.h>

// Function declarations
void updateISSData();
void displayScrollingData(String line1, String line2);
String convertToLocalTime(String utcString);
String getPosixTZ(String timezone);
void configureTimezone();
String normalizeString(String input);
void blinkGreen();

// Create an lcd object
rgb_lcd lcd;

// Default I2C pins for ESP32
#define I2C_SDA 21
#define I2C_SCL 22

// WiFi credentials
const char* ssid = WIFI_SSID;
const char* password = WIFI_PASSWORD;

// API configuration
const char* apiEndpoint = "https://iss-api-bff-esp-768423610307.us-east1.run.app/";
const char* apiKey = API_KEY;
const char* geoApiEndpoint = "http://ip-api.com/json/";  // Free IP geolocation service

// Update interval (in milliseconds)
const unsigned long updateInterval = 300000; // 5 minutes
unsigned long lastUpdate = 0;

// Global variables for display text
String currentLine1 = "Waiting for";
String currentLine2 = "ISS data...";

// Add these constants after other configurations
const char* ntpServer = "pool.ntp.org";

// Add at the top with other constants
const int NORMAL_BRIGHTNESS = 105;  // Reduced brightness for normal operation (0-255)
unsigned long lastBlinkTime = 0;
bool blinkState = false;

// Function to convert UTC string to local time string
String convertToLocalTime(String utcString) {
    char local_time[9];  // HH:MM:SS + null terminator
    
    // Get current local time
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)){
        Serial.println("Failed to obtain time");
        return "??:??:??";
    }
    
    // Format as HH:MM:SS
    strftime(local_time, sizeof(local_time), "%H:%M:%S", &timeinfo);
    return String(local_time);
}

// Function to convert timezone name to POSIX format
String getPosixTZ(String timezone) {
    // Common US timezone conversions
    if (timezone == "America/New_York") return "EST5EDT,M3.2.0,M11.1.0";
    if (timezone == "America/Chicago") return "CST6CDT,M3.2.0,M11.1.0";
    if (timezone == "America/Denver") return "MST7MDT,M3.2.0,M11.1.0";
    if (timezone == "America/Los_Angeles") return "PST8PDT,M3.2.0,M11.1.0";
    if (timezone == "America/Phoenix") return "MST7";  // No DST
    if (timezone == "America/Anchorage") return "AKST9AKDT,M3.2.0,M11.1.0";
    if (timezone == "Pacific/Honolulu") return "HST10";  // No DST
    return "EST5EDT,M3.2.0,M11.1.0";  // Default to EST if unknown
}

/**
 * Configures the device's timezone based on IP geolocation
 * Uses ip-api.com to determine location and sets system time accordingly
 */
void configureTimezone() {
    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        
        Serial.println("Getting timezone from IP location...");
        http.begin(geoApiEndpoint);
        
        int httpResponseCode = http.GET();
        
        if (httpResponseCode == 200) {
            String payload = http.getString();
            Serial.println("Geolocation response: " + payload);
            
            StaticJsonDocument<512> doc;
            DeserializationError error = deserializeJson(doc, payload);
            
            if (!error) {
                String timezone = doc["timezone"].as<String>();
                String posixTZ = getPosixTZ(timezone);
                Serial.println("Detected timezone: " + timezone);
                Serial.println("POSIX timezone: " + posixTZ);
                
                // Configure timezone and NTP
                configTzTime(posixTZ.c_str(), ntpServer);
                
                // Wait for time sync
                Serial.println("Waiting for NTP time sync...");
                while (time(nullptr) < 1000000000) {
                    delay(100);
                    Serial.print(".");
                }
                Serial.println("\nTime synchronized!");
                
                // Print current time to verify
                struct tm timeinfo;
                if(getLocalTime(&timeinfo)){
                    Serial.print("Current local time: ");
                    Serial.printf("%02d:%02d:%02d\n", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
                }
            }
        }
        http.end();
    }
}

/**
 * Converts accented characters to their unaccented equivalents
 * @param input The string containing possible accented characters
 * @return The normalized string with accents removed
 */
String normalizeString(String input) {
    // Common UTF-8 accent replacements
    struct {
        const char* accented;
        char unaccented;
    } replacements[] = {
        {"á", 'a'}, {"à", 'a'}, {"ã", 'a'}, {"â", 'a'}, {"ä", 'a'},
        {"é", 'e'}, {"è", 'e'}, {"ê", 'e'}, {"ë", 'e'},
        {"í", 'i'}, {"ì", 'i'}, {"î", 'i'}, {"ï", 'i'},
        {"ó", 'o'}, {"ò", 'o'}, {"õ", 'o'}, {"ô", 'o'}, {"ö", 'o'},
        {"ú", 'u'}, {"ù", 'u'}, {"û", 'u'}, {"ü", 'u'},
        {"ý", 'y'}, {"ÿ", 'y'},
        {"ñ", 'n'},
        {NULL, 0}
    };
    
    String normalized = input;  // Remove toLowerCase() call
    
    // Replace each accented sequence with its unaccented equivalent
    for (int i = 0; replacements[i].accented != NULL; i++) {
        // Handle lowercase
        normalized.replace(replacements[i].accented, String(replacements[i].unaccented));
        
        // Handle uppercase
        String upperAccented = String(replacements[i].accented);
        upperAccented.toUpperCase();
        normalized.replace(upperAccented, String(toupper(replacements[i].unaccented)));
    }
    
    return normalized;
}

/**
 * Provides visual feedback by blinking the LCD backlight green
 * Used to indicate successful data updates
 */
void blinkGreen() {
    unsigned long currentTime = millis();
    if (currentTime - lastBlinkTime >= 500) {  // Blink every 500ms
        blinkState = !blinkState;
        if (blinkState) {
            lcd.setRGB(0, 255, 0);
        } else {
            lcd.setRGB(0, 0, 0);
        }
        lastBlinkTime = currentTime;
    }
}

/**
 * Initial setup of the ESP32 device
 * Configures I2C, LCD, WiFi, timezone, and performs initial data fetch
 */
void setup() {
    // Initialize Serial first for debugging
    Serial.begin(115200);
    Serial.println("Starting setup...");

    // Initialize I2C communication
    Wire.begin(I2C_SDA, I2C_SCL);
    Serial.println("I2C initialized");

    // Initialize the LCD
    lcd.begin(16, 2);
    Serial.println("LCD initialized");
    lcd.print("Starting up..."); 

    // Set green for setup phase
    lcd.setRGB(0, 255, 0);

    // Connect to WiFi
    Serial.print("Connecting to WiFi");
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(100);
        Serial.print(".");
    }
    Serial.println("\nConnected to WiFi");

    // Configure timezone
    Serial.println("Configuring timezone...");
    configureTimezone();

    // Initial data fetch
    Serial.println("Fetching initial ISS data...");
    updateISSData();

    // Set to dim white for normal operation
    lcd.setRGB(NORMAL_BRIGHTNESS, NORMAL_BRIGHTNESS, NORMAL_BRIGHTNESS);
}

/**
 * Main program loop
 * Handles periodic ISS data updates and display refreshes
 */
void loop() {
    // Check if it's time to update
    unsigned long currentTime = millis();
    if (currentTime - lastUpdate >= updateInterval) {
        updateISSData();
        lastUpdate = currentTime;
    }
    
    // Update display every 450ms for scrolling
    static unsigned long lastScrollUpdate = 0;
    if (currentTime - lastScrollUpdate >= 450) {
        displayScrollingData(currentLine1, currentLine2);
        lastScrollUpdate = currentTime;
    }
}

/**
 * Fetches and processes ISS location data from the API
 * Updates global display variables with new data
 * Provides visual feedback for successful/failed updates
 */
void updateISSData() {
    Serial.println("Updating ISS data...");
    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        
        // Create the URL with API key
        String url = String(apiEndpoint) + "?api_key=" + apiKey;
        Serial.print("Connecting to: ");
        Serial.println(url);
        
        http.begin(url);
        // Add timeout settings
        http.setTimeout(10000);  // 10 second timeout
        
        // Add headers to handle 411 error
        http.addHeader("Content-Length", "0");
        http.addHeader("Connection", "close");
        
        int retry = 0;
        int httpResponseCode;
        
        // Try up to 3 times
        while (retry < 3) {
            httpResponseCode = http.GET();
            
            if (httpResponseCode == 200) {
                break;  // Success! Exit the retry loop
            }
            
            Serial.printf("Attempt %d failed with code: %d\n", retry + 1, httpResponseCode);
            if (httpResponseCode == 411) {
                Serial.println("411 Length Required error - check headers");
            }
            delay(1000);  // Wait a second before retrying
            retry++;
        }
        
        if (httpResponseCode == 200) {
            // Success - set backlight to dim white
            lcd.setRGB(NORMAL_BRIGHTNESS, NORMAL_BRIGHTNESS, NORMAL_BRIGHTNESS);
            
            String payload = http.getString();
            Serial.println("Received payload: " + payload);
            
            StaticJsonDocument<512> doc;
            DeserializationError error = deserializeJson(doc, payload);
            
            if (!error) {
                String funFact = doc["fun_fact"].as<String>();
                // Normalize the city name to remove accents while preserving base characters
                String nearestCity = normalizeString(doc["location_details"].as<String>());
                String utcTime = doc["timestamp"].as<String>();
                String localTime = convertToLocalTime(utcTime);
                
                Serial.println("Location: " + nearestCity);
                Serial.println("Fun fact: " + funFact);
                
                currentLine1 = "ISS: " + nearestCity + " @ " + localTime;
                currentLine2 = "Fact: " + funFact;
            }
        } else {
            Serial.printf("Error in HTTP request after %d attempts\n", retry);
            // Set backlight to blue for API error
            lcd.setRGB(0, 0, 255);
            
            // Update display with error message
            currentLine1 = "API Error";
            currentLine2 = "Retrying soon...";
            
            // Force an immediate display update
            lcd.clear();
            lcd.setCursor(0, 0);
            lcd.print(currentLine1);
            lcd.setCursor(0, 1);
            lcd.print(currentLine2);
        }
        
        http.end();
    } else {
        Serial.println("WiFi not connected");
        // Set backlight to red for WiFi error
        lcd.setRGB(255, 0, 0);
        
        // Try to reconnect to WiFi
        WiFi.disconnect();
        delay(1000);
        WiFi.begin(ssid, password);
        
        // Update display with WiFi status
        currentLine1 = "WiFi Error";
        currentLine2 = "Reconnecting...";
        
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print(currentLine1);
        lcd.setCursor(0, 1);
        lcd.print(currentLine2);
    }
}

// Function to update the display with scrolling data
void displayScrollingData(String line1, String line2) {
    // Clear any previous content
    lcd.clear();
    
    static int position = 0;  // Make position static to maintain state between calls
    int line1_length = line1.length();
    int line2_length = line2.length();
    
    // Display current window of text for line 1
    lcd.setCursor(0, 0);
    String currentText1 = line1.substring(position, min(position + 16, line1_length));
    lcd.print(currentText1);
    
    // Display current window of text for line 2
    lcd.setCursor(0, 1);
    String currentText2 = line2.substring(position, min(position + 16, line2_length));
    lcd.print(currentText2);
    
    // Increment position
    position++;
    
    // Reset position when the last character of the longer string enters the display
    if (position > max(line1_length, line2_length) - 16) {
        position = 0;
        delay(1000);  // Pause at the end before restarting
    }
}
