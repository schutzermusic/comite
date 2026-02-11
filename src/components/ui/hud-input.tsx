"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const hudInputBase =
  "w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-[14px] text-[rgba(255,255,255,0.92)] placeholder:text-[rgba(255,255,255,0.45)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all focus:border-[rgba(0,200,255,0.45)] focus:ring-2 focus:ring-[rgba(0,200,255,0.25)] focus:outline-none";

export interface HudInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const HudInput = React.forwardRef<HTMLInputElement, HudInputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(hudInputBase, className)}
        {...props}
      />
    );
  }
);

HudInput.displayName = "HudInput";

