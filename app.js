// app.js - core logic for Ultra Route Sniper (modified)

const DB_NAME = "ultra-route-sniper";
const DB_VERSION = 1;
const GPX_STORE = "gpxTracks";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_POI_FILTERS = [
  "lodging",
  "fuel",
  "bikeshop",
  "grocery",
  "restaurant",
  "cafe",
  "fastfood",
  "water",
  "camping",
  "shelter",
];
const DEFAULT_RANGE_BY_MODE = {
  plan: { startKm: 50, endKm: 120 },
  live: { startKm: 80, endKm: 120 },
};

let db;
let routePoints = []; // { lat, lon, cumDistKm }
let lastGeoPosition = null; // { lat, lon }
let lastRouteMatch = null; // { kmOnRoute, distanceToRouteKm }
let activePoiFilters = new Set(DEFAULT_POI_FILTERS);
let lastScanResults = [];
let lastScanSegmentPoints = [];
let lastScanRange = null; // { startKmAhead, endKmAhead, corridorWidthKm }
let mapInstance = null;
let mapRouteLayer = null;
let mapRouteCasingLayer = null;
let mapUnpavedLayer = null;
let mapPoiLayer = null;
let mapStartEndLayer = null;
let mapPoiMarkerByKey = new Map();
let mapPoiDataByKey = new Map();
let mapTileLayer = null;
let mapBaseLayers = null;
let mapLegendControl = null;
let currentTileProviderName = "OpenStreetMap";
let tileErrorCount = 0;
let hasSwitchedTileProvider = false;
let surfaceAnalysisToken = 0;
const surfaceOverlayCache = new Map();
let showUnpavedOverlay = true;
let activeUnpavedMode = "conservative";
let activeRangeMode = "plan"; // plan | live

const POI_CATEGORY_COLORS = {
  lodging:    "#3b82f6",
  fuel:       "#f59e0b",
  bikeshop:   "#0ea5e9",
  grocery:    "#ef4444",
  restaurant: "#dc2626",
  cafe:       "#d97706",
  fastfood:   "#b91c1c",
  water:      "#06b6d4",
  camping:    "#22c55e",
  shelter:    "#a855f7",
  custom:     "#ec4899",
  other:      "#9ca3af",
};

const UNPAVED_SURFACE_COLOR = "#f97316";
const UNPAVED_MODE_CONFIG = {
  normal: {
    proximityThresholdKm: 0.08,
    minSegmentKm: 0.12,
    includeCompacted: true,
    includeGrade3: true,
    allowTrackWithoutSurface: true,
  },
  conservative: {
    proximityThresholdKm: 0.03,
    minSegmentKm: 0.35,
    includeCompacted: false,
    includeGrade3: false,
    allowTrackWithoutSurface: false,
  },
};
const UNPAVED_SURFACES = new Set([
  "unpaved", "gravel", "fine_gravel", "compacted", "dirt", "ground",
  "earth", "mud", "sand", "grass", "grass_paver", "pebblestone", "woodchips",
]);
const PAVED_SURFACES = new Set([
  "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
  "paving_stones", "sett", "cobblestone", "chipseal",
]);
const UNPAVED_TRACKTYPES = new Set(["grade4", "grade5"]);
const NON_RIDEABLE_HIGHWAYS = new Set([
  "footway", "pedestrian", "steps", "corridor", "bridleway",
]);
const BIKE_OK_VALUES = new Set(["yes", "designated", "permissive", "official"]);

const TILE_PROVIDERS = {
  OpenStreetMap: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  CartoLight: {
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    options: {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
    },
  },
};

const SUPPORTED_THEMES = ["system", "light", "dark"];
const SUPPORTED_NAV_APPS = ["system", "mapy", "google", "apple"];

