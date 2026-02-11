/**
 * Orion Design Tokens
 * Premium dark-mode-first enterprise design system
 * Inspired by Orion UI Kit, Palantir, and Diligent
 */

// ============================================
// COLOR PALETTE
// ============================================

export const colors = {
  // Base Dark Palette
  dark: {
    bg: {
      primary: '#0a0a0f',      // Deepest background
      secondary: '#0f0f14',    // Card backgrounds
      tertiary: '#14141a',     // Elevated surfaces
      hover: '#1a1a22',        // Hover states
      active: '#1f1f28',       // Active/pressed states
    },
    border: {
      subtle: 'rgba(255, 255, 255, 0.06)',
      default: 'rgba(255, 255, 255, 0.08)',
      strong: 'rgba(255, 255, 255, 0.12)',
      focus: 'rgba(255, 255, 255, 0.16)',
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255, 255, 255, 0.7)',
      tertiary: 'rgba(255, 255, 255, 0.5)',
      muted: 'rgba(255, 255, 255, 0.35)',
      disabled: 'rgba(255, 255, 255, 0.2)',
    },
  },

  // Base Light Palette
  light: {
    bg: {
      primary: '#ffffff',
      secondary: '#f8f9fa',
      tertiary: '#f1f3f5',
      hover: '#e9ecef',
      active: '#dee2e6',
    },
    border: {
      subtle: 'rgba(0, 0, 0, 0.04)',
      default: 'rgba(0, 0, 0, 0.08)',
      strong: 'rgba(0, 0, 0, 0.12)',
      focus: 'rgba(0, 0, 0, 0.16)',
    },
    text: {
      primary: '#0a0a0f',
      secondary: 'rgba(10, 10, 15, 0.7)',
      tertiary: 'rgba(10, 10, 15, 0.5)',
      muted: 'rgba(10, 10, 15, 0.35)',
      disabled: 'rgba(10, 10, 15, 0.2)',
    },
  },

  // Neo Colors - Premium HUD Palette
  neo: {
    green: '#00FFB4',      // NeoGreen - Primary accent
    cyan: '#00C8FF',       // NeoCyan - Secondary accent
    amber: '#FFB04D',      // NeoAmber - Warnings
    red: '#FF5860',        // NeoRed - Critical
  },

  // Theme Backgrounds
  theme: {
    slateBlack: '#050D0A',    // Primary background
    deepSlate: '#0A1612',     // Cards and surfaces
  },

  // Text Colors (High/Medium/Low emphasis)
  text: {
    high: 'rgba(255, 255, 255, 0.92)',
    medium: 'rgba(255, 255, 255, 0.65)',
    low: 'rgba(255, 255, 255, 0.40)',
  },

  // Semantic Colors (updated to use Neo palette)
  semantic: {
    // Success / Healthy - using NeoGreen
    success: {
      default: '#00FFB4',      // NeoGreen
      light: '#33FFC4',
      dark: '#00CC90',
      glow: 'rgba(0, 255, 180, 0.18)',
      bg: 'rgba(0, 255, 180, 0.12)',
    },
    // Warning / Attention - using NeoAmber
    warning: {
      default: '#FFB04D',      // NeoAmber
      light: '#FFC070',
      dark: '#CC8A3E',
      glow: 'rgba(255, 176, 77, 0.18)',
      bg: 'rgba(255, 176, 77, 0.12)',
    },
    // Error / Critical - using NeoRed
    error: {
      default: '#FF5860',      // NeoRed
      light: '#FF787D',
      dark: '#CC464D',
      glow: 'rgba(255, 88, 96, 0.18)',
      bg: 'rgba(255, 88, 96, 0.12)',
    },
    // Info / Data Accent - using NeoCyan
    info: {
      default: '#00C8FF',      // NeoCyan
      light: '#33D4FF',
      dark: '#00A0CC',
      glow: 'rgba(0, 200, 255, 0.18)',
      bg: 'rgba(0, 200, 255, 0.12)',
    },
  },

  // Accent Colors (for charts and highlights)
  accent: {
    cyan: '#06b6d4',
    purple: '#8b5cf6',
    pink: '#ec4899',
    orange: '#f97316',
    blue: '#3b82f6',
    indigo: '#6366f1',
    teal: '#14b8a6',
    lime: '#84cc16',
    rose: '#f43f5e',
    violet: '#a855f7',
  },

  // Chart Color Scales
  charts: {
    // Sequential scale for single-hue data
    sequential: ['#0f4c5c', '#1a6b7c', '#24899c', '#2fa8bc', '#3bc7dc'],
    // Diverging scale for pos/neg data
    diverging: ['#ef4444', '#f87171', '#fca5a5', '#fef3c7', '#34d399', '#10b981', '#059669'],
    // Categorical scale for distinct categories
    categorical: ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#3b82f6'],
    // Heatmap scale
    heatmap: ['#0f4c5c', '#1a6b7c', '#f59e0b', '#f97316', '#ef4444'],
  },

  // Glass effects
  glass: {
    light: 'rgba(255, 255, 255, 0.03)',
    medium: 'rgba(255, 255, 255, 0.06)',
    strong: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(255, 255, 255, 0.08)',
  },
} as const;

