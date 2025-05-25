// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyC86YPT3FfoiSMuBiZ0GKLCKlIJeaBu3zk",
  authDomain: "power-meter-868cb.firebaseapp.com",
  databaseURL:
    "https://power-meter-868cb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "power-meter-868cb",
  storageBucket: "power-meter-868cb.firebasestorage.app",
  messagingSenderId: "871645632526",
  appId: "1:871645632526:web:014e1d1b8241e1cc13445f",
  measurementId: "G-FN84Y8G932",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const messaging = firebase.messaging();
const database = firebase.database();

// DOM Elements
const currentConsumptionEl = document.getElementById("currentConsumption");
const totalConsumptionEl = document.getElementById("totalConsumption");
const kwhLimitInput = document.getElementById("kwhLimit");
const setLimitBtn = document.getElementById("setLimitBtn");
const limitStatusEl = document.getElementById("limitStatus");
const lightToggle = document.getElementById("lightToggle");
const lightStatusText = document.getElementById("lightStatusText");
const outletToggle = document.getElementById("outletToggle");
const outletStatusText = document.getElementById("outletStatusText");
const predictionText = document.getElementById("predictionText");
const voltageEl = document.getElementById("voltage");
const currentEl = document.getElementById("current");
const powerEl = document.getElementById("power");
const notificationPanel = document.getElementById("notificationPanel");
const notificationList = document.getElementById("notificationList");
const notificationCount = document.getElementById("notificationCount");

// Global variables
let currentKwhLimit = 0;
let limitReached = false;
let notified90 = false;
let notified95 = false;
let consumptionChart;
let notifications = [];
let unreadCount = 0;

// Store user's auto-off choice (in localStorage)
let autoOffChoice = localStorage.getItem("autoOffChoice") || "none";

// Create animated particles
function createParticles() {
  const container = document.getElementById("particles");
  for (let i = 0; i < 50; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    particle.style.left = Math.random() * 100 + "%";
    particle.style.top = Math.random() * 100 + "%";
    particle.style.width = Math.random() * 4 + 2 + "px";
    particle.style.height = particle.style.width;
    particle.style.animationDelay = Math.random() * 6 + "s";
    container.appendChild(particle);
  }
}

// Smooth scroll to sections
function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Show notification status
function showNotificationStatus(message, type = "success") {
  const status = document.getElementById("notificationStatus");
  status.textContent = message;
  status.className = `notification-status status-${type}`;
  status.style.display = "block";

  setTimeout(() => {
    status.style.display = "none";
  }, 3000);
}

// Notification Panel Functions
function toggleNotificationPanel() {
  const panel = document.getElementById("notificationPanel");
  panel.classList.toggle("show");

  // Hide mobile nav if open
  if (window.innerWidth <= 768) {
    const mobileNav = document.getElementById("mobileNav");
    if (mobileNav) mobileNav.classList.add("hide");
  }

  // Mark all as read when opened
  if (panel.classList.contains("show")) {
    markAllAsRead();
  }
}

function addNotification(title, message, type = "warning", actions = null) {
  const notification = {
    id: Date.now(),
    title,
    message,
    type,
    time: new Date(),
    read: false,
    actions,
  };

  notifications.unshift(notification);
  unreadCount++;
  updateNotificationDisplay();
  renderNotifications();
}

function updateNotificationDisplay() {
  const badge = document.getElementById("notificationCount");
  badge.textContent = unreadCount;
  badge.style.display = unreadCount > 0 ? "flex" : "none";
}

function renderNotifications() {
  const container = document.getElementById("notificationList");

  if (notifications.length === 0) {
    container.innerHTML =
      '<div class="no-notifications">No new notifications</div>';
    return;
  }

  container.innerHTML = notifications
    .map(
      (notification) => `
    <div class="notification-item ${
      !notification.read ? "unread" : ""
    }" data-id="${notification.id}">
      <div class="notification-content">
        <div class="notification-icon">
          ${getNotificationIcon(notification.type)}
        </div>
        <div class="notification-text">
          <div class="notification-title">${notification.title}</div>
          <div class="notification-message">${notification.message}</div>
          <div class="notification-time">${formatTime(notification.time)}</div>
          ${
            notification.actions
              ? renderNotificationActions(notification.actions, notification.id)
              : ""
          }
        </div>
      </div>
    </div>
  `
    )
    .join("");
}

