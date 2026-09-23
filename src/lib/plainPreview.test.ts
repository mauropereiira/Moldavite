import { describe, expect, it } from 'vitest';
import { markdownToPlainPreview } from './plainPreview';

const preview = (markdown: string) => markdownToPlainPreview(markdown, 200);

describe('markdownToPlainPreview', () => {
  it('keeps literal brackets that were escaped, without the backslashes', () => {
    expect(preview('Untitled \\[\\[project plan\\]\\] and')).toBe('Untitled [[project plan]] and');
  });

  it('turns a table into its cell text, with no pipes or rule', () => {
    expect(preview('| Name | Status |\n| --- | :---: |\n| Plan | Done |')).toBe(
      'Name Status Plan Done'
    );
  });

  it('drops headings, quotes, list and task markers, and emphasis', () => {
    expect(
      preview('# Title\n> quoted\n- item\n1. first\n- [ ] todo\n- [x] done\n**bold** _it_ `code`')
    ).toBe('Title quoted item first todo done bold it code');
  });

  it('keeps link and image text, and a wiki link its label', () => {
    expect(preview('See [site](https://a.io), ![logo](x.png) and [[Plan|plan-2]].')).toBe(
      'See site, logo and Plan.'
    );
  });

  it('skips frontmatter and cuts long text', () => {
    expect(markdownToPlainPreview('---\ncolor: red\n---\nabcdefghij', 5)).toBe('abcde…');
  });
});