// ============================================
// TYPOGRAPHY
// ============================================

export const typography = {
  fontFamily: {
    primary: '"Inter var", "Inter", "ui-sans-serif", system-ui, -apple-system, "SF Pro Display", BlinkMacSystemFont, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", Consolas, monospace',
  },
  fontSize: {
    // KPI and metrics
    kpiLarge: '48px',
    kpiMedium: '36px',
    kpiSmall: '28px',
    // Headings
    h1: '32px',
    h2: '24px',
    h3: '20px',
    h4: '16px',
    // Body
    body: '14px',
    small: '13px',
    // Labels and captions
    label: '12px',
    caption: '11px',
    micro: '10px',
  },
  fontWeight: {
    light: 300,        // Small annotations
    regular: 400,      // Labels & metrics
    medium: 500,       // Section headings
    semibold: 600,     // Titles
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.05em',
    wider: '0.1em',
    widest: '0.15em',
  },
} as const;

// ============================================
// SPACING (8pt Grid System)
// ============================================

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  9: '36px',
  10: '40px',
  12: '48px',
  14: '56px',
  16: '64px',
  20: '80px',
  24: '96px',
  32: '128px',
} as const;

// ============================================
// BORDERS & RADIUS
// ============================================

export const borders = {
  radius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '24px',
    full: '9999px',
  },
  width: {
    none: '0',
    thin: '1px',
    default: '1px',
    thick: '2px',
  },
} as const;

// ============================================
// SHADOWS & GLOWS
// ============================================

export const shadows = {
  // Standard shadows
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 6px rgba(0, 0, 0, 0.3)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.3)',
  xl: '0 20px 25px rgba(0, 0, 0, 0.4)',
  
  // Glow effects (semantic)
  glow: {
    success: '0 0 20px rgba(16, 185, 129, 0.3)',
    warning: '0 0 20px rgba(245, 158, 11, 0.3)',
    error: '0 0 20px rgba(239, 68, 68, 0.3)',
    info: '0 0 20px rgba(6, 182, 212, 0.3)',
    purple: '0 0 20px rgba(139, 92, 246, 0.3)',
  },
  
  // Inner glows
  innerGlow: {
    subtle: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
    medium: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  },
  
  // Card shadows
  card: '0 4px 24px rgba(0, 0, 0, 0.4)',
  cardHover: '0 8px 32px rgba(0, 0, 0, 0.5)',
} as const;

// ============================================
// MOTION & ANIMATION
// ============================================

