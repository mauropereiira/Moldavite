let launchedWithFile = false;

export function markLaunchedWithFile(): void {
  launchedWithFile = true;
}

export function wasLaunchedWithFile(): boolean {
  return launchedWithFile;
}
