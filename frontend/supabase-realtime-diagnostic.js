/**
 * Supabase Realtime + Leaflet Diagnostic Implementation
 *
 * This file contains the complete implementation with diagnostic logging
 * to validate the Supabase realtime payload structure.
 *
 * USAGE:
 * 1. Update SUPABASE_URL and SUPABASE_ANON_KEY with your credentials
 * 2. Update the topic pattern to match your PostgreSQL trigger
 * 3. Include this script in your HTML after Leaflet is loaded
 * 4. Check browser console for diagnostic output
 */

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================

// Supabase credentials
const SUPABASE_URL = "https://<project-ref>.supabase.co";
const SUPABASE_ANON_KEY = "PUBLIC_ANON_KEY";

// Topic pattern - must match what your PostgreSQL trigger broadcasts
// Common patterns: 'features:all', 'data_spasial:all', 'public:data_spasial'
const REALTIME_TOPIC = "features:all"; // adjust to your trigger topic

// ============================================
// DIAGNOSTIC LOGGING UTILITIES
// ============================================

const DiagnosticLogger = {
  // Log with timestamp and type
  log: (type, message, data) => {
    const timestamp = new Date().toISOString();
    const style = getStyleForType(type);
    console.log(`%c[${timestamp}] [${type}] ${message}`, style, data || "");
  },

  // Log payload structure analysis
  analyzePayload: (label, payload) => {
    console.group(`🔍 Payload Analysis: ${label}`);

    // Log raw payload
    console.log("Raw payload:", payload);

    // Analyze top-level properties
    console.log("Top-level keys:", Object.keys(payload));

    // Check for Supabase realtime common patterns
    const analysis = {
      hasEvent: "event" in payload,
      hasPayload: "payload" in payload,
      hasNew:
        payload.payload?.new !== undefined ||
        payload.payload?.NEW !== undefined,
      hasOld:
        payload.payload?.old !== undefined ||
        payload.payload?.OLD !== undefined,
      payloadKeys: payload.payload ? Object.keys(payload.payload) : [],
      eventValue: payload.event || "NOT FOUND",
      newData: payload.payload?.new ?? payload.payload?.NEW ?? null,
      oldData: payload.payload?.old ?? payload.payload?.OLD ?? null,
    };

    console.log("Analysis result:", analysis);
    console.groupEnd();

    return analysis;
  },

  // Log geometry format
  analyzeGeometry: (geometry, label) => {
    if (!geometry) {
      console.warn(`⚠️ Geometry is null/undefined: ${label}`);
      return null;
    }

    console.group(`📍 Geometry Analysis: ${label}`);
    console.log("Geometry type:", geometry.type);
    console.log("Has coordinates:", "coordinates" in geometry);
    console.log(
      "Coordinate structure:",
      geometry.type === "Point"
        ? `[${geometry.coordinates?.[0]}, ${geometry.coordinates?.[1]}]`
        : geometry.coordinates
          ? "Array present"
          : "MISSING",
    );
    console.groupEnd();

    return geometry;
  },
};

// Console styles for different log types
function getStyleForType(type) {
  const styles = {
    INIT: "color: #00bcd4; font-weight: bold;",
    CHANNEL: "color: #2196f3; font-weight: bold;",
    PAYLOAD: "color: #ff9800; font-weight: bold;",
    FEATURE: "color: #4caf50; font-weight: bold;",
    ERROR: "color: #f44336; font-weight: bold;",
    WARNING: "color: #ff5722; font-weight: bold;",
    SUCCESS: "color: #8bc34a; font-weight: bold;",
  };
  return styles[type] || "";
}

// ============================================
// SUPABASE REALTIME IMPLEMENTATION
// ============================================

// Initialize Supabase client
let supabase;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  DiagnosticLogger.log("INIT", "Supabase client created", {
    url: SUPABASE_URL,
  });
} catch (error) {
  DiagnosticLogger.log("ERROR", "Failed to create Supabase client", error);
}

