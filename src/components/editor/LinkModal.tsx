import React, { useState, useEffect, useRef } from 'react';
import { X, Link2, ExternalLink } from 'lucide-react';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, text?: string) => void;
  initialUrl?: string;
  initialText?: string;
}

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
    const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    const isValid = urlPattern.test(urlString) || urlString.startsWith('/') || urlString.startsWith('#');

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
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('/') && !finalUrl.startsWith('#')) {
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
        className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg mx-4 flex flex-col modal-elevated modal-content-enter"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-500 dark:text-blue-400" />
            <h2 id="link-modal-title" className="text-xl font-semibold text-gray-900 dark:text-white">
              {initialUrl ? 'Edit Link' : 'Insert Link'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded focus-ring"
            aria-label="Close link modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* URL Input */}
          <div>
            <label
              htmlFor="link-url"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              URL <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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
                className={`w-full pl-9 pr-4 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none border ${
                  error
                    ? 'border-red-300 dark:border-red-600 focus:ring-2 focus:ring-red-500'
                    : 'border-gray-200 dark:border-gray-600 search-input-polished'
                }`}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'link-error' : undefined}
              />
            </div>
            {error && (
              <p id="link-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>

          {/* Text Input */}
          <div>
            <label
              htmlFor="link-text"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Display Text <span className="text-xs text-gray-500">(optional)</span>
            </label>
            <input
              id="link-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Leave empty to use URL as text"
              className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-600 search-input-polished focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              If no text is provided, the URL will be used as the display text
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors focus-ring"
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
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Press <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">Enter</kbd> to insert or{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">Esc</kbd> to cancel
          </p>
        </div>
      </div>
    </div>
  );
}
