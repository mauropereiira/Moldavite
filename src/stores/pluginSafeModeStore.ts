/**
 * Whether third-party plugins may run in this process. Rust decides it
 * (`plugin_safety.rs`); this mirrors the answer for the UI and the host.
 */

import { create } from 'zustand';

export type SafeModeReason = 'launchFlag' | 'unfinishedStart' | 'userRequest';

export interface SafeModeStatus {
  active: boolean;
  reason: SafeModeReason | null;
  /** Plugins that were starting when the previous start stopped. */
  pluginIds: string[];
}

export const PLUGINS_RUNNING: SafeModeStatus = { active: false, reason: null, pluginIds: [] };

const REASONS: readonly SafeModeReason[] = ['launchFlag', 'unfinishedStart', 'userRequest'];

export function toSafeModeStatus(value: unknown): SafeModeStatus {
  if (typeof value !== 'object' || value === null) return PLUGINS_RUNNING;
  const raw = value as Record<string, unknown>;
  if (raw.active !== true) return PLUGINS_RUNNING;
  const reason = REASONS.find((known) => known === raw.reason) ?? null;
  const pluginIds = Array.isArray(raw.pluginIds)
    ? raw.pluginIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { active: true, reason, pluginIds };
}

interface PluginSafeModeState {
  status: SafeModeStatus;
  setStatus: (status: SafeModeStatus) => void;
}

export const usePluginSafeModeStore = create<PluginSafeModeState>()((set) => ({
  status: PLUGINS_RUNNING,
  setStatus: (status) => set({ status }),
}));
