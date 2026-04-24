"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export type HudElevation = 1 | 2 | 3 | 4 | 5;
export type HudMaterialState = "default" | "success" | "warning" | "critical";

export interface HudPanelProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  deepLink?: { href: string; label: string };
  badge?: number;
  headerActions?: React.ReactNode;
  delay?: number;
  noPadding?: boolean;

  /** @deprecated Accepted for backward compatibility. */
  accentColor?: string;
  /** @deprecated Use interactive instead. */
  hoverGlow?: boolean;
  /** @deprecated Accepted for backward compatibility. */
  breathe?: boolean;

  elevation?: HudElevation;
  state?: HudMaterialState;
  interactive?: boolean;
  sweep?: boolean;
  halo?: boolean;
  watermark?: string;
  serial?: string;
  iconTint?: string;
  metallic?: boolean;
  parallax?: boolean;
}

export function HudPanel({
  children,
  className,
  elevation = 2,
  state = "default",
  interactive = true,
  sweep = false,
  halo = false,
  title,
  subtitle,
  icon,
  iconTint,
  deepLink,
  badge,
  headerActions,
  noPadding = false,
  watermark,
  serial,
  delay = 0,
  metallic = false,
}: HudPanelProps) {
  const hasHeader = Boolean(title || icon);
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }
      }
      className={cn(halo && "ig-glass-halo", className)}
    >
      <div
        className="ig-glass"
        data-elev={elevation}
        data-state={state !== "default" ? state : undefined}
        data-interactive={interactive || undefined}
        data-sweep={sweep || undefined}
      >
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        {sweep && <span data-ig-sweep="" />}

        <div data-ig-content="">
          {hasHeader && (
            <header className="flex items-start justify-between px-5 pt-4 pb-3">
              <div className="flex min-w-0 items-center gap-3">
                {icon && (
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] [box-shadow:inset_0_0_0_1px_var(--ig-border-subtle),inset_0_1px_0_var(--ig-border-strong)]"
                    style={
                      iconTint
                        ? {
                            backgroundColor: `color-mix(in oklab, ${iconTint} 14%, transparent)`,
                            color: iconTint,
                          }
                        : {
                            backgroundColor: "var(--ig-accent-weak)",
                            color: "var(--ig-accent)",
                          }
                    }
                  >
                    {icon}
                  </span>
                )}

                <div className="min-w-0">
                  {title && (
                    <h3
                      className={cn(
                        "truncate text-ig-h3",
                        metallic ? "ig-text-metal" : "text-ig-fg-strong",
                      )}
                    >
                      {title}
                      {badge !== undefined && badge > 0 && (
                        <span className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ig-accent px-1.5 text-[10px] font-semibold text-[var(--ig-bg-canvas)]">
                          {badge}
                        </span>
                      )}
                    </h3>
                  )}

                  {subtitle && (
                    <p className="mt-0.5 truncate text-ig-caption text-ig-fg-muted">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                {headerActions}
                {deepLink && (
                  <a
                    href={deepLink.href}
                    className="text-ig-label text-ig-fg-muted transition-colors hover:text-ig-accent"
                  >
                    {deepLink.label} →
                  </a>
                )}
              </div>
            </header>
          )}

          {hasHeader && (
            <div className="mx-5 h-px bg-gradient-to-r from-transparent via-ig-border to-transparent" />
          )}

          <div className={cn(!noPadding && "px-5 py-4", hasHeader && !noPadding && "pt-4")}>
            {children}
          </div>

          {(watermark || serial) && (
            <footer className="flex items-center justify-between border-t border-ig-border-subtle px-5 pb-2 pt-3">
              {serial && (
                <span className="font-mono text-[10px] tracking-[0.2em] text-ig-fg-subtle">
                  {serial}
                </span>
              )}
              {watermark && (
                <span className="ml-auto text-[9px] uppercase tracking-[0.32em] text-ig-fg-subtle">
                  {watermark}
                </span>
              )}
            </footer>
          )}
        </div>
      </div>
    </motion.div>
  );
}
