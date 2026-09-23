import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const options = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ value: `o${i}`, label: `Option ${i}` }));

describe('SegmentedControl', () => {
  it('keeps up to four options in one row', () => {
    render(
      <SegmentedControl ariaLabel="Few" value="o0" onChange={() => {}} options={options(3)} />
    );
    expect(screen.getByRole('radiogroup')).toHaveStyle({
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    });
  });

  // Seven sorts in one row wrapped "Modified (Newest)" onto four lines.
  it('wraps more than four options into rows of four, ruled between rows', () => {
    render(
      <SegmentedControl ariaLabel="Many" value="o0" onChange={() => {}} options={options(7)} />
    );
    expect(screen.getByRole('radiogroup')).toHaveStyle({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    });
    const radios = screen.getAllByRole('radio');
    expect(radios[4].style.borderLeft).toBe('');
    expect(radios[4].style.borderTop).not.toBe('');
    expect(radios[3].style.borderTop).toBe('');
    expect(radios[5].style.borderLeft).not.toBe('');
  });
});
