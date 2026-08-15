import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignatureMark } from './SignatureMark';
import { WORDMARK_GLYPHS } from './wordmarkGlyphs';

describe('SignatureMark', () => {
  it('renders the wordmark signature glyph as a currentColor SVG', async () => {
    const { container } = render(<SignatureMark />);
    const signatureGlyph = WORDMARK_GLYPHS.find((glyph) => glyph.mirrored);

    await waitFor(() => expect(container.querySelector('path')).toBeInTheDocument());
    const svg = container.querySelector('svg');
    const path = container.querySelector('path');

    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(path).toHaveAttribute('fill', 'currentColor');
    expect(path).toHaveAttribute('d', signatureGlyph?.d);
  });
});
