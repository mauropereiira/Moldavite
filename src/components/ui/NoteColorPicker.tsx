import { useState, useRef, useEffect } from 'react';
import { Palette, Check } from 'lucide-react';

// Graphite-inspired muted color palette - desaturated, industrial aesthetic
export const NOTE_COLORS = [
  { id: 'default', name: 'Default', light: 'transparent', dark: 'transparent' },
  // Warm graphite tones
  { id: 'warm', name: 'Warm', light: '#f8f6f2', dark: '#2a2826' },
  { id: 'sand', name: 'Sand', light: '#f5f0e8', dark: '#2c2820' },
  { id: 'clay', name: 'Clay', light: '#f2ebe4', dark: '#2e2a24' },
  { id: 'terracotta', name: 'Terracotta', light: '#f0e8e4', dark: '#302826' },
  // Cool steel tones
  { id: 'steel', name: 'Steel', light: '#f0f2f4', dark: '#262a2c' },
  { id: 'slate', name: 'Slate', light: '#eef0f2', dark: '#24282a' },
  { id: 'mist', name: 'Mist', light: '#ecf0f4', dark: '#222a30' },
  { id: 'ice', name: 'Ice', light: '#e8f0f4', dark: '#202c32' },
  { id: 'sky', name: 'Sky', light: '#e4eef4', dark: '#1e2c36' },
  // Muted accent tones
  { id: 'sage', name: 'Sage', light: '#e8f0ea', dark: '#222a24' },
  { id: 'olive', name: 'Olive', light: '#eaefe6', dark: '#262a22' },
  { id: 'rose', name: 'Rose', light: '#f4eaec', dark: '#2c2426' },
  { id: 'lavender', name: 'Lavender', light: '#eee8f2', dark: '#28242c' },
  { id: 'storm', name: 'Storm', light: '#e6e8ea', dark: '#2a2c2e' },
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
