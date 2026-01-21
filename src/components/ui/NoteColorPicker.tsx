import { useState, useRef, useEffect } from 'react';
import { Palette, Check } from 'lucide-react';

// Moldavite-inspired color palette - crystal greens, cosmic golds, earth tones
export const NOTE_COLORS = [
  { id: 'default', name: 'Default', light: 'transparent', dark: 'transparent' },
  // Moldavite crystal greens
  { id: 'crystal', name: 'Crystal', light: '#e8f0ec', dark: '#1a2a22' },
  { id: 'moss', name: 'Moss', light: '#e6f0e8', dark: '#1c2a1e' },
  { id: 'fern', name: 'Fern', light: '#e4efe8', dark: '#1e2c20' },
  { id: 'forest', name: 'Forest', light: '#e2ede6', dark: '#1a2820' },
  // Cosmic gold/amber tones
  { id: 'amber', name: 'Amber', light: '#f4f0e4', dark: '#2a2618' },
  { id: 'gold', name: 'Gold', light: '#f6f2e6', dark: '#2c281a' },
  { id: 'honey', name: 'Honey', light: '#f5f0e2', dark: '#2e2a1c' },
  { id: 'bronze', name: 'Bronze', light: '#f2ece2', dark: '#2a2620' },
  // Earth tones (Bohemian origin)
  { id: 'earth', name: 'Earth', light: '#f0ebe6', dark: '#2a2622' },
  { id: 'stone', name: 'Stone', light: '#eeebe8', dark: '#282624' },
  { id: 'clay', name: 'Clay', light: '#f0e8e4', dark: '#2c2824' },
  // Cosmic/space tones
  { id: 'cosmos', name: 'Cosmos', light: '#e8eaf0', dark: '#1e2028' },
  { id: 'nebula', name: 'Nebula', light: '#eae8f0', dark: '#22202a' },
  { id: 'midnight', name: 'Midnight', light: '#e6e8ec', dark: '#1a1c22' },
] as const;

export type NoteColorId = (typeof NOTE_COLORS)[number]['id'];

interface NoteColorPickerProps {
  currentColorId: NoteColorId;
  onColorChange: (colorId: NoteColorId) => void;
  isDark?: boolean;
  openDirection?: 'up' | 'down';
}

export function NoteColorPicker({ currentColorId, onColorChange, isDark = false, openDirection = 'down' }: NoteColorPickerProps) {
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
        <div
          className={`absolute ${openDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 p-3 z-50 w-64 modal-content-enter`}
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div className="section-header mb-2">
            Note Background
          </div>

          <div className="grid grid-cols-5 gap-1.5">
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
                  className="relative w-9 h-9 transition-all"
                  style={{
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected
                      ? '2px solid var(--accent-primary)'
                      : '1px solid var(--border-default)',
                    boxShadow: isSelected ? '0 0 0 2px var(--accent-subtle)' : 'none',
                    backgroundColor: isDefault ? 'var(--bg-inset)' : bgColor,
                  }}
                  title={color.name}
                  aria-label={color.name}
                >
                  {isSelected && (
                    <Check className="w-3 h-3 absolute inset-0 m-auto" style={{ color: 'var(--accent-primary)' }} />
                  )}
                  {isDefault && !isSelected && (
                    <span
                      className="absolute inset-0 flex items-center justify-center text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      ∅
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
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
