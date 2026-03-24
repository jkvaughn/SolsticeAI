import React, { useRef, useEffect } from 'react';
import Lottie, { type LottieRefCurrentProps } from 'lottie-react';

export type LottieIconTrigger = 'hover' | 'click' | 'loop' | 'auto' | 'none';

interface LottieIconProps {
  /** Lottie JSON animation data */
  animationData: object;
  /** Icon size in pixels (square) */
  size?: number;
  /** Width override (takes precedence over size) */
  width?: number;
  /** Height override (takes precedence over size) */
  height?: number;
  /** What triggers the animation */
  trigger?: LottieIconTrigger;
  /** Playback speed multiplier */
  speed?: number;
  /** Additional CSS class */
  className?: string;
  /** Override stroke/fill color (applies CSS filter) */
  color?: string;
  /** Visual scale multiplier to normalize icon sizes (default 1.15 for Iconly viewBox padding) */
  scale?: number;
}

/**
 * Reusable Lottie icon component with configurable animation triggers.
 *
 * Usage:
 * ```tsx
 * import walletAnimation from './icons/lottie/Wallet-Animated.json';
 * <LottieIcon animationData={walletAnimation} size={20} trigger="hover" />
 * ```
 */
export function LottieIcon({
  animationData,
  size = 24,
  width,
  height,
  trigger = 'hover',
  speed = 1,
  className = '',
  scale = 1.15,
}: LottieIconProps) {
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const w = width ?? size;
  const h = height ?? size;

  useEffect(() => {
    const lottie = lottieRef.current;
    if (!lottie) return;

    lottie.setSpeed(speed);

    if (trigger === 'loop') {
      lottie.play();
    } else if (trigger === 'auto') {
      // Play once on mount
      lottie.goToAndPlay(0);
    } else {
      // For 'hover', 'click', 'none' — start paused at frame 0
      lottie.goToAndStop(0);
    }
  }, [trigger, speed]);

  useEffect(() => {
    if (trigger !== 'hover') return;
    const container = containerRef.current;
    if (!container) return;

    // Walk up to find the nearest button ancestor for hover delegation
    const button = container.closest('button') || container.closest('a') || container;

    const onEnter = () => {
      const lottie = lottieRef.current;
      if (lottie) {
        lottie.goToAndPlay(0);
      }
    };

    button.addEventListener('mouseenter', onEnter);
    return () => button.removeEventListener('mouseenter', onEnter);
  }, [trigger]);

  useEffect(() => {
    if (trigger !== 'click') return;
    const container = containerRef.current;
    if (!container) return;

    const button = container.closest('button') || container.closest('a') || container;

    const onClick = () => {
      const lottie = lottieRef.current;
      if (lottie) {
        lottie.goToAndPlay(0);
      }
    };

    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, [trigger]);

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: w, height: h }}
    >
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        loop={trigger === 'loop'}
        autoplay={trigger === 'loop' || trigger === 'auto'}
        style={{ width: w, height: h, transform: `scale(${scale})` }}
      />
    </div>
  );
}

export default LottieIcon;