// =====================================================================
// TRANSLATIONS (Deutsch only)
// =====================================================================
const I18N = {
  "app.title": "Ultra Route Sniper",
  "app.subtitle": "Offline PWA · GPX · POI-Suche",
  "app.themeLabel": "Modus",
  "app.themeSystem": "System",
  "app.themeLight": "Hell",
  "app.themeDark": "Dunkel",
  "app.navAppLabel": "Navigation",
  "app.navAppSystem": "Standard",
  "app.navAppMapy": "Mapy",
  "app.navAppGoogle": "Google Maps",
  "app.navAppApple": "Apple Karten",
  "app.footerBy": "Von Thomas Fischer (@bikepeopletom)",
  "app.footerTagline": "Proudly built in Switzerland for the ultracycling community.",
  "app.footerDonate": "Unterstützen",
  "upload.title": "1. GPX-Strecke laden",
  "upload.hint": "GPX einmal laden. Danach bleibt die Strecke lokal gespeichert (offline nutzbar).",
  "upload.chooseFile": "Datei wählen",
  "upload.useStored": "Gespeicherte Strecke laden",
  "location.title": "2. Ortung",
  "location.hint": "Standort bestimmen und Route abgleichen.",
  "location.startButton": "Standort bestimmen",
  "sniper.title": "3. POI-Suche",
  "sniper.hint": "Suche POIs im gewählten Kilometerfenster entlang der Route.",
  "sniper.modePlan": "Ab Routenstart",
  "sniper.modeLive": "Ab aktuellem Standort",
  "sniper.modePlanHint": "Sucht ab Routenstart (km 0).",
  "sniper.modeLiveHint": "Sucht ab aktuellem Standort auf der Route.",
  "sniper.modeInfo": "Modus bestimmt den Startpunkt für die Suche: Routenstart oder aktueller Standort.",
  "sniper.windowLabel": "Gewünschter Suchbereich (km entlang der Route):",
  "sniper.windowInfo": "Von/Bis definiert den Suchbereich in Kilometern ab dem gewählten Modus.",
  "sniper.corridorLabel": "Max. Abstand links/rechts der Route:",
  "sniper.corridorInfo": "Nur POIs innerhalb dieses Abstands zur Route werden angezeigt.",
  "sniper.corridorRange": "km (1–10)",
  "sniper.scanButton": "POIs suchen",
  "sniper.filterTitle": "POI-Filter (ein/aus):",
  "sniper.clearFilters": "Alle Filter deaktivieren",
  "sniper.ctaHint": "Filter gesetzt? Dann POIs suchen.",
  "sniper.showMapButton": "Karte anzeigen",
  "sniper.customLabel": "Spontansuche (freier Begriff):",
  "sniper.customHint": "z.B. Krankenhaus, Polizei, Apotheke, Supermarkt …",
  "sniper.customPlaceholder": "z.B. Krankenhaus",
  "sniper.customButton": "Suchen",
  "sniper.customSearching": "Suche nach \"{term}\" …",
  "sniper.customNone": "Keine Treffer für \"{term}\" im gewählten Korridor.",
  "sniper.customFound": "{count} Treffer für \"{term}\".",
  "sniper.customError": "Fehler bei der Spontansuche. Bitte erneut versuchen.",
  "sniper.customNeedRoute": "Bitte zuerst eine GPX-Strecke laden.",
  "map.backToList": "Zur Liste",
  "map.unpavedToggle": "Unbefestigt",
  "map.unpavedModeLabel": "Unpaved-Modus",
  "map.unpavedModeConservative": "Konservativ",
  "map.unpavedModeNormal": "Normal",
  "map.unpavedModeInfo": "Konservativ zeigt weniger, aber sicherere unbefestigte Abschnitte. Normal zeigt mehr Treffer.",
  "map.title": "Kartenansicht",
  "poi.lodging": "Unterkunft",
  "poi.fuel": "Tankstelle",
  "poi.bikeshop": "Bike Shop",
  "poi.grocery": "Shop",
  "poi.restaurant": "Restaurant",
  "poi.cafe": "Cafe/Bäckerei",
  "poi.fastfood": "Fast Food",
  "poi.water": "Wasser",
  "poi.camping": "Camping",
  "poi.shelter": "Shelter",
  "poi.custom": "Spontansuche",
  "poi.other": "POI",
  "poi.call": "Anrufen",
  "poi.openMaps": "Route starten",
  "poi.navigate": "Bring mich hin",
  "poi.onMap": "POI auf Karte",
  "status.modeChanged": "Suchmodus gewechselt. Bitte Suche neu starten.",
  "status.noFilterSelected": "Keine Filter aktiv – bitte mindestens eine Kategorie wählen.",
  "status.activeCategories": "Aktive Kategorien: {categories}",
  "status.dbInitError": "Fehler beim Initialisieren des lokalen Speichers.",
  "status.noStoredTrack": "Keine Strecke gespeichert. Bitte GPX laden.",
  "status.storedTrackFound": "Strecke gefunden ({points} Punkte).",
  "status.storedTrackLoaded": "Strecke geladen ({points} Punkte).",
  "status.storedTrackLoadError": "Fehler beim Laden der gespeicherten Strecke.",
  "status.readingGpx": "Lese GPX-Datei …",
  "status.gpxNoPoints": "Keine gültigen Trackpunkte in der GPX-Datei gefunden.",
  "status.gpxLoaded": "Strecke geladen ({points} Punkte, ca. {km} km).",
  "status.gpxParseError": "Fehler beim Parsen der GPX-Datei.",
  "status.gpxReadError": "Fehler beim Lesen der Datei.",
  "status.geoUnsupported": "Geolocation wird von diesem Gerät nicht unterstützt.",
  "status.geoLocating": "Standort wird bestimmt …",
  "status.geoPosition": "Lat: {lat}, Lon: {lon} (+/−{acc} m)",
  "status.geoDenied": "Ortungszugriff verweigert. Bitte im Browser erlauben.",
  "status.geoTimeout": "Ortung dauerte zu lange. Bitte erneut versuchen.",
  "status.geoGeneric": "Fehler bei der Ortung.",
  "status.routeMissing": "Noch keine Strecke im Speicher. Bitte zuerst GPX laden oder gespeicherte Strecke aktivieren.",
  "status.routeUnknown": "Konnte Position auf der Route nicht bestimmen.",
  "status.routeNear": "Du liegst sehr nah an der Strecke.",
  "status.routeAway": "Abstand zur Strecke ca. {km} km.",
  "status.routePosition": "Position auf der Route: km {km}. {distanceText}",
  "status.liveNeedsLocation": "Keine aktuelle Position auf der Route bekannt. Bitte zuerst Standort bestimmen.",
  "status.invalidRange": "Bitte gültige Kilometerangaben eingeben.",
  "status.invalidRangeOrder": "Der Endwert muss größer als der Startwert sein.",
  "status.routeLengthUnknown": "Streckenlänge unbekannt (GPX nicht geladen?).",
  "status.windowOutside": "Fenster außerhalb der Strecke ({mode}). Referenz km {ref} von {total} (Rest: {rest} km).",
  "status.scanning": "Suche {mode}: km {start} bis {end} …",
  "status.noSegmentPoints": "Keine Punkte im gewählten Abschnitt gefunden.",
  "status.noPois": "Keine passenden POIs im gewählten Korridor gefunden.",
  "status.poisFound": "{count} Orte im Korridor gefunden.",
  "status.poiLoadError": "Fehler beim Laden der POIs (Overpass). Bitte nochmals versuchen.",
  "status.mapNoScan": "Keine Scan-Daten vorhanden. Bitte zuerst einen POI-Scan starten.",
  "status.mapUnavailable": "Karte konnte nicht geladen werden (Leaflet nicht verfügbar).",
  "status.mapNeedScan": "Bitte zuerst einen POI-Scan starten.",
  "status.mapTilesLoaded": "Basemap: {provider} | Tiles geladen",
  "status.mapTileErrors": "Basemap: {provider} | Tile-Fehler: {count}",
  "status.mapTileSwitched": "Basemap gewechselt (Tile-Fehler). Bitte Netz/CSP prüfen.",
  "status.mapTileBlocked": "Karten-Tiles blockiert. Externe Domains im Hosting prüfen.",
  "status.mapUnpavedAnalyzing": "Basemap: {provider} | analysiere Untergrund …",
  "status.mapUnpavedKm": "Basemap: {provider} | Unbefestigt ~{km} km",
  "status.mapUnpavedUnavailable": "Basemap: {provider} | Untergrund-Analyse nicht verfügbar",
  "status.mapUnpavedOn": "Basemap: {provider} | Unbefestigt eingeblendet",
  "status.mapUnpavedOff": "Basemap: {provider} | Unbefestigt ausgeblendet",
  "status.mapScanMeta": "Basemap: {provider} | Routepunkte: {routePoints} | POIs: {poiCount}",
  "map.legendRoute": "Route",
  "map.legendUnpaved": "Unbefestigt",
  "map.legendLodging": "Unterkunft",
  "map.legendFuel": "Tankstelle",
  "map.legendBikeshop": "Bike Shop",
  "map.legendGrocery": "Shop",
  "map.legendRestaurant": "Restaurant",
  "map.legendCafe": "Cafe/Bäckerei",
  "map.legendFastfood": "Fast Food",
  "map.legendWater": "Wasser",
  "map.legendCamping": "Camping",
  "map.legendShelter": "Shelter",
  "map.scanWindowTitle": "{mode} | Fenster {start}–{end} km | Breite {corridor} km",
  "map.modePlan": "Ab Routenstart (km 0)",
  "map.modeLive": "Ab Standort (km {ref})",
  "map.startTooltip": "Fenster-Start",
  "map.endTooltip": "Fenster-Ende",
  "poi.popupDistance": "{distance} km voraus",
  "poi.popupNoNumber": "Keine Nummer",
};

// =====================================================================
// CUSTOM POI TERM → OVERPASS QUERY MAPPING
// =====================================================================
const CUSTOM_TERM_MAP = {
  // Deutsch
  "krankenhaus":   [["amenity", "hospital"]],
  "hospital":      [["amenity", "hospital"]],
  "notaufnahme":   [["amenity", "hospital"]],
  "arzt":          [["amenity", "doctors"]],
  "apotheke":      [["amenity", "pharmacy"]],
  "pharmacy":      [["amenity", "pharmacy"]],
  "polizei":       [["amenity", "police"]],
  "police":        [["amenity", "police"]],
  "feuerwehr":     [["amenity", "fire_station"]],
  "supermarkt":    [["shop", "supermarket"]],
  "supermarket":   [["shop", "supermarket"]],
  "tankstelle":    [["amenity", "fuel"]],
  "werkstatt":     [["shop", "bicycle"], ["shop", "car_repair"]],
  "bike shop":     [["shop", "bicycle"]],
  "bikeshop":      [["shop", "bicycle"]],
  "fahrrad":       [["shop", "bicycle"]],
  "atm":           [["amenity", "atm"]],
  "bankomat":      [["amenity", "atm"]],
  "geldautomat":   [["amenity", "atm"]],
  "bank":          [["amenity", "bank"]],
  "toilette":      [["amenity", "toilets"]],
  "toilet":        [["amenity", "toilets"]],
  "wc":            [["amenity", "toilets"]],
  "campingplatz":  [["tourism", "camp_site"]],
  "camping":       [["tourism", "camp_site"]],
  "hotel":         [["tourism", "hotel"]],
  "hostel":        [["tourism", "hostel"]],
  "unterkunft":    [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "hostel"]],
  "wasser":        [["amenity", "drinking_water"]],
  "trinkwasser":   [["amenity", "drinking_water"]],
  "post":          [["amenity", "post_office"]],
  "postamt":       [["amenity", "post_office"]],
  "drogerie":      [["shop", "chemist"]],
  "bäckerei":      [["shop", "bakery"]],
  "baeckerei":     [["shop", "bakery"]],
  "bakery":        [["shop", "bakery"]],
  "café":          [["amenity", "cafe"]],
  "cafe":          [["amenity", "cafe"]],
  "restaurant":    [["amenity", "restaurant"]],
};

let currentTheme = "system";
let currentNavApp = "system";
const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  initDB()
    .then(() => checkStoredGpx())
    .catch((err) => {
      console.error("DB init failed", err);
      setStatus("gpx-status", t("status.dbInitError"), "error");
    });
  registerServiceWorker();
});

