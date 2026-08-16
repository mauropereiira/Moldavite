/**
 * Publish the open note to WordPress.com, from the editor footer.
 *
 * The button is absent — not disabled — in a build without WordPress.com
 * credentials. A control that cannot work is worse than no control: it invites
 * a click and then explains itself.
 *
 * One button covers both states. Not connected, it signs you in. Connected, it
 * publishes to your chosen site and lets you change which one.
 */

import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Dropdown,
  DropdownItem,
  DropdownDivider,
  DropdownSearch,
  DropdownStatic,
} from '@/components/ui/Dropdown';
import { useNoteStore } from '@/stores';
import { useWordPressStore } from '@/stores/wordpressStore';
import { htmlToMarkdown } from '@/lib';
import {
  WORDPRESS_AUTH_EVENT,
  type WordPressAuthResult,
  type WordPressSite,
} from '@/lib/wordpress';

/**
 * Names are not identity. "Site Title" is the WordPress.com default and shows
 * up repeatedly across a large account, so two rows could read identically and
 * publish to different blogs. The host is what actually tells them apart.
 */
const siteLabel = (site: WordPressSite) => {
  const host = site.url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return site.name && site.name !== host ? `${site.name} · ${host}` : host;
};

/** Above this many sites, the list needs filtering more than it needs brevity. */
const SEARCH_THRESHOLD = 5;

/** Rows shown before the list scrolls. */
const VISIBLE_SITES = 3;

interface WordPressMenuProps {
  onShowToast?: (message: string) => void;
  onShowError?: (message: string) => void;
  openDirection?: 'up' | 'down';
}

export function WordPressMenu({
  onShowToast,
  onShowError,
  openDirection = 'down',
}: WordPressMenuProps) {
  const { currentNote } = useNoteStore();
  const {
    available,
    connected,
    connecting,
    publishing,
    sites,
    chosenSiteId,
    refresh,
    connect,
    disconnect,
    chooseSite,
    publish,
    settleAuth,
  } = useWordPressStore();

  const [query, setQuery] = useState('');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The exchange finishes in Rust, so the browser round trip ends here.
  useEffect(() => {
    const unlisten = listen<WordPressAuthResult>(WORDPRESS_AUTH_EVENT, (event) => {
      settleAuth({ connected: event.payload.connected, error: event.payload.error ?? null });
      if (event.payload.connected) onShowToast?.('Connected to WordPress.com');
      else if (event.payload.error) onShowError?.(event.payload.error);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [settleAuth, onShowToast, onShowError]);

  // An Automattic account carries a couple of hundred sites, so the unfiltered
  // list ran off the top and bottom of the screen and nothing could be reached
  // without scrolling past it. Matching the URL as well as the name matters:
  // plenty of sites read as "Team Something" but are found by their subdomain.
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? sites.filter(
            (site) =>
              site.name.toLowerCase().includes(needle) || site.url.toLowerCase().includes(needle)
          )
        : sites,
    [sites, needle]
  );

  if (!available) return null;

  const chosenSite = sites.find((site) => site.id === chosenSiteId) ?? null;
  // Below this, the list is short enough to read at a glance and a search box
  // is just another thing between you and the site you wanted.
  const showSearch = sites.length > SEARCH_THRESHOLD;

  const handlePublish = async () => {
    if (!currentNote) return;
    try {
      const post = await publish({
        path: currentNote.id,
        title: currentNote.title,
        // WordPress stores HTML; the editor already holds HTML, so a note that
        // round-tripped through Markdown is converted back rather than posted
        // as escaped source.
        content: currentNote.content,
      });
      onShowToast?.(post.updated ? 'Updated the WordPress draft' : 'Created a WordPress draft');
    } catch (error) {
      onShowError?.(error instanceof Error ? error.message : String(error));
    }
  };

  const label = connecting ? 'Connecting…' : publishing ? 'Publishing…' : 'WordPress';

  return (
    <Dropdown
      position="right"
      openDirection={openDirection}
      trigger={
        <button className="toolbar-button" title="Publish to WordPress" aria-label="WordPress">
          {label}
        </button>
      }
    >
      {!connected && (
        <DropdownItem onClick={() => void connect()}>Connect WordPress.com…</DropdownItem>
      )}

      {connected && (
        <>
          {/* The picker comes first and does not dismiss the menu, so choosing
              a site leaves you looking at the button that publishes to it.
              Publishing used to sit above a list that closed on selection —
              you chose a site, the menu vanished, and you had to reopen it to
              find the action you had just set up. */}
          {sites.length > 1 && (
            <DropdownStatic>
              {showSearch && (
                <DropdownSearch
                  value={query}
                  onChange={setQuery}
                  label="Search sites"
                  placeholder={`Search ${sites.length} sites…`}
                />
              )}
              {/* Roughly three rows, so the menu stays a menu instead of a
                  column the height of the screen. The cut-off row at the
                  bottom edge is deliberate: it is what tells you to scroll. */}
              <div
                className="overflow-y-auto"
                style={{ maxHeight: `${VISIBLE_SITES * 34 + 12}px` }}
              >
                {matches.length === 0 ? (
                  <div className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No sites match “{query.trim()}”
                  </div>
                ) : (
                  matches.map((site) => (
                    <DropdownItem key={site.id} onClick={() => chooseSite(site.id)}>
                      {site.id === chosenSiteId ? `✓ ${siteLabel(site)}` : siteLabel(site)}
                    </DropdownItem>
                  ))
                )}
              </div>
              <DropdownDivider />
            </DropdownStatic>
          )}

          <DropdownItem
            variant="primary"
            onClick={() => void handlePublish()}
            // Without `publishing`, reopening the menu mid-publish and clicking
            // again sends a second create — neither call has a post id yet, so
            // you get two drafts and only the later one stays mapped.
            disabled={!currentNote || !chosenSite || publishing}
          >
            {publishing
              ? 'Publishing…'
              : chosenSite
                ? `Publish to ${siteLabel(chosenSite)}`
                : 'Choose a site first'}
          </DropdownItem>

          <DropdownDivider />
          <DropdownItem onClick={() => void disconnect()}>Disconnect</DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

// Kept for a later pass: notes stored as Markdown need converting before they
// reach WordPress. Exported so the conversion has one home when that lands.
export const noteContentForWordPress = (content: string) =>
  content.trimStart().startsWith('<') ? content : htmlToMarkdown(content);
