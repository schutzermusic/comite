"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface SecondaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-full text-[13px] md:text-[14px] font-medium transition-all duration-200 border border-[rgba(255,255,255,0.18)] text-[rgba(255,255,255,0.80)] bg-transparent hover:text-white hover:border-[rgba(0,200,255,0.45)] hover:shadow-[0_0_14px_rgba(0,200,255,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,200,255,0.35)] focus-visible:ring-offset-0";

export const SecondaryButton = React.forwardRef<
  HTMLButtonElement,
  SecondaryButtonProps
>(({ className, asChild = false, children, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      className={cn(baseClasses, "h-10 px-4", className)}
      {...props}
    >
      {children}
    </Comp>
  );
});

SecondaryButton.displayName = "SecondaryButton";

