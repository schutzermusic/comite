import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Consolas', 'monospace'],
        display: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
      colors: {
        // =====================================================================
        // SENTINEL THEME - Enterprise Intelligence Dashboard
        // =====================================================================
        sentinel: {
          // Background Hierarchy - Atmospheric Dark
          bg: {
            void: '#070A0D',
            primary: '#0B1016',
            secondary: '#0F151B',
            tertiary: '#131A21',
            panel: 'rgba(18, 25, 32, 0.75)',
            elevated: 'rgba(25, 35, 45, 0.85)',
            card: 'rgba(15, 22, 28, 0.92)',
            hover: 'rgba(30, 42, 54, 0.60)',
            active: 'rgba(35, 48, 62, 0.70)',
          },
          // Accent Colors - Muted Intelligence Palette
          accent: {
            teal: '#14B8A6',
            'teal-muted': 'rgba(20, 184, 166, 0.15)',
            'teal-glow': 'rgba(20, 184, 166, 0.25)',
            cyan: '#00D4FF',
            'cyan-muted': 'rgba(0, 212, 255, 0.12)',
            'cyan-glow': 'rgba(0, 212, 255, 0.20)',
            amber: '#FFB04D',
            'amber-muted': 'rgba(255, 176, 77, 0.12)',
            'amber-glow': 'rgba(255, 176, 77, 0.20)',
            crimson: '#FF5860',
            'crimson-muted': 'rgba(255, 88, 96, 0.12)',
            'crimson-glow': 'rgba(255, 88, 96, 0.22)',
            emerald: '#10B981',
            'emerald-muted': 'rgba(16, 185, 129, 0.12)',
            'emerald-glow': 'rgba(16, 185, 129, 0.20)',
          },
          // Border Hierarchy
          border: {
            subtle: 'rgba(160, 200, 190, 0.06)',
            DEFAULT: 'rgba(160, 200, 190, 0.10)',
            strong: 'rgba(160, 200, 190, 0.16)',
            focus: 'rgba(160, 200, 190, 0.24)',
            glow: 'rgba(20, 184, 166, 0.30)',
            'glow-cyan': 'rgba(0, 212, 255, 0.25)',
          },
          // Text Hierarchy
          text: {
            primary: '#F0F4F3',
            secondary: 'rgba(240, 244, 243, 0.70)',
            tertiary: 'rgba(240, 244, 243, 0.50)',
            muted: 'rgba(240, 244, 243, 0.35)',
            system: 'rgba(180, 200, 195, 0.80)',
            inverse: '#0B1016',
          },
        },

        // Orion Dark Theme - Primary (keeping for compatibility)
        orion: {
          bg: {
            DEFAULT: '#0a0a0f',
            primary: '#0a0a0f',
            secondary: '#0f0f14',
            tertiary: '#14141a',
            elevated: '#1a1a22',
            hover: '#1f1f28',
          },
          border: {
            subtle: 'rgba(255, 255, 255, 0.06)',
            DEFAULT: 'rgba(255, 255, 255, 0.08)',
            strong: 'rgba(255, 255, 255, 0.12)',
            focus: 'rgba(255, 255, 255, 0.16)',
          },
          text: {
            primary: '#ffffff',
            secondary: 'rgba(255, 255, 255, 0.7)',
            tertiary: 'rgba(255, 255, 255, 0.5)',
            muted: 'rgba(255, 255, 255, 0.35)',
          },
        },
        // Semantic Colors
        semantic: {
          success: {
            DEFAULT: '#10b981',
            light: '#34d399',
            dark: '#059669',
          },
          warning: {
            DEFAULT: '#f59e0b',
            light: '#fbbf24',
            dark: '#d97706',
          },
          error: {
            DEFAULT: '#ef4444',
            light: '#f87171',
            dark: '#dc2626',
          },
          info: {
            DEFAULT: '#06b6d4',
            light: '#22d3ee',
            dark: '#0891b2',
          },
        },
        // Chart accent colors
        chart: {
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
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        // Glass effects
        glass: {
          subtle: 'rgba(255, 255, 255, 0.03)',
          light: 'rgba(255, 255, 255, 0.06)',
          medium: 'rgba(255, 255, 255, 0.1)',
          strong: 'rgba(255, 255, 255, 0.15)',
        },
        // Intelligence Control Room Theme
        intel: {
          bg: {
            void: '#070A0D',
            primary: '#0B1016',
            panel: 'rgba(20, 28, 35, 0.55)',
            elevated: 'rgba(25, 35, 45, 0.65)',
          },
          border: {
            subtle: 'rgba(160, 200, 190, 0.08)',
            DEFAULT: 'rgba(160, 200, 190, 0.12)',
            strong: 'rgba(160, 200, 190, 0.18)',
          },
          text: {
            primary: '#F0F4F3',
            secondary: 'rgba(240, 244, 243, 0.70)',
            muted: 'rgba(240, 244, 243, 0.45)',
            system: 'rgba(180, 200, 195, 0.80)',
          },
          accent: {
            teal: '#14B8A6',
            tealMuted: 'rgba(20, 184, 166, 0.15)',
            amber: '#F59E0B',
            amberMuted: 'rgba(245, 158, 11, 0.12)',
            red: '#EF4444',
            redMuted: 'rgba(239, 68, 68, 0.12)',
          },
          glow: {
            teal: 'rgba(20, 184, 166, 0.20)',
            amber: 'rgba(245, 158, 11, 0.18)',
            red: 'rgba(239, 68, 68, 0.22)',
          }
        },
        // Legacy colors (keeping for compatibility)
        insight: {
          gold: '#FFD700',
          'gold-light': '#FFE44D',
          'gold-dark': '#FFB800',
          emerald: '#10B981',
          'emerald-light': '#34D399',
          'emerald-dark': '#059669',
          lime: '#84CC16',
          'lime-light': '#A3E635',
          'lime-dark': '#65A30D',
        },
        neon: {
          electric: '#3B82F6',
          'electric-light': '#60A5FA',
          'electric-dark': '#2563EB',
          orange: '#F97316',
          'orange-light': '#FB923C',
          'orange-dark': '#EA580C',
          cyan: '#06B6D4',
        },
        executive: {
          carbon: '#0A0A0A',
          'carbon-light': '#1A1A1A',
          'carbon-dark': '#000000',
          brushed: '#E5E7EB',
          'brushed-light': '#F3F4F6',
          'brushed-dark': '#D1D5DB',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      fontSize: {
        // Sentinel KPI Typography
        'sentinel-kpi-hero': ['48px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'sentinel-kpi-lg': ['36px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'sentinel-kpi-md': ['28px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
        'sentinel-kpi-sm': ['22px', { lineHeight: '1.2', fontWeight: '600' }],
        'sentinel-heading': ['20px', { lineHeight: '1.3', fontWeight: '600' }],
        'sentinel-body': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'sentinel-label': ['12px', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.08em' }],
        'sentinel-caption': ['11px', { lineHeight: '1.4', fontWeight: '400', letterSpacing: '0.02em' }],
        'sentinel-micro': ['10px', { lineHeight: '1.4', fontWeight: '400', letterSpacing: '0.05em' }],
        // Legacy KPI sizes
        'kpi-lg': ['48px', { lineHeight: '1.1', fontWeight: '700' }],
        'kpi-md': ['36px', { lineHeight: '1.1', fontWeight: '700' }],
        'kpi-sm': ['28px', { lineHeight: '1.2', fontWeight: '600' }],
        // Labels
        'label': ['12px', { lineHeight: '1.4', letterSpacing: '0.05em' }],
        'caption': ['11px', { lineHeight: '1.4', letterSpacing: '0.02em' }],
        'micro': ['10px', { lineHeight: '1.4', letterSpacing: '0.05em' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '24px',
      },
      boxShadow: {
        // =====================================================================
        // SENTINEL SHADOWS & GLOWS
        // =====================================================================
        'sentinel-card': '0 4px 24px rgba(0, 0, 0, 0.40), 0 0 1px rgba(160, 200, 190, 0.08)',
        'sentinel-card-hover': '0 8px 32px rgba(0, 0, 0, 0.50), 0 0 1px rgba(160, 200, 190, 0.12), 0 0 20px rgba(20, 184, 166, 0.08)',
        'sentinel-card-elevated': '0 12px 40px rgba(0, 0, 0, 0.55), 0 0 1px rgba(160, 200, 190, 0.15), 0 0 30px rgba(20, 184, 166, 0.10)',
        'sentinel-glow-teal': '0 0 20px rgba(20, 184, 166, 0.25), 0 0 40px rgba(20, 184, 166, 0.10)',
        'sentinel-glow-cyan': '0 0 20px rgba(0, 212, 255, 0.20), 0 0 40px rgba(0, 212, 255, 0.08)',
        'sentinel-glow-amber': '0 0 20px rgba(255, 176, 77, 0.20), 0 0 40px rgba(255, 176, 77, 0.08)',
        'sentinel-glow-crimson': '0 0 20px rgba(255, 88, 96, 0.22), 0 0 40px rgba(255, 88, 96, 0.10)',
        'sentinel-glow-emerald': '0 0 20px rgba(16, 185, 129, 0.25), 0 0 40px rgba(16, 185, 129, 0.10)',
        'sentinel-inner': 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        // Orion shadows (legacy)
        'orion-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
        'orion-md': '0 4px 6px rgba(0, 0, 0, 0.3)',
        'orion-lg': '0 10px 15px rgba(0, 0, 0, 0.3)',
        'orion-xl': '0 20px 25px rgba(0, 0, 0, 0.4)',
        'orion-card': '0 4px 24px rgba(0, 0, 0, 0.4)',
        'orion-card-hover': '0 8px 32px rgba(0, 0, 0, 0.5)',
        // Glow effects (semantic)
        'glow-success': '0 0 20px rgba(16, 185, 129, 0.3)',
        'glow-warning': '0 0 20px rgba(245, 158, 11, 0.3)',
        'glow-error': '0 0 20px rgba(239, 68, 68, 0.3)',
        'glow-info': '0 0 20px rgba(6, 182, 212, 0.3)',
        'glow-purple': '0 0 20px rgba(139, 92, 246, 0.3)',
        // Inner glow
        'inner-subtle': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        'inner-medium': 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        // Legacy
        'glow-sm': '0 0 10px rgba(255, 215, 0, 0.3)',
        'glow-md': '0 0 20px rgba(255, 215, 0, 0.4)',
        'glow-lg': '0 0 30px rgba(255, 215, 0, 0.5)',
        'neon-gold': '0 0 20px rgba(255, 215, 0, 0.5), 0 0 40px rgba(255, 215, 0, 0.3)',
        'neon-emerald': '0 0 20px rgba(16, 185, 129, 0.5), 0 0 40px rgba(16, 185, 129, 0.3)',
        'neon-electric': '0 0 20px rgba(59, 130, 246, 0.5), 0 0 40px rgba(59, 130, 246, 0.3)',
        'neon-orange': '0 0 20px rgba(249, 115, 22, 0.5), 0 0 40px rgba(249, 115, 22, 0.3)',
        'executive': '0 20px 60px -15px rgba(0, 0, 0, 0.4)',
      },
      backgroundImage: {
        // =====================================================================
        // SENTINEL GRADIENTS
        // =====================================================================
        'sentinel-bg': 'linear-gradient(180deg, #070A0D 0%, #0B1016 50%, #0F151B 100%)',
        'sentinel-radial-top': 'radial-gradient(ellipse at 50% 0%, rgba(20, 184, 166, 0.06) 0%, transparent 50%)',
        'sentinel-radial-bottom': 'radial-gradient(ellipse at 80% 100%, rgba(0, 212, 255, 0.04) 0%, transparent 40%)',
        'sentinel-card': 'linear-gradient(135deg, rgba(15, 22, 28, 0.95) 0%, rgba(11, 16, 22, 0.98) 100%)',
        'sentinel-card-hover': 'linear-gradient(135deg, rgba(20, 28, 36, 0.95) 0%, rgba(15, 22, 28, 0.98) 100%)',
        'sentinel-glow-line': 'linear-gradient(90deg, transparent 0%, rgba(20, 184, 166, 0.4) 50%, transparent 100%)',
        'sentinel-glow-line-cyan': 'linear-gradient(90deg, transparent 0%, rgba(0, 212, 255, 0.35) 50%, transparent 100%)',
        // Orion gradients (legacy)
        'orion-gradient': 'linear-gradient(135deg, #0a0a0f 0%, #14141a 100%)',
        'orion-glow': 'radial-gradient(ellipse at center, rgba(6, 182, 212, 0.15) 0%, transparent 70%)',
        'orion-grid': 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        // Glass gradients
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
        'glass-border': 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'glow-pulse': {
          '0%, 100%': { 
            boxShadow: '0 0 20px rgba(6, 182, 212, 0.2)',
          },
          '50%': { 
            boxShadow: '0 0 30px rgba(6, 182, 212, 0.4)',
          },
        },
        'glow-pulse-teal': {
          '0%, 100%': { 
            boxShadow: '0 0 15px rgba(20, 184, 166, 0.2)',
          },
          '50%': { 
            boxShadow: '0 0 25px rgba(20, 184, 166, 0.35)',
          },
        },
        'glow-pulse-success': {
          '0%, 100%': { 
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)',
          },
          '50%': { 
            boxShadow: '0 0 30px rgba(16, 185, 129, 0.4)',
          },
        },
        'glow-pulse-warning': {
          '0%, 100%': { 
            boxShadow: '0 0 20px rgba(245, 158, 11, 0.2)',
          },
          '50%': { 
            boxShadow: '0 0 30px rgba(245, 158, 11, 0.4)',
          },
        },
        'glow-pulse-error': {
          '0%, 100%': { 
            boxShadow: '0 0 20px rgba(239, 68, 68, 0.2)',
          },
          '50%': { 
            boxShadow: '0 0 30px rgba(239, 68, 68, 0.4)',
          },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'ring-rotate': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-subtle': 'pulse-subtle 3s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        'glow-pulse-teal': 'glow-pulse-teal 3s ease-in-out infinite',
        'glow-pulse-success': 'glow-pulse-success 3s ease-in-out infinite',
        'glow-pulse-warning': 'glow-pulse-warning 3s ease-in-out infinite',
        'glow-pulse-error': 'glow-pulse-error 3s ease-in-out infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'float': 'float 4s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'spin-slow': 'spin-slow 8s linear infinite',
        'ring-rotate': 'ring-rotate 20s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
