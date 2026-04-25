"use client";

import { User } from "lucide-react";

export function UserMenu() {
  return (
    <button
      type="button"
      aria-label="Abrir menu do usuário"
      className="flex h-8 w-8 items-center justify-center rounded-full bg-ig-accent-weak text-ig-body-sm font-semibold text-ig-accent transition-colors hover:bg-ig-accent hover:text-ig-base"
    >
      <User size={14} aria-hidden="true" />
    </button>
  );
}
