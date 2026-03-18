TASK 123 — Network Command (New Page)

PROJECT_STATUS.md is the source of truth. Read it in full before starting.

Create a new full-screen war room visualization page at /network-command.

ARCHITECTURE:
- New route: /network-command in routes.tsx (eagerly imported, no React.lazy)
- New page component: /src/app/components/NetworkCommand.tsx
- New simulation hook: /src/app/hooks/useNetworkSimulation.ts
- No new backend routes. Data sources: /network-metrics (POST, on mount), Supabase Realtime
  on heartbeat_cycles (INSERT), cadenza_flags (INSERT), transactions (INSERT + UPDATE).
- Full-bleed immersive layout — no DashboardLayout sidebar. Custom header strip only.
- All colors: CODA theme tokens. Dark canvas. No hardcoded hex.

PAGE ZONES (6):

1. HEADER STRIP
Left: "NETWORK COMMAND" in Clash Grotesk, text-coda-text, uppercase letter-spacing. Subtitle:
"Solstice Network — Institutional Settlement Layer". Right: live clock (HH:MM:SS UTC,
monospace), network mode badge (DEVNET/PRODUCTION from existing /network-mode endpoint),
back-arrow link to /treasury-ops. Thin border-coda-border/30 bottom divider.

2. TPS COUNTER (hero element)
Large centered display above the network ring. Format: "22,847 TPS" in JetBrains Mono,
large (text-6xl or larger). Simulation: start at 0 on mount, ramp to peak over 3s, then
hold with ±5–8% realistic variance (use seeded Math.random with timestamp-based seed).
Peak TPS: pull from /network-metrics response (use actual_tps if available, else seed
between 8000–22000 based on active bank count × 3000). Color: emerald if <70% peak,
amber 70–90%, red >90%. Sub-label: "TRANSACTIONS PER SECOND" in text-coda-text-muted.

3. NETWORK RING (main canvas, SVG)
Full-width SVG (viewBox 0 0 1200 600). Bank nodes in a circle (radius ~220px, centered at
600,300). Node positions seeded by sorted bank IDs (same algorithm as original Task 123
spec — use LCG pseudo-random with seed = bank IDs sorted and joined). Node: circle r=28,
bg=bg-coda-surface, border=border-coda-border, label = bank code (JPM, CITI, etc.) in
JetBrains Mono text-xs + current balance in text-coda-text-muted below.
BNY custodian: diamond shape at center (600,300).
Transaction arcs: animated SVG paths between nodes. Arc color: emerald=PvP settled,
amber=lockup active, purple=Cadenza escalated, red=reversed. Arc spawn rate scales with
TPS counter (1 arc per ~200ms at 10k TPS). Arcs fade out after 1.5s. Use requestAnimationFrame
for smooth animation, not CSS transitions (avoid layout thrashing).
Node glow: active sender/receiver nodes get a subtle box-shadow / filter:drop-shadow in
the arc color during arc transit.
Data seed: on mount, fetch real recent transactions from /network-metrics to determine
which corridors are active. Use those corridors for arc generation weighting.

4. METRICS RAIL (left sidebar, ~180px wide)
Vertical stack of live counters, updating every 500ms:
- Total TPS (from simulation)
- Confirmed TXs (cumulative counter, increments with TPS)
- Volume Settled (seed from /network-metrics total volume, increment synthetically)
- Active Lockups (real data from /network-metrics)
- Yield Accruing (real data, seed from /network-metrics, tick per second)
- Fees Collected (real data from /network-metrics)
Each counter: small label in text-coda-text-muted (text-xs uppercase), large value in
JetBrains Mono text-xl, AnimatedValue for smooth number transitions. bg-coda-surface/40
panel with border-coda-border/20 right border.

5. CADENZA ANOMALY FEED (right sidebar, ~240px wide)
Real-time feed from cadenza_flags table via Supabase Realtime (INSERT subscription).
On mount: fetch last 20 flags. New flags prepend with slide-in animation (Motion).
Each entry: detected_at timestamp (HH:MM:SS), flag_type badge (color-coded:
duplicate=amber, velocity_spike=red, counterparty_flagged=orange, anomaly_detected=red),
severity chip, bank pair if available (from transaction join), reasoning truncated to 60
chars. Max 50 entries visible (older entries fade out at bottom).
Empty state: pulsing "◉ NETWORK NOMINAL" in emerald, centered.
Header: "CADENZA MONITOR" label + live flag count badge.

6. EVENT TICKER (bottom strip, full width)
Horizontal scrolling ticker of real recent settlements from transactions table. Supabase
Realtime INSERT subscription + initial fetch of last 50 settled txns. Each entry:
"{SENDER_CODE} → {RECEIVER_CODE} ${amount} · {settlement_method} · {time_ago}"
Separated by " · · · " spacer. Auto-scroll left at speed proportional to TPS counter.
Emerald text on bg-coda-surface/60 strip with top border.

TREASURY OPS INTEGRATION:
- Add "⚡ Network Command" button to HeartbeatControl.tsx controls row (after Single Cycle
  button). Uses react-router navigate('/network-command'). Style: ghost/outline variant.
- On Network Command: Realtime subscription on heartbeat_cycles INSERT. When a new cycle
  lands, show a 3s "CYCLE COMPLETE" banner (slide down from top, emerald, then fade out)
  and spike TPS counter +15% for 2s then return to baseline.

NEW FILES:
- /src/app/components/NetworkCommand.tsx (main page)
- /src/app/hooks/useNetworkSimulation.ts (simulation engine: TPS ramp, arc generation,
  counter increments, heartbeat integration)

MODIFIED FILES:
- /src/app/routes.tsx — add /network-command route
- /src/app/components/HeartbeatControl.tsx — add Network Command button
- /src/app/components/dashboard/dashboard-layout.tsx — add Network Command nav link
  (Radar or Globe icon, between Treasury Ops and Agent Config)
- /src/app/types.ts — add NetworkCommandState interface, NetworkSimulationParams interface

Report TASK_COMPLETE with all files modified/created, TPS peak value used, and confirmation
that real data sources (network-metrics, cadenza_flags, transactions, heartbeat_cycles)
are all wired.