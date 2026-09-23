/**
 * Image references inside notes.
 *
 * `save_image` writes into the active Forge's `images/` folder, and a note
 * stores that file as `images/<url-encoded name>`, relative to the Forge root
 * whichever folder the note itself lives in. An absolute asset URL carries one
 * machine's home directory, or one install's iOS container path, so it breaks
 * on every other device that syncs the Forge.
 *
 * The editor document keeps the relative form. Only display resolves it,
 * against the Forge this window has open, and only to a single file directly
 * inside that Forge's `images/` folder, which is all the asset scope grants.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { safeInvoke } from './ipc';

const FORGE_IMAGE_PREFIX = 'images/';

/** What `convertFileSrc` produces on macOS/iOS/Linux and on Windows/Android. */
const ASSET_URL = /^(?:asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)(.+)$/i;

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isImageFileName(name: string | null): name is string {
  return !!name && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

/**
 * The Obsidian importer links images relative to the note, as `../images/x`
 * from `daily/` or `../../images/x` from `notes/sub/`. The leading `../` run
 * is dropped rather than followed: whatever it climbs to, only a bare file
 * name inside the open Forge's `images/` is ever resolved.
 */
const RELATIVE_IMAGE = /^(?:\.\.\/)*images\/(.*)$/;

function relativeImageName(src: string): string | null {
  const match = RELATIVE_IMAGE.exec(src);
  const name = match ? decode(match[1]) : null;
  return isImageFileName(name) ? name : null;
}

/**
 * The Forge-relative form of an image reference, or null when `src` is not an
 * image in a Forge's `images/` folder (remote URLs, data URLs, anything else).
 *
 * The absolute asset URLs older builds wrote are recognised by their last two
 * path segments alone, so a URL naming another machine's home directory still
 * maps onto this Forge's copy of the same file.
 */
export function toForgeImageSrc(src: string): string | null {
  if (src.startsWith(FORGE_IMAGE_PREFIX)) {
    return relativeImageName(src) ? src : null;
  }
  const relative = relativeImageName(src);
  if (relative) return FORGE_IMAGE_PREFIX + encodeURIComponent(relative);
  const asset = ASSET_URL.exec(src);
  const path = asset ? decode(asset[1]) : null;
  if (!path) return null;
  const segments = path.split(/[\\/]/);
  const name = segments.pop() ?? null;
  if (segments.pop() !== 'images' || !isImageFileName(name)) return null;
  return FORGE_IMAGE_PREFIX + encodeURIComponent(name);
}

/** The note reference for a file `save_image` just wrote, given the path it returned. */
export function forgeImageSrcForSavedPath(savedPath: string): string {
  return FORGE_IMAGE_PREFIX + encodeURIComponent(savedPath.split(/[\\/]/).pop() ?? '');
}

/** The URL the webview can load for `src`; anything that is not a Forge image passes through. */
export function resolveForgeImageSrc(src: string, forgeRoot: string | null): string {
  const name = forgeRoot ? relativeImageName(src) : null;
  if (!forgeRoot || !name) return src;
  const separator = forgeRoot.includes('\\') && !forgeRoot.includes('/') ? '\\' : '/';
  const root = forgeRoot.replace(/[\\/]+$/, '');
  return convertFileSrc(`${root}${separator}images${separator}${name}`);
}

let forgeRoot: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function getForgeRoot(): string | null {
  return forgeRoot;
}

/** Forge switches reload the window, so one lookup per load is enough outside onboarding. */
export function loadForgeRoot(): Promise<void> {
  loading ??= (async () => {
    try {
      const root = await safeInvoke<string>('get_notes_directory');
      forgeRoot = typeof root === 'string' && root !== '' ? root : null;
      listeners.forEach((listener) => listener());
    } catch (error) {
      loading = null;
      console.error('[forgeImages] Could not read the Forge path:', error);
    }
  })();
  return loading;
}

export function refreshForgeRoot(): Promise<void> {
  loading = null;
  return loadForgeRoot();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useForgeImageSrc(src: string): string {
  const root = useSyncExternalStore(subscribe, getForgeRoot);
  useEffect(() => {
    void loadForgeRoot();
  }, []);
  return resolveForgeImageSrc(src, root);
}
