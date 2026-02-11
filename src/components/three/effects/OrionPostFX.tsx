'use client';

import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';

interface OrionPostFXProps {
  /** Bloom intensity (0-2, default 0.4) */
  bloomIntensity?: number;
  /** Bloom luminance threshold (0-1, default 0.6) */
  bloomThreshold?: number;
  /** Bloom smoothing (0-1, default 0.9) */
  bloomSmoothing?: number;
  /** Enable vignette effect */
  vignette?: boolean;
  /** Vignette darkness (0-1, default 0.4) */
  vignetteDarkness?: number;
  /** Disable all effects (for performance) */
  disabled?: boolean;
}

/**
 * Orion-style post-processing effects
 * Subtle bloom with optional vignette for cinematic look
 */
export function OrionPostFX({
  bloomIntensity = 0.4,
  bloomThreshold = 0.6,
  bloomSmoothing = 0.9,
  vignette = false,
  vignetteDarkness = 0.4,
  disabled = false,
}: OrionPostFXProps) {
  if (disabled) return null;

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={bloomThreshold}
        luminanceSmoothing={bloomSmoothing}
        kernelSize={KernelSize.MEDIUM}
        blendFunction={BlendFunction.ADD}
        mipmapBlur
      />
      {vignette && (
        <Vignette
          darkness={vignetteDarkness}
          offset={0.3}
          blendFunction={BlendFunction.NORMAL}
        />
      )}
    </EffectComposer>
  );
}

/**
 * Minimal bloom preset for subtle glow
 */
export function MinimalBloom() {
  return (
    <OrionPostFX
      bloomIntensity={0.3}
      bloomThreshold={0.7}
      bloomSmoothing={0.95}
    />
  );
}

/**
 * Hero bloom preset for prominent elements
 */
export function HeroBloom() {
  return (
    <OrionPostFX
      bloomIntensity={0.5}
      bloomThreshold={0.5}
      bloomSmoothing={0.8}
      vignette
      vignetteDarkness={0.3}
    />
  );
}






