// Initialize Leaflet map (reusing existing or creating new)
let map;
function initDiagnosticMap() {
  // Try to find existing map
  if (typeof L === "undefined") {
    DiagnosticLogger.log(
      "ERROR",
      "Leaflet not loaded! Make sure Leaflet.js is included before this script.",
    );
    return null;
  }

  const existingMap = document.getElementById("map");
  if (!existingMap) {
    DiagnosticLogger.log(
      "WARNING",
      "No #map element found. Creating a temporary map container.",
    );
    // Create temporary container
    const tempContainer = document.createElement("div");
    tempContainer.id = "temp-map";
    tempContainer.style.cssText =
      "position:absolute;top:-9999px;width:100%;height:400px;";
    document.body.appendChild(tempContainer);
    map = L.map("temp-map").setView([-6.2, 106.816], 13);
  } else {
    map = L.map("map");
  }

  // Add tile layer if not present
  if (!map.hasLayer(L.tileLayer)) {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  }

  DiagnosticLogger.log("INIT", "Leaflet map initialized", {
    center: map.getCenter(),
    zoom: map.getZoom(),
  });
  return map;
}

// Layer to hold features keyed by id
const featuresLayer = L.geoJSON(null, {
  onEachFeature: (feature, layer) => {
    const props = feature.properties || {};
    layer.bindPopup(JSON.stringify(props, null, 2));
  },
}).addTo(map);

const markersById = new Map();

// ============================================
// FEATURE HANDLERS WITH DIAGNOSTIC LOGGING
// ============================================

/**
 * Add/update a feature from broadcast payload
 * Includes comprehensive diagnostic logging
 */
function upsertFeature(newObj, source = "unknown") {
  DiagnosticLogger.log(
    "FEATURE",
    `[upsertFeature] Called from: ${source}`,
    newObj,
  );

  if (!newObj) {
    DiagnosticLogger.log(
      "WARNING",
      "[upsertFeature] newObj is null/undefined, skipping",
    );
    return;
  }

  const id = newObj.id;
  if (!id) {
    DiagnosticLogger.log(
      "WARNING",
      "[upsertFeature] No id found in newObj",
      newObj,
    );
    return;
  }

  // Analyze geometry
  const geometry = newObj.geometry; // already JSON (GeoJSON geometry)
  DiagnosticLogger.analyzeGeometry(geometry, `Feature ${id}`);

  // Prepare properties (exclude geometry)
  const properties = { ...newObj };
  delete properties.geometry;

  DiagnosticLogger.log(
    "FEATURE",
    `[upsertFeature] Processing feature id=${id}`,
    {
      geometryType: geometry?.type,
      propertiesKeys: Object.keys(properties),
    },
  );

  const geojsonFeature = {
    type: "Feature",
    geometry,
    properties,
  };

  // Remove old layer if exists
  if (markersById.has(id)) {
    DiagnosticLogger.log(
      "FEATURE",
      `[upsertFeature] Removing existing layer for id=${id}`,
    );
    const layer = markersById.get(id);
    featuresLayer.removeLayer(layer);
    markersById.delete(id);
  }

  // Add new layer
  const addedLayer = L.geoJSON(geojsonFeature, {
    onEachFeature: (feature, layer) => {
      layer.bindPopup(JSON.stringify(properties, null, 2));
    },
  }).addTo(map);

  // Store reference
  markersById.set(id, addedLayer);
  DiagnosticLogger.log(
    "SUCCESS",
    `[upsertFeature] Added/updated feature id=${id}`,
  );
}

/**
 * Remove feature from map
 */
function removeFeature(oldObj, source = "unknown") {
  DiagnosticLogger.log(
    "FEATURE",
    `[removeFeature] Called from: ${source}`,
    oldObj,
  );

  if (!oldObj) {
    DiagnosticLogger.log("WARNING", "[removeFeature] oldObj is null/undefined");
    return;
  }

  const id = oldObj.id;
  if (!id) {
    DiagnosticLogger.log(
      "WARNING",
      "[removeFeature] No id found in oldObj",
      oldObj,
    );
    return;
  }

  const layer = markersById.get(id);
  if (layer) {
    featuresLayer.removeLayer(layer);
    markersById.delete(id);
    DiagnosticLogger.log("SUCCESS", `[removeFeature] Removed feature id=${id}`);
  } else {
    DiagnosticLogger.log(
      "WARNING",
      `[removeFeature] No layer found for id=${id}`,
    );
  }
}