function initUI() {
  const gpxInput          = document.getElementById("gpx-file-input");
  const useStoredBtn      = document.getElementById("use-stored-gpx-btn");
  const locateBtn         = document.getElementById("locate-btn");
  const sniperBtn         = document.getElementById("sniper-btn");
  const showMapBtn        = document.getElementById("show-map-btn");
  const backToListBtn     = document.getElementById("back-to-list-btn");
  const unpavedToggle     = document.getElementById("unpaved-toggle");
  const unpavedModeSelect = document.getElementById("unpaved-mode-select");
  const filterContainer   = document.querySelector(".poi-filters");
  const clearFiltersBtn   = document.getElementById("clear-filters-btn");
  const rangeModeContainer = document.querySelector(".range-mode");
  const themeSelect       = document.getElementById("theme-select");
  const navAppSelect      = document.getElementById("navapp-select");
  const customPoiBtn      = document.getElementById("custom-poi-btn");

  gpxInput.addEventListener("change", handleGpxFileSelect);
  useStoredBtn.addEventListener("click", async () => {
    await loadStoredGpxIntoMemory();
    updateSniperButtonState();
  });
  locateBtn.addEventListener("click", handleLocateClick);
  sniperBtn.addEventListener("click", handleSniperClick);
  showMapBtn.addEventListener("click", handleShowMapClick);
  backToListBtn.addEventListener("click", () => toggleMapView(false));

  if (unpavedToggle) {
    unpavedToggle.checked = showUnpavedOverlay;
    unpavedToggle.addEventListener("change", (event) => {
      showUnpavedOverlay = !!event.target.checked;
      if (showUnpavedOverlay && !mapUnpavedLayer && lastScanSegmentPoints.length) {
        updateUnpavedOverlay(getRenderableRouteLatLngs());
      } else {
        applyUnpavedVisibility();
      }
    });
  }
  if (unpavedModeSelect) {
    unpavedModeSelect.addEventListener("change", (event) => {
      setUnpavedMode(event.target.value);
    });
  }
  if (filterContainer) {
    filterContainer.addEventListener("click", handleFilterClick);
  }
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", handleClearFiltersClick);
  }
  if (rangeModeContainer) {
    rangeModeContainer.addEventListener("click", handleRangeModeClick);
  }
  if (themeSelect) {
    themeSelect.addEventListener("change", (event) => setTheme(event.target.value));
  }
  if (navAppSelect) {
    navAppSelect.addEventListener("change", (event) => setNavApp(event.target.value));
  }
  if (customPoiBtn) {
    customPoiBtn.addEventListener("click", handleCustomPoiClick);
  }
  // Allow Enter key in custom search field
  const customPoiInput = document.getElementById("custom-poi-input");
  if (customPoiInput) {
    customPoiInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleCustomPoiClick();
    });
  }

  document.addEventListener("click", handlePoiActionClick);
  systemThemeMedia.addEventListener("change", () => {
    if (currentTheme === "system") applyTheme("system");
  });

  initNavApp();
  initUnpavedMode();
  initTheme();
  applyStaticTranslations();
  applyRangeModeUI(false);
}

// ---------- TRANSLATION ----------

function t(key, vars = {}) {
  const raw = I18N[key] || key;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    raw,
  );
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  });
}

// ---------- THEME ----------

function initTheme() {
  const storedTheme = localStorage.getItem("ultraRouteSniperTheme");
  const selected = SUPPORTED_THEMES.includes(storedTheme) ? storedTheme : "system";
  setTheme(selected);
}

function setTheme(theme) {
  const normalized = SUPPORTED_THEMES.includes(theme) ? theme : "system";
  currentTheme = normalized;
  localStorage.setItem("ultraRouteSniperTheme", normalized);
  const select = document.getElementById("theme-select");
  if (select) select.value = normalized;
  applyTheme(normalized);
}

function applyTheme(theme) {
  const resolved =
    theme === "system" ? (systemThemeMedia.matches ? "dark" : "light") : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

// ---------- UNPAVED MODE ----------

function initUnpavedMode() {
  const stored = localStorage.getItem("ultraRouteSniperUnpavedMode");
  const selected = stored === "normal" || stored === "conservative" ? stored : "conservative";
  setUnpavedMode(selected, false);
}

function setUnpavedMode(mode, refresh = true) {
  const normalized = mode === "normal" ? "normal" : "conservative";
  activeUnpavedMode = normalized;
  localStorage.setItem("ultraRouteSniperUnpavedMode", normalized);
  const select = document.getElementById("unpaved-mode-select");
  if (select) select.value = normalized;
  if (!refresh) return;
  if (!lastScanSegmentPoints.length || !mapInstance) return;
  updateUnpavedOverlay(getRenderableRouteLatLngs());
}

function getUnpavedModeConfig() {
  return UNPAVED_MODE_CONFIG[activeUnpavedMode] || UNPAVED_MODE_CONFIG.conservative;
}

// ---------- NAV APP ----------

function initNavApp() {
  const stored = localStorage.getItem("ultraRouteSniperNavApp");
  const selected = SUPPORTED_NAV_APPS.includes(stored) ? stored : "system";
  setNavApp(selected);
}

function setNavApp(app) {
  const normalized = SUPPORTED_NAV_APPS.includes(app) ? app : "system";
  currentNavApp = normalized;
  localStorage.setItem("ultraRouteSniperNavApp", normalized);
  const select = document.getElementById("navapp-select");
  if (select) select.value = normalized;
}

// ---------- STATUS HELPERS ----------

function setStatus(elementId, text, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("error", "info");
  if (type) el.classList.add(type);
}

function updateSniperButtonState() {
  const sniperBtn = document.getElementById("sniper-btn");
  if (!sniperBtn) return;
  const hasRoute    = routePoints && routePoints.length > 0;
  const hasPosition = activeRangeMode === "live" ? !!lastRouteMatch : true;
  const hasFilters  = activePoiFilters.size > 0;
  sniperBtn.disabled = !(hasRoute && hasPosition && hasFilters);
}

function handleFilterClick(event) {
  const target = event.target;
  if (!target.matches(".chip[data-poi-filter]")) return;
  const key = target.getAttribute("data-poi-filter");
  if (!key) return;

  if (activePoiFilters.has(key)) {
    activePoiFilters.delete(key);
    target.classList.remove("active");
  } else {
    activePoiFilters.add(key);
    target.classList.add("active");
  }

  const filterInfo =
    activePoiFilters.size === 0
      ? t("status.noFilterSelected")
      : t("status.activeCategories", {
          categories: Array.from(activePoiFilters)
            .map((c) => t(`poi.${c}`))
            .join(", "),
        });

  setStatus("sniper-status", filterInfo, "info");
  document.getElementById("show-map-btn").disabled = true;
  updateSniperButtonState();
  if (mapInstance && mapLegendControl) addOrUpdateMapLegend();
}

function handleClearFiltersClick() {
  activePoiFilters.clear();
  document.querySelectorAll(".chip[data-poi-filter]").forEach((chip) => {
    chip.classList.remove("active");
  });
  setStatus("sniper-status", t("status.noFilterSelected"), "info");
  document.getElementById("show-map-btn").disabled = true;
  updateSniperButtonState();
  if (mapInstance && mapLegendControl) addOrUpdateMapLegend();
}

function handleRangeModeClick(event) {
  const target = event.target.closest(".chip[data-range-mode]");
  if (!target) return;
  const mode = target.getAttribute("data-range-mode");
  if (!mode || (mode !== "plan" && mode !== "live")) return;
  if (mode === activeRangeMode) return;

  activeRangeMode = mode;
  applyRangeModeUI(true);
  lastScanResults = [];
  lastScanSegmentPoints = [];
  lastScanRange = null;
  const showMapBtn = document.getElementById("show-map-btn");
  if (showMapBtn) showMapBtn.disabled = true;
  setStatus("sniper-status", t("status.modeChanged"), "info");
  updateSniperButtonState();
}

function applyRangeModeUI(applyDefaults) {
  document.querySelectorAll(".chip[data-range-mode]").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-range-mode") === activeRangeMode);
  });

  const hint = document.getElementById("range-mode-hint");
  if (hint) {
    hint.textContent =
      activeRangeMode === "live" ? t("sniper.modeLiveHint") : t("sniper.modePlanHint");
  }

  if (applyDefaults) {
    const startInput = document.getElementById("range-start");
    const endInput   = document.getElementById("range-end");
    const defaults   = DEFAULT_RANGE_BY_MODE[activeRangeMode];
    if (startInput) startInput.value = String(defaults.startKm);
    if (endInput)   endInput.value   = String(defaults.endKm);
  }
}

function getCorridorWidthKm() {
  const input = document.getElementById("corridor-width");
  if (!input) return 2;
  let val = Number(input.value || 2);
  if (Number.isNaN(val)) val = 2;
  return Math.max(1, Math.min(10, val));
}

