import type { CSSProperties, ReactNode } from 'react';
import { WORDMARK_BOX, WORDMARK_GLYPHS } from './wordmarkGlyphs';

export interface SignatureMarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

interface SignatureEmptyStateProps {
  children: ReactNode;
  className?: string;
  vertical?: boolean;
}

const SIGNATURE_GLYPH = (() => {
  const glyph = WORDMARK_GLYPHS.find((candidate) => candidate.mirrored);
  if (!glyph) throw new Error('The wordmark must contain one mirrored glyph.');
  return glyph;
})();

const fontTransform = `translate(${-WORDMARK_BOX.minX} ${WORDMARK_BOX.maxY}) scale(1 -1)`;

/** The mirrored `a` from the wordmark, cropped as a quiet standalone mark. */
export function SignatureMark({ size = 20, className, style }: SignatureMarkProps) {
  const centreX = SIGNATURE_GLYPH.cx - WORDMARK_BOX.minX;
  const centreY = WORDMARK_BOX.maxY - SIGNATURE_GLYPH.cy;
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={`${centreX - 250} ${centreY - 300} 500 600`}
      width={size}
      height={size}
      style={{ display: 'block', flex: 'none', ...style }}
    >
      <g transform={fontTransform}>
        <path d={SIGNATURE_GLYPH.d} fill="currentColor" />
      </g>
    </svg>
  );
}

export function SignatureEmptyState({
  children,
  className = '',
  vertical = false,
}: SignatureEmptyStateProps) {
  return (
    <div
      className={`signature-empty-state${vertical ? ' signature-empty-state-vertical' : ''} ${className}`}
    >
      <SignatureMark />
      {children}
    </div>
  );
}