function getNotificationIcon(type) {
  const icons = {
    warning: "⚠️",
    success: "✅",
    info: "ℹ️",
    error: "❌",
  };
  return icons[type] || "ℹ️";
}

function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function renderNotificationActions(actions, notificationId) {
  return `
    <div class="notification-actions">
      ${actions
        .map(
          (action) => `
        <button class="notification-action-btn ${action.class}" onclick="handleNotificationAction('${action.action}', ${notificationId})">
          ${action.text}
        </button>
      `
        )
        .join("")}
    </div>
  `;
}

function handleNotificationAction(action, notificationId) {
  switch (action) {
    case "turn-off-light":
      turnOffDevice("light");
      break;
    case "turn-off-outlet":
      turnOffDevice("outlet");
      break;
    case "turn-off-both":
      turnOffDevice("both");
      break;
  }

  // Remove the notification after action
  removeNotification(notificationId);
}

function removeNotification(id) {
  notifications = notifications.filter((n) => n.id !== id);
  renderNotifications();
}

function markAllAsRead() {
  notifications.forEach((n) => (n.read = true));
  unreadCount = 0;
  updateNotificationDisplay();
  renderNotifications();
}

function clearAllNotifications() {
  notifications = [];
  unreadCount = 0;
  updateNotificationDisplay();
  renderNotifications();
}

// Close notification panel when clicking outside
document.addEventListener("click", (e) => {
  const notificationContainer = document.querySelector(
    ".notification-container"
  );
  if (!notificationContainer.contains(e.target)) {
    notificationPanel.classList.remove("show");
  }
});

// Auto-enable notifications on app load
window.addEventListener("load", () => {
  createParticles();

  if ("Notification" in window) {
    if (Notification.permission === "default") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          showNotificationStatus("Smart notifications enabled!", "success");
          getMessagingToken();
        } else {
          showNotificationStatus(
            "Please enable notifications for alerts",
            "error"
          );
        }
      });
    } else if (Notification.permission === "granted") {
      showNotificationStatus("Notifications ready!", "success");
      getMessagingToken();
    }
  }
});

// Chart Creation Function (with improved mobile responsiveness)
function createConsumptionChart(labels, data) {
  const ctx = document.getElementById("consumptionChart").getContext("2d");

  if (consumptionChart) {
    consumptionChart.destroy();
  }

  consumptionChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Daily Consumption (kWh)",
          data: data,
          backgroundColor: "rgba(0, 0, 0, 0.1)",
          borderColor: "#000000",
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "#000000",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#000000",
            font: { size: 14, weight: "bold" },
          },
        },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.9)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "#000000",
          borderWidth: 1,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 20,
          ticks: {
            stepSize: 2,
            color: "#000000",
            callback: function (value) {
              return value + " kWh";
            },
          },
          grid: { color: "rgba(0,0,0,0.1)" },
          title: { display: true, text: "Energy (kWh)", color: "#000000" },
        },
        x: {
          ticks: {
            color: "#000000",
            maxRotation: 45,
            minRotation: 0,
          },
          grid: { color: "rgba(0,0,0,0.1)" },
          title: { display: true, text: "Date", color: "#000000" },
        },
      },
    },
  });
}

// Utility functions for date handling
function getWeekNumber(date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
  return `${date.getFullYear()}-W${Math.ceil(
    (pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7
  )}`;
}

function getMonthString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

