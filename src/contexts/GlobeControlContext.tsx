'use client';

import React, { createContext, useContext, useRef, useCallback, ReactNode } from 'react';

interface GlobeControlContextType {
  flyToBrazil: () => void;
  setGlobeRef: (ref: any) => void;
}

const GlobeControlContext = createContext<GlobeControlContextType | undefined>(undefined);

export function GlobeControlProvider({ children }: { children: ReactNode }) {
  const globeRef = useRef<any>(null);

  const setGlobeRef = useCallback((ref: any) => {
    globeRef.current = ref;
  }, []);

  const flyToBrazil = useCallback(() => {
    if (globeRef.current) {
      const globe = globeRef.current;
      // Fly to Brazil with close zoom (altitude 0.5 = zoom in)
      // Use adjusted longitude to match the visual alignment
      globe.pointOfView(
        { lat: -14.235, lng: -51.9253 + 8, altitude: 0.5 },
        1500 // 1.5s animation
      );
    }
  }, []);

  return (
    <GlobeControlContext.Provider value={{ flyToBrazil, setGlobeRef }}>
      {children}
    </GlobeControlContext.Provider>
  );
}

export function useGlobeControl() {
  const context = useContext(GlobeControlContext);
  if (context === undefined) {
    throw new Error('useGlobeControl must be used within a GlobeControlProvider');
  }
  return context;
}