import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

import { htmlToMarkdown, markdownToHtml } from './fileSystem';
import { renderHook } from '@testing-library/react';
import {
  forgeImageSrcForSavedPath,
  resolveForgeImageSrc,
  toForgeImageSrc,
  useForgeImageSrc,
} from './forgeImages';

const OTHER_MACHINE =
  'asset://localhost/%2FUsers%2Fsomeone-else%2FDocuments%2FMoldavite%2FDefault%2Fimages%2Fshot_20260101.png';

function imageSrc(html: string): string | null {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.querySelector('img')?.getAttribute('src') ?? null;
}

describe('saving images', () => {
  it('stores a freshly saved image relative to the Forge root', () => {
    expect(forgeImageSrcForSavedPath('/Users/me/Documents/Moldavite/Default/images/a b.png')).toBe(
      'images/a%20b.png'
    );
    expect(forgeImageSrcForSavedPath('C:\\Users\\me\\Forge\\images\\a.png')).toBe('images/a.png');
  });

  it('writes the relative path to Markdown', () => {
    expect(htmlToMarkdown('<img src="images/a.png" alt="">')).toBe(
      '<img src="images/a.png" alt="">'
    );
  });

  it('writes an absolute asset URL back as the relative path', () => {
    expect(htmlToMarkdown(`<img src="${OTHER_MACHINE}" alt="">`)).toBe(
      '<img src="images/shot_20260101.png" alt="">'
    );
    expect(
      htmlToMarkdown(
        '<img src="http://asset.localhost/C%3A%5CUsers%5Cme%5CForge%5Cimages%5Ca.png" alt="">'
      )
    ).toBe('<img src="images/a.png" alt="">');
  });

  it('leaves remote and data URLs alone', () => {
    for (const src of ['https://example.com/images/a.png', 'data:image/png;base64,AAA']) {
      expect(toForgeImageSrc(src)).toBeNull();
      expect(htmlToMarkdown(`<img src="${src}" alt="">`)).toBe(`<img src="${src}" alt="">`);
    }
  });
});

describe('loading images', () => {
  it('keeps the relative path in the document', () => {
    expect(imageSrc(markdownToHtml('<img src="images/a.png" alt="">'))).toBe('images/a.png');
  });

  it('rewrites a legacy absolute URL from another home directory to the relative path', () => {
    const html = markdownToHtml(`<img src="${OTHER_MACHINE}" alt="">`);
    expect(imageSrc(html)).toBe('images/shot_20260101.png');
    expect(htmlToMarkdown(html)).toBe('<img src="images/shot_20260101.png" alt="">');
  });

  it("resolves the relative path against this device's Forge", () => {
    expect(resolveForgeImageSrc('images/a%20b.png', '/Users/me/Forge')).toBe(
      `asset://localhost/${encodeURIComponent('/Users/me/Forge/images/a b.png')}`
    );
    expect(resolveForgeImageSrc('images/a.png', 'C:\\Users\\me\\Forge')).toBe(
      `asset://localhost/${encodeURIComponent('C:\\Users\\me\\Forge\\images\\a.png')}`
    );
  });

  it('shows the legacy image from this Forge, not the path it was written with', () => {
    const relative = imageSrc(markdownToHtml(`<img src="${OTHER_MACHINE}" alt="">`)) ?? '';
    expect(decodeURIComponent(resolveForgeImageSrc(relative, '/Users/me/Forge'))).toBe(
      'asset://localhost//Users/me/Forge/images/shot_20260101.png'
    );
  });

  it('leaves the reference alone until the Forge path is known', () => {
    expect(resolveForgeImageSrc('images/a.png', null)).toBe('images/a.png');
  });

  it('does not request a Forge image from the app origin before the Forge path is known', () => {
    expect(renderHook(() => useForgeImageSrc('images/a.png')).result.current).toBe('');
    expect(renderHook(() => useForgeImageSrc('data:image/png;base64,AAA')).result.current).toBe(
      'data:image/png;base64,AAA'
    );
  });
});

describe('note-relative links from the Obsidian importer', () => {
  it.each([
    ['./images/x.png', 'images/x.png'],
    ['../images/x.png', 'images/x.png'],
    ['../../images/x.png', 'images/x.png'],
    ['../../../images/photo%202.png', 'images/photo%202.png'],
  ])('accepts %s as %s', (src, relative) => {
    expect(toForgeImageSrc(src)).toBe(relative);
    expect(resolveForgeImageSrc(src, '/Users/me/Forge')).toBe(
      resolveForgeImageSrc(relative, '/Users/me/Forge')
    );
  });

  it('displays the imported Markdown image and saves it Forge-relative', () => {
    const html = markdownToHtml('![second](<../../images/photo 2.png>)');
    expect(imageSrc(html)).toBe('images/photo%202.png');
    expect(htmlToMarkdown(html)).toBe('<img src="images/photo%202.png" alt="second">');
    expect(resolveForgeImageSrc(imageSrc(html) ?? '', '/Users/me/Forge')).toBe(
      `asset://localhost/${encodeURIComponent('/Users/me/Forge/images/photo 2.png')}`
    );
  });
});

describe('path traversal', () => {
  it.each([
    'images/../notes/secret.md',
    'images/..',
    'images/..%2Fnotes%2Fsecret.md',
    'images/sub/a.png',
    'images/a%5C..%5Cb.png',
    'images/',
    '../../etc/passwd',
    'images/../x.png',
    'images/sub/x.png',
    '../images/../x.png',
    '../images/sub/x.png',
    '..images/x.png',
    'notes/../images/x.png',
  ])('does not treat %s as a Forge image', (src) => {
    expect(toForgeImageSrc(src)).toBeNull();
    expect(resolveForgeImageSrc(src, '/Users/me/Forge')).toBe(src);
  });

  it('does not map a legacy URL whose file is not directly inside images/', () => {
    for (const path of ['/Users/me/Forge/notes/secret.md', '/Users/me/Forge/images/sub/a.png']) {
      expect(toForgeImageSrc(`asset://localhost/${encodeURIComponent(path)}`)).toBeNull();
    }
    expect(
      toForgeImageSrc(`asset://localhost/${encodeURIComponent('/Users/me/images/..')}`)
    ).toBeNull();
  });
});
