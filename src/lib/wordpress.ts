/**
 * Typed IPC for WordPress.com publishing.
 *
 * The authorization code never reaches this layer: `connect` only opens the
 * browser, and the exchange happens in Rust off the `moldavite://` callback.
 * Completion arrives as a `wordpress:auth` event.
 */

import { safeInvoke as invoke } from './ipc';

export interface WordPressStatus {
  /** False in a build without WordPress.com credentials. */
  available: boolean;
  connected: boolean;
  error: string | null;
}

export interface WordPressSite {
  id: number;
  name: string;
  url: string;
}

export interface PublishedPost {
  id: number;
  url: string | null;
  updated: boolean;
}

export interface WordPressAuthResult {
  connected: boolean;
  error: string | null;
}

export const WORDPRESS_AUTH_EVENT = 'wordpress:auth';

export async function wordpressStatus(): Promise<WordPressStatus> {
  return await invoke<WordPressStatus>('wordpress_status');
}

/** Opens the system browser. Resolves when the browser has been asked, not
 *  when the user has finished — listen for `wordpress:auth` for that. */
export async function wordpressConnect(): Promise<void> {
  await invoke('wordpress_connect');
}

export async function wordpressDisconnect(): Promise<void> {
  await invoke('wordpress_disconnect');
}

export async function wordpressSites(): Promise<WordPressSite[]> {
  return await invoke<WordPressSite[]>('wordpress_sites');
}

export async function wordpressPublish(args: {
  siteId: number;
  title: string;
  content: string;
  existingPostId?: number | null;
}): Promise<PublishedPost> {
  return await invoke<PublishedPost>('wordpress_publish', {
    siteId: args.siteId,
    title: args.title,
    content: args.content,
    existingPostId: args.existingPostId ?? null,
  });
}
