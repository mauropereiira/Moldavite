import type { ButtonHTMLAttributes, CSSProperties } from 'react';

/** The strip under the tab bar that tells the open note's state, with its actions. */
export const bannerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '6px 16px',
  padding: '8px 20px',
  borderBottom: '1px solid var(--border-default)',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

export function BannerAction(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="focus-ring"
      style={{
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--border-default)',
        padding: 0,
        width: 'auto',
        font: 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit',
        color: 'var(--text-primary)',
        cursor: 'pointer',
      }}
      {...props}
    />
  );
}