// ============================================
// REALTIME SUBSCRIPTION WITH COMPREHENSIVE LOGGING
// ============================================

function setupRealtimeSubscription() {
  DiagnosticLogger.log(
    "CHANNEL",
    `Setting up realtime subscription to topic: ${REALTIME_TOPIC}`,
  );

  const channel = supabase.channel(REALTIME_TOPIC, {
    config: { private: false }, // Set to true if using private channels with RLS
  });

  // Log ALL broadcast events with full payload analysis
  channel.on("broadcast", { event: "*" }, (payload) => {
    DiagnosticLogger.log(
      "PAYLOAD",
      "=== RAW BROADCAST EVENT RECEIVED ===",
      payload,
    );

    // Analyze the complete payload structure
    const analysis = DiagnosticLogger.analyzePayload(
      "Broadcast Event",
      payload,
    );

    // Extract event type - try multiple patterns
    const eventType = payload.eventType || payload.type || "unknown";
    DiagnosticLogger.log("PAYLOAD", `Detected event type: ${eventType}`);

    // Try to extract new and old data using multiple patterns
    const newData =
      payload.payload?.new ?? payload.payload?.NEW ?? payload.new ?? null;
    const oldData =
      payload.payload?.old ?? payload.payload?.OLD ?? payload.old ?? null;

    DiagnosticLogger.log("PAYLOAD", "Extracted data:", { newData, oldData });

    // Handle based on event type or payload structure
    // Common patterns: INSERT, UPDATE, DELETE, or automatic from PostgreSQL trigger
    if (newData) {
      upsertFeature(newData, "realtime-insert/update");
    }

    if (oldData && (!newData || eventType === "DELETE")) {
      removeFeature(oldData, "realtime-delete");
    }

    // Fallback: if we can't determine the event type, try to upsert anyway
    if (!newData && !oldData) {
      DiagnosticLogger.log(
        "WARNING",
        "Could not extract newData or oldData from payload. Trying to use payload directly.",
        payload,
      );
      if (payload.payload && typeof payload.payload === "object") {
        // Maybe the payload itself is the data
        upsertFeature(payload.payload, "realtime-fallback");
      }
    }
  });

  // Log subscription status changes
  channel.on("system", { event: "*" }, (payload) => {
    DiagnosticLogger.log("CHANNEL", "System event:", payload);
  });

  // Subscribe and log result
  channel.subscribe((status) => {
    DiagnosticLogger.log("CHANNEL", `Subscription status: ${status}`, {
      topic: REALTIME_TOPIC,
      timestamp: new Date().toISOString(),
    });

    if (status === "SUBSCRIBED") {
      DiagnosticLogger.log(
        "SUCCESS",
        "Successfully subscribed to Supabase realtime!",
      );
    } else if (status === "CHANNEL_ERROR") {
      DiagnosticLogger.log(
        "ERROR",
        "Channel error - check your Supabase credentials and topic name",
      );
    } else if (status === "TIMED_OUT") {
      DiagnosticLogger.log(
        "WARNING",
        "Connection timed out - check network connectivity",
      );
    }
  });

  return channel;
}

// ============================================
// INITIAL DATA LOAD WITH DIAGNOSTIC LOGGING
// ============================================

