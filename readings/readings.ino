#include <WiFiManager.h>       // WiFiManager library
#include <HTTPClient.h>        // HTTP Client for Firebase REST API
#include <ArduinoJson.h>       // JSON formatter
#include <PZEM004Tv30.h>       // PZEM004Tv30 library
#include <time.h>              // Time synchronization
#include "freertos/semphr.h"   // FreeRTOS semaphore for synchronization
#include <WiFi.h>              // ESP32 WiFi library
#include <Wire.h>              // I2C library for OLED
#include <Adafruit_GFX.h>      // Graphics library
#include <Adafruit_SSD1306.h>  // OLED display library

// Firebase REST API Configuration
#define FIREBASE_URL ""
#define FIREBASE_AUTH ""

// PZEM004Tv30 configuration
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

// OLED Display configuration
#define SCREEN_WIDTH 128      // OLED display width, in pixels
#define SCREEN_HEIGHT 64      // OLED display height, in pixels
#define OLED_RESET    -1      // Reset pin # (or -1 if sharing Arduino reset pin)
#define SCREEN_ADDRESS 0x3C   // Default I2C address for 0.96" OLED (Check your display, could also be 0x3D)
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Time configuration
const long gmtOffset_sec = 28800;  // GMT+8 (Philippines)
const int daylightOffset_sec = 0;

// Sensor Network Credentials
const String nodeCode = "C-4";
const String location = "Cebu City, Cebu";

// Shared variables (protected by mutex)
float voltage, current, power, frequency, pf;
char dateString[20], timeString[20];
unsigned long lastReadingTime = 0;
const unsigned long timeoutInterval = 120000;

// Mutex for synchronization
SemaphoreHandle_t dataMutex;

// Function to connect to WiFi
void connectWiFi() {
    WiFiManager wm;
    
    if (WiFi.SSID() == "") {
        Serial.println("No saved WiFi credentials, starting WiFiManager...");
        
        unsigned long startMillis = millis(); // Start time tracking
        wm.setConfigPortalTimeout(120); // Set WiFiManager timeout to 2 minutes (120 seconds)
        
        if (!wm.autoConnect("ESP32_WiFiManager")) {
            Serial.println("WiFiManager timed out! Restarting...");
            ESP.restart();
        }
    } else {
        Serial.println("Connecting to saved WiFi...");
        WiFi.begin();
        WiFi.setAutoReconnect(true);
        WiFi.persistent(true);

        int attempts = 0;
        while (WiFi.status() != WL_CONNECTED) {
            Serial.print(".");
            delay(500);
            attempts++;

            // If it takes longer than 2 minutes, restart
            if (attempts >= 240) { // 240 * 500ms = 120 seconds
                Serial.println("\nWiFi connection timeout! Restarting...");
                ESP.restart();
            }
        }

        Serial.println("\nWiFi Connected!");
    }
}

// Function to initialize OLED display
void initOLED() {
    // SSD1306_SWITCHCAPVCC = generate display voltage from 3.3V internally
    if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
        Serial.println(F("SSD1306 allocation failed"));
        for(;;); // Don't proceed, loop forever
    }
    
    // Initial display setup
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(F("Power Meter"));
    display.println(F("Initializing..."));
    display.print(F("Node: "));
    display.println(nodeCode);
    display.print(F("Location: "));
    display.println(location);
    display.display();
    delay(2000); // Show the splash screen for 2 seconds
}

// Function to handle WiFi auto-reconnect
void checkWiFi() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi disconnected! Reconnecting...");
        WiFi.disconnect();
        WiFi.reconnect();
    }
}

