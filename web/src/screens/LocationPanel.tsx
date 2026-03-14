/**
 * LocationPanel — displays a contact's current location and location history.
 *
 * Shown in the right panel area when the user clicks the 📍 icon on a contact
 * that shares their location. Uses Firestore real-time subscriptions for
 * current location and fetches history on mount.
 *
 * Includes an embedded OpenStreetMap (Leaflet) showing the last 10 locations
 * as pins, with sequential same-coordinate pins merged into time ranges.
 *
 * Design: matches existing app patterns — inline styles, #3390ec accent,
 * #707579 secondary, borderRadius 10, consistent padding.
 */
import React, { useState, useEffect, useMemo } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import {
  LocationData,
  LocationHistoryEntry,
  subscribeToCurrentLocation,
  fetchLocationHistory,
  cleanupOldHistory,
  buildMapsUrl,
  formatLocationTimestamp,
} from "../services/locationService";
import {
  mergeSequentialLocations,
  formatMapTime,
  MergedLocation,
} from "../services/locationMapUtils";

// Leaflet map components & CSS
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

// Hide the "Leaflet |" prefix from attribution, keep OSM credit
const leafletHideStyle = document.createElement("style");
leafletHideStyle.textContent = `.leaflet-control-attribution a[href*="leafletjs.com"] { display: none !important; } .leaflet-control-attribution span { display: none !important; }`;
document.head.appendChild(leafletHideStyle);

/* ------------------------------------------------------------------ */
/*  Leaflet marker icon fix (Vite/Webpack strips default icon URLs)    */
/* ------------------------------------------------------------------ */

// @ts-ignore — Leaflet asset imports handled by Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
// @ts-ignore
import markerIcon from "leaflet/dist/images/marker-icon.png";
// @ts-ignore
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

/** Blue circle marker for the current (latest) location. */
function createCurrentIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:#3390ec;border:3px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

/** Gray circle marker for history locations. */
function createHistoryIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      background:#707579;border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,0.25);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -8],
  });
}

interface LocationPanelProps {
  contactUid: string;
  contactName: string;
  onClose: () => void;
}

