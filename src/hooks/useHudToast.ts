"use client";

import type React from "react";
import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info";
type LegacyToastVariant = ToastVariant | "default" | "destructive";

export interface ToastItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  variant: ToastVariant;
  duration: number;
}

interface LegacyToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: LegacyToastVariant;
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, "id">) => string;
  remove: (id: string) => void;
}

const createToastId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const normalizeVariant = (variant?: LegacyToastVariant): ToastVariant => {
  if (variant === "destructive") return "error";
  if (variant === "default" || variant === undefined) return "info";
  return variant;
};

export const useHudToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = createToastId();

    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));

    return id;
  },
  remove: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));

export function useHudToast() {
  const add = useHudToastStore((state) => state.add);
  const remove = useHudToastStore((state) => state.remove);

  const notify = (
    title: React.ReactNode,
    options?: { description?: React.ReactNode; variant?: ToastVariant; duration?: number },
  ) =>
    add({
      title,
      description: options?.description,
      variant: options?.variant ?? "info",
      duration: options?.duration ?? 4000,
    });

  const toast = ({ title, description, variant, duration }: LegacyToastOptions) => {
    const id = add({
      title,
      description,
      variant: normalizeVariant(variant),
      duration: duration ?? (variant === "destructive" ? 6000 : 4000),
    });

    return {
      id,
      dismiss: () => remove(id),
      update: (nextToast: LegacyToastOptions) => {
        remove(id);
        add({
          title: nextToast.title,
          description: nextToast.description,
          variant: normalizeVariant(nextToast.variant),
          duration: nextToast.duration ?? duration ?? 4000,
        });
      },
    };
  };

  return {
    notify,
    toast,
    dismiss: remove,
    success: (title: React.ReactNode, description?: React.ReactNode) =>
      add({ title, description, variant: "success", duration: 4000 }),
    error: (title: React.ReactNode, description?: React.ReactNode) =>
      add({ title, description, variant: "error", duration: 6000 }),
    warning: (title: React.ReactNode, description?: React.ReactNode) =>
      add({ title, description, variant: "warning", duration: 5000 }),
  };
}