// ---------- INDEXEDDB ----------

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(GPX_STORE)) {
        db.createObjectStore(GPX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = (event) => { db = event.target.result; resolve(); };
    request.onerror   = () => reject(request.error);
  });
}

function saveGpxToDB(parsed) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialised"));
    const tx    = db.transaction(GPX_STORE, "readwrite");
    const store = tx.objectStore(GPX_STORE);
    const req   = store.put({ id: "main-route", createdAt: Date.now(), points: parsed });
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function getStoredGpx() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialised"));
    const tx    = db.transaction(GPX_STORE, "readonly");
    const store = tx.objectStore(GPX_STORE);
    const req   = store.get("main-route");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  });
}

async function checkStoredGpx() {
  try {
    const record = await getStoredGpx();
    const btn = document.getElementById("use-stored-gpx-btn");
    if (record && record.points && record.points.length > 0) {
      btn.disabled = false;
      setStatus("gpx-status", t("status.storedTrackFound", { points: record.points.length }), "info");
    } else {
      btn.disabled = true;
      setStatus("gpx-status", t("status.noStoredTrack"));
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadStoredGpxIntoMemory() {
  try {
    const record = await getStoredGpx();
    if (!record || !record.points || record.points.length === 0) {
      setStatus("gpx-status", t("status.noStoredTrack"), "error");
      return;
    }
    routePoints = record.points;
    setStatus("gpx-status", t("status.storedTrackLoaded", { points: routePoints.length }), "info");
  } catch (err) {
    console.error(err);
    setStatus("gpx-status", t("status.storedTrackLoadError"), "error");
  }
}

// ---------- GPX HANDLING ----------

function handleGpxFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  setStatus("gpx-status", t("status.readingGpx"));

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text   = e.target.result;
      const parsed = parseGpx(text);
      if (!parsed || parsed.length === 0) {
        setStatus("gpx-status", t("status.gpxNoPoints"), "error");
        return;
      }
      routePoints = parsed;
      await saveGpxToDB(parsed);
      document.getElementById("use-stored-gpx-btn").disabled = false;
      setStatus("gpx-status",
        t("status.gpxLoaded", { points: parsed.length, km: parsed[parsed.length - 1].cumDistKm.toFixed(1) }),
        "info",
      );
    } catch (err) {
      console.error(err);
      setStatus("gpx-status", t("status.gpxParseError"), "error");
    }
  };
  reader.onerror = () => setStatus("gpx-status", t("status.gpxReadError"), "error");
  reader.readAsText(file);
}

function parseGpx(xmlText) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("GPX parse error");
  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
  if (trkpts.length === 0) {
    return computeCumulativeDistances(Array.from(doc.getElementsByTagName("rtept")));
  }
  return computeCumulativeDistances(trkpts);
}

function computeCumulativeDistances(pointElements) {
  const points = [];
  let cumDist  = 0;
  let prev     = null;
  for (const el of pointElements) {
    const lat = parseFloat(el.getAttribute("lat"));
    const lon = parseFloat(el.getAttribute("lon"));
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    if (prev) cumDist += haversineKm(prev.lat, prev.lon, lat, lon);
    prev = { lat, lon };
    points.push({ lat, lon, cumDistKm: cumDist });
  }
  return points;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- ROUTE MATCHING ----------

function getRoutePositionForLocation(lat, lon) {
  if (!routePoints || routePoints.length === 0) return null;
  let bestIndex = 0;
  let bestDist  = Infinity;
  for (let i = 0; i < routePoints.length; i += 5) {
    const d = haversineKm(lat, lon, routePoints[i].lat, routePoints[i].lon);
    if (d < bestDist) { bestDist = d; bestIndex = i; }
  }
  return { kmOnRoute: routePoints[bestIndex].cumDistKm, distanceToRouteKm: bestDist };
}

function getRouteSegmentBetweenKm(startKm, endKm) {
  if (!routePoints || routePoints.length === 0) return [];
  const s = Math.max(0, Math.min(startKm, endKm));
  const e = Math.max(startKm, endKm);
  return routePoints.filter((p) => p.cumDistKm >= s && p.cumDistKm <= e);
}

function findNearestRouteKmForLatLon(lat, lon) {
  if (!routePoints || routePoints.length === 0) return null;
  let bestKm   = 0;
  let bestDist = Infinity;
  for (let i = 0; i < routePoints.length; i += 5) {
    const d = haversineKm(lat, lon, routePoints[i].lat, routePoints[i].lon);
    if (d < bestDist) { bestDist = d; bestKm = routePoints[i].cumDistKm; }
  }
  return { kmOnRoute: bestKm, distanceToRouteKm: bestDist };
}

// ---------- GEOLOCATION ----------

function handleLocateClick() {
  if (!("geolocation" in navigator)) {
    setStatus("location-status", t("status.geoUnsupported"), "error");
    return;
  }
  setStatus("location-status", t("status.geoLocating"));
  const btn = document.getElementById("locate-btn");
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      const { latitude, longitude, accuracy } = pos.coords;
      setStatus("location-status",
        t("status.geoPosition", { lat: latitude.toFixed(5), lon: longitude.toFixed(5), acc: Math.round(accuracy) }),
        "info",
      );
      updateRoutePosition(latitude, longitude);
    },
    (err) => {
      btn.disabled = false;
      let msg = t("status.geoGeneric");
      if (err.code === err.PERMISSION_DENIED) msg = t("status.geoDenied");
      else if (err.code === err.TIMEOUT)      msg = t("status.geoTimeout");
      setStatus("location-status", msg, "error");
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 },
  );
}

function updateRoutePosition(lat, lon) {
  if (!routePoints || routePoints.length === 0) {
    setStatus("route-position", t("status.routeMissing"), "error");
    return;
  }
  const match = getRoutePositionForLocation(lat, lon);
  if (!match) { setStatus("route-position", t("status.routeUnknown"), "error"); return; }

  lastGeoPosition = { lat, lon };
  lastRouteMatch  = match;

  const { kmOnRoute, distanceToRouteKm } = match;
  const distanceDisplay =
    distanceToRouteKm < 0.05
      ? t("status.routeNear")
      : t("status.routeAway", { km: distanceToRouteKm.toFixed(2) });

  setStatus("route-position",
    t("status.routePosition", { km: kmOnRoute.toFixed(1), distanceText: distanceDisplay }),
    "info",
  );
  updateSniperButtonState();
}

// ---------- SNIPER MODE (POI SCAN) ----------

async function handleSniperClick() {
  if (activeRangeMode === "live" && (!lastRouteMatch || !lastGeoPosition)) {
    setStatus("sniper-status", t("status.liveNeedsLocation"), "error");
    return;
  }

  const startKmAhead = Number(document.getElementById("range-start").value || 0);
  const endKmAhead   = Number(document.getElementById("range-end").value || 0);
  const poiList      = document.getElementById("poi-list");
  const showMapBtn   = document.getElementById("show-map-btn");

  if (Number.isNaN(startKmAhead) || Number.isNaN(endKmAhead)) {
    setStatus("sniper-status", t("status.invalidRange"), "error");
    return;
  }
  if (endKmAhead <= startKmAhead) {
    setStatus("sniper-status", t("status.invalidRangeOrder"), "error");
    return;
  }

  const routeTotalKm  = routePoints?.length ? routePoints[routePoints.length - 1].cumDistKm : 0;
  const referenceKm   = activeRangeMode === "live" ? lastRouteMatch.kmOnRoute || 0 : 0;
  const modeLabel     = activeRangeMode === "live"
    ? t("map.modeLive", { ref: referenceKm.toFixed(1) })
    : t("map.modePlan");
  const segmentStartKm = referenceKm + startKmAhead;
  const segmentEndKm   = Math.min(referenceKm + endKmAhead, routeTotalKm);

  if (!routeTotalKm) {
    setStatus("sniper-status", t("status.routeLengthUnknown"), "error");
    return;
  }
  if (segmentEndKm <= segmentStartKm) {
    const remainingKm = Math.max(0, routeTotalKm - referenceKm);
    setStatus("sniper-status",
      t("status.windowOutside", { mode: modeLabel, ref: referenceKm.toFixed(1), total: routeTotalKm.toFixed(1), rest: remainingKm.toFixed(1) }),
      "error",
    );
    return;
  }

  poiList.innerHTML = "";
  showMapBtn.disabled = true;
  setStatus("sniper-status",
    t("status.scanning", { mode: modeLabel, start: segmentStartKm.toFixed(1), end: segmentEndKm.toFixed(1) }),
    "info",
  );

  const sniperBtn = document.getElementById("sniper-btn");
  sniperBtn.disabled = true;

  try {
    const segmentPoints = getRouteSegmentBetweenKm(segmentStartKm, segmentEndKm);
    if (!segmentPoints.length) {
      setStatus("sniper-status", t("status.noSegmentPoints"), "error");
      sniperBtn.disabled = false;
      return;
    }

    const bbox          = computeBoundingBox(segmentPoints);
    const overpassPois  = await fetchOverpassPois(bbox);
    const corridorWidthKm = getCorridorWidthKm();

    const filtered = overpassPois
      .map((poi) => {
        const nearest = findNearestRouteKmForLatLon(poi.lat, poi.lon);
        if (!nearest) return null;
        return { ...poi, kmOnRoute: nearest.kmOnRoute, distanceToRouteKm: nearest.distanceToRouteKm, distanceAheadKm: nearest.kmOnRoute - referenceKm };
      })
      .filter((p) =>
        p &&
        activePoiFilters.has(p.category) &&
        p.distanceToRouteKm <= corridorWidthKm &&
        p.distanceAheadKm >= startKmAhead &&
        p.distanceAheadKm <= endKmAhead,
      )
      .sort((a, b) => a.distanceAheadKm - b.distanceAheadKm);

    lastScanResults       = filtered;
    lastScanSegmentPoints = segmentPoints;
    lastScanRange         = { startKmAhead, endKmAhead, corridorWidthKm, mode: activeRangeMode, referenceKm };

    renderPoiList(filtered);

    if (!filtered.length) {
      setStatus("sniper-status", t("status.noPois"), "info");
      showMapBtn.disabled = true;
    } else {
      setStatus("sniper-status", t("status.poisFound", { count: filtered.length }), "info");
      showMapBtn.disabled = false;
    }
  } catch (err) {
    console.error(err);
    setStatus("sniper-status", t("status.poiLoadError"), "error");
  } finally {
    sniperBtn.disabled = false;
  }
}

