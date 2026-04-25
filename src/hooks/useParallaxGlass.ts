"use client";

import { useCallback, useRef } from "react";
import type React from "react";

interface ParallaxResult {
  containerRef: React.RefObject<HTMLDivElement>;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

export function useParallaxGlass(strength = 0.6): ParallaxResult {
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = ((e.clientX - cx) / (rect.width / 2)) * strength;
      const dy = ((e.clientY - cy) / (rect.height / 2)) * strength;
      const sx = ((e.clientX - rect.left) / rect.width) * 100;
      const sy = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--ig-parallax-x", `${dx}px`);
      el.style.setProperty("--ig-parallax-y", `${dy}px`);
      el.style.setProperty("--ig-spot-x", `${sx}%`);
      el.style.setProperty("--ig-spot-y", `${sy}%`);
    },
    [strength],
  );

  const onMouseLeave = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty("--ig-parallax-x", "0px");
    el.style.setProperty("--ig-parallax-y", "0px");
  }, []);

  return { containerRef, onMouseMove, onMouseLeave };
}
