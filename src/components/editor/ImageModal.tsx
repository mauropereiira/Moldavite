import React, { useState, useEffect, useRef } from 'react';
import { processAndSaveImage, fileToBase64 } from '@/lib';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DialogSurface } from '@/components/ui/DialogSurface';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, alt?: string) => void;
}

type TabType = 'file' | 'url';

const keyboardHintStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-inset)',
  borderColor: 'var(--border-default)',
};

export function ImageModal({ isOpen, onClose, onInsert }: ImageModalProps) {
  const urlInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<TabType>('file');
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Validate and preview image URL
  const validateAndPreviewImage = (imageUrl: string) => {
    setIsLoading(true);
    setError('');

    // Basic URL validation
    const urlPattern = /^(https?:\/\/)|(data:image\/)/;
    if (!urlPattern.test(imageUrl)) {
      setError('URL must start with http://, https://, or be a data URL');
      setIsLoading(false);
      setPreviewUrl('');
      return;
    }

    // Try to load the image to validate it
    const img = new window.Image();
    img.onload = () => {
      setPreviewUrl(imageUrl);
      setError('');
      setIsLoading(false);
    };
    img.onerror = () => {
      setError('Unable to load image. Please check the URL.');
      setPreviewUrl('');
      setIsLoading(false);
    };
    img.src = imageUrl;
  };

  // Handle file selection
  const handleFileSelect = async (file: File) => {
    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      setError('Please select a valid image file (PNG, JPG, GIF, WebP, or SVG)');
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('Image must be smaller than 10MB');
      return;
    }

    setSelectedFile(file);
    setError('');
    setIsLoading(true);

    try {
      // Create preview from file
      const dataUrl = await fileToBase64(file);
      setPreviewUrl(dataUrl);
      setIsLoading(false);
    } catch {
      setError('Failed to read image file');
      setIsLoading(false);
    }
  };

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setAlt('');
      setError('');
      setIsLoading(false);
      setPreviewUrl('');
      setSelectedFile(null);
      setActiveTab('file');
      // Focus appropriate input when modal opens
      setTimeout(() => {
        if (activeTab === 'url') {
          urlInputRef.current?.focus();
        }
      }, 100);
    }
  }, [isOpen]);

  // Validate and preview image when URL changes
  useEffect(() => {
    if (activeTab !== 'url' || !url.trim()) {
      if (activeTab === 'url') {
        setPreviewUrl('');
        setError('');
        setIsLoading(false);
      }
      return;
    }

    const timeoutId = setTimeout(() => {
      validateAndPreviewImage(url);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [url, activeTab]);

  // Focus input when switching tabs
  useEffect(() => {
    if (activeTab === 'url') {
      setTimeout(() => urlInputRef.current?.focus(), 100);
    }
  }, [activeTab]);

  const handleInsert = async () => {
    if (activeTab === 'file') {
      if (!selectedFile) {
        setError('Please select an image file');
        return;
      }

      setIsLoading(true);
      try {
        // Resize and save image
        const savedPath = await processAndSaveImage(selectedFile);
        // Convert the file path to a URL that Tauri can serve
        const imageUrl = convertFileSrc(savedPath);
        onInsert(imageUrl, alt.trim() || undefined);
        handleClose();
      } catch (err) {
        setError(`Failed to save image: ${err}`);
        setIsLoading(false);
      }
    } else {
      if (!url.trim()) {
        setError('Image URL is required');
        return;
      }

      if (error) {
        return;
      }

      onInsert(url.trim(), alt.trim() || undefined);
      handleClose();
    }
  };

  const handleClose = () => {
    setUrl('');
    setAlt('');
    setError('');
    setIsLoading(false);
    setPreviewUrl('');
    setSelectedFile(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !error) {
      if ((activeTab === 'url' && url.trim()) || (activeTab === 'file' && selectedFile)) {
        e.preventDefault();
        handleInsert();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <DialogSurface
        onEscape={handleClose}
        aria-labelledby="image-modal-title"
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
              id="image-modal-title"
              className="text-xl font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Insert Image
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded focus-ring hover:text-[var(--text-secondary)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close image modal"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border-default)' }}>
          <button
            onClick={() => {
              setActiveTab('file');
              setError('');
              setPreviewUrl('');
            }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'file' ? 'border-b-2' : 'hover:text-[var(--text-secondary)]'
            }`}
            style={{
              color: activeTab === 'file' ? 'var(--accent-primary)' : 'var(--text-muted)',
              borderColor: activeTab === 'file' ? 'var(--accent-primary)' : 'transparent',
            }}
          >
            Upload File
          </button>
          <button
            onClick={() => {
              setActiveTab('url');
              setError('');
              setPreviewUrl('');
              setSelectedFile(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'url' ? 'border-b-2' : 'hover:text-[var(--text-secondary)]'
            }`}
            style={{
              color: activeTab === 'url' ? 'var(--accent-primary)' : 'var(--text-muted)',
              borderColor: activeTab === 'url' ? 'var(--accent-primary)' : 'transparent',
            }}
          >
            From URL
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {activeTab === 'file' ? (
            /* File Upload */
            <div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative w-full h-40 rounded-lg border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  isDragging || selectedFile
                    ? ''
                    : 'hover:border-[var(--border-strong)] hover:bg-[var(--bg-panel)]'
                }`}
                style={{
                  borderColor:
                    isDragging || selectedFile ? 'var(--accent-primary)' : 'var(--border-default)',
                  backgroundColor:
                    isDragging || selectedFile ? 'var(--accent-subtle)' : 'transparent',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  className="hidden"
                />
                {selectedFile ? (
                  <>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {selectedFile.name}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <span className="font-medium" style={{ color: 'var(--accent-primary)' }}>
                        Click to upload
                      </span>{' '}
                      or drag and drop
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      PNG, JPG, GIF, WebP, or SVG (max 10MB)
                    </p>
                  </>
                )}
              </div>
              {error && (
                <div className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
                  {error}
                </div>
              )}
            </div>
          ) : (
            /* URL Input */
            <div>
              <label
                htmlFor="image-url"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Image URL <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                ref={urlInputRef}
                id="image-url"
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError('');
                }}
                placeholder="https://example.com/image.jpg"
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
                aria-describedby={error ? 'image-error' : undefined}
              />
              {error && (
                <div id="image-error" className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Alt Text Input */}
          <div>
            <label
              htmlFor="image-alt"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Alt Text{' '}
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                (optional, but recommended)
              </span>
            </label>
            <input
              id="image-alt"
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Describe the image for accessibility"
              className="w-full px-4 py-2 rounded-lg placeholder:text-[var(--text-muted)] border search-input-polished focus:outline-none"
              style={{
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-panel)',
                borderColor: 'var(--border-default)',
              }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Alt text helps screen readers describe images to visually impaired users
            </p>
          </div>

          {/* Preview */}
          {(previewUrl || isLoading) && (
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Preview
              </label>
              <div
                className="relative w-full h-48 rounded-lg border overflow-hidden flex items-center justify-center"
                style={{
                  backgroundColor: 'var(--bg-inset)',
                  borderColor: 'var(--border-default)',
                }}
              >
                {isLoading ? (
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Loading preview…
                  </span>
                ) : previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={alt || 'Preview'}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : null}
              </div>
            </div>
          )}
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
            disabled={
              (activeTab === 'url' && (!url.trim() || !!error)) ||
              (activeTab === 'file' && !selectedFile) ||
              isLoading
            }
            className="px-4 py-2 text-sm font-medium text-white rounded-lg btn-primary-gradient btn-elevated focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Saving...' : 'Insert Image'}
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
      </DialogSurface>
    </div>
  );
}
