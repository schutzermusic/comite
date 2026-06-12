"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { HudPanel, type HudPanelProps } from "./HudPanel";

type HudCardProps = React.HTMLAttributes<HTMLDivElement> &
  Pick<HudPanelProps, "elevation" | "state" | "interactive" | "halo" | "sweep" | "fullHeight">;

const HudCard = React.forwardRef<HTMLDivElement, HudCardProps>(
  ({ className, children, elevation, state, interactive, halo, sweep, fullHeight, ...props }, ref) => (
    // className is applied on the HudPanel wrapper (the glass shell). The inner
    // div used to also receive `className` which caused layout classes like
    // `h-full flex flex-col` to be duplicated and break flex stretching inside
    // cards. We keep the inner div neutral so consumers can rely on the wrapper
    // class controlling layout.
    <HudPanel
      noPadding
      fullHeight={fullHeight}
      className={cn('min-w-0', className)}
      elevation={elevation}
      state={state}
      interactive={interactive}
      halo={halo}
      sweep={sweep}
    >
      <div ref={ref} className={cn('min-w-0', fullHeight && 'flex h-full flex-col')} {...props}>
        {children}
      </div>
    </HudPanel>
  ),
);
HudCard.displayName = "HudCard";

const HudCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1.5 border-b border-ig-border-subtle px-5 py-4", className)}
      {...props}
    />
  ),
);
HudCardHeader.displayName = "HudCardHeader";

const HudCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-ig-h3 text-ig-fg-strong", className)} {...props} />
  ),
);
HudCardTitle.displayName = "HudCardTitle";

const HudCardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-ig-body-sm text-ig-fg-muted", className)} {...props} />
));
HudCardDescription.displayName = "HudCardDescription";

const HudCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-5 py-4", className)} {...props} />
  ),
);
HudCardContent.displayName = "HudCardContent";

const HudCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center border-t border-ig-border-subtle px-5 py-4", className)}
      {...props}
    />
  ),
);
HudCardFooter.displayName = "HudCardFooter";

export {
  HudCard,
  HudCardHeader,
  HudCardFooter,
  HudCardTitle,
  HudCardDescription,
  HudCardContent,
};
