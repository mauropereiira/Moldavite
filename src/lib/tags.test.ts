import { describe, expect, it } from 'vitest';
import { renameTagInContent } from './tags';

describe('renameTagInContent', () => {
  it('renames visible tag text without changing links, code, preformatted text, or URL fragments', () => {
    const content = [
      '<p>Use #old here.</p>',
      '<p><a href="https://example.com/#old">linked #old</a></p>',
      '<p><code>#old</code> and <span>#OLD</span></p>',
      '<pre><code>#old in a sample</code></pre>',
      '<p>Reference https://example.com/page#old but rename #old.</p>',
    ].join('');

    expect(renameTagInContent(content, 'old', 'new')).toBe(
      [
        '<p>Use #new here.</p>',
        '<p><a href="https://example.com/#old">linked #old</a></p>',
        '<p><code>#old</code> and <span>#new</span></p>',
        '<pre><code>#old in a sample</code></pre>',
        '<p>Reference https://example.com/page#old but rename #new.</p>',
      ].join('')
    );
  });

  it('preserves Markdown links, images, code spans, and code blocks', () => {
    const content = [
      'Visible #old',
      '`inline #old` and ``another #old``',
      '[linked #old](https://example.com/page#old)',
      '![alt #old](https://example.com/image.png#old)',
      'https://example.com/plain#old and #OLD',
      '```md',
      '#old in a fence',
      '```',
      '    #old in indented code',
    ].join('\n');

    expect(renameTagInContent(content, 'old', 'new')).toBe(
      [
        'Visible #new',
        '`inline #old` and ``another #old``',
        '[linked #old](https://example.com/page#old)',
        '![alt #old](https://example.com/image.png#old)',
        'https://example.com/plain#old and #new',
        '```md',
        '#old in a fence',
        '```',
        '    #old in indented code',
      ].join('\n')
    );
  });

  it('still renames visible text around a literal less-than sign', () => {
    expect(renameTagInContent('2 < 3 and #old', 'old', 'new')).toBe('2 < 3 and #new');
  });
});
