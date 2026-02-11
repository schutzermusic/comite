/**
 * Three.js Performance Configuration
 * Optimized defaults for enterprise dashboard with WebGL
 */

import type { RootState } from '@react-three/fiber';

export interface ThreePerfConfig {
  dpr: [number, number];
  frameloop: 'always' | 'demand' | 'never';
  gl: {
    antialias: boolean;
    alpha: boolean;
    powerPreference: 'high-performance' | 'low-power' | 'default';
    preserveDrawingBuffer: boolean;
    failIfMajorPerformanceCaveat: boolean;
  };
  shadows: boolean;
  flat: boolean;
}

/**
 * Detect device performance tier based on hardware
 */
export function getDevicePerformanceTier(): 'high' | 'medium' | 'low' {
  if (typeof window === 'undefined') return 'medium';
  
  // Check for mobile devices
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  
  // Check hardware concurrency (CPU cores)
  const cores = navigator.hardwareConcurrency || 4;
  
  // Check device memory (if available)
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
  
  if (isMobile || cores <= 2 || memory <= 2) {
    return 'low';
  } else if (cores >= 8 && memory >= 8) {
    return 'high';
  }
  
  return 'medium';
}

/**
 * Get optimized Three.js configuration based on device tier
 */
export function getThreePerfConfig(
  tier?: 'high' | 'medium' | 'low'
): ThreePerfConfig {
  const deviceTier = tier || getDevicePerformanceTier();
  
  const configs: Record<'high' | 'medium' | 'low', ThreePerfConfig> = {
    high: {
      dpr: [1, 2],
      frameloop: 'always',
      gl: {
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
      },
      shadows: false,
      flat: false,
    },
    medium: {
      dpr: [1, 1.5],
      frameloop: 'always',
      gl: {
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
      },
      shadows: false,
      flat: false,
    },
    low: {
      dpr: [1, 1],
      frameloop: 'demand',
      gl: {
        antialias: false,
        alpha: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: true,
      },
      shadows: false,
      flat: true,
    },
  };
  
  return configs[deviceTier];
}

/**
 * Default camera configuration for dashboard 3D elements
 */
export const defaultCameraConfig = {
  fov: 45,
  near: 0.1,
  far: 100,
  position: [0, 0, 5] as [number, number, number],
};

/**
 * Orion Green theme colors for Three.js materials
 * Metallic green futuristic palette
 */
export const orionThreeColors = {
  primary: '#10b981',    // Emerald (main accent)
  secondary: '#06b6d4',  // Cyan (data accent)
  tertiary: '#22c55e',   // Bright green
  highlight: '#14b8a6',  // Teal
  success: '#10b981',    // Green
  warning: '#f59e0b',    // Amber
  error: '#ef4444',      // Red
  background: '#0a0f0d', // Deep forest black
  ambient: '#111a17',    // Elevated dark green
  glow: 'rgba(16, 185, 129, 0.4)', // Emerald glow
};

/**
 * Performance monitoring callback for R3F
 */
export function createPerfCallback(
  onPerfChange?: (fps: number) => void
) {
  let frameCount = 0;
  let lastTime = performance.now();
  
  return (state: RootState) => {
    frameCount++;
    const now = performance.now();
    
    if (now - lastTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastTime));
      onPerfChange?.(fps);
      frameCount = 0;
      lastTime = now;
    }
  };
}