// Calculate and store organized consumption data
async function calculateAndStoreConsumptionData() {
  try {
    const c4Ref = database.ref("C-4");
    const snapshot = await c4Ref.once("value");
    const data = snapshot.val();

    if (!data) {
      await database.ref("consumptions").set({
        daily: {},
        weekly: {},
        monthly: {},
      });
      return { daily: {}, weekly: {}, monthly: {}, total: 0 };
    }

    const dailyConsumptions = {};
    const weeklyConsumptions = {};
    const monthlyConsumptions = {};
    let totalKwh = 0;

    Object.keys(data).forEach((year) => {
      const yearData = data[year];
      Object.keys(yearData).forEach((month) => {
        const monthData = yearData[month];
        Object.keys(monthData).forEach((day) => {
          const dayData = monthData[day];
          const dailyKwh = calculateDailyKwh(dayData);

          const dateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(
            2,
            "0"
          )}`;
          const date = new Date(year, month - 1, day);
          const weekStr = getWeekNumber(date);
          const monthStr = getMonthString(date);

          dailyConsumptions[dateStr] = dailyKwh;
          totalKwh += dailyKwh;

          if (!weeklyConsumptions[weekStr]) {
            weeklyConsumptions[weekStr] = 0;
          }
          weeklyConsumptions[weekStr] += dailyKwh;

          if (!monthlyConsumptions[monthStr]) {
            monthlyConsumptions[monthStr] = 0;
          }
          monthlyConsumptions[monthStr] += dailyKwh;
        });
      });
    });

    await database.ref("consumptions").set({
      daily: dailyConsumptions,
      weekly: weeklyConsumptions,
      monthly: monthlyConsumptions,
    });

    await database.ref("totalKwh").set(totalKwh.toFixed(6));

    return {
      daily: dailyConsumptions,
      weekly: weeklyConsumptions,
      monthly: monthlyConsumptions,
      total: totalKwh,
    };
  } catch (error) {
    console.error("Error calculating consumption data:", error);
    return { daily: {}, weekly: {}, monthly: {}, total: 0 };
  }
}

async function calculateAndStoreTotalConsumption() {
  const consumptionData = await calculateAndStoreConsumptionData();
  return consumptionData.total;
}

// Function to create enhanced consumption table with daily/weekly/monthly views
function createEnhancedConsumptionTable(consumptionData) {
  // Store data globally for tab switching
  window.consumptionData = consumptionData;

  // Show daily table by default
  showConsumptionTable("daily");
}

// Function to show specific consumption table
function showConsumptionTable(type) {
  if (!window.consumptionData) return;

  const data = window.consumptionData[type];
  const wrapper = document.getElementById("consumptionTableWrapper");

  // Update active tab
  document
    .querySelectorAll(".consumption-tab")
    .forEach((tab) => tab.classList.remove("active"));
  document.getElementById(`${type}Tab`).classList.add("active");

  let tableHTML = `<table class="consumption-table">`;

  if (type === "daily") {
    tableHTML += `
      <thead>
        <tr>
          <th>Date</th>
          <th>Consumption (kWh)</th>
        </tr>
      </thead>
      <tbody>
    `;

    // Sort daily data by date (most recent first)
    const sortedDates = Object.keys(data).sort(
      (a, b) => new Date(b) - new Date(a)
    );
    sortedDates.forEach((date) => {
      tableHTML += `
        <tr>
          <td>${date}</td>
          <td>${data[date].toFixed(3)}</td>
        </tr>
      `;
    });
  } else if (type === "weekly") {
    tableHTML += `
      <thead>
        <tr>
          <th>Week</th>
          <th>Consumption (kWh)</th>
        </tr>
      </thead>
      <tbody>
    `;

    // Sort weekly data by week (most recent first)
    const sortedWeeks = Object.keys(data).sort((a, b) => b.localeCompare(a));
    sortedWeeks.forEach((week) => {
      tableHTML += `
        <tr>
          <td>${week}</td>
          <td>${data[week].toFixed(3)}</td>
        </tr>
      `;
    });
  } else if (type === "monthly") {
    tableHTML += `
      <thead>
        <tr>
          <th>Month</th>
          <th>Consumption (kWh)</th>
        </tr>
      </thead>
      <tbody>
    `;

    // Sort monthly data by month (most recent first)
    const sortedMonths = Object.keys(data).sort((a, b) => b.localeCompare(a));
    sortedMonths.forEach((month) => {
      tableHTML += `
        <tr>
          <td>${month}</td>
          <td>${data[month].toFixed(3)}</td>
        </tr>
      `;
    });
  }

  tableHTML += `</tbody></table>`;
  wrapper.innerHTML = tableHTML;
}

// Make function global for onclick handlers
window.showConsumptionTable = showConsumptionTable;

// Function to turn off devices
async function turnOffDevice(deviceType) {
  try {
    if (deviceType === "light" || deviceType === "both") {
      await database.ref("light").set(false);
      lightToggle.checked = false;
      lightStatusText.textContent = "⚫ Light is OFF";
    }

    if (deviceType === "outlet" || deviceType === "both") {
      await database.ref("outlet").set(false);
      outletToggle.checked = false;
      outletStatusText.textContent = "⚫ Outlet is OFF";
    }

    const actionText = deviceType === "both" ? "Both devices" : deviceType;
    showNotificationStatus(
      `${actionText} turned off to save energy!`,
      "success"
    );

    // Add success notification
    addNotification(
      "✅ Energy Saved!",
      `${actionText} turned off successfully to reduce consumption.`,
      "success"
    );
  } catch (error) {
    console.error("Error turning off device:", error);
    showNotificationStatus("Failed to control device", "error");
  }
}

// Function to check kWh limit with progressive notifications
function checkKwhLimit(currentKwh) {
  if (currentKwhLimit > 0) {
    const percentage = (currentKwh / currentKwhLimit) * 100;

    // 90% Warning
    if (percentage >= 90 && percentage < 95 && !notified90) {
      notified90 = true;
      addNotification(
        "⚠️ 90% Limit Warning",
        `You've used 90% of your daily limit (${currentKwh.toFixed(
          3
        )}/${currentKwhLimit} kWh). Consider reducing usage to avoid exceeding your limit.`,
        "warning"
      );

      if (Notification.permission === "granted") {
        new Notification("⚠️ 90% Energy Limit Warning", {
          body: `You've used 90% of your daily limit. Current: ${currentKwh.toFixed(
            3
          )} kWh`,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚠️</text></svg>",
        });
      }
    }

    // 95% Critical Warning
    else if (percentage >= 95 && percentage < 100 && !notified95) {
      notified95 = true;

      // Smart actions - only show controls for devices that are ON
      const actions = [];
      if (lightToggle.checked) {
        actions.push({
          text: "💡 Turn Off Light",
          action: "turn-off-light",
          class: "turn-off-light",
        });
      }
      if (outletToggle.checked) {
        actions.push({
          text: "🔌 Turn Off Outlet",
          action: "turn-off-outlet",
          class: "turn-off-outlet",
        });
      }

      addNotification(
        "🚨 95% Critical Warning",
        `Critical! You've used 95% of your daily limit (${currentKwh.toFixed(
          3
        )}/${currentKwhLimit} kWh). Immediate action recommended to avoid exceeding limit.`,
        "warning",
        actions.length > 0 ? actions : null
      );

      if (Notification.permission === "granted") {
        new Notification("🚨 95% Critical Energy Warning", {
          body: `Critical warning! You've used 95% of your daily limit. Take action now!`,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚨</text></svg>",
        });
      }
    }

    // Limit Exceeded
    else if (currentKwh >= currentKwhLimit && !limitReached) {
      limitReached = true;

      // Smart actions - only show controls for devices that are ON
      const actions = [];
      if (lightToggle.checked) {
        actions.push({
          text: "💡 Turn Off Light",
          action: "turn-off-light",
          class: "turn-off-light",
        });
      }
      if (outletToggle.checked) {
        actions.push({
          text: "🔌 Turn Off Outlet",
          action: "turn-off-outlet",
          class: "turn-off-outlet",
        });
      }
      if (lightToggle.checked && outletToggle.checked) {
        actions.push({
          text: "🔄 Turn Off Both",
          action: "turn-off-both",
          class: "turn-off-both",
        });
      }

      addNotification(
        "🚨 kWh Limit Exceeded!",
        `Your daily consumption has exceeded the set limit of ${currentKwhLimit} kWh. Current usage: ${currentKwh.toFixed(
          3
        )} kWh. ${
          actions.length > 0
            ? "Take immediate action to reduce consumption."
            : "All controllable devices are already off."
        }`,
        "warning",
        actions.length > 0 ? actions : null
      );

      if (Notification.permission === "granted") {
        new Notification("🚨 Energy Limit Exceeded!", {
          body: `Daily consumption has exceeded ${currentKwhLimit} kWh. Take immediate action!`,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚨</text></svg>",
        });
      }
    }

    // Update limit status display
    if (limitStatusEl) {
      if (currentKwh >= currentKwhLimit) {
        limitStatusEl.innerHTML = `🚨 <strong>LIMIT EXCEEDED!</strong> ${currentKwh.toFixed(
          3
        )}/${currentKwhLimit} kWh (${percentage.toFixed(1)}%)`;
        limitStatusEl.style.color = "#ff4444";
      } else if (percentage >= 95) {
        limitStatusEl.innerHTML = `🚨 <strong>CRITICAL:</strong> ${currentKwh.toFixed(
          3
        )}/${currentKwhLimit} kWh (${percentage.toFixed(1)}%)`;
        limitStatusEl.style.color = "#ff4444";
      } else if (percentage >= 90) {
        limitStatusEl.innerHTML = `⚠️ <strong>WARNING:</strong> ${currentKwh.toFixed(
          3
        )}/${currentKwhLimit} kWh (${percentage.toFixed(1)}%)`;
        limitStatusEl.style.color = "#ff9800";
      } else {
        limitStatusEl.innerHTML = `📊 ${currentKwh.toFixed(
          3
        )}/${currentKwhLimit} kWh (${percentage.toFixed(1)}%)`;
        limitStatusEl.style.color = "#000000";
      }
    }
  }
}

