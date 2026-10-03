import type { ButtonHTMLAttributes } from 'react';

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
