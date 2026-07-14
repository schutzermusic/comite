"use client";

import { useEffect } from "react";
import type React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useHudToastStore, type ToastItem, type ToastVariant } from "@/hooks/useHudToast";

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-ig-success" />,
  error: <XCircle size={16} className="text-ig-danger" />,
  warning: <AlertTriangle size={16} className="text-ig-warning" />,
  info: <Info size={16} className="text-ig-info" />,
};

const STATE_MAP: Record<ToastVariant, "success" | "critical" | "warning" | "default"> = {
  success: "success",
  error: "critical",
  warning: "warning",
  info: "default",
};

export function HudToaster() {
  const toasts = useHudToastStore((state) => state.toasts);
  const remove = useHudToastStore((state) => state.remove);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItemView key={toast.id} toast={toast} onRemove={remove} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItemView({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: (id: string) => void;
}) {
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.96 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.96 }}
      transition={
        shouldReduceMotion
          ? { duration: 0.16 }
          : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
      }
      className="pointer-events-auto"
    >
      <div className="ig-glass" data-elev="4" data-state={STATE_MAP[toast.variant]}>
        <span data-ig-noise="" />
        <div data-ig-content="" className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 flex-shrink-0">{ICONS[toast.variant]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-ig-body-sm font-medium leading-tight text-ig-fg-strong">
              {toast.title}
            </p>
            {toast.description && (
              <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{toast.description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fechar notificação"
            onClick={() => onRemove(toast.id)}
            className="flex-shrink-0 rounded-[var(--ig-radius-sm)] p-1 text-ig-fg-subtle transition-colors hover:bg-ig-panel-hover hover:text-ig-fg"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
