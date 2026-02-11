/**
 * Shared Motion Presets for Premium Hover Interactions
 * Used with Framer Motion throughout the dashboard
 */

import { Variants, Transition } from 'framer-motion';

// =============================================================================
// SPRING CONFIGS - Premium Refined
// =============================================================================

export const springSmooth: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
};

export const springBouncy: Transition = {
  type: 'spring',
  stiffness: 450,
  damping: 28,
};

export const springGentle: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 38,
};

// Premium easing for refined hover
export const premiumEasing = [0.25, 0.1, 0.25, 1]; // cubic-bezier

// =============================================================================
// CARD HOVER PRESETS
// =============================================================================

/**
 * Standard card hover - refined premium feel
 */
export const cardHoverVariants: Variants = {
  rest: {
    y: 0,
    scale: 1,
    transition: {
      ...springSmooth,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
  hover: {
    y: -5,
    scale: 1.01,
    transition: {
      ...springSmooth,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
  tap: {
    scale: 0.99,
    transition: { 
      duration: 0.12,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
};

/**
 * KPI card hover - refined premium feel with subtle glow intensification
 */
export const kpiCardHoverVariants: Variants = {
  rest: {
    y: 0,
    scale: 1,
    transition: {
      ...springSmooth,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
  hover: {
    y: -6,
    scale: 1.012,
    transition: {
      ...springBouncy,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
  tap: {
    scale: 0.99,
    transition: { 
      duration: 0.12,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
};

/**
 * Container hover - subtle movement for larger cards
 */
export const containerHoverVariants: Variants = {
  rest: {
    y: 0,
    scale: 1,
    transition: springGentle,
  },
  hover: {
    y: -4,
    scale: 1.005,
    transition: springGentle,
  },
};

/**
 * Glow intensity animation (for CSS custom properties)
 */
export const glowIntensityVariants: Variants = {
  rest: {
    '--glow-opacity': 0.08,
    '--glow-spread': '20px',
    transition: { duration: 0.3 },
  },
  hover: {
    '--glow-opacity': 0.15,
    '--glow-spread': '40px',
    transition: { duration: 0.3 },
  },
};

// =============================================================================
// STAGGER & LIST ANIMATIONS
// =============================================================================

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springSmooth,
  },
};

// =============================================================================
// FADE & SLIDE ANIMATIONS
// =============================================================================

export const fadeInUp: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
};

export const fadeInScale: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: springSmooth,
  },
};

// =============================================================================
// PULSE & GLOW ANIMATIONS
// =============================================================================

export const pulseGlow: Variants = {
  pulse: {
    boxShadow: [
      '0 0 20px rgba(16, 185, 129, 0.1)',
      '0 0 40px rgba(16, 185, 129, 0.2)',
      '0 0 20px rgba(16, 185, 129, 0.1)',
    ],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// =============================================================================
// LIGHT SWEEP EFFECT (CSS-based)
// =============================================================================

/**
 * CSS class for light sweep effect on hover
 * Apply to parent element, add child with class "light-sweep"
 */
export const lightSweepCSS = `
  .light-sweep-container {
    position: relative;
    overflow: hidden;
  }
  
  .light-sweep-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 50%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.03),
      rgba(16, 185, 129, 0.05),
      transparent
    );
    transform: skewX(-20deg);
    transition: left 0.6s ease-out;
    pointer-events: none;
    z-index: 20;
  }
  
  .light-sweep-container:hover::before {
    left: 150%;
  }
`;


