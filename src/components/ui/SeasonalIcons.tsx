/**
 * Small seasonal icons. AcornIcon, LeafIcon, MugIcon, MushroomIcon and
 * JackOLanternIcon are Tabler Icons 3.48 (https://tabler.io/icons),
 * MIT License, Copyright (c) 2020-2026 Paweł Kuna. The pumpkin and the falling
 * leaf are Moldavite's own.
 */
import type { ReactNode } from 'react';

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

export const JackOLanternIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M9 15l1.5 1l1.5 -1l1.5 1l1.5 -1" />
    <path d="M10 11h.01" />
    <path d="M14 11h.01" />
    <path d="M17 6.082c2.609 .588 3.627 4.162 2.723 7.983c-.903 3.82 -2.75 6.44 -5.359 5.853a3.355 3.355 0 0 1 -.774 -.279a3.728 3.728 0 0 1 -1.59 .361c-.556 0 -1.09 -.127 -1.59 -.362a3.296 3.296 0 0 1 -.774 .28c-2.609 .588 -4.456 -2.033 -5.36 -5.853c-.903 -3.82 .115 -7.395 2.724 -7.983c1.085 -.244 1.575 .066 2.585 .787c.716 -.554 1.54 -.869 2.415 -.869c.876 0 1.699 .315 2.415 .87c1.01 -.722 1.5 -1.032 2.585 -.788" />
    <path d="M12 6c0 -1.226 .693 -2.346 1.789 -2.894l.211 -.106" />
  </LineIcon>
);

export const PumpkinIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M12 8c-2.1 0-3.4 2.7-3.4 5.9S9.9 20 12 20s3.4-2.9 3.4-6.1S14.1 8 12 8z" />
    <path d="M9.3 8.5C6.4 8 3.6 10.2 3.6 14s2.6 6.3 6 5.8" />
    <path d="M14.7 8.5c2.9-.5 5.7 1.7 5.7 5.5s-2.6 6.3-6 5.8" />
    <path d="M12 8V5.2c0-.7.3-1.2.9-1.5" />
    <path d="M12.6 6.2c.9-1 2.6-1.2 3.7-.4" />
  </LineIcon>
);

export const FallingLeafIcon = (props: IconProps) => (
  <LineIcon {...props}>
    <path d="M5 19c0-7.5 5.2-12.6 14-14-1.1 8.6-6.4 14-14 14z" />
    <path d="M5 19l8.5-8.5" />
    <path d="M5 19l-2 2" />
  </LineIcon>
);

/** Index section-title icons, by section title. */
export const SECTION_ICONS: Record<string, (props: IconProps) => ReactNode> = {
  Folders: AcornIcon,
  Notes: LeafIcon,
  Daily: MugIcon,
  Tags: MushroomIcon,
};
