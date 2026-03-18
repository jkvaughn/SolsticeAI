TASK 123 — Network Command (New Page: Globe Visualization)

PROJECT_STATUS.md is the source of truth. Read it in full before starting.

Create a new full-screen war room visualization page at /network-command.

ARCHITECTURE:
- New route: /network-command in routes.tsx (eagerly imported, no React.lazy)
- New page component: /src/app/components/NetworkCommand.tsx
- New simulation hook: /src/app/hooks/useNetworkSimulation.ts
- New globe component: /src/app/components/network-command/GlobeCanvas.tsx
- No new backend routes. Data sources: /network-metrics (POST, on mount), Supabase Realtime
  on heartbeat_cycles (INSERT), cadenza_flags (INSERT), transactions (INSERT + UPDATE).
- Full-bleed immersive layout. Uses DashboardLayout (sidebar intact for navigation) but
  the main content area is a dark near-black canvas. DO NOT strip the sidebar — use
  bg-coda-bg as the page background (renders near-black in dark mode automatically).
- All colors: CODA theme tokens exclusively. No hardcoded hex values anywhere.
  Key tokens: bg-coda-bg, bg-coda-surface, border-coda-border, text-coda-text,
  text-coda-text-muted, text-coda-text-faint, text-coda-brand (emerald accent).
- LiquidGlass theme: All panel/card elements use the existing dashboard-card or
  dashboard-card-subtle CSS classes (glassmorphic backdrop-blur, border-coda-border/20,
  bg-coda-surface/40). Match the visual language of EscalationDashboard.tsx and
  HeartbeatControl.tsx — frosted glass panels floating over the dark canvas.

MAPBOX INTEGRATION (from Vantage supply chain map — adapt, do not copy wholesale):
Token: (use VITE_MAPBOX_TOKEN from .env)
Dark style: mapbox://styles/rimark/cmh4f1b0b002o01ra7r3baatz
Required npm: mapbox-gl (already in Vantage, add to CODA package.json)
Required CSS import: import 'mapbox-gl/dist/mapbox-gl.css'

Map initialization pattern (copy verbatim from Vantage geographic-supply-chain-map.tsx):
  mapboxgl.accessToken = MAPBOX_TOKEN;
  map.current = new mapboxgl.Map({
    container: mapContainer.current,
    style: DARK_MODE_STYLE,
    center: [-30, 30],          // Atlantic center — shows all 7 bank cities
    zoom: 1.8,                  // Wide enough to see NYC cluster + London + Zurich + Tuvalu
    pitch: 0,
    bearing: 0,
    antialias: true,
    attributionControl: false,
  });
  map.current.on('style.load', () => { setMapLoaded(true); });
  // Cleanup: map.current.remove(); map.current = null;

DO NOT port from Vantage:
  - Clustering (clusterMaxZoom, clusterRadius) — only 7 nodes
  - 3D buildings (fill-extrusion layer, mapbox-streets-v8 source)
  - Geocoding (geocodeAddress, geocodeCache) — bank coords are hardcoded
  - useSupplyChainMap hook and supply_chain_map_entities/supply_chain_relationships tables
  - Programs dropdown and PROGRAMS array
  - GeofenceVisualization.tsx entirely
  - analyzeDisruption engine — Cadenza does this in CODA
  - ImpactPanel — replaced by Cadenza anomaly feed sidebar
  - useSidebar impactPanelVisible logic — use LayoutContext from CODA instead
  - Military COLORS object (neon red/green/cyan) — use CODA theme tokens only

DO port the LiquidGlass UI patterns:
  - squircle-lg backdrop-blur-xl floating header pattern
  - bg-white/10 dark:bg-white/[0.02] border border-white/20 dark:border-white/10 glass panels
  - The overall fixed inset-0 full-viewport canvas architecture
  NOTE: In CODA, squircle classes may not exist — use dashboard-card-subtle instead.
  CODA LiquidGlass = dashboard-card-subtle (backdrop-blur, border-coda-border/20, bg-coda-surface/40)

