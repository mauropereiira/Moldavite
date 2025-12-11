import { useState, useRef, useEffect } from 'react';
import { Palette, Check } from 'lucide-react';

// Muted, harmonious color palette that works in both light and dark modes
export const NOTE_COLORS = [
  { id: 'default', name: 'Default', light: 'transparent', dark: 'transparent' },
  // Warm tones
  { id: 'cream', name: 'Cream', light: '#fefce8', dark: '#422006' },
  { id: 'peach', name: 'Peach', light: '#fff7ed', dark: '#431407' },
  { id: 'rose', name: 'Rose', light: '#fff1f2', dark: '#4c0519' },
  { id: 'blush', name: 'Blush', light: '#fdf2f8', dark: '#500724' },
  // Cool tones
  { id: 'lavender', name: 'Lavender', light: '#faf5ff', dark: '#3b0764' },
  { id: 'periwinkle', name: 'Periwinkle', light: '#eef2ff', dark: '#1e1b4b' },
  { id: 'sky', name: 'Sky', light: '#f0f9ff', dark: '#0c4a6e' },
  { id: 'aqua', name: 'Aqua', light: '#ecfeff', dark: '#164e63' },
  { id: 'mint', name: 'Mint', light: '#ecfdf5', dark: '#064e3b' },
  // Neutral tones
  { id: 'sage', name: 'Sage', light: '#f0fdf4', dark: '#14532d' },
  { id: 'sand', name: 'Sand', light: '#fafaf9', dark: '#292524' },
  { id: 'stone', name: 'Stone', light: '#f5f5f4', dark: '#1c1917' },
  { id: 'slate', name: 'Slate', light: '#f8fafc', dark: '#0f172a' },
  { id: 'zinc', name: 'Zinc', light: '#fafafa', dark: '#18181b' },
] as const;

export type NoteColorId = (typeof NOTE_COLORS)[number]['id'];

interface NoteColorPickerProps {
  currentColorId: NoteColorId;
  onColorChange: (colorId: NoteColorId) => void;
  isDark?: boolean;
}

export function NoteColorPicker({ currentColorId, onColorChange, isDark = false }: NoteColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const currentColor = NOTE_COLORS.find((c) => c.id === currentColorId) || NOTE_COLORS[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="toolbar-button"
        title="Note background color"
        aria-label="Change note background color"
        aria-expanded={isOpen}
      >
        <Palette className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 p-3 bg-white dark:bg-gray-800 rounded-md shadow-xl border border-gray-200 dark:border-gray-700 z-50 w-64 modal-content-enter">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Note Background
          </div>

          <div className="grid grid-cols-5 gap-2">
            {NOTE_COLORS.map((color) => {
              const bgColor = isDark ? color.dark : color.light;
              const isSelected = currentColorId === color.id;
              const isDefault = color.id === 'default';

              return (
                <button
                  key={color.id}
                  onClick={() => {
                    onColorChange(color.id);
                    setIsOpen(false);
                  }}
                  className={`
                    relative w-10 h-10 rounded border-2 transition-all
                    ${isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }
                    ${isDefault ? 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600' : ''}
                  `}
                  style={{ backgroundColor: isDefault ? undefined : bgColor }}
                  title={color.name}
                  aria-label={color.name}
                >
                  {isSelected && (
                    <Check className="w-4 h-4 absolute inset-0 m-auto text-blue-600 dark:text-blue-400" />
                  )}
                  {isDefault && !isSelected && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-500">
                      ∅
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
              {currentColor.name}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to get the actual color value
export function getNoteBackgroundColor(colorId: NoteColorId, isDark: boolean): string | undefined {
  const color = NOTE_COLORS.find((c) => c.id === colorId);
  if (!color || color.id === 'default') return undefined;
  return isDark ? color.dark : color.light;
}