async function loadInitialFeatures() {
  DiagnosticLogger.log("INIT", "Loading initial features from database...");

  try {
    const { data, error } = await supabase
      .from("features") // Adjust table name as needed
      .select("*");

    if (error) {
      DiagnosticLogger.log(
        "ERROR",
        "Error loading features from Supabase",
        error,
      );
      return;
    }

    DiagnosticLogger.log(
      "INIT",
      `Loaded ${data?.length || 0} initial features`,
      data,
    );

    if (data && data.length > 0) {
      data.forEach((row, index) => {
        DiagnosticLogger.log(
          "FEATURE",
          `Processing initial feature ${index + 1}/${data.length}`,
          row,
        );

        // Try to find geometry column (might be 'geometry', 'geom', 'geom_geojson', etc.)
        const geometry = row.geometry ?? row.geom ?? row.geom_geojson ?? null;

        if (geometry) {
          DiagnosticLogger.analyzeGeometry(
            geometry,
            `Initial feature ${row.id || index}`,
          );
        }

        const obj = {
          ...row,
          geometry,
        };
        upsertFeature(obj, "initial-load");
      });

      // Fit map to bounds if we have features
      if (featuresLayer.getLayers().length > 0) {
        map.fitBounds(featuresLayer.getBounds());
        DiagnosticLogger.log(
          "SUCCESS",
          `Map fitted to ${featuresLayer.getLayers().length} features`,
        );
      }
    }
  } catch (err) {
    DiagnosticLogger.log("ERROR", "Exception during initial load", err);
  }
}

// ============================================
// TEST FUNCTION - SIMULATE PAYLOAD (FOR DEBUGGING)
// ============================================

window.testSupabasePayload = function (testPayload) {
  console.group("🧪 TEST PAYLOAD INJECTED");
  console.log("Test payload:", testPayload);

  // Simulate what the channel.on('broadcast') handler would do
  DiagnosticLogger.analyzePayload("Test Payload", testPayload);

  const newData =
    testPayload.payload?.new ??
    testPayload.payload?.NEW ??
    testPayload.new ??
    null;
  const oldData =
    testPayload.payload?.old ??
    testPayload.payload?.OLD ??
    testPayload.old ??
    null;

  if (newData) upsertFeature(newData, "test");
  if (oldData && !newData) removeFeature(oldData, "test");

  console.groupEnd();
};

// ============================================
// HELPER: LIST OF COMMON PAYLOAD PATTERNS
// ============================================

window.SupabaseDebugPatterns = {
  // Pattern 1: Supabase standard
  standard: {
    eventType: "INSERT",
    payload: {
      new: {
        id: 1,
        name: "Test",
        geometry: { type: "Point", coordinates: [106.816, -6.2] },
      },
    },
  },

  // Pattern 2: PostgreSQL trigger (uppercase NEW/OLD)
  postgresTrigger: {
    event: "INSERT",
    payload: {
      NEW: {
        id: 1,
        name: "Test",
        geometry: { type: "Point", coordinates: [106.816, -6.2] },
      },
    },
  },

  // Pattern 3: Direct payload (no nested structure)
  direct: {
    id: 1,
    name: "Test",
    geometry: { type: "Point", coordinates: [106.816, -6.2] },
  },

  // Pattern 4: Delete operation
  delete: {
    eventType: "DELETE",
    payload: { old: { id: 1, name: "Test" } },
  },
};

// ============================================
// INITIALIZATION
// ============================================

// Auto-initialize when DOM is ready and Leaflet + Supabase are loaded
function autoInit() {
  if (typeof L === "undefined") {
    DiagnosticLogger.log("WARNING", "Leaflet not loaded yet, waiting...");
    setTimeout(autoInit, 100);
    return;
  }

  if (typeof createClient === "undefined") {
    DiagnosticLogger.log(
      "WARNING",
      "Supabase createClient not loaded yet, waiting...",
    );
    setTimeout(autoInit, 100);
    return;
  }

  DiagnosticLogger.log(
    "INIT",
    "Starting Supabase Realtime diagnostic implementation",
  );

  // Initialize map
  initDiagnosticMap();

  // Setup realtime subscription
  setupRealtimeSubscription();

  // Load initial features
  loadInitialFeatures();

  // Log available test patterns
  console.log(
    "%c📋 Available test patterns:",
    "color: #00bcd4; font-weight: bold;",
    "Use window.testSupabasePayload(window.SupabaseDebugPatterns.standard) to test",
  );
}

// Start initialization
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoInit);
} else {
  autoInit();
}

DiagnosticLogger.log(
  "INIT",
  "Diagnostic script loaded. Check configuration and ensure Supabase credentials are set.",
);
