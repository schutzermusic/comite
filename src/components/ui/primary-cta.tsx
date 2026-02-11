"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface PrimaryCTAProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold text-[13px] md:text-[14px] leading-none transition-all duration-200 shadow-[0_0_16px_rgba(0,255,180,0.45)] active:shadow-[0_0_12px_rgba(0,255,180,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,200,255,0.45)] focus-visible:ring-offset-0";

export const PrimaryCTA = React.forwardRef<HTMLButtonElement, PrimaryCTAProps>(
  ({ className, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        className={cn(
          baseClasses,
          "h-10 min-h-[36px] px-[18px] bg-gradient-to-r from-[#00FFB4] to-[#00C8FF] text-[rgba(0,0,0,0.9)]",
          "hover:brightness-[1.05] hover:-translate-y-[1px] hover:shadow-[0_0_22px_rgba(0,255,180,0.55)]",
          "active:translate-y-0",
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);

PrimaryCTA.displayName = "PrimaryCTA";

