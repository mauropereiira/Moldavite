/** Transient hand-off from a validated deep link to the community browser. */

import { create } from 'zustand';

export interface PluginInstallRequest {
  id: string;
  nonce: number;
}

interface PluginInstallRequestState {
  pending: PluginInstallRequest | null;
  request: (id: string) => void;
  clear: (nonce: number) => void;
}

export const usePluginInstallStore = create<PluginInstallRequestState>((set) => ({
  pending: null,
  request: (id) =>
    set((state) => ({
      pending: { id, nonce: (state.pending?.nonce ?? 0) + 1 },
    })),
  clear: (nonce) => set((state) => (state.pending?.nonce === nonce ? { pending: null } : state)),
}));
