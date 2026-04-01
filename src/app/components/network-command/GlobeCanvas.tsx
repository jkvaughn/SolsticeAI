/**
 * GlobeCanvas — Mapbox GL JS globe with NATIVE GeoJSON particle rendering
 *
 * All visual elements (bank nodes, corridor arcs, animated particles) are
 * rendered as native Mapbox GL layers. Particles use multiple stacked circle
 * layers (outer glow, mid glow, core, hot center) for vibrant orb effects.
 * Mapbox handles all 3D projection, zoom, pitch, and globe wrapping natively.
 */

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { NetworkSimulationState } from '../../hooks/useNetworkSimulation';
import { useTheme } from '../ThemeProvider';

// ── Mapbox config ────────────────────────────────────────────
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
const DARK_STYLE = 'mapbox://styles/rimark/cmh4f1b0b002o01ra7r3baatz';
const LIGHT_STYLE = 'mapbox://styles/rimark/cmh4euliq004001sqhct5exl0';
const FALLBACK_STYLE = 'mapbox://styles/mapbox/dark-v11';

// ── Bank HQ coordinates [lng, lat] ───────────────────────────
export const BANK_COORDS: Record<
  string,
  { lng: number; lat: number; name: string; color: string }
> = {
  JPM:  { lng: -74.006,   lat: 40.7128, name: 'JPMorgan',      color: '#64748b' },
  CITI: { lng: -73.9855,  lat: 40.758,  name: 'Citibank',      color: '#64748b' },
  HSBC: { lng: -0.1278,   lat: 51.5074, name: 'HSBC',          color: '#64748b' },
  UBS:  { lng: 8.5417,    lat: 47.3769, name: 'UBS',           color: '#64748b' },
  WFC:  { lng: -122.4194, lat: 37.7749, name: 'Wells Fargo',   color: '#64748b' },
  BNY:  { lng: -74.0445,  lat: 40.6892, name: 'BNY Mellon',    color: '#94a3b8' },
  FNBT: { lng: -96.797,  lat: 32.7767, name: 'First Nat TX',  color: '#64748b' },
};

// ── Corridor pairs ───────────────────────────────────────────
const CORRIDOR_PAIRS: [string, string][] = [
  ['JPM', 'CITI'], ['JPM', 'HSBC'], ['JPM', 'UBS'], ['JPM', 'WFC'],
  ['CITI', 'HSBC'], ['CITI', 'UBS'], ['HSBC', 'UBS'],
  ['BNY', 'JPM'], ['BNY', 'CITI'], ['BNY', 'FNBT'],
  ['WFC', 'FNBT'], ['WFC', 'HSBC'],
];

// ── Particle types ───────────────────────────────────────────
interface Particle {
  corridorIdx: number;
  progress: number;
  speed: number;
  colorKey: string;
  radius: number;
  reverse: boolean;
}

// Monochromatic slate/blue palette — institutional, not playful
const COLOR_HEX: Record<string, { dark: string; light: string; darkBright: string; lightBright: string }> = {
  primary:   { dark: '#94a3b8', light: '#64748b', darkBright: '#cbd5e1', lightBright: '#94a3b8' },
  secondary: { dark: '#7dd3fc', light: '#0ea5e9', darkBright: '#bae6fd', lightBright: '#7dd3fc' },
  accent:    { dark: '#a5b4fc', light: '#6366f1', darkBright: '#c7d2fe', lightBright: '#a5b4fc' },
  alert:     { dark: '#fca5a5', light: '#ef4444', darkBright: '#fecaca', lightBright: '#fca5a5' },
};

interface Props {
  sim: NetworkSimulationState;
  sidebarWidth?: number;
}

// ── Helpers ──────────────────────────────────────────────────

/** Generate a quadratic-bezier arc as a GeoJSON LineString coordinate array */
function bezierArc(
  aLng: number, aLat: number,
  bLng: number, bLat: number,
  steps = 48,
): [number, number][] {
  const midLng = (aLng + bLng) / 2;
  const midLat = (aLat + bLat) / 2;
  const dist = Math.abs(aLng - bLng) + Math.abs(aLat - bLat);
  const curveHeight = Math.min(20, dist * 0.15);
  const cpLng = midLng;
  const cpLat = midLat + (midLat > 0 ? curveHeight : -curveHeight);

  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const lng = u * u * aLng + 2 * u * t * cpLng + t * t * bLng;
    const lat = u * u * aLat + 2 * u * t * cpLat + t * t * bLat;
    coords.push([lng, lat]);
  }
  return coords;
}

