"use client";

/**
 * Abas das gavetas de detalhe. Leves de propósito: um botão por aba, o
 * contador só quando diz alguma coisa, e o alerta em vermelho só quando há
 * bloqueio. Teclado: setas esquerda/direita percorrem as abas.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "./commercial-flow.css";

export interface FlowTab { id: string; label: string; count?: number; alert?: boolean }

export function FlowTabs({
  tabs, active, onChange, label,
}: { tabs: FlowTab[]; active: string; onChange: (id: string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = tabs.findIndex((tab) => tab.id === active);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div className="flow-tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" data-tab={tab.id}
          aria-selected={tab.id === active} tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}>
          {tab.label}
          {tab.count ? <i className={tab.alert ? "flow-tab-alert" : undefined}>{tab.count}</i> : null}
        </button>
      ))}
    </div>
  );
}

export function FlowTabPanel({ children, label }: { children: ReactNode; label: string }) {
  return <div className="flow-tabpanel" role="tabpanel" aria-label={label}>{children}</div>;
}