function computeBoundingBox(points) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

async function fetchOverpassPois(bbox) {
  const { minLat, maxLat, minLon, maxLon } = bbox;
  const B = `${minLat},${minLon},${maxLat},${maxLon}`;

  const query = `
    [out:json][timeout:25];
    (
      // Unterkünfte
      node["tourism"="hotel"](${B});
      node["tourism"="motel"](${B});
      node["tourism"="guest_house"](${B});
      node["tourism"="hostel"](${B});
      node["tourism"="apartment"](${B});
      // Tankstellen
      node["amenity"="fuel"](${B});
      // Bike Shops
      node["shop"="bicycle"](${B});
      // Versorgung
      node["shop"="supermarket"](${B});
      node["shop"="convenience"](${B});
      node["shop"="grocery"](${B});
      node["amenity"="restaurant"](${B});
      node["amenity"="cafe"](${B});
      node["shop"="bakery"](${B});
      node["amenity"="fast_food"](${B});
      // Wasser
      node["amenity"="drinking_water"](${B});
      node["amenity"="fountain"](${B});
      // Camping
      node["tourism"="camp_site"](${B});
      node["tourism"="caravan_site"](${B});
      // Shelter / Hütten
      node["amenity"="shelter"](${B});
      node["tourism"="alpine_hut"](${B});
      node["tourism"="wilderness_hut"](${B});
      node["amenity"="hut"](${B});
    );
    out body;
  `;

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    body: query,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
  });
  if (!response.ok) throw new Error(`Overpass error: ${response.status}`);
  const data = await response.json();
  if (!data.elements) return [];

  return data.elements
    .filter((el) => el.type === "node" && typeof el.lat === "number")
    .map((el) => classifyOverpassElement(el));
}

function classifyOverpassElement(el) {
  const tags = el.tags || {};

  let category = "other";
  let typeKey  = "poi.other";

  if (["hotel","motel","guest_house","hostel","apartment"].includes(tags.tourism)) {
    category = "lodging"; typeKey = "poi.lodging";
  } else if (tags.amenity === "fuel") {
    category = "fuel"; typeKey = "poi.fuel";
  } else if (tags.shop === "bicycle") {
    category = "bikeshop"; typeKey = "poi.bikeshop";
  } else if (["supermarket","convenience","grocery"].includes(tags.shop)) {
    category = "grocery"; typeKey = "poi.grocery";
  } else if (tags.amenity === "restaurant") {
    category = "restaurant"; typeKey = "poi.restaurant";
  } else if (tags.amenity === "cafe" || tags.shop === "bakery") {
    category = "cafe"; typeKey = "poi.cafe";
  } else if (tags.amenity === "fast_food") {
    category = "fastfood"; typeKey = "poi.fastfood";
  } else if (["drinking_water","fountain"].includes(tags.amenity)) {
    category = "water"; typeKey = "poi.water";
  } else if (["camp_site","caravan_site"].includes(tags.tourism)) {
    category = "camping"; typeKey = "poi.camping";
  } else if (["shelter","hut"].includes(tags.amenity) || ["alpine_hut","wilderness_hut"].includes(tags.tourism)) {
    category = "shelter"; typeKey = "poi.shelter";
  }

  const name = tags.name || tags.ref || t(typeKey);
  return { id: el.id, lat: el.lat, lon: el.lon, name, typeKey, category, phone: tags.phone || tags["contact:phone"] || null };
}

// ---------- CUSTOM / FREITEXT SUCHE ----------

async function handleCustomPoiClick() {
  const input  = document.getElementById("custom-poi-input");
  const term   = (input?.value || "").trim();
  const status = "custom-poi-status";
  const list   = document.getElementById("custom-poi-list");

  if (!term) return;

  if (!routePoints || routePoints.length === 0) {
    setStatus(status, t("sniper.customNeedRoute"), "error");
    return;
  }

  setStatus(status, t("sniper.customSearching", { term }), "info");
  list.innerHTML = "";

  // Resolve term → Overpass tag pairs
  const normalized = term.toLowerCase().trim();
  const tagPairs   = CUSTOM_TERM_MAP[normalized] || resolveCustomTermFallback(normalized);

  // Determine search bbox: use last scan segment or full route
  const sourcePoints = lastScanSegmentPoints.length >= 2 ? lastScanSegmentPoints : routePoints;
  const bbox         = computeBoundingBox(sourcePoints);
  const referenceKm  = activeRangeMode === "live" && lastRouteMatch ? lastRouteMatch.kmOnRoute : 0;
  const corridorWidthKm = getCorridorWidthKm();

  try {
    const results = await fetchCustomPois(bbox, tagPairs, term);

    const filtered = results
      .map((poi) => {
        const nearest = findNearestRouteKmForLatLon(poi.lat, poi.lon);
        if (!nearest) return null;
        return { ...poi, kmOnRoute: nearest.kmOnRoute, distanceToRouteKm: nearest.distanceToRouteKm, distanceAheadKm: nearest.kmOnRoute - referenceKm };
      })
      .filter((p) => p && p.distanceToRouteKm <= corridorWidthKm)
      .sort((a, b) => a.distanceAheadKm - b.distanceAheadKm);

    if (!filtered.length) {
      setStatus(status, t("sniper.customNone", { term }), "info");
      return;
    }

    setStatus(status, t("sniper.customFound", { count: filtered.length, term }), "info");
    renderCustomPoiList(filtered, list);

    // Ergebnisse in lastScanResults mergen → Karte wird aktiv
    lastScanResults = lastScanResults.filter((p) => p.category !== "custom").concat(filtered);

    // Segment-Punkte sicherstellen
    if (!lastScanSegmentPoints.length && routePoints.length) {
      lastScanSegmentPoints = routePoints;
    }
    // lastScanRange sicherstellen (wird von renderMapForLastScan benötigt)
    if (!lastScanRange) {
      const routeTotalKm = routePoints.length ? routePoints[routePoints.length - 1].cumDistKm : 0;
      lastScanRange = {
        startKmAhead: 0,
        endKmAhead: routeTotalKm,
        corridorWidthKm: getCorridorWidthKm(),
        mode: activeRangeMode,
        referenceKm: (activeRangeMode === "live" && lastRouteMatch) ? lastRouteMatch.kmOnRoute : 0,
      };
    }

    const showMapBtn = document.getElementById("show-map-btn");
    if (showMapBtn) showMapBtn.disabled = false;

  } catch (err) {
    console.error(err);
    setStatus(status, t("sniper.customError"), "error");
  }
}

