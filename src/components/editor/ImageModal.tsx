import React, { useState, useEffect, useRef } from 'react';
import { X, Image as ImageIcon, AlertCircle, Loader, Upload, Link as LinkIcon } from 'lucide-react';
import { processAndSaveImage, fileToBase64 } from '@/lib';
import { convertFileSrc } from '@tauri-apps/api/core';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, alt?: string) => void;
}

type TabType = 'file' | 'url';

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
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter' && !e.shiftKey && !error) {
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-modal-title"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg mx-4 flex flex-col modal-elevated modal-content-enter"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 id="image-modal-title" className="text-xl font-semibold text-gray-900 dark:text-white">
              Insert Image
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded focus-ring"
            aria-label="Close image modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => { setActiveTab('file'); setError(''); setPreviewUrl(''); }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'file'
                ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload File
          </button>
          <button
            onClick={() => { setActiveTab('url'); setError(''); setPreviewUrl(''); setSelectedFile(null); }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'url'
                ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <LinkIcon className="w-4 h-4" />
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
                  isDragging
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)]'
                    : selectedFile
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)]'
                    : 'border-gray-300 dark:border-gray-600 hover:border-[var(--accent-primary)] hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
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
                    <ImageIcon className="w-8 h-8" style={{ color: 'var(--accent-primary)' }} />
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium" style={{ color: 'var(--accent-primary)' }}>Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      PNG, JPG, GIF, WebP, or SVG (max 10MB)
                    </p>
                  </>
                )}
              </div>
              {error && (
                <div className="mt-2 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          ) : (
            /* URL Input */
            <div>
              <label
                htmlFor="image-url"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Image URL <span className="text-red-500">*</span>
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
                className={`w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none border ${
                  error
                    ? 'border-red-300 dark:border-red-600 focus:ring-2 focus:ring-red-500'
                    : 'border-gray-200 dark:border-gray-600 search-input-polished'
                }`}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'image-error' : undefined}
              />
              {error && (
                <div id="image-error" className="mt-2 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          {/* Alt Text Input */}
          <div>
            <label
              htmlFor="image-alt"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Alt Text <span className="text-xs text-gray-500">(optional, but recommended)</span>
            </label>
            <input
              id="image-alt"
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Describe the image for accessibility"
              className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-600 search-input-polished focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Alt text helps screen readers describe images to visually impaired users
            </p>
          </div>

          {/* Preview */}
          {(previewUrl || isLoading) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Preview
              </label>
              <div className="relative w-full h-48 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 overflow-hidden flex items-center justify-center">
                {isLoading ? (
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <Loader className="w-6 h-6 animate-spin" />
                    <span className="text-sm">Loading preview...</span>
                  </div>
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
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors focus-ring"
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
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Press <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">Enter</kbd> to insert or{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">Esc</kbd> to cancel
          </p>
        </div>
      </div>
    </div>
  );
}