// Function to set kWh limit
async function setKwhLimit() {
  const limitValue = parseFloat(kwhLimitInput.value);

  if (isNaN(limitValue) || limitValue <= 0) {
    showNotificationStatus("Please enter a valid limit value", "error");
    return;
  }

  try {
    currentKwhLimit = limitValue;
    // Reset all notification flags when new limit is set
    limitReached = false;
    notified90 = false;
    notified95 = false;

    await database.ref("kwhLimit").set(limitValue);

    if (limitStatusEl) {
      limitStatusEl.innerHTML = `✅ Smart limit set: <strong>${limitValue} kWh</strong>`;
      limitStatusEl.style.color = "#000000";
    }

    showNotificationStatus(`Smart limit set to ${limitValue} kWh!`, "success");

    // Add notification
    addNotification(
      "🎯 Smart Limit Set",
      `Daily consumption limit updated to ${limitValue} kWh. You'll be notified at 90%, 95%, and when the limit is reached.`,
      "success"
    );

    const currentKwh = parseFloat(currentConsumptionEl.textContent) || 0;
    checkKwhLimit(currentKwh);
  } catch (error) {
    console.error("Error setting kWh limit:", error);
    showNotificationStatus("Failed to set limit", "error");
  }
}

// Function to load saved kWh limit
async function loadKwhLimit() {
  try {
    const snapshot = await database.ref("kwhLimit").once("value");
    const savedLimit = snapshot.val();

    if (savedLimit !== null) {
      currentKwhLimit = parseFloat(savedLimit);
      if (kwhLimitInput) {
        kwhLimitInput.value = currentKwhLimit;
      }
      if (limitStatusEl) {
        limitStatusEl.innerHTML = `Current limit: <strong>${currentKwhLimit} kWh</strong>`;
        limitStatusEl.style.color = "#000000";
      }
    }
  } catch (error) {
    console.error("Error loading kWh limit:", error);
  }
}

