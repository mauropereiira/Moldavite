import type { ReactNode } from 'react';

export interface SectionHeadingProps {
  children: ReactNode;
}

export function SectionHeading({ children }: SectionHeadingProps) {
  return <h3 className="settings-section-heading">{children}</h3>;
}