void setup() {
    Serial.begin(115200);
    
    // Initialize I2C for OLED
    Wire.begin(); // Default SDA=21, SCL=22 on ESP32
    
    // Initialize OLED display
    initOLED();
    
    connectWiFi();
    configTime(gmtOffset_sec, daylightOffset_sec, "pool.ntp.org", "time.nist.gov");

    struct tm timeinfo;
    while (!getLocalTime(&timeinfo)) {
        Serial.println("Failed to obtain time. Retrying...");
        delay(500);
    }
    Serial.println("Time synchronized successfully!");

    // Create mutex
    dataMutex = xSemaphoreCreateMutex();

    // Create FreeRTOS Tasks
    xTaskCreatePinnedToCore(TaskReadSensor, "TaskReadSensor", 4096, NULL, 2, NULL, 0);
    xTaskCreatePinnedToCore(TaskSendToFirebase, "TaskSendToFirebase", 8192, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(TaskCheckWiFi, "TaskCheckWiFi", 2048, NULL, 1, NULL, 0);
    xTaskCreatePinnedToCore(TaskUpdateOLED, "TaskUpdateOLED", 4096, NULL, 2, NULL, 1);
}

void loop() {
    // FreeRTOS handles tasks, nothing needed here.
}

// Task 1: Read Sensor Data Every 1 Second
void TaskReadSensor(void *pvParameters) {
    while (1) {
        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            xSemaphoreTake(dataMutex, portMAX_DELAY);
            sprintf(dateString, "%04d/%02d/%02d", 
                    timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday );
            sprintf(timeString, "%02d:%02d:%02d", 
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
            xSemaphoreGive(dataMutex);
        } else {
            Serial.println("Failed to get time.");
        }

        xSemaphoreTake(dataMutex, portMAX_DELAY);
        voltage = pzem.voltage();
        current = pzem.current();
        power = pzem.power();
        frequency = pzem.frequency();
        pf = pzem.pf();
        xSemaphoreGive(dataMutex);

        if (!isnan(voltage) && !isnan(current) && !isnan(power) && 
            !isnan(frequency) && !isnan(pf)) {
            lastReadingTime = millis();  // Update last successful reading time
        }

        Serial.printf("V: %.2fV | I: %.2fA | P: %.2fW | F: %.2fHz | PF: %.4f\n", 
                      voltage, current, power, frequency, pf);

        // Check if no readings have been received for more than 2 minutes
        if (millis() - lastReadingTime > timeoutInterval) {
            Serial.println("❌ No sensor readings received for 2 minutes! Restarting...");
            ESP.restart(); // Restart the ESP32
        }

        vTaskDelay(100 / portTICK_PERIOD_MS); // Optimized delay
    }
}

// Task 2: Send Data to Firebase Using REST API (Asynchronous)
void TaskSendToFirebase(void *pvParameters) {
    while (1) {
        xSemaphoreTake(dataMutex, portMAX_DELAY);
        
        // Construct Firebase path
        String nodePath = nodeCode + "/" + dateString + "/" + timeString + ".json?auth=" + FIREBASE_AUTH;
        String url = String(FIREBASE_URL) + "/" + nodePath;


        // Create JSON payload
        StaticJsonDocument<200> doc;
        doc["date"] = dateString;
        doc["time"] = timeString;
        doc["voltage"] = voltage;
        doc["current"] = current;
        doc["power"] = power;
        doc["frequency"] = frequency;
        doc["powerFactor"] = pf;
        String jsonOut;
        serializeJson(doc, jsonOut);
        
        xSemaphoreGive(dataMutex);

        // Send data asynchronously
        HTTPClient http;
        http.begin(url);
        http.addHeader("Content-Type", "application/json");

        unsigned long startMillis = millis();
        int httpResponseCode = http.PUT(jsonOut);
        unsigned long endMillis = millis();

        if (httpResponseCode > 0) {
            Serial.printf("[%s %s] Data sent! HTTP %d (Latency: %lu ms)\n", 
                          dateString, timeString, httpResponseCode, endMillis - startMillis);
        } else {
            Serial.printf("⚠️ Error sending data! HTTP %d\n", httpResponseCode);
        }

        http.end();

        vTaskDelay(100 / portTICK_PERIOD_MS);
    }
}

// Task 3: Check WiFi Every 5 Seconds
void TaskCheckWiFi(void *pvParameters) {
    while (1) {
        checkWiFi();
        vTaskDelay(5000 / portTICK_PERIOD_MS);
    }
}

// Task 4: Update OLED Display Every 1 Second
void TaskUpdateOLED(void *pvParameters) {
    // Give other tasks time to initialize
    vTaskDelay(1000 / portTICK_PERIOD_MS);
    
    while (1) {
        // Take local copies of the readings while holding the mutex
        float v, i, p, f, powerFactor;
        char date[20], time[20];
        bool validReading = true;
        
        xSemaphoreTake(dataMutex, portMAX_DELAY);
        v = voltage;
        i = current;
        p = power;
        f = frequency;
        powerFactor = pf;
        strcpy(date, dateString);
        strcpy(time, timeString);
        
        // Check if readings are valid
        if (isnan(v) || isnan(i) || isnan(p) || isnan(f) || isnan(powerFactor)) {
            validReading = false;
        }
        xSemaphoreGive(dataMutex);
        
        // Update display
        display.clearDisplay();
        display.setTextSize(1);
        display.setCursor(0, 0);
        
        // WiFi status
        if (WiFi.status() == WL_CONNECTED) {
            display.print("WiFi: ");
            display.println(WiFi.SSID());
        } else {
            display.println("WiFi: Disconnected");
        }
        
        // Show date and time
        display.print(date);
        display.print(" ");
        display.println(time);
        
        display.println("--------------------");
        
        if (validReading) {
            // Show power readings with larger text for power value
            display.print("V: ");
            display.print(v, 1);
            display.println(" V");
            
            display.print("I: ");
            display.print(i, 2);
            display.println(" A");
            
            // Highlight power with larger text
            display.setTextSize(2);
            display.print("P: ");
            display.print(p, 1);
            display.println("W");
            
            // Back to normal text size
            display.setTextSize(1);
            display.print("F: ");
            display.print(f, 1);
            display.println(" Hz");
            
            display.print("PF: ");
            display.println(powerFactor, 2);
        } else {
            display.println("Reading sensors...");
            display.println("Please wait");
        }
        
        // Show the node ID
        display.setCursor(0, 56);
        display.print(F("Node: "));
        display.print(nodeCode);
        
        display.display();
        
        vTaskDelay(1000 / portTICK_PERIOD_MS); // Update display every second
    }
}