function resolveCustomTermFallback(term) {
  // Generic fallback: try amenity=<term> and name~<term>
  return [["amenity", term]];
}

async function fetchCustomPois(bbox, tagPairs, term) {
  const { minLat, maxLat, minLon, maxLon } = bbox;
  const B = `${minLat},${minLon},${maxLat},${maxLon}`;

  // Nodes, Ways und Relations abfragen → center liefert einen einzigen Punkt pro Objekt
  const tagLines = tagPairs
    .map(([key, val]) =>
      `node["${key}"="${val}"](${B});\n      way["${key}"="${val}"](${B});\n      relation["${key}"="${val}"](${B});`
    )
    .join("\n      ");

  const query = `
    [out:json][timeout:25];
    (
      ${tagLines}
    );
    out center;
  `;

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    body: query,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
  });
  if (!response.ok) throw new Error(`Overpass error: ${response.status}`);
  const data = await response.json();
  if (!data.elements) return [];

  // Koordinaten: node → lat/lon direkt; way/relation → center
  const seen = new Set();
  return data.elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      // Deduplizierung über Position (verhindert Duplikate durch überlappende Tag-Abfragen)
      const posKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (seen.has(posKey)) return null;
      seen.add(posKey);
      return { el, lat, lon };
    })
    .filter(Boolean)
    .map(({ el, lat, lon }) => {
      const tags = el.tags || {};
      return {
        id: el.id,
        lat,
        lon,
        name: tags.name || tags.ref || term,
        typeKey: "poi.custom",
        category: "custom",
        phone: tags.phone || tags["contact:phone"] || null,
      };
    });
}

function renderCustomPoiList(pois, listEl) {
  pois.forEach((poi) => {
    const li = document.createElement("li");
    li.className = "poi-item";

    const mainLine = document.createElement("div");
    mainLine.className = "poi-line-main";

    const distanceSpan = document.createElement("span");
    distanceSpan.className = "poi-distance";
    distanceSpan.textContent = `${poi.distanceAheadKm.toFixed(1)} km`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "poi-name";
    nameSpan.textContent = poi.name;

    mainLine.appendChild(distanceSpan);
    mainLine.appendChild(nameSpan);

    const actions = document.createElement("div");
    actions.className = "poi-actions";

    const mapsBtn = document.createElement("button");
    mapsBtn.className = "btn primary poi-action-btn";
    mapsBtn.textContent = t("poi.openMaps");
    mapsBtn.addEventListener("click", () => openNavigationForPoi(poi));

    actions.appendChild(mapsBtn);

    if (poi.phone) {
      const callLink = document.createElement("a");
      callLink.href = `tel:${poi.phone.replace(/\s+/g, "")}`;
      const callBtn = document.createElement("button");
      callBtn.className = "btn secondary poi-action-btn";
      callBtn.textContent = t("poi.call");
      callLink.appendChild(callBtn);
      actions.appendChild(callLink);
    }

    li.appendChild(mainLine);
    li.appendChild(actions);
    listEl.appendChild(li);
  });
}

// ---------- NAVIGATION ----------

function buildNavigationTargets(poi) {
  const lat          = Number(poi.lat);
  const lon          = Number(poi.lon);
  const encodedName  = encodeURIComponent(poi.name || "POI");
  const encodedCoords = encodeURIComponent(`${lon},${lat}`);
  return {
    system: { primary: `geo:${lat},${lon}?q=${lat},${lon}(${encodedName})` },
    google: { primary: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}` },
    apple:  { primary: `https://maps.apple.com/?daddr=${lat},${lon}` },
    mapy:   {
      primary:  `mapycz://map?x=${lon}&y=${lat}&z=15&source=coor&id=${encodedCoords}`,
      fallback: `https://mapy.com/turisticka?x=${lon}&y=${lat}&z=15&source=coor&id=${encodedCoords}`,
    },
  };
}

function openWithFallback(primaryUrl, fallbackUrl) {
  let fallbackTimer = null;
  const cancelFallback = () => {
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    document.removeEventListener("visibilitychange", cancelFallback);
  };
  document.addEventListener("visibilitychange", cancelFallback, { once: true });
  window.location.href = primaryUrl;
  fallbackTimer = window.setTimeout(() => {
    if (document.visibilityState === "visible") {
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    }
    cancelFallback();
  }, 700);
}

function openNavigationForPoi(poi) {
  const app    = currentNavApp || "system";
  const targets = buildNavigationTargets(poi);
  const target  = targets[app] || targets.system;
  if (app === "mapy" && target.fallback) { openWithFallback(target.primary, target.fallback); return; }
  window.location.href = target.primary;
}

function handlePoiActionClick(event) {
  const actionEl = event.target.closest("[data-poi-action]");
  if (!actionEl) return;
  const action = actionEl.getAttribute("data-poi-action");
  const poiKey = actionEl.getAttribute("data-poi-key");
  if (!action || !poiKey) return;
  const poi = mapPoiDataByKey.get(poiKey);
  if (!poi) return;
  if (action === "navigate") { event.preventDefault(); openNavigationForPoi(poi); }
}

// ---------- POI LIST RENDERING ----------

