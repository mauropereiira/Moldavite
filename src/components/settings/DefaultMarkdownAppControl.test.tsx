import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

import DefaultMarkdownAppControl from './DefaultMarkdownAppControl';

type Status = { mode: 'set' | 'open-settings' | 'unsupported'; isDefault: boolean | null };

function answer(status: Status, afterMake: Status | Error = status) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === 'default_markdown_app_status') return status;
    if (cmd === 'make_default_markdown_app') {
      if (afterMake instanceof Error) throw afterMake;
      return afterMake;
    }
    return undefined;
  });
}

async function renderControl() {
  render(<DefaultMarkdownAppControl />);
  await act(async () => {});
}

describe('DefaultMarkdownAppControl', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    platform.mobile = false;
  });

  it('offers Make default when another app opens .md files, then reports the change', async () => {
    answer({ mode: 'set', isDefault: false }, { mode: 'set', isDefault: true });
    await renderControl();

    expect(screen.getByText('Default app for Markdown files')).toBeInTheDocument();
    expect(screen.getByText('Another app opens .md files')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    });

    expect(invoke).toHaveBeenCalledWith('make_default_markdown_app', undefined);
    expect(screen.getByText('Moldavite opens .md files')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make default' })).not.toBeInTheDocument();
  });

  it('shows the status without a button when Moldavite is already the default', async () => {
    answer({ mode: 'set', isDefault: true });
    await renderControl();

    expect(screen.getByText('Moldavite opens .md files')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens Default Apps settings on Windows, where the status is unknown', async () => {
    answer({ mode: 'open-settings', isDefault: null });
    await renderControl();

    expect(screen.queryByText(/opens \.md files/)).not.toBeInTheDocument();
    expect(screen.getByText(/search for \.md in Default Apps/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Default Apps settings' }));
    });
    expect(invoke).toHaveBeenCalledWith('make_default_markdown_app', undefined);
  });

  it('says so when the system refuses', async () => {
    answer({ mode: 'set', isDefault: false }, new Error('macOS said no'));
    await renderControl();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    });
    expect(screen.getByText('macOS said no')).toBeInTheDocument();
    expect(screen.getByText('Another app opens .md files')).toBeInTheDocument();
  });

  it('renders nothing where the default cannot be changed', async () => {
    answer({ mode: 'unsupported', isDefault: null });
    await renderControl();
    expect(screen.queryByText('Default app for Markdown files')).not.toBeInTheDocument();
  });

  it('renders nothing on a phone and does not ask', async () => {
    platform.mobile = true;
    answer({ mode: 'set', isDefault: false });
    await renderControl();
    expect(screen.queryByText('Default app for Markdown files')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
