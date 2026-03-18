/**
 * motion-shim.tsx
 *
 * Drop-in replacement for `motion/react` that avoids the dual-React
 * "Invalid hook call" crash in Figma Make's preview iframe.
 *
 * Renders plain HTML elements with CSS transition/animation classes.
 * `initial`, `animate`, `exit`, `transition` props are silently ignored
 * — the visual animations are handled by Tailwind / theme.css keyframes.
 */
import React, { forwardRef, type ComponentPropsWithRef, type ElementType } from 'react';

// Strip motion-specific props so they don't leak to the DOM
const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants',
  'whileHover', 'whileTap', 'whileFocus', 'whileDrag', 'whileInView',
  'drag', 'dragConstraints', 'dragElastic', 'dragMomentum',
  'onDrag', 'onDragStart', 'onDragEnd',
  'layout', 'layoutId', 'layoutDependency',
  'onAnimationStart', 'onAnimationComplete',
  'onViewportEnter', 'onViewportLeave',
]);

function stripMotionProps(props: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of Object.keys(props)) {
    if (!MOTION_PROPS.has(key)) {
      clean[key] = props[key];
    }
  }
  return clean;
}

function createMotionComponent<T extends keyof JSX.IntrinsicElements>(tag: T) {
  const Comp = forwardRef<any, any>((props, ref) => {
    const clean = stripMotionProps(props);
    return React.createElement(tag, { ...clean, ref });
  });
  Comp.displayName = `motion.${tag}`;
  return Comp;
}

// Cache created components
const cache = new Map<string, any>();

function getOrCreate(tag: string) {
  if (!cache.has(tag)) {
    cache.set(tag, createMotionComponent(tag as any));
  }
  return cache.get(tag)!;
}

// Pre-build the most common ones
const motionDiv = getOrCreate('div');
const motionSpan = getOrCreate('span');
const motionP = getOrCreate('p');
const motionButton = getOrCreate('button');
const motionA = getOrCreate('a');
const motionUl = getOrCreate('ul');
const motionLi = getOrCreate('li');
const motionSection = getOrCreate('section');
const motionNav = getOrCreate('nav');
const motionHeader = getOrCreate('header');
const motionMain = getOrCreate('main');
const motionImg = getOrCreate('img');
const motionSvg = getOrCreate('svg');
const motionPath = getOrCreate('path');

// Proxy so `motion.anything` works
export const motion = new Proxy(
  {
    div: motionDiv,
    span: motionSpan,
    p: motionP,
    button: motionButton,
    a: motionA,
    ul: motionUl,
    li: motionLi,
    section: motionSection,
    nav: motionNav,
    header: motionHeader,
    main: motionMain,
    img: motionImg,
    svg: motionSvg,
    path: motionPath,
  } as Record<string, any>,
  {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      return getOrCreate(prop);
    },
  },
);

// AnimatePresence — just renders children
export function AnimatePresence({
  children,
  mode,
  initial,
  onExitComplete,
}: {
  children?: React.ReactNode;
  mode?: string;
  initial?: boolean;
  onExitComplete?: () => void;
}) {
  return <>{children}</>;
}