export default function LocationPanel({ contactUid, contactName, onClose }: LocationPanelProps) {
  const { t } = useLanguage();
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [history, setHistory] = useState<LocationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to real-time current location
  useEffect(() => {
    const unsub = subscribeToCurrentLocation(contactUid, (loc) => {
      setCurrentLocation(loc);
      setLoading(false);
    });
    return unsub;
  }, [contactUid]);

  // Fetch location history on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await fetchLocationHistory(contactUid);
      if (!cancelled) setHistory(entries);
    })();
    // Clean up own old history entries when viewing the location panel
    cleanupOldHistory();
    return () => { cancelled = true; };
  }, [contactUid]);

  // Merge sequential nearby locations for map pins
  const mergedPins = useMemo(() => {
    const allEntries: LocationHistoryEntry[] = [];
    // Include current location as the newest entry
    if (currentLocation) {
      allEntries.push({
        id: "__current__",
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        timestamp: currentLocation.timestamp,
        accuracy: currentLocation.accuracy,
        address: currentLocation.address,
      });
    }
    // history is already desc-sorted; prepend current (newest) if present
    allEntries.push(...history);
    return mergeSequentialLocations(allEntries);
  }, [currentLocation, history]);

  // Determine map center: latest location or first history entry
  const mapCenter: [number, number] | null = useMemo(() => {
    if (currentLocation) return [currentLocation.lat, currentLocation.lng];
    if (history.length > 0) return [history[0].lat, history[0].lng];
    return null;
  }, [currentLocation, history]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "#fff",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid #f0f0f0",
        background: "#fff",
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 8,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 8,
            color: "#707579",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15,
            fontWeight: 500,
            color: "#000",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            📍 {t.location} — {contactName}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#707579", fontSize: 14 }}>
            {t.loading || "Loading..."}
          </div>
        ) : !currentLocation && history.length === 0 ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: "#707579" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📍</div>
            <p style={{ fontSize: 14 }}>{t.noLocationData}</p>
          </div>
        ) : (
          <>
            {/* Embedded Map — shows merged location pins on OpenStreetMap */}
            {mapCenter && mergedPins.length > 0 && (
              <LocationMap pins={mergedPins} center={mapCenter} />
            )}

            {/* Current Location */}
            {currentLocation && (
              <div style={{ marginTop: 16 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#3390ec",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}>
                  {t.currentLocation}
                </div>
                <LocationCard
                  lat={currentLocation.lat}
                  lng={currentLocation.lng}
                  timestamp={currentLocation.timestamp}
                  accuracy={currentLocation.accuracy}
                  address={currentLocation.address}
                  t={t}
                  highlight
                />
              </div>
            )}

            {/* Location History */}
            {history.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#3390ec",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}>
                  {t.locationHistory}
                </div>
                {history.map((entry) => (
                  <LocationCard
                    key={entry.id}
                    lat={entry.lat}
                    lng={entry.lng}
                    timestamp={entry.timestamp}
                    accuracy={entry.accuracy}
                    address={entry.address}
                    t={t}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LocationCard — a single location entry                             */
/* ------------------------------------------------------------------ */

interface LocationCardProps {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
  address?: string;
  t: Record<string, string>;
  highlight?: boolean;
}

function LocationCard({ lat, lng, timestamp, accuracy, address, t, highlight }: LocationCardProps) {
  const mapsUrl = buildMapsUrl(lat, lng);

  return (
    <div style={{
      padding: "12px 14px",
      background: highlight ? "#e8f4fd" : "#f4f4f5",
      borderRadius: 10,
      marginBottom: 8,
      border: highlight ? "1px solid #b3d9f2" : "1px solid transparent",
    }}>
      {/* Coordinates */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 6,
      }}>
        <span style={{ fontSize: 14, color: "#000", fontWeight: 400 }}>
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
        {accuracy !== undefined && (
          <span style={{ fontSize: 12, color: "#707579" }}>
            (±{accuracy}m)
          </span>
        )}
      </div>

      {/* Address if available */}
      {address && (
        <div style={{ fontSize: 13, color: "#333", marginBottom: 6 }}>
          {address}
        </div>
      )}

      {/* Timestamp + Open in Maps */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 12, color: "#707579" }}>
          {t.locationUpdated}: {formatLocationTimestamp(timestamp)}
        </span>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 13,
            color: "#3390ec",
            textDecoration: "none",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        >
          🗺️ {t.openInMaps}
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LocationMap — embedded OpenStreetMap with merged pins               */
/* ------------------------------------------------------------------ */

const currentIcon = createCurrentIcon();
const historyIcon = createHistoryIcon();

interface LocationMapProps {
  pins: MergedLocation[];
  center: [number, number];
}

function LocationMap({ pins, center }: LocationMapProps) {
  const { t } = useLanguage();
  return (
    <div style={{
      marginTop: 16,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid #f0f0f0",
    }}>
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: 300, width: "100%" }}
        scrollWheelZoom={true}
        attributionControl={true}
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin, i) => (
          <Marker
            key={`${pin.lat}-${pin.lng}-${pin.startTime}-${i}`}
            position={[pin.lat, pin.lng]}
            icon={pin.isCurrent ? currentIcon : historyIcon}
          >
            <Popup>
              <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                <div style={{
                  fontWeight: 600,
                  color: pin.isCurrent ? "#3390ec" : "#333",
                  marginBottom: 2,
                }}>
                  {pin.isCurrent ? `📍 ${t.currentLocation || "Current"}` : `📌 ${t.locationHistory || "History"}`}
                </div>
                <div style={{ color: "#555" }}>
                  {formatMapTime(pin.startTime, pin.endTime)}
                </div>
                <div style={{ fontSize: 12, color: "#707579", marginTop: 2 }}>
                  {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
