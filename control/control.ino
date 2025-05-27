// ESP32 Dual Relay Control via Serial Monitor + Firebase HTTP + WiFiManager + FreeRTOS
// Commands: relay1_on, relay1_off, relay2_on, relay2_off, status, help
// Firebase: light=true controls relay1, outlet=true controls relay2

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

// Firebase Info
#define FIREBASE_HOST ""
#define FIREBASE_AUTH "" 

// Define relay pins
const int RELAY1_PIN = 26;  // GPIO26 for Relay 1 (Light)
const int RELAY2_PIN = 27;  // GPIO27 for Relay 2 (Outlet)

// Define LED pins for status indication
const int LED_PIN = 25;     // GPIO25 for activity LED
const int WIFI_LED_PIN = 2; // GPIO2 for WiFi status LED
const int RESET_PIN = 0;    // Reset pin for WiFi Manager (BOOT button)

// Relay states
volatile bool relay1_state = false;
volatile bool relay2_state = false;

// WiFi Manager
WiFiManager wifiManager;
volatile bool wifiConnected = false;

// Last values from Firebase
volatile bool lastLightState = false;
volatile bool lastOutletState = false;

// Serial communication
String serialInput = "";
volatile bool serialComplete = false;

// FreeRTOS Task Handles
TaskHandle_t firebaseTaskHandle = NULL;
TaskHandle_t serialTaskHandle = NULL;
TaskHandle_t resetTaskHandle = NULL;
TaskHandle_t commandProcessorTaskHandle = NULL;

// FreeRTOS Synchronization
SemaphoreHandle_t wifiMutex = NULL;
SemaphoreHandle_t relayMutex = NULL;
QueueHandle_t commandQueue = NULL;

// Command structure for internal communication
enum CommandType {
  CMD_RELAY1_ON,
  CMD_RELAY1_OFF,
  CMD_RELAY2_ON,
  CMD_RELAY2_OFF,
  CMD_BOTH_ON,
  CMD_BOTH_OFF,
  CMD_RESET_WIFI,
  CMD_FIREBASE_SYNC,
  CMD_SHOW_STATUS
};

struct Command {
  CommandType type;
  bool updateFirebase;
};

// Function declarations for FreeRTOS tasks
void firebaseTask(void *pvParameters);
void serialTask(void *pvParameters);
void resetTask(void *pvParameters);
void commandProcessorTask(void *pvParameters);

// Firebase communication functions with improved error handling
bool getFirebaseBoolValue(const String& path) {
  if (!wifiConnected) return false;
  
  if (xSemaphoreTake(wifiMutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
    HTTPClient http;
    bool result = false;
    String url = "https://" + String(FIREBASE_HOST) + path + "?auth=" + String(FIREBASE_AUTH);
    
    http.begin(url);
    http.setTimeout(10000); // 10 second timeout
    int httpCode = http.GET();
    
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      payload.trim();
      result = (payload == "true");
      Serial.println("Firebase GET " + path + ": " + payload);
    } else {
      Serial.println("Firebase GET failed for " + path + ", error: " + String(httpCode));
    }
    
    http.end();
    xSemaphoreGive(wifiMutex);
    return result;
  } else {
    Serial.println("Failed to get WiFi mutex for Firebase GET");
    return false;
  }
}

bool setFirebaseBoolValue(const String& path, bool value) {
  if (!wifiConnected) return false;
  
  if (xSemaphoreTake(wifiMutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
    HTTPClient http;
    String url = "https://" + String(FIREBASE_HOST) + path + "?auth=" + String(FIREBASE_AUTH);
    String payload = value ? "true" : "false";
    
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000); // 10 second timeout
    
    int httpCode = http.PUT(payload);
    
    if (httpCode == HTTP_CODE_OK) {
      Serial.println("Firebase PUT " + path + ": " + payload + " successful");
      http.end();
      xSemaphoreGive(wifiMutex);
      return true;
    } else {
      Serial.println("Firebase PUT failed for " + path + ", error: " + String(httpCode));
      http.end();
      xSemaphoreGive(wifiMutex);
      return false;
    }
  } else {
    Serial.println("Failed to get WiFi mutex for Firebase PUT");
    return false;
  }
}