export const motion = {
  duration: {
    instant: '0ms',
    fast: '100ms',
    normal: '200ms',
    slow: '300ms',
    slower: '500ms',
  },
  easing: {
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

// ============================================
// Z-INDEX
// ============================================

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  fixed: 300,
  modalBackdrop: 400,
  modal: 500,
  popover: 600,
  tooltip: 700,
  toast: 800,
} as const;

// ============================================
// BREAKPOINTS
// ============================================

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// ============================================
// COMPONENT-SPECIFIC TOKENS
// ============================================

export const components = {
  // KPI Card
  kpiCard: {
    minWidth: '200px',
    padding: spacing[6],
    gap: spacing[2],
  },
  
  // Decision Queue Item
  queueItem: {
    padding: spacing[4],
    gap: spacing[3],
    borderRadius: borders.radius.lg,
  },
  
  // Chart container
  chart: {
    minHeight: '200px',
    padding: spacing[4],
  },
  
  // Sidebar
  sidebar: {
    widthExpanded: '280px',
    widthCollapsed: '72px',
    iconSize: '20px',
  },
} as const;

// ============================================
// THEME OBJECTS
// ============================================

export const darkTheme = {
  colors: {
    bg: colors.dark.bg,
    border: colors.dark.border,
    text: colors.dark.text,
    semantic: colors.semantic,
    accent: colors.accent,
    glass: colors.glass,
  },
  typography,
  spacing,
  borders,
  shadows,
  motion,
} as const;

export const lightTheme = {
  colors: {
    bg: colors.light.bg,
    border: colors.light.border,
    text: colors.light.text,
    semantic: colors.semantic,
    accent: colors.accent,
    glass: {
      light: 'rgba(0, 0, 0, 0.02)',
      medium: 'rgba(0, 0, 0, 0.04)',
      strong: 'rgba(0, 0, 0, 0.06)',
      border: 'rgba(0, 0, 0, 0.08)',
    },
  },
  typography,
  spacing,
  borders,
  shadows: {
    ...shadows,
    sm: '0 1px 2px rgba(0, 0, 0, 0.08)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.15)',
    card: '0 4px 24px rgba(0, 0, 0, 0.08)',
    cardHover: '0 8px 32px rgba(0, 0, 0, 0.12)',
  },
  motion,
} as const;

// ============================================
// NIVO CHART THEME
// ============================================

export const nivoTheme = {
  dark: {
    background: 'transparent',
    text: {
      fontSize: 11,
      fill: colors.dark.text.secondary,
      fontFamily: typography.fontFamily.primary,
    },
    axis: {
      domain: {
        line: {
          stroke: colors.dark.border.subtle,
          strokeWidth: 1,
        },
      },
      ticks: {
        line: {
          stroke: colors.dark.border.subtle,
          strokeWidth: 1,
        },
        text: {
          fontSize: 10,
          fill: colors.dark.text.muted,
        },
      },
      legend: {
        text: {
          fontSize: 11,
          fill: colors.dark.text.secondary,
        },
      },
    },
    grid: {
      line: {
        stroke: colors.dark.border.subtle,
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fontSize: 11,
        fill: colors.dark.text.secondary,
      },
    },
    tooltip: {
      container: {
        background: colors.dark.bg.tertiary,
        color: colors.dark.text.primary,
        fontSize: 12,
        borderRadius: 8,
        boxShadow: shadows.lg,
        padding: '8px 12px',
        border: `1px solid ${colors.dark.border.default}`,
      },
    },
  },
  light: {
    background: 'transparent',
    text: {
      fontSize: 11,
      fill: colors.light.text.secondary,
      fontFamily: typography.fontFamily.primary,
    },
    axis: {
      domain: {
        line: {
          stroke: colors.light.border.default,
          strokeWidth: 1,
        },
      },
      ticks: {
        line: {
          stroke: colors.light.border.subtle,
          strokeWidth: 1,
        },
        text: {
          fontSize: 10,
          fill: colors.light.text.muted,
        },
      },
      legend: {
        text: {
          fontSize: 11,
          fill: colors.light.text.secondary,
        },
      },
    },
    grid: {
      line: {
        stroke: colors.light.border.subtle,
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fontSize: 11,
        fill: colors.light.text.secondary,
      },
    },
    tooltip: {
      container: {
        background: colors.light.bg.primary,
        color: colors.light.text.primary,
        fontSize: 12,
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        padding: '8px 12px',
        border: `1px solid ${colors.light.border.default}`,
      },
    },
  },
} as const;

// Export all tokens
export default {
  colors,
  typography,
  spacing,
  borders,
  shadows,
  motion,
  zIndex,
  breakpoints,
  components,
  darkTheme,
  lightTheme,
  nivoTheme,
};






