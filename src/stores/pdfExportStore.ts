import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * User-configurable PDF page size. Maps directly to jsPDF format keys.
 */
export type PdfPageSize = 'letter' | 'a4' | 'legal';

/**
 * Margin preset names. Concrete millimetre values are looked up via
 * {@link PDF_MARGIN_MM} so the persisted value stays a stable enum even if
 * we tweak the actual margin sizes later.
 */
export type PdfMarginPreset = 'narrow' | 'normal' | 'wide';

/**
 * jsPDF accepts millimetre margins as a single number or 4-tuple. We use
 * symmetric margins so a single number is sufficient.
 */
export const PDF_MARGIN_MM: Record<PdfMarginPreset, number> = {
  narrow: 8,
  normal: 16,
  wide: 26,
};

interface PdfExportState {
  pageSize: PdfPageSize;
  margin: PdfMarginPreset;
  setPageSize: (size: PdfPageSize) => void;
  setMargin: (margin: PdfMarginPreset) => void;
}

/**
 * Tiny persisted store that remembers the user's last-used PDF export
 * options. Kept separate from `useSettingsStore` so it doesn't clutter the
 * Settings UI — these are workflow choices, not app preferences.
 */
export const usePdfExportStore = create<PdfExportState>()(
  persist(
    (set) => ({
      pageSize: 'letter',
      margin: 'normal',
      setPageSize: (pageSize) => set({ pageSize }),
      setMargin: (margin) => set({ margin }),
    }),
    { name: 'moldavite-pdf-export' },
  ),
);
