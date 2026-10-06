import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Keys are relative to this folder; name each file from src/components.
const files = Object.entries(sources).map(([path, source]) => [
  path.startsWith('./') ? `ui/${path.slice(2)}` : path.slice(3),
  source,
]);

// Surfaces that are dialogs or full-window pages, but have no × on purpose.
const NO_CLOSE: Record<string, string> = {
  'ui/DialogSurface.tsx': 'the behaviour-only primitive every dialog wraps',
  'ui/WelcomeScreen.tsx': 'only asks whether a dialog is open',
  'ChromeShortcutHost.tsx': 'only asks whether a dialog is open',
  'onboarding/AppOnboardingModal.tsx': 'its steps are finished, not dismissed',
};

// Tabs close a note, not a surface, and keep their own smaller ×.
const OWN_CLOSE = ['editor/TabBar.tsx', 'editor/OpenTabsMenu.tsx'];

const isSurface = (source: string) =>
  /<DialogSurface\b|role="dialog"|aria-modal="true"|app-overlay\b|app-trash-overlay/.test(source);

describe('one close control', () => {
  it('finds the dialogs and pages it checks', () => {
    expect(files.filter(([, source]) => isSurface(source)).length).toBeGreaterThan(30);
  });

  it.each(files.filter(([path, source]) => isSurface(source) && !(path in NO_CLOSE)))(
    '%s closes with the shared CloseButton',
    (_path, source) => {
      expect(source).toMatch(/<CloseButton\b/);
    }
  );

  it.each(files.filter(([path]) => path !== 'ui/CloseButton.tsx' && !OWN_CLOSE.includes(path)))(
    '%s draws no close button of its own',
    (_path, source) => {
      // A plain button named Close, or a bare × glyph as a label.
      expect(source).not.toMatch(
        /<button\b(?:(?!<\/button>)[\s\S]){0,800}?aria-label=["{`']+Close\b/
      );
      expect(source).not.toMatch(/>\s*×\s*</);
    }
  );

  it.each(files)('%s shows no shortcut hint line for closing', (_path, source) => {
    expect(source).not.toMatch(/Esc closes/i);
  });
});
