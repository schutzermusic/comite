"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown } from "lucide-react";

export function OrgSwitcher() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("pointerdown", handlePointerDown);
      return () => document.removeEventListener("pointerdown", handlePointerDown);
    }

    return undefined;
  }, [open]);

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="app-header-company"
      >
        <Building2 size={13} className="text-ig-accent" aria-hidden="true" />
        <span>Apex Board</span>
        <ChevronDown
          size={11}
          className="text-ig-fg-disabled transition-transform data-[open=true]:rotate-180"
          data-open={open}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          data-elev="3"
          className="ig-glass absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 overflow-hidden rounded-[var(--ig-radius-lg)] border border-ig-border p-2"
        >
          <span data-ig-noise="" />
          <span data-ig-specular="" />
          <div data-ig-content="" className="p-2 text-ig-body-sm text-ig-fg-muted">
            Apex Board
          </div>
        </div>
      )}
    </div>
  );
}
