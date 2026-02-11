'use client';

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, TorusGeometry, Points, BufferGeometry, Float32BufferAttribute } from 'three';
import { orionThreeColors } from '@/lib/three/perf';

interface RiskOrbitalRadarProps {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  size?: number;
}

/**
 * Risk Orbital Radar
 * Compact 3D hero widget for Critical Risks card
 * 2-3 subtle orbital rings with risk nodes
 */
export function RiskOrbitalRadar({
  critical = 2,
  high = 5,
  medium = 7,
  low = 4,
  size = 1,
}: RiskOrbitalRadarProps) {
  const ring1Ref = useRef<Mesh>(null);
  const ring2Ref = useRef<Mesh>(null);
  const ring3Ref = useRef<Mesh>(null);
  const nodesRef = useRef<Points>(null);

  // Create risk nodes positions
  const totalRisks = critical + high + medium + low;
  const nodeCount = Math.min(totalRisks, 12); // Max 12 nodes for performance
  
  const nodePositions = React.useMemo(() => {
    const positions = new Float32Array(nodeCount * 3);
    const radius = 1.2;
    
    for (let i = 0; i < nodeCount; i++) {
      const angle = (i / nodeCount) * Math.PI * 2;
      const height = (Math.sin(i * 0.5) - 0.5) * 0.4; // Deterministic height
      
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    
    return positions;
  }, [nodeCount]);

  // Animate rings
  useFrame((state) => {
    if (ring1Ref.current) {
      ring1Ref.current.rotation.x += 0.002;
      ring1Ref.current.rotation.z += 0.001;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.x -= 0.0015;
      ring2Ref.current.rotation.z += 0.002;
    }
    if (ring3Ref.current) {
      ring3Ref.current.rotation.y += 0.001;
    }
    if (nodesRef.current) {
      nodesRef.current.rotation.y += 0.0005;
    }
  });

  return (
    <group scale={size}>
      {/* Ambient light */}
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 0, 0]} intensity={0.4} color={orionThreeColors.primary} />

      {/* Outer ring - Critical risks (red accent) */}
      <mesh ref={ring1Ref} position={[0, 0, 0]}>
        <torusGeometry args={[1.3, 0.015, 8, 32]} />
        <meshStandardMaterial
          color={orionThreeColors.error}
          emissive={orionThreeColors.error}
          emissiveIntensity={critical > 0 ? 0.8 : 0.2}
          transparent
          opacity={0.6}
        />
      </mesh>

      {/* Middle ring - High/Medium risks (cyan/green) */}
      <mesh ref={ring2Ref} position={[0, 0, 0]}>
        <torusGeometry args={[1.1, 0.012, 8, 32]} />
        <meshStandardMaterial
          color={orionThreeColors.primary}
          emissive={orionThreeColors.primary}
          emissiveIntensity={0.6}
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Inner ring - All risks (subtle green) */}
      <mesh ref={ring3Ref} position={[0, 0, 0]}>
        <torusGeometry args={[0.9, 0.01, 8, 32]} />
        <meshStandardMaterial
          color={orionThreeColors.success}
          emissive={orionThreeColors.success}
          emissiveIntensity={0.4}
          transparent
          opacity={0.4}
        />
      </mesh>

      {/* Risk nodes */}
      {nodeCount > 0 && (
        <points ref={nodesRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={nodeCount}
              array={nodePositions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial
            size={0.08}
            color={orionThreeColors.primary}
            transparent
            opacity={0.8}
            sizeAttenuation={true}
          />
        </points>
      )}

      {/* Central core */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial
          color={orionThreeColors.primary}
          emissive={orionThreeColors.primary}
          emissiveIntensity={1.5}
        />
      </mesh>
    </group>
  );
}

export default RiskOrbitalRadar;

