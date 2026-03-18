import { motion } from './motion-shim';
import type { ReactNode, CSSProperties } from 'react';

// ============================================================
// PageTransition — blur-fade entrance animation wrapper
//
// Wraps page content with a smooth blur(4px) -> blur(0px)
// entrance that matches the Agent Config card animation style.
// Supports optional staggered children for card-heavy pages.
// ============================================================

const pageVariants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit:   { opacity: 0, y: -8, filter: 'blur(4px)' },
};

interface PageTransitionProps {
  children: ReactNode;
  /** Extra className on the wrapper div */
  className?: string;
  /** Inline styles passed through to the wrapper div */
  style?: CSSProperties;
  /** Stagger delay between children (seconds). Default: no stagger. */
  stagger?: number;
  /** Animation duration in seconds. Default: 0.35 */
  duration?: number;
}

export function PageTransition({
  children,
  className = '',
  style,
  stagger,
  duration = 0.35,
}: PageTransitionProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={pageVariants}
      transition={{
        duration,
        ease: [0.25, 0.46, 0.45, 0.94],
        ...(stagger ? { staggerChildren: stagger } : {}),
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}