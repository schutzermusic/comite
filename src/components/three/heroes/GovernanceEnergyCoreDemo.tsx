'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { ThreeCanvasShell } from '../ThreeCanvasShell';
import { OrionPostFX } from '../effects/OrionPostFX';

// Futuristic color palette - cyan/teal/turquoise
const COLORS = {
  primary: '#00E5C8',    // Bright teal
  secondary: '#00B4D8',  // Cyan blue
  accent: '#00FFE5',     // Bright turquoise
  glow: '#00D4AA',       // Glow color
};

/**
 * Particle Cloud Orb - Main spherical particle system
 * Creates a sphere of particles that slowly rotates and pulses
 */
function ParticleCloudOrb({
  count = 800,
  radius = 1.15,
  value = 78,
}: {
  count?: number;
  radius?: number;
  value?: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);

  // Generate particles in a sphere using Fibonacci distribution
  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);

    const color1 = new THREE.Color(COLORS.primary);
    const color2 = new THREE.Color(COLORS.secondary);
    const color3 = new THREE.Color(COLORS.accent);

    for (let i = 0; i < count; i++) {
      // Fibonacci sphere distribution for even spread
      const phi = Math.acos(1 - 2 * (i + 0.5) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      // Vary radius slightly for organic feel
      const r = radius * (0.85 + Math.random() * 0.3);

      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      // Random color between the palette colors
      const colorChoice = Math.random();
      let color;
      if (colorChoice < 0.5) color = color1;
      else if (colorChoice < 0.8) color = color2;
      else color = color3;

      cols[i * 3] = color.r;
      cols[i * 3 + 1] = color.g;
      cols[i * 3 + 2] = color.b;
    }
    return { positions: pos, colors: cols };
  }, [count, radius]);

  useFrame((state) => {
    if (pointsRef.current) {
      // Slow rotation
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.05;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.03) * 0.1;

      // Subtle scale pulsation
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.02;
      pointsRef.current.scale.setScalar(pulse);
    }
    if (materialRef.current) {
      // Subtle opacity pulsation
      materialRef.current.opacity = 0.6 + Math.sin(state.clock.elapsedTime * 1.2) * 0.15;
    }
  });

  return (
    <Points ref={pointsRef} positions={positions} colors={colors} stride={3} frustumCulled={false}>
      <PointMaterial
        ref={materialRef}
        transparent
        vertexColors
        size={0.025}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={0.7}
      />
    </Points>
  );
}

/**
 * Energy arc/ribbon orbiting the sphere
 * Creates flowing curved paths around the orb
 */
