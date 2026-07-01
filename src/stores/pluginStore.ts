import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { namespacedKey } from '@/lib/forgeStorage';

interface Grant {
  enabled: boolean;
  grantedVersion: string;
}

interface PluginState {
  grants: Record<string, Grant>;
  /** Enabled AND the granted version still matches the installed version. */
  isEnabledAndGranted: (id: string, version: string) => boolean;
  /** Needs a (re)grant: never granted, disabled, or version changed. */
  needsGrant: (id: string, version: string) => boolean;
  grant: (id: string, version: string) => void;
  disable: (id: string) => void;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      grants: {},
      isEnabledAndGranted: (id, version) => {
        const g = get().grants[id];
        return !!g && g.enabled && g.grantedVersion === version;
      },
      needsGrant: (id, version) => {
        const g = get().grants[id];
        return !g || !g.enabled || g.grantedVersion !== version;
      },
      grant: (id, version) =>
        set((s) => ({
          grants: { ...s.grants, [id]: { enabled: true, grantedVersion: version } },
        })),
      disable: (id) =>
        set((s) => ({
          grants: {
            ...s.grants,
            [id]: { enabled: false, grantedVersion: s.grants[id]?.grantedVersion ?? '' },
          },
        })),
    }),
    {
      name: namespacedKey('moldavite-plugins'),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ grants: s.grants }),
    }
  )
);
