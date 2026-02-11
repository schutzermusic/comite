'use client';

import { Suspense, ReactNode, CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { getThreePerfConfig, defaultCameraConfig } from '@/lib/three/perf';
import { cn } from '@/lib/utils';

interface ThreeCanvasShellProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  performanceTier?: 'high' | 'medium' | 'low';
  eventSource?: HTMLElement;
  eventPrefix?: 'offset' | 'client' | 'page' | 'layer' | 'screen';
}

/**
 * Loading fallback for Three.js canvas
 */
function CanvasLoadingFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-2 border-orion-border-DEFAULT rounded-full" />
        <div className="absolute inset-0 border-2 border-semantic-info-DEFAULT border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

/**
 * Reusable Three.js Canvas wrapper with optimized settings
 * Handles performance, suspense, and cleanup
 */
export function ThreeCanvasShell({
  children,
  className,
  style,
  fallback,
  cameraPosition = defaultCameraConfig.position,
  cameraFov = defaultCameraConfig.fov,
  performanceTier,
  eventSource,
  eventPrefix = 'offset',
}: ThreeCanvasShellProps) {
  const config = getThreePerfConfig(performanceTier);

  return (
    <div 
      className={cn('relative w-full h-full', className)} 
      style={style}
    >
      <Canvas
        dpr={config.dpr}
        frameloop={config.frameloop}
        gl={config.gl}
        shadows={config.shadows}
        flat={config.flat}
        camera={{
          fov: cameraFov,
          near: defaultCameraConfig.near,
          far: defaultCameraConfig.far,
          position: cameraPosition,
        }}
        eventSource={eventSource}
        eventPrefix={eventPrefix}
        style={{ 
          background: 'transparent',
          position: 'absolute',
          inset: 0,
        }}
      >
        <Suspense fallback={null}>
          {/* Adaptive DPR for performance scaling */}
          <AdaptiveDpr pixelated />
          
          {/* Preload all assets */}
          <Preload all />
          
          {/* Scene content */}
          {children}
        </Suspense>
      </Canvas>
      
      {/* External fallback while loading */}
      <Suspense fallback={fallback || <CanvasLoadingFallback />}>
        <div style={{ display: 'none' }} />
      </Suspense>
    </div>
  );
}






















