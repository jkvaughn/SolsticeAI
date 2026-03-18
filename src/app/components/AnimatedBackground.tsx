/**
 * iOS 26 Animated Background Orbs
 *
 * Dual-layer ambient orb system: light-mode and dark-mode sets rendered
 * simultaneously, crossfaded via CSS opacity when the theme toggles.
 *
 * All orbs use pastel blue shades for a cohesive finance aesthetic.
 *
 * Uses the `animate-orb-1`, `animate-orb-2`, `animate-orb-3` keyframe
 * classes defined in theme.css.
 */
export function AnimatedBackground() {
  return (
    <>
      {/* ── Light-mode orbs (hidden in dark) ─────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden dark:opacity-0 opacity-100 transition-opacity duration-500">
        {/* Large Deep Sky Blue — top right */}
        <div
          className="absolute top-[-15%] right-[5%] w-[700px] h-[700px] rounded-full blur-3xl animate-orb-1"
          style={{
            background:
              'radial-gradient(circle, rgba(59, 130, 246, 0.18) 0%, rgba(96, 165, 250, 0.12) 40%, transparent 70%)',
          }}
        />

        {/* Large Cornflower Blue — bottom left */}
        <div
          className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] rounded-full blur-3xl animate-orb-2"
          style={{
            background:
              'radial-gradient(circle, rgba(100, 149, 237, 0.16) 0%, rgba(132, 172, 245, 0.10) 40%, transparent 70%)',
          }}
        />

        {/* Medium Periwinkle — center */}
        <div
          className="absolute top-[30%] left-[40%] w-[600px] h-[600px] rounded-full blur-3xl animate-orb-3"
          style={{
            background:
              'radial-gradient(circle, rgba(147, 180, 250, 0.14) 0%, rgba(173, 200, 253, 0.09) 40%, transparent 70%)',
          }}
        />

        {/* Small Ice Blue — mid right */}
        <div
          className="absolute top-[50%] right-[15%] w-[400px] h-[400px] rounded-full blur-3xl animate-orb-1"
          style={{
            background:
              'radial-gradient(circle, rgba(125, 175, 245, 0.15) 0%, rgba(165, 203, 252, 0.10) 40%, transparent 70%)',
          }}
        />
      </div>

      {/* ── Dark-mode orbs (hidden in light) ─────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-0 dark:opacity-100 transition-opacity duration-500">
        {/* Large Royal Blue — top right */}
        <div
          className="absolute top-[-15%] right-[5%] w-[700px] h-[700px] rounded-full blur-3xl animate-orb-1"
          style={{
            background:
              'radial-gradient(circle, rgba(37, 99, 235, 0.22) 0%, rgba(59, 130, 246, 0.14) 40%, transparent 70%)',
          }}
        />

        {/* Large Slate Blue — bottom left */}
        <div
          className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] rounded-full blur-3xl animate-orb-2"
          style={{
            background:
              'radial-gradient(circle, rgba(79, 119, 232, 0.20) 0%, rgba(100, 149, 237, 0.12) 40%, transparent 70%)',
          }}
        />

        {/* Medium Soft Blue — center */}
        <div
          className="absolute top-[30%] left-[40%] w-[600px] h-[600px] rounded-full blur-3xl animate-orb-3"
          style={{
            background:
              'radial-gradient(circle, rgba(129, 161, 245, 0.16) 0%, rgba(147, 180, 250, 0.09) 40%, transparent 70%)',
          }}
        />

        {/* Small Azure — mid right */}
        <div
          className="absolute top-[50%] right-[15%] w-[400px] h-[400px] rounded-full blur-3xl animate-orb-1"
          style={{
            background:
              'radial-gradient(circle, rgba(96, 165, 250, 0.18) 0%, rgba(125, 185, 252, 0.10) 40%, transparent 70%)',
          }}
        />
      </div>
    </>
  );
}
