/**
 * Orion Green Theme System
 * Premium Metallic Green Enterprise Theme
 * Inspired by Palantir, Orion UI, and high-end control rooms
 */

// =============================================================================
// COLOR TOKENS
// =============================================================================

export const orionGreenColors = {
  // Primary Background Gradient - Metallic Green
  bg: {
    primary: '#0a0f0d',      // Deep forest black
    secondary: '#0d1412',    // Elevated dark green
    tertiary: '#111a17',     // Card surface
    elevated: '#152320',     // Hover/active states
    glass: 'rgba(16, 32, 28, 0.6)', // Glass morphism
    glassLight: 'rgba(20, 40, 35, 0.4)',
    overlay: 'rgba(8, 14, 12, 0.85)',
  },

  // Text Hierarchy - Premium lift (+10-15% secondary contrast)
  text: {
    primary: '#f0fdf8',      // Brighter with green tint
    secondary: '#d8f0e4',    // +15% brighter for better contrast
    tertiary: '#9abfaf',     // +12% brighter for improved low emphasis
    muted: '#6a8b7c',        // +15% brighter for more visible hints
    inverse: '#0a0f0d',
    // Premium KPI text
    kpiNumber: '#ffffff',    // Pure white for numbers
    heading: '#f8fffc',      // Slightly brighter for section titles
  },

  // Accent Colors - Emerald/Cyan Focus
  accent: {
    primary: '#10b981',      // Emerald green (main)
    primaryDark: '#059669',
    primaryLight: '#34d399',
    primaryGlow: 'rgba(16, 185, 129, 0.4)',
    
    secondary: '#06b6d4',    // Cyan (data/info)
    secondaryDark: '#0891b2',
    secondaryLight: '#22d3ee',
    secondaryGlow: 'rgba(6, 182, 212, 0.3)',
    
    tertiary: '#8b5cf6',     // Violet (subtle accent only)
    tertiaryGlow: 'rgba(139, 92, 246, 0.2)',
  },

  // Semantic Colors
  semantic: {
    success: '#10b981',
    successGlow: 'rgba(16, 185, 129, 0.35)',
    warning: '#f59e0b',
    warningGlow: 'rgba(245, 158, 11, 0.3)',
    error: '#ef4444',
    errorGlow: 'rgba(239, 68, 68, 0.3)',
    info: '#06b6d4',
    infoGlow: 'rgba(6, 182, 212, 0.3)',
  },

  // Borders
  border: {
    subtle: 'rgba(16, 185, 129, 0.08)',
    default: 'rgba(16, 185, 129, 0.15)',
    strong: 'rgba(16, 185, 129, 0.25)',
    glow: 'rgba(16, 185, 129, 0.4)',
  },

  // Chart Palette - Green-Cyan Dominant
  chart: {
    primary: '#10b981',     // Emerald
    secondary: '#06b6d4',   // Cyan
    tertiary: '#22c55e',    // Green
    quaternary: '#14b8a6',  // Teal
    quinary: '#0ea5e9',     // Sky
    senary: '#8b5cf6',      // Violet (sparse use)
    // Gradients for area fills
    areaGradientStart: 'rgba(16, 185, 129, 0.4)',
    areaGradientEnd: 'rgba(16, 185, 129, 0.02)',
  },
} as const;

// =============================================================================
// GRADIENTS
// =============================================================================

export const orionGreenGradients = {
  // Background gradients
  bgPrimary: 'linear-gradient(180deg, #0a0f0d 0%, #0d1412 50%, #111a17 100%)',
  bgRadial: 'radial-gradient(ellipse at 50% 0%, rgba(16, 185, 129, 0.08) 0%, transparent 60%)',
  bgRadialSecondary: 'radial-gradient(ellipse at 80% 80%, rgba(6, 182, 212, 0.05) 0%, transparent 50%)',
  
  // Metallic shine
  metallicShine: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, transparent 50%, rgba(6, 182, 212, 0.05) 100%)',
  
  // Card gradients
  cardGlass: 'linear-gradient(135deg, rgba(16, 32, 28, 0.8) 0%, rgba(16, 32, 28, 0.4) 100%)',
  cardHover: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, transparent 100%)',
  
  // Chart gradients
  chartAreaPrimary: 'linear-gradient(180deg, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0.02) 100%)',
  chartAreaSecondary: 'linear-gradient(180deg, rgba(6, 182, 212, 0.3) 0%, rgba(6, 182, 212, 0.02) 100%)',
  
  // Text gradients
  textPremium: 'linear-gradient(135deg, #e8f5f0 0%, #a8c4b8 100%)',
  textAccent: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
} as const;

// =============================================================================
// SHADOWS & GLOWS
// =============================================================================