function renderPoiList(pois) {
  const list = document.getElementById("poi-list");
  list.innerHTML = "";

  pois.forEach((poi) => {
    const li = document.createElement("li");
    li.className = "poi-item";

    const mainLine = document.createElement("div");
    mainLine.className = "poi-line-main";

    const distanceSpan = document.createElement("span");
    distanceSpan.className = "poi-distance";
    distanceSpan.textContent = `${poi.distanceAheadKm.toFixed(1)} km`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "poi-name";
    nameSpan.textContent = poi.name;

    const typeSpan = document.createElement("span");
    typeSpan.className = "poi-type";
    typeSpan.textContent = t(poi.typeKey || `poi.${poi.category}` || "poi.other");

    mainLine.appendChild(distanceSpan);
    mainLine.appendChild(nameSpan);
    mainLine.appendChild(typeSpan);

    const actions = document.createElement("div");
    actions.className = "poi-actions";

    const mapsBtn = document.createElement("button");
    mapsBtn.className = "btn primary poi-action-btn";
    mapsBtn.textContent = t("poi.openMaps");
    mapsBtn.addEventListener("click", () => openNavigationForPoi(poi));

    const mapViewBtn = document.createElement("button");
    mapViewBtn.className = "btn secondary poi-action-btn";
    mapViewBtn.textContent = t("poi.onMap");
    mapViewBtn.addEventListener("click", () => showPoiOnMapFromList(poi));

    actions.appendChild(mapsBtn);
    actions.appendChild(mapViewBtn);

    if (poi.phone) {
      const callLink = document.createElement("a");
      callLink.href = `tel:${poi.phone.replace(/\s+/g, "")}`;
      const callBtn = document.createElement("button");
      callBtn.className = "btn secondary poi-action-btn";
      callBtn.textContent = t("poi.call");
      callLink.appendChild(callBtn);
      actions.appendChild(callLink);
    }

    li.appendChild(mainLine);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

// ---------- MAP VIEW ----------

function toggleMapView(show) {
  const mapView = document.getElementById("map-view");
  if (!mapView) return;
  mapView.classList.toggle("hidden", !show);
  mapView.setAttribute("aria-hidden", show ? "false" : "true");
}

function handleShowMapClick() {
  if (!lastScanResults.length || !lastScanSegmentPoints.length) {
    setStatus("sniper-status", t("status.mapNoScan"), "error");
    return;
  }
  if (typeof L === "undefined") {
    setStatus("sniper-status", t("status.mapUnavailable"), "error");
    return;
  }
  toggleMapView(true);
  renderMapForLastScan();
}

function showPoiOnMapFromList(poi) {
  if (!lastScanResults.length || !lastScanSegmentPoints.length) {
    setStatus("sniper-status", t("status.mapNeedScan"), "error");
    return;
  }
  toggleMapView(true);
  renderMapForLastScan();
  const marker = mapPoiMarkerByKey.get(getPoiKey(poi));
  if (!marker || !mapInstance) return;
  mapInstance.setView(marker.getLatLng(), Math.max(mapInstance.getZoom(), 13), { animate: true });
  marker.openPopup();
}

function renderMapForLastScan() {
  const mapContainer = document.getElementById("map-container");
  const mapTitle     = document.getElementById("map-view-title");
  if (!mapContainer) return;

  if (!mapInstance) {
    mapInstance = L.map("map-container", { zoomControl: true, preferCanvas: true });
    initMapBaseLayers();
  }

  [mapRouteLayer, mapRouteCasingLayer, mapUnpavedLayer, mapPoiLayer, mapStartEndLayer]
    .forEach((l) => { if (l) mapInstance.removeLayer(l); });
  mapPoiMarkerByKey = new Map();
  mapPoiDataByKey   = new Map();

  const routeLatLngs = getRenderableRouteLatLngs();
  mapRouteCasingLayer = L.polyline(routeLatLngs, { color: "#052e16", weight: 8, opacity: 0.95 }).addTo(mapInstance);
  mapRouteLayer       = L.polyline(routeLatLngs, { color: "#22c55e", weight: 5, opacity: 1 }).addTo(mapInstance);

  const start = routeLatLngs[0];
  const end   = routeLatLngs[routeLatLngs.length - 1];
  mapStartEndLayer = L.layerGroup([
    L.circleMarker(start, { radius: 7, color: "#22c55e", fillColor: "#22c55e", fillOpacity: 1, weight: 2 }).bindTooltip(t("map.startTooltip")),
    L.circleMarker(end,   { radius: 7, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1, weight: 2 }).bindTooltip(t("map.endTooltip")),
  ]).addTo(mapInstance);

  mapPoiLayer = L.layerGroup();
  lastScanResults.forEach((poi) => {
    const poiKey = getPoiKey(poi);
    const color  = POI_CATEGORY_COLORS[poi.category] || POI_CATEGORY_COLORS.other;
    const marker = L.circleMarker([poi.lat, poi.lon], { radius: 7, color, fillColor: color, fillOpacity: 0.95, weight: 2 });
    marker.bindPopup(buildPoiPopupHtml(poi), { autoPan: true, closeButton: true });
    mapPoiMarkerByKey.set(poiKey, marker);
    mapPoiDataByKey.set(poiKey, poi);
    mapPoiLayer.addLayer(marker);
  });
  mapPoiLayer.addTo(mapInstance);
  addOrUpdateMapLegend();
  updateUnpavedOverlay(routeLatLngs);

  const bounds = L.latLngBounds(routeLatLngs);
  mapStartEndLayer.eachLayer((l) => { if (typeof l.getLatLng === "function") bounds.extend(l.getLatLng()); });
  mapPoiLayer.eachLayer((l)      => { if (typeof l.getLatLng === "function") bounds.extend(l.getLatLng()); });

  if (bounds.isValid()) mapInstance.fitBounds(bounds, { padding: [24, 24] });
  else if (routeLatLngs.length) mapInstance.setView(routeLatLngs[0], 12);

  setMapStatus(t("status.mapScanMeta", { provider: currentTileProviderName, routePoints: routeLatLngs.length, poiCount: lastScanResults.length }));
  requestAnimationFrame(() => { mapInstance.invalidateSize(); setTimeout(() => mapInstance.invalidateSize(), 180); });

  if (mapTitle && lastScanRange) {
    const modeText = lastScanRange.mode === "live"
      ? t("map.modeLive", { ref: lastScanRange.referenceKm.toFixed(1) })
      : t("map.modePlan");
    mapTitle.textContent = t("map.scanWindowTitle", { mode: modeText, start: lastScanRange.startKmAhead, end: lastScanRange.endKmAhead, corridor: lastScanRange.corridorWidthKm });
  }
}

function initMapBaseLayers() {
  mapBaseLayers = {};
  Object.entries(TILE_PROVIDERS).forEach(([name, provider]) => {
    mapBaseLayers[name] = L.tileLayer(provider.url, provider.options);
  });
  mapTileLayer = mapBaseLayers[currentTileProviderName];
  mapTileLayer.addTo(mapInstance);
  attachTileErrorHandling(mapTileLayer);
  L.control.layers(mapBaseLayers, null, { collapsed: true }).addTo(mapInstance);
}

function addOrUpdateMapLegend() {
  if (!mapInstance) return;
  if (mapLegendControl) mapInstance.removeControl(mapLegendControl);

  mapLegendControl = L.control({ position: "bottomright" });
  mapLegendControl.onAdd = () => {
    const div   = L.DomUtil.create("div", "map-legend");
    const items = [[t("map.legendRoute"), "#22c55e"]];
    if (showUnpavedOverlay) items.push([t("map.legendUnpaved"), UNPAVED_SURFACE_COLOR]);

    const categoryLegend = [
      ["lodging",    t("map.legendLodging"),    POI_CATEGORY_COLORS.lodging],
      ["fuel",       t("map.legendFuel"),        POI_CATEGORY_COLORS.fuel],
      ["bikeshop",   t("map.legendBikeshop"),    POI_CATEGORY_COLORS.bikeshop],
      ["grocery",    t("map.legendGrocery"),     POI_CATEGORY_COLORS.grocery],
      ["restaurant", t("map.legendRestaurant"),  POI_CATEGORY_COLORS.restaurant],
      ["cafe",       t("map.legendCafe"),        POI_CATEGORY_COLORS.cafe],
      ["fastfood",   t("map.legendFastfood"),    POI_CATEGORY_COLORS.fastfood],
      ["water",      t("map.legendWater"),       POI_CATEGORY_COLORS.water],
      ["camping",    t("map.legendCamping"),     POI_CATEGORY_COLORS.camping],
      ["shelter",    t("map.legendShelter"),     POI_CATEGORY_COLORS.shelter],
    ];
    categoryLegend.forEach(([key, label, color]) => {
      if (activePoiFilters.has(key)) items.push([label, color]);
    });

    div.innerHTML = items
      .map(([label, color]) => `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span>${label}</div>`)
      .join("");
    return div;
  };
  mapLegendControl.addTo(mapInstance);
}

// ---------- UNPAVED OVERLAY ----------

async function updateUnpavedOverlay(routeLatLngs) {
  if (!mapInstance || routeLatLngs.length < 2) return;
  if (!showUnpavedOverlay) { applyUnpavedVisibility(); return; }

  const cacheKey = getSurfaceCacheKey(routeLatLngs);
  if (surfaceOverlayCache.has(cacheKey)) {
    const cached = surfaceOverlayCache.get(cacheKey);
    drawUnpavedOverlay(cached.polylines);
    if (cached.km > 0) setMapStatus(t("status.mapUnpavedKm", { provider: currentTileProviderName, km: cached.km.toFixed(1) }));
    return;
  }

  const token = ++surfaceAnalysisToken;
  setMapStatus(t("status.mapUnpavedAnalyzing", { provider: currentTileProviderName }));

  try {
    const ways            = await fetchSurfaceWays(routeLatLngs);
    if (token !== surfaceAnalysisToken) return;
    const unpavedPolylines = detectUnpavedPolylines(routeLatLngs, ways);
    const unpavedKm        = estimatePolylineKm(unpavedPolylines);
    surfaceOverlayCache.set(cacheKey, { polylines: unpavedPolylines, km: unpavedKm });
    drawUnpavedOverlay(unpavedPolylines);
    setMapStatus(t("status.mapUnpavedKm", { provider: currentTileProviderName, km: unpavedKm.toFixed(1) }));
  } catch (err) {
    if (token !== surfaceAnalysisToken) return;
    console.warn("Surface analysis failed", err);
    setMapStatus(t("status.mapUnpavedUnavailable", { provider: currentTileProviderName }));
  }
}

function drawUnpavedOverlay(polylines) {
  if (mapUnpavedLayer) mapInstance.removeLayer(mapUnpavedLayer);
  mapUnpavedLayer = L.layerGroup();
  polylines.forEach((line) => {
    if (line.length < 2) return;
    L.polyline(line, { color: UNPAVED_SURFACE_COLOR, weight: 6, opacity: 0.95, lineCap: "round", lineJoin: "round", dashArray: "10 8" }).addTo(mapUnpavedLayer);
  });
  applyUnpavedVisibility();
}

function applyUnpavedVisibility() {
  if (!mapInstance) return;
  if (!mapUnpavedLayer) {
    if (!showUnpavedOverlay) setMapStatus(t("status.mapUnpavedOff", { provider: currentTileProviderName }));
    return;
  }
  if (showUnpavedOverlay) {
    if (!mapInstance.hasLayer(mapUnpavedLayer)) mapUnpavedLayer.addTo(mapInstance);
    setMapStatus(t("status.mapUnpavedOn", { provider: currentTileProviderName }));
  } else if (mapInstance.hasLayer(mapUnpavedLayer)) {
    mapInstance.removeLayer(mapUnpavedLayer);
    setMapStatus(t("status.mapUnpavedOff", { provider: currentTileProviderName }));
  }
  addOrUpdateMapLegend();
}

function getSurfaceCacheKey(routeLatLngs) {
  const first = routeLatLngs[0];
  const last  = routeLatLngs[routeLatLngs.length - 1];
  return `${activeUnpavedMode}|${routeLatLngs.length}|${first[0].toFixed(4)},${first[1].toFixed(4)}|${last[0].toFixed(4)},${last[1].toFixed(4)}`;
}

async function fetchSurfaceWays(routeLatLngs) {
  const bbox = computeLatLngBoundingBox(routeLatLngs, 0.02);
  const query = `
    [out:json][timeout:30];
    way["highway"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
    out tags geom;
  `;
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    body: query,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
  });
  if (!response.ok) throw new Error(`Overpass surface error: ${response.status}`);
  const data = await response.json();
  if (!data.elements) return [];
  return data.elements.filter((el) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 1);
}

function detectUnpavedPolylines(routeLatLngs, ways) {
  if (!ways.length || routeLatLngs.length < 2) return [];
  const vertexIndex = buildWayVertexIndex(ways);
  if (!vertexIndex.size) return [];

  const sampleStep = Math.max(1, Math.floor(routeLatLngs.length / 900));
  const sampled    = [];
  for (let i = 0; i < routeLatLngs.length; i += sampleStep) sampled.push(routeLatLngs[i]);
  const lastPt     = routeLatLngs[routeLatLngs.length - 1];
  const lastSample = sampled[sampled.length - 1];
  if (!lastSample || lastSample[0] !== lastPt[0] || lastSample[1] !== lastPt[1]) sampled.push(lastPt);

  const flags    = sampled.map(([lat, lon]) => isNearUnpavedWay(lat, lon, vertexIndex));
  const polylines = [];
  let current    = [];
  for (let i = 0; i < sampled.length; i++) {
    if (flags[i]) { current.push(sampled[i]); }
    else if (current.length > 1) { polylines.push(current); current = []; }
    else { current = []; }
  }
  if (current.length > 1) polylines.push(current);

  const { minSegmentKm } = getUnpavedModeConfig();
  return polylines.filter((line) => estimateLineKm(line) >= minSegmentKm);
}

function buildWayVertexIndex(ways) {
  const index    = new Map();
  const cellSize = 0.02;
  ways.forEach((way) => {
    const tags = way.tags || {};
    if (!isWayRelevantForUnpaved(tags) || !isUnpavedWay(tags)) return;
    way.geometry.forEach((pt) => {
      const key = `${Math.floor(pt.lat / cellSize)}|${Math.floor(pt.lon / cellSize)}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ lat: pt.lat, lon: pt.lon });
    });
  });
  return index;
}

function isWayRelevantForUnpaved(tags) {
  const highway = (tags.highway || "").toLowerCase();
  const bicycle = (tags.bicycle || "").toLowerCase();
  const access  = (tags.access  || "").toLowerCase();
  if (!highway) return false;
  if (NON_RIDEABLE_HIGHWAYS.has(highway)) return false;
  if (activeUnpavedMode === "conservative" && highway === "path" && !BIKE_OK_VALUES.has(bicycle)) return false;
  if (access === "no" && !BIKE_OK_VALUES.has(bicycle)) return false;
  return true;
}

function isNearUnpavedWay(lat, lon, index) {
  const cellSize = 0.02;
  const cx       = Math.floor(lat / cellSize);
  const cy       = Math.floor(lon / cellSize);
  let candidates = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cx + dx}|${cy + dy}`;
      if (index.has(key)) candidates = candidates.concat(index.get(key));
    }
  }
  if (!candidates.length) return false;
  let best = Infinity;
  for (const c of candidates) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < best) best = d;
  }
  return best <= getUnpavedModeConfig().proximityThresholdKm;
}

function isUnpavedWay(tags) {
  const surface   = (tags.surface    || "").toLowerCase();
  const tracktype = (tags.tracktype  || "").toLowerCase();
  const highway   = (tags.highway    || "").toLowerCase();
  const smoothness = (tags.smoothness || "").toLowerCase();
  if (surface && PAVED_SURFACES.has(surface)) return false;
  if (surface && UNPAVED_SURFACES.has(surface)) {
    if (surface === "compacted" && !getUnpavedModeConfig().includeCompacted) return false;
    return true;
  }
  if (tracktype && (UNPAVED_TRACKTYPES.has(tracktype) || (tracktype === "grade3" && getUnpavedModeConfig().includeGrade3))) return true;
  if (highway === "track" && !surface && (
    getUnpavedModeConfig().allowTrackWithoutSurface ||
    tracktype === "grade5" ||
    smoothness === "very_bad" || smoothness === "horrible" || smoothness === "very_horrible"
  )) return true;
  return false;
}

function computeLatLngBoundingBox(latLngs, padDeg = 0) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  latLngs.forEach(([lat, lon]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  });
  return { minLat: minLat - padDeg, maxLat: maxLat + padDeg, minLon: minLon - padDeg, maxLon: maxLon + padDeg };
}

