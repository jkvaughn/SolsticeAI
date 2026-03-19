import React, { useRef, useEffect } from 'react';
import Lottie from 'lottie-react';
import { sidebarCloseAnimation } from './sidebar-close-animation';
import { sidebarExpandAnimation } from './sidebar-expand-animation';

interface ArrowLeftIconProps {
  size?: number;
  /** @deprecated Use className="text-coda-text" instead */
  color?: string;
  className?: string;
  isCollapsed?: boolean;
}

export const ArrowLeftIcon = ({ size = 24, color, className, isCollapsed = false }: ArrowLeftIconProps) => {
  const lottieRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply color filter to the animation — prefers className-based dark detection,
  // falls back to legacy color prop for backward compat.
  useEffect(() => {
    function applyFilter() {
      if (!containerRef.current) return;
      const svgElement = containerRef.current.querySelector('svg');
      if (!svgElement) return;
      if (color) {
        svgElement.style.filter = color === '#ffffff' ? 'invert(1)' : 'invert(0)';
      } else {
        const isDark = document.documentElement.classList.contains('dark');
        svgElement.style.filter = isDark ? 'invert(1)' : 'invert(0)';
      }
    }
    applyFilter();
    // Re-apply when dark mode class changes (no color prop)
    if (!color) {
      const observer = new MutationObserver(applyFilter);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    }
  }, [color]);

  const handleMouseEnter = () => {
    if (lottieRef.current) {
      lottieRef.current.goToAndPlay(0, true);
    }
  };

  // Select the appropriate animation based on collapsed state
  const animationData = isCollapsed ? sidebarExpandAnimation : sidebarCloseAnimation;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size * 0.936, height: size * 0.936, opacity: 0.4 }}
      onMouseEnter={handleMouseEnter}
    >
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        loop={false}
        autoplay={false}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};