function EnergyArc({
  radius = 1.3,
  color = COLORS.primary,
  rotationSpeed = 0.2,
  arcLength = 0.7,
  tiltX = 0,
  tiltY = 0,
  tiltZ = 0,
  opacity = 0.8,
}: {
  radius?: number;
  color?: string;
  rotationSpeed?: number;
  arcLength?: number;
  tiltX?: number;
  tiltY?: number;
  tiltZ?: number;
  opacity?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.z += delta * rotationSpeed;
    }
  });

  // Arc geometry (partial torus)
  const arcAngle = Math.PI * 2 * arcLength;

  return (
    <mesh ref={meshRef} rotation={[tiltX, tiltY, tiltZ]}>
      <torusGeometry args={[radius, 0.008, 8, 64, arcAngle]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={2}
        toneMapped={false}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Orbital Ring - Full thin ring with glow
 */
function OrbitalRing({
  radius = 1.35,
  color = COLORS.secondary,
  rotationSpeed = 0.1,
  tiltX = Math.PI / 2,
  tiltY = 0,
  opacity = 0.5,
  thickness = 0.006,
}: {
  radius?: number;
  color?: string;
  rotationSpeed?: number;
  tiltX?: number;
  tiltY?: number;
  opacity?: number;
  thickness?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.z += delta * rotationSpeed;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[tiltX, tiltY, 0]}>
      <torusGeometry args={[radius, thickness, 16, 100]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.5}
        toneMapped={false}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Core Glow - Central pulsing sphere
 */
function CoreGlow({ color = COLORS.glow }: { color?: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    if (meshRef.current && materialRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.15;
      meshRef.current.scale.setScalar(pulse * 0.2);
      materialRef.current.opacity = 0.25 + Math.sin(state.clock.elapsedTime * 1.5) * 0.1;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial
        ref={materialRef}
        color={color}
        emissive={color}
        emissiveIntensity={3}
        transparent
        opacity={0.3}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Progress Arc Indicator - Shows the health percentage as an arc
 */
function ProgressArc({
  value = 78,
  radius = 1.5,
  color = COLORS.accent,
}: {
  value?: number;
  radius?: number;
  color?: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Convert percentage to arc angle (0-100 -> 0-2π)
  const arcAngle = (value / 100) * Math.PI * 2;

  useFrame((state) => {
    if (meshRef.current) {
      // Very subtle rotation
      meshRef.current.rotation.z = -Math.PI / 2 + Math.sin(state.clock.elapsedTime * 0.3) * 0.02;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[0, 0, -Math.PI / 2]}>
      <torusGeometry args={[radius, 0.015, 8, 64, arcAngle]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={2.5}
        toneMapped={false}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

/**
 * Futuristic Energy Scene - Complete 3D scene
 */
function FuturisticEnergyScene({ value = 78 }: { value?: number }) {
  return (
    <>
      {/* Ambient and point lights */}
      <ambientLight intensity={0.08} />
      <pointLight position={[0, 0, 4]} intensity={0.5} color={COLORS.primary} />
      <pointLight position={[2, 2, 2]} intensity={0.2} color={COLORS.secondary} />

      {/* Main particle cloud orb - NO central sphere glow, just particles */}
      <ParticleCloudOrb count={600} radius={1.0} value={value} />

      {/* Energy arcs - flowing curves */}
      <EnergyArc
        radius={1.25}
        color={COLORS.primary}
        rotationSpeed={0.15}
        arcLength={0.6}
        tiltX={Math.PI / 2.2}
        opacity={0.85}
      />
      <EnergyArc
        radius={1.35}
        color={COLORS.secondary}
        rotationSpeed={-0.12}
        arcLength={0.5}
        tiltX={Math.PI / 3}
        tiltY={0.4}
        opacity={0.7}
      />
      <EnergyArc
        radius={1.2}
        color={COLORS.accent}
        rotationSpeed={0.18}
        arcLength={0.45}
        tiltX={Math.PI / 1.8}
        tiltY={-0.3}
        opacity={0.6}
      />

      {/* Orbital rings */}
      <OrbitalRing
        radius={1.45}
        color={COLORS.primary}
        rotationSpeed={0.08}
        tiltX={Math.PI / 2}
        opacity={0.4}
      />
      <OrbitalRing
        radius={1.55}
        color={COLORS.secondary}
        rotationSpeed={-0.06}
        tiltX={Math.PI / 2.5}
        tiltY={0.2}
        opacity={0.3}
        thickness={0.004}
      />

      {/* Progress arc based on health value */}
      <ProgressArc value={value} radius={1.65} />

      {/* Enhanced post-processing */}
      <OrionPostFX
        bloomIntensity={0.6}
        bloomThreshold={0.3}
        bloomSmoothing={0.95}
      />
    </>
  );
}

interface GovernanceEnergyCoreProps {
  className?: string;
  value?: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Futuristic Governance Energy Core - Main exported component
 * Displays a 3D particle orb visualization with percentage overlay
 */
export function GovernanceEnergyCoreDemo({
  className,
  value = 78,
  label = 'Saúde',
  size = 'md',
}: GovernanceEnergyCoreProps) {
  const sizeConfig = {
    sm: { width: 180, height: 180, fontSize: '32px', labelSize: '9px' },
    md: { width: 240, height: 240, fontSize: '44px', labelSize: '10px' },
    lg: { width: 300, height: 300, fontSize: '56px', labelSize: '11px' },
  };

  const config = sizeConfig[size];

  return (
    <div
      className={className}
      style={{
        width: config.width,
        height: config.height,
        position: 'relative'
      }}
    >
      {/* 3D Canvas with smooth radial fade mask */}
      <div
        style={{
          position: 'absolute',
          inset: '-20%',
          borderRadius: '50%',
          overflow: 'hidden',
          mask: 'radial-gradient(circle at center, black 35%, transparent 55%)',
          WebkitMask: 'radial-gradient(circle at center, black 35%, transparent 55%)',
        }}
      >
        <ThreeCanvasShell
          cameraPosition={[0, 0, 5]}
          cameraFov={35}
        >
          <FuturisticEnergyScene value={value} />
        </ThreeCanvasShell>
      </div>

      {/* Value overlay - Clean typography without clutter */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
        style={{ zIndex: 20 }}
      >
        <span
          className="relative font-light tracking-tight"
          style={{
            fontSize: config.fontSize,
            color: '#fff',
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.6)',
          }}
        >
          {value}%
        </span>
        <span
          className="relative font-medium uppercase mt-1"
          style={{
            fontSize: config.labelSize,
            color: 'rgba(255, 255, 255, 0.6)',
            letterSpacing: '0.25em',
            textShadow: '0 0 10px rgba(0, 0, 0, 0.8)',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export default GovernanceEnergyCoreDemo;
