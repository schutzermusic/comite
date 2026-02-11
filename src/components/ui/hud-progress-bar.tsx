"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const progressBarVariants = cva(
  "h-1.5 w-full rounded-full transition-all duration-500 overflow-hidden",
  {
    variants: {
      variant: {
        active: "bg-gradient-to-r from-[#00FFB4] to-[#00C8FF] shadow-[0_0_10px_rgba(0,255,180,0.7)]",
        medium: "bg-gradient-to-r from-[#FFB04D] to-[#FF8C42] shadow-[0_0_10px_rgba(255,176,77,0.7)]",
        critical: "bg-gradient-to-r from-[#FF5860] to-[#FF4040] shadow-[0_0_10px_rgba(255,88,96,0.7)]",
        completed: "bg-gradient-to-r from-[#00C8FF] to-[#0099CC] shadow-[0_0_10px_rgba(0,200,255,0.7)]",
      },
    },
    defaultVariants: {
      variant: "active",
    },
  }
);

export interface HUDProgressBarProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof progressBarVariants> {
  value: number;
  max?: number;
  showLabel?: boolean;
  labelPosition?: "left" | "right";
}

export function HUDProgressBar({
  className,
  variant,
  value,
  max = 100,
  showLabel = true,
  labelPosition = "right",
  ...props
}: HUDProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  
  // Auto-detect variant based on value
  const getVariant = (): VariantProps<typeof progressBarVariants>["variant"] => {
    if (variant) return variant;
    if (percentage >= 80) return "completed";
    if (percentage >= 50) return "active";
    if (percentage >= 25) return "medium";
    return "critical";
  };

  return (
    <div className={cn("w-full", className)} {...props}>
      {showLabel && (
        <div className={cn(
          "flex justify-between items-center mb-2 text-xs",
          labelPosition === "left" && "flex-row-reverse"
        )}>
          <span className="text-[rgba(255,255,255,0.60)]">Progresso</span>
          <span className="font-semibold text-[rgba(255,255,255,0.92)]">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className="h-1.5 w-full rounded-full bg-[rgba(255,255,255,0.10)] overflow-hidden">
        <div
          className={cn(progressBarVariants({ variant: getVariant() }))}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
