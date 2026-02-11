"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusPillVariants = cva(
  "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-wide rounded-full font-medium transition-all",
  {
    variants: {
      variant: {
        active: "text-[#00FFB4] bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)]",
        at_risk: "text-[#FFB04D] bg-[rgba(255,176,77,0.12)] border border-[rgba(255,176,77,0.25)]",
        critical: "text-[#FF5860] bg-[rgba(255,88,96,0.12)] border border-[rgba(255,88,96,0.25)]",
        completed: "text-[#00C8FF] bg-[rgba(0,200,255,0.12)] border border-[rgba(0,200,255,0.25)]",
        success: "text-[#00FFB4] bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)]",
        warning: "text-[#FFB04D] bg-[rgba(255,176,77,0.12)] border border-[rgba(255,176,77,0.25)]",
        error: "text-[#FF5860] bg-[rgba(255,88,96,0.12)] border border-[rgba(255,88,96,0.25)]",
        info: "text-[#00C8FF] bg-[rgba(0,200,255,0.12)] border border-[rgba(0,200,255,0.25)]",
        neutral: "text-[rgba(255,255,255,0.65)] bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

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
  // Map common status strings to variants
  const getVariant = (): "active" | "at_risk" | "critical" | "completed" | "success" | "warning" | "error" | "info" | "neutral" => {
    if (variant) return variant;
    
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
    <span
      className={cn(statusPillVariants({ variant: getVariant() }), className)}
      {...props}
    >
      {label || children}
    </span>
  );
}
