"use client";

import React from "react";
import { HudSignal } from "@/components/hud/HudSignal";
import type { HudSignalTone } from "@/components/hud/HudSignal";

/**
 * Pill legada. Hoje delega ao Signal Chip para que exista uma única linguagem
 * de status no produto — a inferência de variante a partir do texto, que várias
 * telas dependem, foi preservada.
 *
 * As cores neon fixas (#00FFB4 / #FF5860 / …) foram removidas: elas ignoravam
 * os tokens --ig-* e quebravam no tema claro.
 */
const VARIANT_TONE: Record<string, HudSignalTone> = {
  active: "success",
  at_risk: "warning",
  critical: "critical",
  completed: "accent",
  success: "success",
  warning: "warning",
  error: "danger",
  info: "info",
  neutral: "neutral",
};

export interface StatusPillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'variant'> {
  variant?: "active" | "at_risk" | "critical" | "completed" | "success" | "warning" | "error" | "info" | "neutral" | string;
  label?: string;
  children?: React.ReactNode;
}

export function StatusPill({ 
  className, 
  variant, 
  children,
  label,
  ...props 
}: StatusPillProps) {
  type PillVariant = "active" | "at_risk" | "critical" | "completed" | "success" | "warning" | "error" | "info" | "neutral";
  const ALLOWED_VARIANTS: PillVariant[] = ["active", "at_risk", "critical", "completed", "success", "warning", "error", "info", "neutral"];

  // Map common status strings to variants
  const getVariant = (): PillVariant => {
    if (variant && (ALLOWED_VARIANTS as string[]).includes(variant)) {
      return variant as PillVariant;
    }
    
    // Extract text from children if it's a string, otherwise use label
    let textToCheck = label;
    
    if (!textToCheck && children) {
      if (typeof children === 'string') {
        textToCheck = children;
      } else if (React.isValidElement(children) && typeof children.props.children === 'string') {
        textToCheck = children.props.children;
      } else if (React.Children.count(children) > 0) {
        const textContent = React.Children.toArray(children)
          .map(child => {
            if (typeof child === 'string') return child;
            if (React.isValidElement(child) && child.props.children) {
              if (typeof child.props.children === 'string') return child.props.children;
            }
            return '';
          })
          .filter(Boolean)
          .join(' ');
        textToCheck = textContent;
      }
    }
    
    const text = String(textToCheck || "").toLowerCase();
    
    if (text.includes("ativo") || text.includes("active") || text === "em_andamento") return "active";
    if (text.includes("risco") || text.includes("risk") || text === "at_risk") return "at_risk";
    if (text.includes("crítico") || text.includes("critical") || text === "critico") return "critical";
    if (text.includes("concluído") || text.includes("completed") || text === "concluido") return "completed";
    if (text.includes("sucesso") || text.includes("success")) return "success";
    if (text.includes("aviso") || text.includes("warning")) return "warning";
    if (text.includes("erro") || text.includes("error")) return "error";
    if (text.includes("info") || text.includes("informação")) return "info";
    
    return "neutral";
  };

  return (
    <HudSignal
      label={label || children}
      tone={VARIANT_TONE[getVariant()]}
      size="sm"
      title={props.title}
      className={className}
    />
  );
}
