import React, { useRef, useEffect } from 'react';
import Lottie from 'lottie-react';
import { sidebarCloseAnimation } from './sidebar-close-animation';
import { sidebarExpandAnimation } from './sidebar-expand-animation';

interface ArrowLeftIconProps {
  size?: number;
  color?: string;
  isCollapsed?: boolean;
}

export const ArrowLeftIcon = ({ size = 24, color = "#000000", isCollapsed = false }: ArrowLeftIconProps) => {
  const lottieRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply color filter to the animation
  useEffect(() => {
    if (containerRef.current) {
      const svgElement = containerRef.current.querySelector('svg');
      if (svgElement) {
        svgElement.style.filter = color === '#ffffff' ? 'invert(1)' : 'invert(0)';
      }
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