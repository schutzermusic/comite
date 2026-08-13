import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge base — realinhada ao Signal System (ver `components/hud/HudSignal`):
 * raio 7px em vez de cápsula, superfície de vidro e trilho de tom à esquerda no
 * lugar do preenchimento chapado. A API shadcn é mantida.
 */
const badgeVariants = cva(
  "relative isolate inline-flex items-center overflow-hidden rounded-[7px] border pl-3 pr-2.5 py-[3px] text-[11px] font-semibold leading-none " +
    "border-[color-mix(in_oklab,var(--sig-tone)_26%,var(--ig-border-strong))] " +
    "shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_75%,transparent)] " +
    "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--sig-tone)_45%,transparent)] " +
    "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[color:var(--sig-tone)] " +
    "before:shadow-[0_0_10px_color-mix(in_oklab,var(--sig-tone)_75%,transparent)] before:content-['']",
  {
    variants: {
      variant: {
        default:
          "[--sig-tone:var(--ig-accent)] text-ig-fg-strong bg-[linear-gradient(135deg,color-mix(in_oklab,var(--sig-tone)_9%,var(--ig-bg-raised)),color-mix(in_oklab,var(--ig-bg-raised)_88%,transparent))]",
        secondary:
          "[--sig-tone:var(--ig-fg-subtle)] text-ig-fg-muted bg-[linear-gradient(135deg,color-mix(in_oklab,var(--sig-tone)_9%,var(--ig-bg-raised)),color-mix(in_oklab,var(--ig-bg-raised)_88%,transparent))]",
        destructive:
          "[--sig-tone:var(--ig-danger)] text-ig-fg-strong bg-[linear-gradient(135deg,color-mix(in_oklab,var(--sig-tone)_9%,var(--ig-bg-raised)),color-mix(in_oklab,var(--ig-bg-raised)_88%,transparent))]",
        outline: "[--sig-tone:var(--ig-fg-subtle)] text-ig-fg bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
