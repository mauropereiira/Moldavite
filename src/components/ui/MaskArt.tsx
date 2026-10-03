import type { CSSProperties } from 'react';

interface MaskArtProps {
  src: string;
  className?: string;
  label?: string;
  style?: CSSProperties;
}

export function MaskArt({ src, className = '', label, style }: MaskArtProps) {
  const maskImage = `url("${src}")`;

  return (
    <span
      className={`mask-art ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      style={{ ...style, maskImage, WebkitMaskImage: maskImage }}
    />
  );
}