// Function to display total consumption
function displayTotalConsumption(totalKwh) {
  if (totalConsumptionEl) {
    totalConsumptionEl.textContent = totalKwh.toFixed(3);
  }
}

// Function to calculate daily kWh
function calculateDailyKwh(dayData) {
  if (!dayData) return 0;

  const timestamps = Object.keys(dayData).sort();
  let totalKwh = 0;

  for (let i = 1; i < timestamps.length; i++) {
    const currentReading = dayData[timestamps[i]];
    const previousReading = dayData[timestamps[i - 1]];

    if (currentReading.power && previousReading.time && currentReading.time) {
      const prevTime = new Date(`2025-05-22 ${previousReading.time}`);
      const currTime = new Date(`2025-05-22 ${currentReading.time}`);
      const timeDiffHours = (currTime - prevTime) / (1000 * 60 * 60);

      const kwh = (parseFloat(currentReading.power) * timeDiffHours) / 1000;
      totalKwh += kwh;
    }
  }

  return totalKwh;
}

// Function to get the latest C-4 reading
function getLatestC4Reading() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  const todayPath = `C-4/${year}/${month}/${day}`;

  database.ref(todayPath).on("value", async (snapshot) => {
    const dayData = snapshot.val();
    if (dayData) {
      const timestamps = Object.keys(dayData).sort();
      const latestTimestamp = timestamps[timestamps.length - 1];
      const latestReading = dayData[latestTimestamp];

      if (latestReading) {
        if (latestReading.voltage !== undefined) {
          voltageEl.textContent = parseFloat(latestReading.voltage).toFixed(2);
        }
        if (latestReading.current !== undefined) {
          currentEl.textContent = parseFloat(latestReading.current).toFixed(2);
        }
        if (latestReading.power !== undefined) {
          powerEl.textContent = parseFloat(latestReading.power).toFixed(2);
        }

        const todayKwh = calculateDailyKwh(dayData);
        currentConsumptionEl.textContent = todayKwh.toFixed(3);

        checkKwhLimit(todayKwh);

        const totalKwh = await calculateAndStoreTotalConsumption();
        displayTotalConsumption(totalKwh);
      }
    }
  });
}

