/**
 * Small seasonal icons. AcornIcon, LeafIcon, MugIcon and MushroomIcon are
 * Tabler Icons 3.48 (https://tabler.io/icons),
 * MIT License, Copyright (c) 2020-2026 Paweł Kuna. SnowflakeIcon, GiftIcon,
 * PineIcon and CandyCaneIcon are Lucide (https://lucide.dev), ISC License.
 */
import type { ReactNode } from 'react';
import type { Season } from '@/lib/seasons';

interface IconProps {
  className?: string;
  title?: string;
}

function LineIcon({ className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const AcornIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M18 10l-.45 4.1a8.36 8.36 0 0 1 -5.18 6.83a1 1 0 0 1 -.74 0a8.36 8.36 0 0 1 -5.18 -6.83l-.45 -4.1" />
    <path d="M13 3a4.9 4.9 0 0 0 -1 3" />
    <path d="M8 6h8a3 3 0 0 1 3 3a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1a3 3 0 0 1 3 -3" />
  </LineIcon>
);

export const LeafIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M5 21c.5 -4.5 2.5 -8 7 -10" />
    <path d="M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0" />
  </LineIcon>
);

export const MugIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M3 14c.83 .642 2.077 1.017 3.5 1c1.423 .017 2.67 -.358 3.5 -1c.83 -.642 2.077 -1.017 3.5 -1c1.423 -.017 2.67 .358 3.5 1" />
    <path d="M8 3a2.4 2.4 0 0 0 -1 2a2.4 2.4 0 0 0 1 2" />
    <path d="M12 3a2.4 2.4 0 0 0 -1 2a2.4 2.4 0 0 0 1 2" />
    <path d="M3 10h14v5a6 6 0 0 1 -6 6h-2a6 6 0 0 1 -6 -6v-5" />
    <path d="M16.746 16.726a3 3 0 1 0 .252 -5.555" />
  </LineIcon>
);

export const MushroomIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M20 11.1c0 -4.474 -3.582 -8.1 -8 -8.1s-8 3.626 -8 8.1a.9 .9 0 0 0 .9 .9h14.2a.9 .9 0 0 0 .9 -.9" />
    <path d="M10 12v7a2 2 0 1 0 4 0v-7" />
  </LineIcon>
);

export const SnowflakeIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="m10 20-1.25-2.5L6 18" />
    <path d="M10 4 8.75 6.5 6 6" />
    <path d="m14 20 1.25-2.5L18 18" />
    <path d="m14 4 1.25 2.5L18 6" />
    <path d="m17 21-3-6h-4" />
    <path d="m17 3-3 6 1.5 3" />
    <path d="M2 12h6.5L10 9" />
    <path d="m20 10-1.5 2 1.5 2" />
    <path d="M22 12h-6.5L14 15" />
    <path d="m4 10 1.5 2L4 14" />
    <path d="m7 21 3-6-1.5-3" />
    <path d="m7 3 3 6h4" />
  </LineIcon>
);

export const GiftIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13" />
    <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
    <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
  </LineIcon>
);

export const PineIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z" />
    <path d="M12 22v-3" />
  </LineIcon>
);

export const CandyCaneIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M5.7 21a2 2 0 0 1-3.5-2l8.6-14a6 6 0 0 1 10.4 6 2 2 0 1 1-3.464-2 2 2 0 1 0-3.464-2Z" />
    <path d="M17.75 7 15 2.1" />
    <path d="M10.9 4.8 13 9" />
    <path d="m7.9 9.7 2 4.4" />
    <path d="M4.9 14.7 7 18.9" />
  </LineIcon>
);

/** Index section-title icons for each seasonal theme, by section title. */
export const SECTION_ICONS: Record<Season, Record<string, (props: IconProps) => ReactNode>> = {
  autumn: {
    Folders: AcornIcon,
    Notes: LeafIcon,
    Daily: MugIcon,
    Tags: MushroomIcon,
  },
  winter: {
    Folders: GiftIcon,
    Notes: SnowflakeIcon,
    Daily: MugIcon,
    Tags: PineIcon,
  },
};
