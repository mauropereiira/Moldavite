/**
 * Process-local toast queue with generated ids and optional expiry timers.
 * Removal is idempotent, timers may only remove their own toast, and no notification
 * state is persisted across reloads or Forge switches.
 */

import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  /** A toast with actions stays until the user acts on it or dismisses it. */
  actions?: ToastAction[];
}

interface ToastState {
  toasts: Toast[];
  addToast: (
    type: ToastType,
    message: string,
    duration?: number,
    actions?: ToastAction[]
  ) => string;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
}

const generateId = () => `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, message, duration, actions) => {
    const id = generateId();
    const defaultDuration = type === 'success' ? 3000 : type === 'warning' ? 5000 : 4000;

    const toast: Toast = {
      id,
      type,
      message,
      duration: duration ?? defaultDuration,
      ...(actions?.length ? { actions } : {}),
    };

    set((state) => ({
      toasts: [toast, ...state.toasts].slice(0, 5), // Keep max 5 toasts
    }));

    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },

  clearAllToasts: () => {
    set({ toasts: [] });
  },
}));