// Load C-4 Consumption Data Function
async function loadC4ConsumptionData() {
  const c4Ref = database.ref("C-4");

  c4Ref
    .once("value")
    .then(async (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const consumptionData = await calculateAndStoreConsumptionData();
      displayTotalConsumption(consumptionData.total);

      // Create the enhanced consumption table with tabs
      createEnhancedConsumptionTable(consumptionData);

      const dailyData = consumptionData.daily;
      if (Object.keys(dailyData).length > 0) {
        const chartLabels = Object.keys(dailyData).sort();
        const chartValues = chartLabels.map((date) => dailyData[date]);

        createConsumptionChart(chartLabels, chartValues);

        const totalDays = chartValues.length;
        const totalConsumption = chartValues.reduce((sum, v) => sum + v, 0);
        const average = totalConsumption / totalDays;
        const today = new Date();
        const daysInMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 1,
          0
        ).getDate();
        const predictedTotal = average * daysInMonth;

        predictionText.innerHTML = `
        🔮 <strong>Prediction:</strong> Based on ${totalDays} days of data, your projected monthly usage is <strong>${predictedTotal.toFixed(
          2
        )} kWh</strong><br>
        📈 Daily average: <strong>${average.toFixed(3)} kWh</strong><br>
        💡 <em>Tip: Maintain usage below ${(average * 0.9).toFixed(
          3
        )} kWh daily to reduce monthly costs by 10%</em>
      `;
      }
    })
    .catch((error) => {
      console.error("Failed to load C-4 consumption data:", error);
      predictionText.textContent = "❌ Error loading consumption data.";
    });
}

// Load Device States Function
async function loadDeviceStates() {
  try {
    // Load light state
    const lightSnapshot = await database.ref("light").once("value");
    const lightState = lightSnapshot.val();
    if (lightState !== null) {
      lightToggle.checked = lightState;
      lightStatusText.textContent = lightState
        ? "🟢 Light is ON"
        : "⚫ Light is OFF";
    }

    // Load outlet state
    const outletSnapshot = await database.ref("outlet").once("value");
    const outletState = outletSnapshot.val();
    if (outletState !== null) {
      outletToggle.checked = outletState;
      outletStatusText.textContent = outletState
        ? "🟢 Outlet is ON"
        : "⚫ Outlet is OFF";
    }
  } catch (error) {
    lightStatusText.textContent = "❌ Failed to load state";
    outletStatusText.textContent = "❌ Failed to load state";
    console.error("Failed to load device states:", error);
  }
}