export const orionGreenShadows = {
  // Card shadows - Premium layered system
  cardDefault: `
    0 4px 24px rgba(0, 0, 0, 0.3), 
    0 0 1px rgba(16, 185, 129, 0.1),
    0 0 20px rgba(16, 185, 129, 0.08)
  `,
  cardElevated: `
    0 8px 32px rgba(0, 0, 0, 0.4), 
    0 0 2px rgba(16, 185, 129, 0.15),
    0 0 30px rgba(16, 185, 129, 0.12)
  `,
  cardHover: `
    0 16px 48px rgba(0, 0, 0, 0.5), 
    0 0 40px rgba(16, 185, 129, 0.15),
    0 0 60px rgba(16, 185, 129, 0.08)
  `,
  cardPremium: `
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 40px rgba(16, 185, 129, 0.15),
    0 0 80px rgba(16, 185, 129, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.06)
  `,
  // Primary cards - +25-40% glow intensity
  cardPrimary: `
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 0 50px rgba(16, 185, 129, 0.20),
    0 0 100px rgba(16, 185, 129, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08)
  `,
  cardPrimaryHover: `
    0 16px 48px rgba(0, 0, 0, 0.55),
    0 0 60px rgba(16, 185, 129, 0.25),
    0 0 120px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.10)
  `,
  // Secondary cards - +10-15% glow intensity
  cardSecondary: `
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 35px rgba(16, 185, 129, 0.13),
    0 0 70px rgba(16, 185, 129, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.06)
  `,
  
  // Glow effects - Enhanced
  glowPrimary: '0 0 30px rgba(16, 185, 129, 0.35), 0 0 60px rgba(16, 185, 129, 0.15)',
  glowSecondary: '0 0 25px rgba(6, 182, 212, 0.3), 0 0 50px rgba(6, 182, 212, 0.12)',
  glowSubtle: '0 0 15px rgba(16, 185, 129, 0.2), 0 0 30px rgba(16, 185, 129, 0.08)',
  glowIntense: '0 0 40px rgba(16, 185, 129, 0.4), 0 0 80px rgba(16, 185, 129, 0.2)',
  
  // Inner shadows
  innerSubtle: 'inset 0 1px 2px rgba(0, 0, 0, 0.2)',
  innerGlow: 'inset 0 0 20px rgba(16, 185, 129, 0.05)',
  innerHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.1)',
} as const;

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export const orionGreenTypography = {
  fontFamily: {
    display: '"SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    body: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"SF Mono", "Fira Code", "Consolas", monospace',
  },
  
  fontSize: {
    'kpi-xl': '3rem',        // 48px - Hero KPIs
    'kpi-lg': '2.25rem',     // 36px - Large numbers
    'kpi-md': '1.75rem',     // 28px - Medium numbers
    'kpi-sm': '1.25rem',     // 20px - Small numbers
    'heading-lg': '1.5rem',  // 24px
    'heading-md': '1.25rem', // 20px
    'heading-sm': '1rem',    // 16px
    'body-md': '0.875rem',   // 14px
    'body-sm': '0.75rem',    // 12px
    'label': '0.6875rem',    // 11px
    'micro': '0.625rem',     // 10px
  },
  
  fontWeight: {
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  
  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.05em',
    wider: '0.1em',    // For micro labels (increased)
    widest: '0.14em',  // For uppercase labels (increased)
  },

  // Premium text effects
  textShadow: {
    kpiNumber: '0 0 20px rgba(16, 185, 129, 0.4), 0 0 40px rgba(16, 185, 129, 0.2)',
    heading: '0 0 10px rgba(16, 185, 129, 0.15)',
    subtle: '0 0 8px rgba(16, 185, 129, 0.1)',
  },
} as const;

// =============================================================================
// SPACING & RADII
// =============================================================================

export const orionGreenSpacing = {
  px: '1px',
  0.5: '0.125rem',  // 2px
  1: '0.25rem',     // 4px
  2: '0.5rem',      // 8px
  3: '0.75rem',     // 12px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  8: '2rem',        // 32px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  16: '4rem',       // 64px
} as const;

export const orionGreenRadii = {
  none: '0',
  sm: '0.25rem',    // 4px
  md: '0.5rem',     // 8px
  lg: '0.75rem',    // 12px
  xl: '1rem',       // 16px
  '2xl': '1.5rem',  // 24px
  full: '9999px',
} as const;

// =============================================================================
// TRANSITIONS
// =============================================================================

export const orionGreenMotion = {
  duration: {
    fast: '150ms',
    normal: '300ms',
    slow: '500ms',
    slower: '800ms',
  },
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    smooth: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

// =============================================================================
// COMPLETE THEME OBJECT
// =============================================================================

export const orionGreenTheme = {
  colors: orionGreenColors,
  gradients: orionGreenGradients,
  shadows: orionGreenShadows,
  typography: orionGreenTypography,
  spacing: orionGreenSpacing,
  radii: orionGreenRadii,
  motion: orionGreenMotion,
} as const;

export type OrionGreenTheme = typeof orionGreenTheme;


