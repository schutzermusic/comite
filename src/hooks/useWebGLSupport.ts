'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect WebGL support in the browser
 * Returns true if WebGL is available, false otherwise
 */
export function useWebGLSupport(): {
  isSupported: boolean;
  isLoading: boolean;
  error: string | null;
} {
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkWebGL = () => {
      try {
        // Try to create a WebGL context
        const canvas = document.createElement('canvas');
        const gl =
          canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl');

        if (gl) {
          // Check for major performance caveats
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            // Check for software renderers (poor performance)
            if (
              renderer.includes('SwiftShader') ||
              renderer.includes('llvmpipe') ||
              renderer.includes('Software')
            ) {
              setError('Software WebGL renderer detected - 3D disabled for performance');
              setIsSupported(false);
              setIsLoading(false);
              return;
            }
          }

          setIsSupported(true);
          setError(null);
        } else {
          setIsSupported(false);
          setError('WebGL not supported by this browser');
        }
      } catch (e) {
        setIsSupported(false);
        setError('Failed to initialize WebGL');
      }
      setIsLoading(false);
    };

    // Small delay to ensure DOM is ready
    const timer = setTimeout(checkWebGL, 100);
    return () => clearTimeout(timer);
  }, []);

  return { isSupported, isLoading, error };
}

/**
 * Simple synchronous check for WebGL support (for SSR safety)
 */
export function checkWebGLSync(): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}






