// Event Listeners
if (setLimitBtn) {
  setLimitBtn.addEventListener("click", setKwhLimitWithModal);
}

if (kwhLimitInput) {
  kwhLimitInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      setKwhLimitWithModal();
    }
  });
}

lightToggle.addEventListener("change", async () => {
  lightToggle.disabled = true;
  try {
    await database.ref("light").set(lightToggle.checked);
    lightStatusText.textContent = lightToggle.checked
      ? "🟢 Light is ON"
      : "⚫ Light is OFF";
    showNotificationStatus(
      `Light ${lightToggle.checked ? "turned on" : "turned off"}`,
      "success"
    );

    // Add notification
    addNotification(
      `💡 Light ${lightToggle.checked ? "Turned On" : "Turned Off"}`,
      `Smart lighting has been ${
        lightToggle.checked ? "activated" : "deactivated"
      }.`,
      "info"
    );
  } catch (error) {
    showNotificationStatus("Failed to control light", "error");
    lightToggle.checked = !lightToggle.checked;
    console.error(error);
  } finally {
    lightToggle.disabled = false;
  }
});

outletToggle.addEventListener("change", async () => {
  outletToggle.disabled = true;
  try {
    await database.ref("outlet").set(outletToggle.checked);
    outletStatusText.textContent = outletToggle.checked
      ? "🟢 Outlet is ON"
      : "⚫ Outlet is OFF";
    showNotificationStatus(
      `Outlet ${outletToggle.checked ? "enabled" : "disabled"}`,
      "success"
    );

    // Add notification
    addNotification(
      `🔌 Outlet ${outletToggle.checked ? "Enabled" : "Disabled"}`,
      `Power outlet has been ${
        outletToggle.checked ? "turned on" : "turned off"
      }.`,
      "info"
    );
  } catch (error) {
    showNotificationStatus("Failed to control outlet", "error");
    outletToggle.checked = !outletToggle.checked;
    console.error(error);
  } finally {
    outletToggle.disabled = false;
  }
});

// Real-time Light Updates
const lightRef = database.ref("light");
lightRef.on("value", (snapshot) => {
  const lightState = snapshot.val();
  if (lightState !== null) {
    lightToggle.checked = lightState;
    lightStatusText.textContent = lightState
      ? "🟢 Light is ON"
      : "⚫ Light is OFF";
  }
});

// Real-time Outlet Updates
const outletRef = database.ref("outlet");
outletRef.on("value", (snapshot) => {
  const outletState = snapshot.val();
  if (outletState !== null) {
    outletToggle.checked = outletState;
    outletStatusText.textContent = outletState
      ? "🟢 Outlet is ON"
      : "⚫ Outlet is OFF";
  }
});

// Real-time Consumption Data Updates
const consumptionsRef = database.ref("consumptions");
consumptionsRef.on("value", (snapshot) => {
  const consumptionData = snapshot.val();
  if (consumptionData) {
    if (window.consumptionData) {
      window.consumptionData = consumptionData;
      const activeTab = document.querySelector(".consumption-tab.active");
      if (activeTab) {
        const tabType = activeTab.id.replace("Tab", "");
        showConsumptionTable(tabType);
      }
    }
  }
});

// Real-time kWh Limit Updates
const kwhLimitRef = database.ref("kwhLimit");
kwhLimitRef.on("value", (snapshot) => {
  const limit = snapshot.val();
  if (limit !== null) {
    const newLimit = parseFloat(limit);

    // Reset notification flags if limit changed
    if (currentKwhLimit !== newLimit) {
      limitReached = false;
      notified90 = false;
      notified95 = false;
    }

    currentKwhLimit = newLimit;
    if (kwhLimitInput) {
      kwhLimitInput.value = currentKwhLimit;
    }

    const currentKwh = parseFloat(currentConsumptionEl.textContent) || 0;
    checkKwhLimit(currentKwh);
  }
});

