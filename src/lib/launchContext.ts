import { create } from 'zustand';

export const useLaunchContextStore = create(() => ({
  ready: false,
  launchedWithFile: false,
}));

export function markLaunchedWithFile(): void {
  useLaunchContextStore.setState({ launchedWithFile: true });
}

export function wasLaunchedWithFile(): boolean {
  return useLaunchContextStore.getState().launchedWithFile;
}