Bank node layer (add after style.load):
  Add a GeoJSON source 'banks' with the 7 hardcoded bank points.
  Each feature properties: { code, name, balance, color }
  Add layer 'bank-nodes': circle type, circle-radius 14, circle-color from properties.color
  circle-stroke-width 2, circle-stroke-color border-coda-border equivalent (#ffffff20)
  On map click on 'bank-nodes': pulse the node, update active corridor highlighting.

Corridor line layer (add after style.load):
  Add a GeoJSON source 'corridors' with LineString features between active bank pairs.
  Seed corridor pairs from /network-metrics recent transactions on mount.
  Each feature properties: { volume, lastStatus, opacity }
  Layer 'corridor-lines': line type, line-color by lastStatus (emerald/amber/purple/red),
  line-opacity from properties.opacity (0.1–0.8 based on rolling volume heat),
  line-width 1.5.
  Update corridor opacities every 2s from simulation state.

Particle overlay (HTML5 Canvas 2D, NOT a Mapbox layer):
  Position an <canvas> element absolutely over the map container (same inset-0).
  pointer-events: none so map interactions pass through.
  In requestAnimationFrame loop:
    - Project each particle's geographic [lng, lat] position to screen [x, y] using
      map.current.project([lng, lat]) — this is how Vantage overlays work on Mapbox.
    - Draw particle: ctx.arc(x, y, r, 0, 2*Math.PI), ctx.shadowBlur=8, shadowColor=color
    - Advance particle position along bezier corridor path by (elapsed / lifetime)
    - Retire particle when lifetime exceeded, spawn replacement if simulation running
  Spawn rate: Math.floor(tps / 500) per active corridor per second, capped at 200 total.
  Corridor bezier control point: midpoint offset toward equator by ~15° lat for arc effect.

PAGE LAYOUT (5 zones):

1. HEADER STRIP (LiquidGlass)
Use dashboard-card-subtle styling. Left: back arrow (← Treasury Ops link), then
"NETWORK COMMAND" in Clash Grotesk uppercase with wide letter-spacing, subtitle:
"Solstice Network — Institutional Settlement Layer" in text-coda-text-muted text-xs.
Right: live clock (HH:MM:SS UTC, JetBrains Mono), DEVNET/PRODUCTION badge (fetch from
/network-mode on mount), Start/Stop/Reset glassmorphic buttons (these control the
simulation via useNetworkSimulation hook — simulation is PAUSED on mount, only runs
when user clicks Start). Thin border-coda-border/30 bottom divider.

2. TPS COUNTER (hero, floats above globe)
Absolutely positioned, centered horizontally, ~120px from top of canvas area.
Format: "22,847 TPS" in JetBrains Mono text-6xl (or larger). Below: "TRANSACTIONS
PER SECOND" in text-coda-text-muted text-xs uppercase tracking-widest.
Simulation (via useNetworkSimulation):
  - PAUSED state: shows "0 TPS" in text-coda-text-faint
  - On Start: ramps from 0 to peak over 3s using easeInOutCubic
  - Peak: seeded between 8,000–22,000 based on active bank count × 3,000. Use
    actual_tps from /network-metrics if available.
  - Running variance: ±5–8% realistic noise (seeded, not pure random)
  - Color: text-coda-brand (emerald) if <70% peak, amber-400 70–90%, red-400 >90%
  - On Stop: counter freezes. On Reset: returns to 0.
  - React setState throttled to ~20fps (use ref for simulation loop, setState every 50ms)

3. GLOBE CANVAS (main canvas, full remaining height)
Full-width, full-height canvas area below header. GlobeCanvas.tsx renders here.
Bank nodes placed at real-world HQ coordinates:
  JPM  → lat 40.7128, lng -74.0060  (New York)
  CITI → lat 40.7580, lng -73.9855  (New York)
  HSBC → lat 51.5074, lng -0.1278   (London)
  UBS  → lat 47.3769, lng  8.5417   (Zurich)
  WFC  → lat 37.7749, lng -122.4194 (San Francisco)
  BNY  → lat 40.6892, lng -74.0445  (New York/Jersey City)
  FNBT → lat -8.5211, lng 179.1983  (Funafuti, Tuvalu)
BNY custodian rendered as a diamond SVG overlay at its coordinates.

PARTICLE STREAM VISUALIZATION (canvas overlay, not Mapbox layer):
The key insight: DO NOT draw one arc per transaction. Instead:
  - Establish persistent CORRIDOR PATHS between bank pairs that have transacted.
    Seed from /network-metrics recent transactions on mount.
  - Each corridor has a faint static line at 15% opacity (color: coda-border tone)
  - Particles (small glowing dots, r=2–3px) travel along corridor paths at a rate
    proportional to TPS: rate = Math.floor(tps / 500) particles per corridor per second
    for the top corridors, scaled down for lower-volume corridors.
  - Particle color: emerald=PvP settled, amber=lockup active, purple=Cadenza escalated
  - Particle glow: apply a radial gradient blur (canvas shadowBlur=8, shadowColor=color)
  - On high TPS (>15k), popular corridors look like rivers of light. This is the effect.
  - Particle lifetime: 2–3s (time to traverse the corridor path). Use bezier arc paths
    that curve over the globe surface for visual depth.
  - Cap at 200 simultaneous particles total (performance guard). At cap, oldest particles
    are retired.
  - Node glow: when a node is active sender/receiver, its overlay circle pulses
    (scale 1.0 → 1.3 → 1.0, opacity 1.0 → 0.6, 800ms). Use requestAnimationFrame.
  - CORRIDOR HEAT: corridor line opacity scales with rolling 30s volume on that route.
    High-volume corridors glow at 60–80% opacity. Quiet corridors at 10–15%.
All particle/glow logic: pure HTML5 Canvas 2D API (not SVG, not CSS animations).
Use requestAnimationFrame loop in GlobeCanvas component. No setInterval.

4. METRICS RAIL (left side, ~180px, LiquidGlass panel)
dashboard-card-subtle class, fixed to left edge of canvas area, vertically centered.
Live counters (500ms update via useNetworkSimulation):
  - TOTAL TPS (simulation value)
  - CONFIRMED TXS (cumulative, increments with TPS ÷ 1000 per tick)
  - VOLUME SETTLED ($, seed from /network-metrics, increment synthetically at ~$50k/s)
  - ACTIVE LOCKUPS (real, from /network-metrics, Realtime on lockup_tokens)
  - YIELD ACCRUING ($, real seed + per-second tick at 525bps annualized rate)
  - FEES COLLECTED (real, from /network-metrics, updates on heartbeat cycle)
Format: text-xs uppercase label in text-coda-text-muted, value in JetBrains Mono
text-xl text-coda-text. AnimatedValue component (already exists in codebase) for
smooth number transitions. Counters are CAPPED: max 1B txs, max $1T volume, max $1B
yield. All counters freeze on Stop, reset to DB-seeded values on Reset.

5. CADENZA ANOMALY FEED (right side, ~240px, LiquidGlass panel)
dashboard-card-subtle class, fixed to right edge of canvas area.
Header: "CADENZA MONITOR" in text-xs uppercase + live flag count badge
(bg-red-500/20 text-red-400 if >0, bg-coda-surface if 0).
Real-time feed: Supabase Realtime INSERT on cadenza_flags table.
On mount: fetch last 20 flags ordered by detected_at DESC.
Each entry (Motion AnimatePresence, slide in from right):
  - detected_at time (HH:MM:SS, text-coda-text-faint text-xs monospace)
  - flag_type badge: duplicate=amber, velocity_spike=red, counterparty_flagged=orange,
    anomaly_detected=red, info=blue (bg-{color}-500/10 text-{color}-400 text-xs)
  - severity chip (auto_reverse=red, escalate=amber, info=blue/coda-brand)
  - reasoning truncated to 60 chars in text-coda-text-muted text-xs
Max 50 visible entries. Older entries fade out at bottom (opacity gradient mask).
Empty state: pulsing green dot + "NETWORK NOMINAL" in text-coda-brand text-sm.

6. EVENT TICKER (bottom strip, full width, LiquidGlass)
bg-coda-surface/60 strip, border-t border-coda-border/20, height ~32px.
Horizontal auto-scrolling ticker. Supabase Realtime on transactions (INSERT, UPDATE
where status=settled). Initial fetch: last 50 settled transactions.
Each entry: "{SENDER_CODE} → {RECEIVER_CODE} ${amount} · {settlement_method_badge} ·
{time_ago}" in JetBrains Mono text-xs. Settlement method: pvp=emerald, lockup=amber,
reversed=red. Separated by " ··· " in text-coda-text-faint.
Scroll speed: proportional to TPS (faster at higher TPS, base 40px/s, max 120px/s).
Pauses on hover. Seamless loop (duplicate array for infinite scroll effect).

TREASURY OPS INTEGRATION:
- Add "⚡ Network Command" button to HeartbeatControl.tsx controls row (after Single
  Cycle button). Uses react-router navigate('/network-command'). Style: outline variant
  matching existing button styles in HeartbeatControl.
- Add "Network Command" nav link in dashboard-layout.tsx sidebar (Globe or Radar icon
  from lucide-react, between Treasury Ops and Agent Config).
- On Network Command: Supabase Realtime subscription on heartbeat_cycles INSERT.
  When a new cycle lands while simulation is running: show 3s "CYCLE COMPLETE" banner
  (slides down from header, emerald glassmorphic, then fades out) + spike TPS counter
  +15% for 2s then return to baseline + pulse all active node glows simultaneously.

NEW FILES:
- /src/app/components/NetworkCommand.tsx (main page, layout orchestration)
- /src/app/components/network-command/GlobeCanvas.tsx (globe + particle overlay)
- /src/app/hooks/useNetworkSimulation.ts (simulation engine: returns { state, start,
  stop, reset }. State includes tps, confirmedTxs, volumeSettled, yieldAccruing,
  feesCollected, corridors, activeNodes. Caps enforced. 20fps setState throttle.)

MODIFIED FILES:
- /src/app/routes.tsx — add /network-command route (eagerly imported)
- /src/app/components/HeartbeatControl.tsx — add Network Command button
- /src/app/components/dashboard/dashboard-layout.tsx — add Network Command nav link
- /src/app/types.ts — add NetworkCommandState, NetworkSimulationParams, BankNode,
  Corridor, ParticleState, GlobeCanvasRef interfaces. No `any` types.

Report TASK_COMPLETE with: all files created/modified, TPS peak value used, confirmation
that Mapbox placeholder is clearly marked and fallback canvas renders correctly,
confirmation that all 5 data sources are wired (network-metrics, cadenza_flags,
transactions, heartbeat_cycles, lockup_tokens), and confirmation that all colors use
CODA theme tokens with zero hardcoded hex values.