// Real-time Total Consumption Updates
const totalKwhRef = database.ref("totalKwh");
totalKwhRef.on("value", (snapshot) => {
  const totalKwh = snapshot.val();
  if (totalKwh !== null) {
    displayTotalConsumption(parseFloat(totalKwh));
  }
});

// FCM Token and Messaging
function getMessagingToken() {
  messaging
    .getToken({
      vapidKey:
        "BEDddLrLNwv0yufAFmHwBvbzvBW08d5MD3M5j42KDLJlCWc7_EzPRp2EZWzcSyUa426JwPmCWVYT1pl9Oq3tLHg",
    })
    .then((currentToken) => {
      if (currentToken) {
        console.log("FCM Token:", currentToken);
      }
    })
    .catch((err) => {
      console.error("Error getting FCM token:", err);
    });
}

messaging.onMessage((payload) => {
  console.log("Message received:", payload);
  addNotification(
    payload.notification.title,
    payload.notification.body,
    "info"
  );
  showNotificationStatus(
    payload.notification.title + ": " + payload.notification.body,
    "success"
  );
});

// Initialize the application
async function init() {
  await loadC4ConsumptionData();
  await loadDeviceStates();
  await loadKwhLimit();
  getLatestC4Reading();
  showNotificationStatus("PowerFlow dashboard initialized!", "success");

  // Add welcome notification
  addNotification(
    "🚀 PowerFlow Ready!",
    "Smart energy monitoring is now active. Set your daily limits and monitor your consumption in real-time.",
    "success"
  );
}

init();

// Show modal when setting limit
function showAutoOffModal() {
  document.getElementById("autoOffModal").style.display = "flex";
}

// Handle modal choice
function setAutoOffChoice(choice) {
  autoOffChoice = choice;
  localStorage.setItem("autoOffChoice", choice);
  document.getElementById("autoOffModal").style.display = "none";
  showNotificationStatus("Auto turn-off preference saved!", "success");
}

// Mobile burger menu functionality
const burgerMenuBtn = document.getElementById("burgerMenuBtn");
const mobileNav = document.getElementById("mobileNav");

if (burgerMenuBtn && mobileNav) {
  burgerMenuBtn.addEventListener("click", () => {
    mobileNav.classList.toggle("hide");
  });

  // Hide mobile nav by default
  mobileNav.classList.add("hide");

  // Optional: Hide menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!mobileNav.contains(e.target) && !burgerMenuBtn.contains(e.target)) {
      mobileNav.classList.add("hide");
    }
  });
}

// Override setKwhLimit to show modal after setting limit
async function setKwhLimitWithModal() {
  await setKwhLimit();
  showAutoOffModal();
}

// When limit is exceeded, auto turn off based on choice
async function autoTurnOffIfNeeded() {
  if (limitReached && autoOffChoice !== "none") {
    let turnedOff = [];
    if (
      (autoOffChoice === "light" || autoOffChoice === "both") &&
      lightToggle.checked
    ) {
      await database.ref("light").set(false);
      lightToggle.checked = false;
      lightStatusText.textContent = "⚫ Light is OFF";
      turnedOff.push("Light");
    }
    if (
      (autoOffChoice === "outlet" || autoOffChoice === "both") &&
      outletToggle.checked
    ) {
      await database.ref("outlet").set(false);
      outletToggle.checked = false;
      outletStatusText.textContent = "⚫ Outlet is OFF";
      turnedOff.push("Outlet");
    }
    if (turnedOff.length > 0) {
      showNotificationStatus(
        "Devices turned off automatically due to limit!",
        "warning"
      );
      addNotification(
        "⚡ Devices Turned Off",
        `Selected devices (${turnedOff.join(
          ", "
        )}) were turned off automatically after exceeding the kWh limit.`,
        "warning"
      );
    }
  }
}

// Call autoTurnOffIfNeeded when limit is exceeded
const originalCheckKwhLimit = checkKwhLimit;
function checkKwhLimitWithAutoOff(currentKwh) {
  originalCheckKwhLimit(currentKwh);
  autoTurnOffIfNeeded();
}

// Override checkKwhLimit to include auto-off functionality
checkKwhLimit = checkKwhLimitWithAutoOff;