/** Evaluate bezier at parameter t (for particle positioning) */
function bezierPoint(
  aLng: number, aLat: number,
  bLng: number, bLat: number,
  t: number,
): [number, number] {
  const midLng = (aLng + bLng) / 2;
  const midLat = (aLat + bLat) / 2;
  const dist = Math.abs(aLng - bLng) + Math.abs(aLat - bLat);
  const curveHeight = Math.min(20, dist * 0.15);
  const cpLng = midLng;
  const cpLat = midLat + (midLat > 0 ? curveHeight : -curveHeight);

  const u = 1 - t;
  return [
    u * u * aLng + 2 * u * t * cpLng + t * t * bLng,
    u * u * aLat + 2 * u * t * cpLat + t * t * bLat,
  ];
}

// Empty GeoJSON constant
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// ============================================================
// Component
// ============================================================
export function GlobeCanvas({ sim, sidebarWidth = 0 }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const simRef = useRef(sim);
  simRef.current = sim;
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  // Pre-compute corridor metadata
  const corridors = useRef(
    CORRIDOR_PAIRS.map(([f, t]) => {
      const a = BANK_COORDS[f];
      const b = BANK_COORDS[t];
      return { from: f, to: t, aLng: a.lng, aLat: a.lat, bLng: b.lng, bLat: b.lat };
    }),
  ).current;

  // ── React to theme changes: swap Mapbox style ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const targetStyle = isDark ? DARK_STYLE : LIGHT_STYLE;
    map.setStyle(targetStyle);
  }, [isDark]);

  // ── React to sidebar width: shift map center via padding ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      padding: { left: sidebarWidth, top: 0, right: 0, bottom: 0 },
      duration: 400,
    });
  }, [sidebarWidth]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Set token
    (mapboxgl as any).accessToken = MAPBOX_TOKEN;

    // ── Initialize map ───────────────────────────────────────
    let map: mapboxgl.Map;
    const initialStyle = isDarkRef.current ? DARK_STYLE : LIGHT_STYLE;
    try {
      map = new mapboxgl.Map({
        container,
        style: initialStyle,
        center: [-40, 38],
        zoom: 2.0,
        maxZoom: 20,
        projection: 'globe' as any,
        antialias: true,
        attributionControl: false,
        logoPosition: 'bottom-right',
        fadeDuration: 0,
      });
    } catch {
      map = new mapboxgl.Map({
        container,
        style: FALLBACK_STYLE,
        center: [-40, 38],
        zoom: 2.0,
        maxZoom: 20,
        projection: 'globe' as any,
        antialias: true,
        attributionControl: false,
        logoPosition: 'bottom-right',
        fadeDuration: 0,
      });
    }

    mapRef.current = map;

    // Hide Mapbox logo
    map.on('load', () => {
      const logoEl = container.querySelector('.mapboxgl-ctrl-logo');
      if (logoEl) (logoEl as HTMLElement).style.display = 'none';
      const attribEl = container.querySelector('.mapboxgl-ctrl-attrib');
      if (attribEl) (attribEl as HTMLElement).style.display = 'none';

      map.easeTo({
        padding: { left: sidebarWidthRef.current, top: 0, right: 0, bottom: 0 },
        duration: 0,
      });
    });

    map.on('error', (e) => {
      console.warn('[GlobeCanvas] Mapbox error:', e.error?.message || e);
      if (e.error?.message?.includes('style')) {
        map.setStyle(FALLBACK_STYLE);
      }
    });

    // ── Add all layers on style load ─────────────────────────
    map.on('style.load', () => {
      // Disable terrain — the custom styles may reference mapbox-dem for terrain
      // but we don't want 3D terrain. Catch errors if the source doesn't exist yet.
      try { map.setTerrain(null); } catch (_) { /* ignore */ }

      const dark = isDarkRef.current;
      try {
        map.setFog(dark ? {
          color: 'rgb(10, 12, 20)',
          'high-color': 'rgb(20, 24, 40)',
          'horizon-blend': 0.08,
          'space-color': 'rgb(8, 10, 18)',
          'star-intensity': 0.3,
        } : {
          color: 'rgb(220, 225, 235)',
          'high-color': 'rgb(180, 195, 220)',
          'horizon-blend': 0.06,
          'space-color': 'rgb(200, 210, 230)',
          'star-intensity': 0,
        });
      } catch { /* fog unsupported */ }

      // ── Corridor arc lines ──────────────────────────────────
      const corridorFeatures = CORRIDOR_PAIRS.map(([f, t]) => {
        const a = BANK_COORDS[f];
        const b = BANK_COORDS[t];
        return {
          type: 'Feature' as const,
          properties: { from: f, to: t },
          geometry: {
            type: 'LineString' as const,
            coordinates: bezierArc(a.lng, a.lat, b.lng, b.lat),
          },
        };
      });

      map.addSource('corridors', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: corridorFeatures },
      });

      // Corridor glow (wider, faint)
      map.addLayer({
        id: 'corridor-glow',
        type: 'line',
        source: 'corridors',
        paint: {
          'line-color': dark ? 'rgba(52,211,153,0.12)' : 'rgba(16,185,129,0.10)',
          'line-width': 6,
          'line-blur': 4,
          'line-opacity': 0.5,
        },
      });

      // Corridor core line
      map.addLayer({
        id: 'corridor-lines',
        type: 'line',
        source: 'corridors',
        paint: {
          'line-color': dark ? 'rgba(52,211,153,0.35)' : 'rgba(16,185,129,0.3)',
          'line-width': 1.2,
          'line-opacity': 0.7,
        },
      });

      // ── Bank node circles ────────────────────────────────────
      const nodeFeatures = Object.entries(BANK_COORDS).map(([code, b]) => ({
        type: 'Feature' as const,
        properties: { code, name: b.name, color: b.color, isBNY: code === 'BNY' },
        geometry: {
          type: 'Point' as const,
          coordinates: [b.lng, b.lat],
        },
      }));

      map.addSource('bank-nodes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: nodeFeatures },
      });

      map.addLayer({
        id: 'bank-nodes-glow',
        type: 'circle',
        source: 'bank-nodes',
        paint: {
          'circle-radius': 14,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.08,
          'circle-blur': 1,
        },
      });

      map.addLayer({
        id: 'bank-nodes-core',
        type: 'circle',
        source: 'bank-nodes',
        paint: {
          'circle-radius': ['case', ['get', 'isBNY'], 5, 4],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.25)',
        },
      });

      map.addLayer({
        id: 'bank-labels',
        type: 'symbol',
        source: 'bank-nodes',
        layout: {
          'text-field': ['get', 'code'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 10,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': dark ? 'rgba(255,255,255,0.6)' : 'rgba(30,30,30,0.7)',
          'text-halo-color': dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
          'text-halo-width': 1,
        },
      });

      // ── NATIVE particle layers (4 stacked for vibrant orbs) ─
      map.addSource('particles', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      // Layer 1: Subtle glow
      map.addLayer({
        id: 'particle-outer-glow',
        type: 'circle',
        source: 'particles',
        paint: {
          'circle-radius': ['*', ['get', 'radius'], 2.5],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['*', ['get', 'alpha'], 0.08],
          'circle-blur': 1,
        },
      });

      // Layer 2: Core dot — clean, understated
      map.addLayer({
        id: 'particle-core',
        type: 'circle',
        source: 'particles',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'bright'],
          'circle-opacity': ['*', ['get', 'alpha'], 0.7],
        },
      });
    });

    // ── Animation loop — update particle GeoJSON source ──────
    let spawnAccum = 0;
    lastRef.current = performance.now();

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame);
      try {
        const dt = Math.min(now - lastRef.current, 100);
        lastRef.current = now;

        const m = mapRef.current;
        if (!m) return;

        const s = simRef.current;
        const dark = isDarkRef.current;

        // Spawn particles when running
        if (s.running && s.tps > 0) {
          const rate = Math.max(5, Math.floor(s.tps / 200));
          spawnAccum += rate * (dt / 1000);

          while (spawnAccum >= 1 && particlesRef.current.length < 400) {
            spawnAccum -= 1;

            let cIdx = Math.floor(Math.random() * corridors.length);
            if (Math.random() < 0.3) {
              const sw = s.corridorWeights;
              if (sw && sw.length > 0) {
                const totalW = sw.reduce((sum, c) => sum + c.weight, 0);
                if (totalW > 0) {
                  let pick = Math.random() * totalW;
                  for (let i = 0; i < sw.length; i++) {
                    pick -= sw[i].weight;
                    if (pick <= 0) {
                      const match = corridors.findIndex(
                        (a) =>
                          (a.from === sw[i].from && a.to === sw[i].to) ||
                          (a.from === sw[i].to && a.to === sw[i].from),
                      );
                      if (match >= 0) cIdx = match;
                      break;
                    }
                  }
                }
              }
            }

            const roll = Math.random();
            const colorKey =
              roll < 0.7 ? 'primary' : roll < 0.88 ? 'secondary' : roll < 0.96 ? 'accent' : 'alert';

            particlesRef.current.push({
              corridorIdx: cIdx,
              progress: 0,
              speed: 0.15 + Math.random() * 0.2,
              colorKey,
              radius: 1.5 + Math.random() * 1.5,
              reverse: Math.random() > 0.5,
            });
          }
        } else {
          spawnAccum = 0;
        }

        // Update particle positions and build GeoJSON features
        const alive: Particle[] = [];
        const features: GeoJSON.Feature[] = [];

        for (const p of particlesRef.current) {
          p.progress += p.speed * (dt / 1000);
          if (p.progress >= 1) continue;

          const c = corridors[p.corridorIdx];
          if (!c) continue;

          const t = p.reverse ? 1 - p.progress : p.progress;
          const [lng, lat] = bezierPoint(c.aLng, c.aLat, c.bLng, c.bLat, t);

          // Fade in/out
          const alpha =
            p.progress < 0.08
              ? p.progress / 0.08
              : p.progress > 0.85
                ? (1 - p.progress) / 0.15
                : 1;

          const hex = COLOR_HEX[p.colorKey] || COLOR_HEX.emerald;

          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              color: dark ? hex.dark : hex.light,
              bright: dark ? hex.darkBright : hex.lightBright,
              radius: p.radius,
              alpha: Math.round(alpha * 100) / 100,
            },
          });

          alive.push(p);
        }

        particlesRef.current = alive;

        // Push updated GeoJSON to Mapbox source
        const src = m.getSource('particles') as mapboxgl.GeoJSONSource | undefined;
        if (src) {
          src.setData({ type: 'FeatureCollection', features });
        }
      } catch (e) {
        console.error('[GlobeCanvas] Animation frame error:', e);
      }
    }

    rafRef.current = requestAnimationFrame(frame);

    // Pulse glow halos + corridor opacity
    let pulsePhase = 0;
    const updateLayers = () => {
      if (!mapRef.current) return;
      const s = simRef.current;
      pulsePhase += 0.15;

      if (mapRef.current.getLayer('corridor-lines')) {
        mapRef.current.setPaintProperty(
          'corridor-lines',
          'line-opacity',
          s.running ? 0.7 : 0.3,
        );
      }
      if (mapRef.current.getLayer('corridor-glow')) {
        mapRef.current.setPaintProperty(
          'corridor-glow',
          'line-opacity',
          s.running ? 0.6 : 0.2,
        );
      }

      if (mapRef.current.getLayer('bank-nodes-glow')) {
        if (s.running && s.tps > 0) {
          const tpsScale = Math.min(1, s.tps / 30000);
          const pulse = Math.sin(pulsePhase) * 0.5 + 0.5;
          const radius = 16 + tpsScale * 10 + pulse * 8;
          const opacity = 0.1 + tpsScale * 0.1 + pulse * 0.06;
          mapRef.current.setPaintProperty('bank-nodes-glow', 'circle-radius', radius);
          mapRef.current.setPaintProperty('bank-nodes-glow', 'circle-opacity', opacity);
        } else {
          mapRef.current.setPaintProperty('bank-nodes-glow', 'circle-radius', 18);
          mapRef.current.setPaintProperty('bank-nodes-glow', 'circle-opacity', 0.12);
        }
      }
    };
    const layerInterval = setInterval(updateLayers, 80);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearInterval(layerInterval);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="w-full h-full relative" style={{ background: isDark ? '#080a12' : '#dce1eb' }}>
      <div
        ref={mapContainerRef}
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}