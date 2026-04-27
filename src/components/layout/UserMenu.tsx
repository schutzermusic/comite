"use client";

import { User } from "lucide-react";

export function UserMenu() {
  return (
    <button
      type="button"
      aria-label="Abrir menu do usuário"
      className="app-header-profile"
    >
      <User size={14} aria-hidden="true" />
    </button>
  );
}
