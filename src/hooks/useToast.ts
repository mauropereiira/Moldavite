/**
 * Stable convenience callbacks over the toast store.
 * The hook owns no queue state; duration, identity, removal, and cleanup remain
 * centralized in `stores/toastStore.ts`.
 */

import { useCallback } from 'react';
import { useToastStore } from '../stores/toastStore';

export const useToast = () => {
  const { addToast, removeToast, clearAllToasts } = useToastStore();

  const success = useCallback(
    (message: string, duration?: number) => {
      return addToast('success', message, duration);
    },
    [addToast]
  );

  const error = useCallback(
    (message: string, duration?: number) => {
      return addToast('error', message, duration);
    },
    [addToast]
  );

  return {
    success,
    error,
    dismiss: removeToast,
    clearAll: clearAllToasts,
  };
};
