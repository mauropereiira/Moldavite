import React, { useState, useEffect, useRef } from 'react';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, text?: string) => void;
  initialUrl?: string;
  initialText?: string;
}

const keyboardHintStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-inset)',
  borderColor: 'var(--border-default)',
};

export function LinkModal({
  isOpen,
  onClose,
  onInsert,
  initialUrl = '',
  initialText = '',
}: LinkModalProps) {
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrl(initialUrl);
      setText(initialText);
      setError('');
      // Focus URL input when modal opens
      setTimeout(() => urlInputRef.current?.focus(), 100);
    }
  }, [isOpen, initialUrl, initialText]);

  const validateUrl = (urlString: string): boolean => {
    if (!urlString.trim()) {
      setError('URL is required');
      return false;
    }

    // Basic URL validation - allow common formats
    const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
    const isValid =
      urlPattern.test(urlString) || urlString.startsWith('/') || urlString.startsWith('#');

    if (!isValid) {
      setError('Please enter a valid URL');
      return false;
    }

    setError('');
    return true;
  };

  const handleInsert = () => {
    if (!validateUrl(url)) return;

    // Auto-add https:// if no protocol is specified
    let finalUrl = url.trim();
    if (
      !finalUrl.startsWith('http://') &&
      !finalUrl.startsWith('https://') &&
      !finalUrl.startsWith('/') &&
      !finalUrl.startsWith('#')
    ) {
      finalUrl = 'https://' + finalUrl;
    }

    onInsert(finalUrl, text.trim() || undefined);
    handleClose();
  };

  const handleClose = () => {
    setUrl('');
    setText('');
    setError('');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInsert();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-modal-title"
    >
      <div
        className="rounded-xl w-full max-w-lg mx-4 flex flex-col modal-elevated modal-content-enter"
        style={{ backgroundColor: 'var(--bg-elevated)' }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <div>
            <h2
              id="link-modal-title"
              className="text-xl font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {initialUrl ? 'Edit Link' : 'Insert Link'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded focus-ring hover:text-[var(--text-secondary)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close link modal"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* URL Input */}
          <div>
            <label
              htmlFor="link-url"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              URL <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <div>
              <input
                ref={urlInputRef}
                id="link-url"
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError('');
                }}
                placeholder="https://example.com or /page or #section"
                className={`w-full px-4 py-2 rounded-lg placeholder:text-[var(--text-muted)] focus:outline-none border ${
                  error ? 'focus:ring-2' : 'search-input-polished'
                }`}
                style={
                  {
                    color: 'var(--text-primary)',
                    backgroundColor: 'var(--bg-panel)',
                    borderColor: error ? 'var(--error)' : 'var(--border-default)',
                    '--tw-ring-color': error ? 'var(--error)' : 'var(--focus-ring)',
                  } as React.CSSProperties
                }
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'link-error' : undefined}
              />
            </div>
            {error && (
              <p id="link-error" className="mt-1 text-sm" style={{ color: 'var(--error)' }}>
                {error}
              </p>
            )}
          </div>

          {/* Text Input */}
          <div>
            <label
              htmlFor="link-text"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Display Text{' '}
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                (optional)
              </span>
            </label>
            <input
              id="link-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Leave empty to use URL as text"
              className="w-full px-4 py-2 rounded-lg placeholder:text-[var(--text-muted)] border search-input-polished focus:outline-none"
              style={{
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-panel)',
                borderColor: 'var(--border-default)',
              }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              If no text is provided, the URL will be used as the display text
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors focus-ring hover:bg-[var(--bg-inset)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleInsert}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg btn-primary-gradient btn-elevated focus-ring"
          >
            {initialUrl ? 'Update Link' : 'Insert Link'}
          </button>
        </div>

        {/* Keyboard hints */}
        <div className="px-6 pb-4">
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            Press{' '}
            <kbd
              className="px-1.5 py-0.5 text-xs font-semibold border rounded"
              style={keyboardHintStyle}
            >
              Enter
            </kbd>{' '}
            to insert or{' '}
            <kbd
              className="px-1.5 py-0.5 text-xs font-semibold border rounded"
              style={keyboardHintStyle}
            >
              Esc
            </kbd>{' '}
            to cancel
          </p>
        </div>
      </div>
    </div>
  );
}
