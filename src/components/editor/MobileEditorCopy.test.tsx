import { fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatShortcut } from '@/lib/shortcuts';
import { FormattingMenu } from './FormattingMenu';
import { ImageModal } from './ImageModal';
import { LinkModal } from './LinkModal';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  platform.mobile = false;
});

describe.each([true, false])('editor dialogs and menus with mobile=%s', (mobile) => {
  it('offers keyboard hints only where there is a keyboard to press them on', () => {
    platform.mobile = mobile;
    render(<LinkModal isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.queryByText('Esc') === null).toBe(mobile);
  });

  it('asks for a URL with the URL keyboard, uncorrected, and focuses it on open', () => {
    platform.mobile = mobile;
    render(<LinkModal isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
    const url = screen.getByLabelText(/URL/);
    expect(url).toHaveAttribute('inputmode', 'url');
    expect(url).toHaveAttribute('autocapitalize', 'off');
    expect(url).toHaveAttribute('autocorrect', 'off');
    expect(url).toHaveAttribute('spellcheck', 'false');
    expect(document.activeElement).toBe(url);
    expect(url.getAttribute('placeholder')).toBe(
      mobile ? 'https://example.com' : 'https://example.com or /page or #section'
    );
  });

  it('describes choosing a picture in the words of the device', () => {
    platform.mobile = mobile;
    render(<ImageModal isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.queryByText('Choose a photo') !== null).toBe(mobile);
    expect(screen.queryByText('Click to upload') !== null).toBe(!mobile);
    expect(screen.queryByText('Esc') === null).toBe(mobile);
  });

  it('shows Format menu shortcuts only on the desktop', () => {
    platform.mobile = mobile;
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    render(<FormattingMenu editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
    const bold = screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent?.startsWith('Bold'));
    expect(bold?.textContent).toBe(mobile ? 'Bold' : `Bold${formatShortcut('⌘B')}`);
  });
});

it('marks the chosen image tab in ink, not the accent', () => {
  render(<ImageModal isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
  const tab = screen.getByRole('button', { name: 'Upload File' });
  expect(tab.style.color).toBe('var(--text-primary)');
  expect(tab.style.borderColor).toBe('var(--text-primary)');
});
