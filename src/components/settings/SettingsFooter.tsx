"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HudButton } from "@/components/hud/HudButton";

interface SettingsFooterProps {
  dirty?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
}

export function SettingsFooter({
  dirty,
  onSave,
  onDiscard,
}: SettingsFooterProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={shouldReduceMotion ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={shouldReduceMotion ? { y: 0, opacity: 0 } : { y: 20, opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
          className="sticky bottom-0 mt-8 flex items-center justify-end gap-3 border-t border-ig-border bg-ig-base/90 py-4 backdrop-blur-sm"
        >
          <HudButton variant="ghost" onClick={onDiscard}>
            Descartar
          </HudButton>
          <HudButton variant="primary" onClick={onSave}>
            Salvar alterações
          </HudButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
