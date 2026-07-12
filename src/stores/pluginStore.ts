import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { namespacedKey } from '@/lib/forgeStorage';

export interface PluginGrant {
  enabled: boolean;
  grantedVersion: string;
  /** Content hash of the plugin at grant time — changed code re-prompts. */
  grantedHash?: string;
  /** Hosts approved interactively after install. Kept outside the consent hash. */
  approvedHosts?: string[];
}

/** Consent is valid only for the exact plugin content it was given for. */
function grantMatches(g: PluginGrant | undefined, version: string, hash?: string): boolean {
  if (!g || !g.enabled || g.grantedVersion !== version) return false;
  // No hash from the backend means we can't verify the code — fail closed.
  return !!hash && g.grantedHash === hash;
}

interface PluginState {
  grants: Record<string, PluginGrant>;
  /** Enabled AND the granted version + content hash still match what's installed. */
  isEnabledAndGranted: (id: string, version: string, hash?: string) => boolean;
  /** Needs a (re)grant: never granted, disabled, version or code changed. */
  needsGrant: (id: string, version: string, hash?: string) => boolean;
  grant: (id: string, version: string, hash?: string) => void;
  disable: (id: string) => void;
  approveHost: (id: string, host: string) => void;
  revokeHost: (id: string, host: string) => void;
  approvedHosts: (id: string) => string[];
  /** Forget a plugin's grant entirely (on uninstall) so a re-dropped id must re-consent. */
  revoke: (id: string) => void;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      grants: {},
      isEnabledAndGranted: (id, version, hash) => grantMatches(get().grants[id], version, hash),
      needsGrant: (id, version, hash) => !grantMatches(get().grants[id], version, hash),
      grant: (id, version, hash) =>
        set((s) => ({
          grants: {
            ...s.grants,
            [id]: {
              enabled: true,
              grantedVersion: version,
              grantedHash: hash,
              approvedHosts: s.grants[id]?.approvedHosts,
            },
          },
        })),
      disable: (id) =>
        set((s) => ({
          grants: {
            ...s.grants,
            [id]: {
              enabled: false,
              grantedVersion: s.grants[id]?.grantedVersion ?? '',
              grantedHash: s.grants[id]?.grantedHash,
              approvedHosts: s.grants[id]?.approvedHosts,
            },
          },
        })),
      approveHost: (id, host) =>
        set((s) => {
          const grant = s.grants[id];
          if (!grant || grant.approvedHosts?.includes(host)) return s;
          return {
            grants: {
              ...s.grants,
              [id]: { ...grant, approvedHosts: [...(grant.approvedHosts ?? []), host] },
            },
          };
        }),
      revokeHost: (id, host) =>
        set((s) => {
          const grant = s.grants[id];
          if (!grant?.approvedHosts?.includes(host)) return s;
          return {
            grants: {
              ...s.grants,
              [id]: { ...grant, approvedHosts: grant.approvedHosts.filter((h) => h !== host) },
            },
          };
        }),
      approvedHosts: (id) => [...(get().grants[id]?.approvedHosts ?? [])],
      revoke: (id) =>
        set((s) => {
          const next = { ...s.grants };
          delete next[id];
          return { grants: next };
        }),
    }),
    {
      name: namespacedKey('moldavite-plugins'),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ grants: s.grants }),
    }
  )
);