// Relay control functions with thread safety
void controlRelay1(bool state) {
  if (xSemaphoreTake(relayMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    digitalWrite(RELAY1_PIN, state ? LOW : HIGH);  // LOW = ON for active-low relay
    relay1_state = state;
    blinkLED();
    xSemaphoreGive(relayMutex);
  }
}

void controlRelay2(bool state) {
  if (xSemaphoreTake(relayMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    digitalWrite(RELAY2_PIN, state ? LOW : HIGH);  // LOW = ON for active-low relay
    relay2_state = state;
    blinkLED();
    xSemaphoreGive(relayMutex);
  }
}

void blinkLED() {
  // Quick blink to show activity
  digitalWrite(LED_PIN, HIGH);
  vTaskDelay(pdMS_TO_TICKS(100));
  digitalWrite(LED_PIN, LOW);
}

void setup() {
  // Initialize Serial Monitor
  Serial.begin(115200);
  delay(100);
  
  Serial.println("\n\nESP32 Dual Relay Controller with Firebase HTTP and FreeRTOS");
  
  // Configure pins
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(WIFI_LED_PIN, OUTPUT);
  pinMode(RESET_PIN, INPUT_PULLUP);
  
  // Set initial relay states (OFF) - HIGH = OFF for active-low relays
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(WIFI_LED_PIN, LOW);
  
  // Create FreeRTOS synchronization primitives
  wifiMutex = xSemaphoreCreateMutex();
  relayMutex = xSemaphoreCreateMutex();
  commandQueue = xQueueCreate(20, sizeof(Command));
  
  // Setup WiFi Manager
  Serial.println("Connecting to WiFi...");
  wifiManager.setConfigPortalTimeout(300); // 5 minutes timeout
  wifiManager.setConnectTimeout(30); // 30 seconds connect timeout
  
  if (!wifiManager.autoConnect("ESP32-RelayController", "password123")) {
    Serial.println("Failed to connect and hit timeout");
    delay(3000);
    ESP.restart();
  }
  
  wifiConnected = true;
  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  digitalWrite(WIFI_LED_PIN, HIGH);
  
  // Create FreeRTOS tasks
  xTaskCreatePinnedToCore(
    commandProcessorTask,
    "CommandProcessor",
    4096,
    NULL,
    3,
    &commandProcessorTaskHandle,
    1
  );
  
  xTaskCreatePinnedToCore(
    firebaseTask,
    "FirebaseTask",
    8192,
    NULL,
    2,
    &firebaseTaskHandle,
    1
  );
  
  xTaskCreatePinnedToCore(
    serialTask,
    "SerialTask",
    3072,
    NULL,
    1,
    &serialTaskHandle,
    0
  );
  
  xTaskCreatePinnedToCore(
    resetTask,
    "ResetTask",
    1024,
    NULL,
    1,
    &resetTaskHandle,
    0
  );
  
  Serial.println("All tasks created successfully");
  
  // Print available commands
  printCommands();
  
  // Get initial Firebase states
  vTaskDelay(pdMS_TO_TICKS(1000));
  
  if (wifiConnected) {
    lastLightState = getFirebaseBoolValue("/light.json");
    lastOutletState = getFirebaseBoolValue("/outlet.json");
    
    // Set initial relay states based on Firebase
    controlRelay1(lastLightState);
    controlRelay2(lastOutletState);
  }
  
  Serial.println("System ready!");
}

void loop() {
  // Main loop is empty since all functionality is in FreeRTOS tasks
  vTaskDelay(1000 / portTICK_PERIOD_MS);
}

// Firebase communication task
void firebaseTask(void *pvParameters) {
  const TickType_t xDelay = 2000 / portTICK_PERIOD_MS; // 2 second delay
  int failedConnections = 0;
  
  for (;;) {
    if (wifiConnected) {
      // Check WiFi connection
      if (WiFi.status() != WL_CONNECTED) {
        failedConnections++;
        if (failedConnections > 5) {
          wifiConnected = false;
          digitalWrite(WIFI_LED_PIN, LOW);
          Serial.println("WiFi connection lost. Attempting to reconnect...");
          WiFi.reconnect();
        }
        vTaskDelay(xDelay);
        continue;
      } else {
        failedConnections = 0;
        if (!wifiConnected) {
          wifiConnected = true;
          digitalWrite(WIFI_LED_PIN, HIGH);
          Serial.println("WiFi reconnected!");
        }
      }
      
      // Check light state
      bool lightState = getFirebaseBoolValue("/light.json");
      if (lightState != lastLightState) {
        lastLightState = lightState;
        controlRelay1(lightState);
        Serial.print("Firebase: Light state changed to ");
        Serial.println(lightState ? "ON" : "OFF");
      }
      
      // Check outlet state
      bool outletState = getFirebaseBoolValue("/outlet.json");
      if (outletState != lastOutletState) {
        lastOutletState = outletState;
        controlRelay2(outletState);
        Serial.print("Firebase: Outlet state changed to ");
        Serial.println(outletState ? "ON" : "OFF");
      }
    } else if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      digitalWrite(WIFI_LED_PIN, HIGH);
      Serial.println("WiFi connection restored");
    }
    
    vTaskDelay(xDelay);
  }
}

// Serial communication task
void serialTask(void *pvParameters) {
  const TickType_t xDelay = 20 / portTICK_PERIOD_MS;
  
  for (;;) {
    // Check for serial commands
    while (Serial.available() > 0) {
      char inChar = (char)Serial.read();
      
      if (inChar != '\n' && inChar != '\r') {
        serialInput += inChar;
      }
      
      if (inChar == '\n') {
        serialComplete = true;
      }
    }
    
    // Process completed command
    if (serialComplete) {
      serialInput.trim();
      serialInput.toLowerCase();
      
      Command cmd;
      cmd.updateFirebase = true; // Default to updating Firebase
      
      if (serialInput == "relay1_on" || serialInput == "light_on") {
        cmd.type = CMD_RELAY1_ON;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "relay1_off" || serialInput == "light_off") {
        cmd.type = CMD_RELAY1_OFF;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "relay2_on" || serialInput == "outlet_on") {
        cmd.type = CMD_RELAY2_ON;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "relay2_off" || serialInput == "outlet_off") {
        cmd.type = CMD_RELAY2_OFF;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "both_on") {
        cmd.type = CMD_BOTH_ON;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "both_off") {
        cmd.type = CMD_BOTH_OFF;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "status") {
        cmd.type = CMD_SHOW_STATUS;
        cmd.updateFirebase = false;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "firebase_sync") {
        cmd.type = CMD_FIREBASE_SYNC;
        cmd.updateFirebase = false;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "wifi_reset") {
        cmd.type = CMD_RESET_WIFI;
        cmd.updateFirebase = false;
        xQueueSend(commandQueue, &cmd, 0);
      }
      else if (serialInput == "help") {
        printCommands();
      }
      else if (serialInput == "") {
        // Empty command, do nothing
      }
      else {
        Serial.println("❌ Unknown command: " + serialInput);
        Serial.println("Type 'help' for available commands");
      }
      
      serialInput = "";
      serialComplete = false;
    }
    
    vTaskDelay(xDelay);
  }
}

// WiFi reset button monitoring task
void resetTask(void *pvParameters) {
  const TickType_t xDelay = 100 / portTICK_PERIOD_MS;
  
  for (;;) {
    if (digitalRead(RESET_PIN) == LOW) {
      int pressTime = 0;
      while (digitalRead(RESET_PIN) == LOW && pressTime < 30) {
        vTaskDelay(100 / portTICK_PERIOD_MS);
        pressTime++;
      }
      
      if (pressTime >= 30) { // Button held for 3 seconds
        Command cmd;
        cmd.type = CMD_RESET_WIFI;
        cmd.updateFirebase = false;
        xQueueSend(commandQueue, &cmd, 0);
      }
    }
    
    vTaskDelay(xDelay);
  }
}

// Command processor task
void commandProcessorTask(void *pvParameters) {
  Command receivedCmd;
  
  for (;;) {
    if (xQueueReceive(commandQueue, &receivedCmd, portMAX_DELAY) == pdPASS) {
      switch (receivedCmd.type) {
        case CMD_RELAY1_ON:
          controlRelay1(true);
          Serial.println("✓ Relay 1 (Light) turned ON");
          if (receivedCmd.updateFirebase) {
            setFirebaseBoolValue("/light.json", true);
          }
          break;
          
        case CMD_RELAY1_OFF:
          controlRelay1(false);
          Serial.println("✓ Relay 1 (Light) turned OFF");
          if (receivedCmd.updateFirebase) {
            setFirebaseBoolValue("/light.json", false);
          }
          break;
          
        case CMD_RELAY2_ON:
          controlRelay2(true);
          Serial.println("✓ Relay 2 (Outlet) turned ON");
          if (receivedCmd.updateFirebase) {
            setFirebaseBoolValue("/outlet.json", true);
          }
          break;
          
        case CMD_RELAY2_OFF:
          controlRelay2(false);
          Serial.println("✓ Relay 2 (Outlet) turned OFF");
          if (receivedCmd.updateFirebase) {
            setFirebaseBoolValue("/outlet.json", false);
          }
          break;
          
        case CMD_BOTH_ON:
          controlRelay1(true);
          controlRelay2(true);
          Serial.println("✓ Both relays turned ON");
          if (receivedCmd.updateFirebase) {
            setFirebaseBoolValue("/light.json", true);
            setFirebaseBoolValue("/outlet.json", true);
          }
          break;
          
        case CMD_BOTH_OFF:
          controlRelay1(false);
          controlRelay2(false);
          Serial.println("✓ Both relays turned OFF");
          if (receivedCmd.updateFirebase) {
            setFirebaseBoolValue("/light.json", false);
            setFirebaseBoolValue("/outlet.json", false);
          }
          break;
          
        case CMD_SHOW_STATUS:
          showStatus();
          break;
          
        case CMD_FIREBASE_SYNC:
          if (wifiConnected) {
            Serial.println("Forcing Firebase sync...");
            bool lightState = getFirebaseBoolValue("/light.json");
            bool outletState = getFirebaseBoolValue("/outlet.json");
            
            if (lightState != relay1_state) {
              controlRelay1(lightState);
              lastLightState = lightState;
            }
            
            if (outletState != relay2_state) {
              controlRelay2(outletState);
              lastOutletState = outletState;
            }
            
            Serial.println("✓ Firebase sync completed");
          } else {
            Serial.println("❌ Firebase not connected");
          }
          break;
          
        case CMD_RESET_WIFI:
          Serial.println("Resetting WiFi settings...");
          wifiManager.resetSettings();
          delay(1000);
          ESP.restart();
          break;
      }
    }
  }
}

void showStatus() {
  Serial.println("=== System Status ===");
  Serial.print("WiFi: ");
  Serial.println(wifiConnected ? "Connected" : "Disconnected");
  if (wifiConnected) {
    Serial.print("SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  }
  Serial.print("Firebase: ");
  Serial.println(wifiConnected ? "Available" : "Not available");
  Serial.print("Light (Relay 1): ");
  Serial.println(relay1_state ? "ON" : "OFF");
  Serial.print("Outlet (Relay 2): ");
  Serial.println(relay2_state ? "ON" : "OFF");
  Serial.print("Free heap: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  Serial.print("Running tasks: ");
  Serial.println(uxTaskGetNumberOfTasks());
  Serial.println("====================");
}

void printCommands() {
  Serial.println("=== Available Commands ===");
  Serial.println("Light Control:");
  Serial.println("  light_on / relay1_on   - Turn ON Light");
  Serial.println("  light_off / relay1_off - Turn OFF Light");
  Serial.println("Outlet Control:");
  Serial.println("  outlet_on / relay2_on   - Turn ON Outlet");
  Serial.println("  outlet_off / relay2_off - Turn OFF Outlet");
  Serial.println("Both:");
  Serial.println("  both_on     - Turn ON both relays");
  Serial.println("  both_off    - Turn OFF both relays");
  Serial.println("System:");
  Serial.println("  status      - Show system status");
  Serial.println("  firebase_sync - Force Firebase sync");
  Serial.println("  wifi_reset  - Reset WiFi settings");
  Serial.println("  help        - Show this help message");
  Serial.println("===========================");
}