function estimatePolylineKm(polylines) {
  return polylines.reduce((total, line) => total + estimateLineKm(line), 0);
}

function estimateLineKm(line) {
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    km += haversineKm(line[i-1][0], line[i-1][1], line[i][0], line[i][1]);
  }
  return km;
}

function attachTileErrorHandling(layer) {
  layer.on("tileerror", () => {
    tileErrorCount++;
    setMapStatus(t("status.mapTileErrors", { provider: currentTileProviderName, count: tileErrorCount }));
    if (tileErrorCount >= 8 && !hasSwitchedTileProvider) {
      hasSwitchedTileProvider = true;
      const fallback = currentTileProviderName === "OpenStreetMap" ? "CartoLight" : "OpenStreetMap";
      switchToTileProvider(fallback);
      setMapStatus(t("status.mapTileSwitched"));
      return;
    }
    if (tileErrorCount >= 16) setMapStatus(t("status.mapTileBlocked"));
  });
  layer.on("load", () => setMapStatus(t("status.mapTilesLoaded", { provider: currentTileProviderName })));
}

function switchToTileProvider(providerName) {
  if (!mapInstance || !mapBaseLayers || !mapBaseLayers[providerName]) return;
  if (mapTileLayer) mapInstance.removeLayer(mapTileLayer);
  mapTileLayer = mapBaseLayers[providerName];
  currentTileProviderName = providerName;
  mapTileLayer.addTo(mapInstance);
  attachTileErrorHandling(mapTileLayer);
}

function setMapStatus(text) {
  const el = document.getElementById("map-status");
  if (el) el.textContent = text;
}

function buildPoiPopupHtml(poi) {
  const escapedName = escapeHtml(poi.name || "POI");
  const escapedType = escapeHtml(t(poi.typeKey || `poi.${poi.category}` || "poi.other"));
  const poiKey      = getPoiKey(poi);
  const distanceText = t("poi.popupDistance", { distance: poi.distanceAheadKm.toFixed(1) });
  const callLink    = poi.phone
    ? `<a class="popup-link" href="tel:${poi.phone.replace(/\s+/g, "")}">${t("poi.call")}</a>`
    : "";
  const navigateLink = `<a class="popup-link" href="#" data-poi-action="navigate" data-poi-key="${escapeHtml(poiKey)}">${t("poi.navigate")}</a>`;
  return `
    <p class="popup-title">${escapedName}</p>
    <p class="popup-meta">${escapedType} · ${distanceText}</p>
    ${callLink}
    ${navigateLink}
  `;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getPoiKey(poi) {
  return `${poi.id}|${poi.lat}|${poi.lon}`;
}

function getRenderableRouteLatLngs() {
  const source = lastScanSegmentPoints?.length >= 2 ? lastScanSegmentPoints : routePoints;
  const latLngs = (source || []).map((p) => [p.lat, p.lon]);
  if (latLngs.length >= 2) return latLngs;
  if (routePoints.length >= 2) return routePoints.map((p) => [p.lat, p.lon]);
  return latLngs;
}

// ---------- PWA SERVICE WORKER ----------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
