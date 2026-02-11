"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface HUDCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  glowColor?: "green" | "cyan" | "amber" | "red";
  variant?: "default" | "elevated";
}

export function HUDCard({
  className,
  children,
  glow = false,
  glowColor = "green",
  variant = "default",
  ...props
}: HUDCardProps) {
  const glowColors = {
    green: "rgba(0,255,180,0.18)",
    cyan: "rgba(0,200,255,0.18)",
    amber: "rgba(255,176,77,0.18)",
    red: "rgba(255,88,96,0.18)",
  };

  const glowShadow = glow
    ? `0 0 18px ${glowColors[glowColor]}`
    : "none";

  return (
    <div
      className={cn(
        "relative rounded-2xl p-5 md:p-6 transition-all duration-300",
        variant === "default"
          ? "bg-gradient-to-br from-[#07130F] to-[#030B09]"
          : "bg-gradient-to-br from-[#0A1612] to-[#07130F]",
        "border border-[rgba(255,255,255,0.05)]",
        glow && "border-[rgba(255,255,255,0.08)]",
        className
      )}
      style={{
        boxShadow: glow
          ? `${glowShadow}, inset 0 0 0 1px rgba(255,255,255,0.04)`
          : "inset 0 0 0 1px rgba(255,255,255,0.04)",
      }}
      {...props}
    >
      {/* Subtle HUD grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06] rounded-2xl"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "32px 32px, 32px 32px",
          maskImage:
            "radial-gradient(circle at 50% 50%, black 40%, transparent 70%)",
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
