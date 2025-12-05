/**
 * Validation utilities for user input and data validation
 */

/**
 * Validates a URL string
 * @param url - The URL to validate
 * @returns True if the URL is valid
 */
export function isValidUrl(url: string): boolean {
  if (!url.trim()) {
    return false;
  }

  // Allow relative URLs, anchors, and full URLs
  if (url.startsWith('/') || url.startsWith('#')) {
    return true;
  }

  // Validate full URLs
  const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
  return urlPattern.test(url);
}

/**
 * Validates an image URL
 * @param url - The image URL to validate
 * @returns True if the URL appears to be a valid image URL
 */
export function isValidImageUrl(url: string): boolean {
  if (!url.trim()) {
    return false;
  }

  // Allow data URLs for base64 images
  if (url.startsWith('data:image/')) {
    return true;
  }

  // Validate HTTP(S) URLs
  const urlPattern = /^https?:\/\//;
  return urlPattern.test(url);
}

/**
 * Validates a note name
 * @param name - The note name to validate
 * @returns True if the note name is valid
 */
export function isValidNoteName(name: string): boolean {
  const trimmed = name.trim();

  if (!trimmed) {
    return false;
  }

  // Disallow path separators and special characters that could cause file system issues
  const invalidChars = /[\/\\:*?"<>|]/;
  return !invalidChars.test(trimmed);
}

/**
 * Validates a template name
 * @param name - The template name to validate
 * @returns True if the template name is valid
 */
export function isValidTemplateName(name: string): boolean {
  return isValidNoteName(name);
}

/**
 * Validates a date string in YYYY-MM-DD format
 * @param dateString - The date string to validate
 * @returns True if the date string is valid
 */
export function isValidDateString(dateString: string): boolean {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!pattern.test(dateString)) {
    return false;
  }

  // Verify it's a valid date
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Validates HTML content is not empty
 * @param html - The HTML string to validate
 * @returns True if the HTML contains actual content
 */
export function hasContent(html: string): boolean {
  if (!html) {
    return false;
  }

  // Strip HTML tags and check if there's text
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

  return text.length > 0;
}

/**
 * Sanitizes a note name for use as a filename
 * @param name - The note name to sanitize
 * @returns A sanitized filename-safe string
 */
export function sanitizeNoteName(name: string): string {
  return name
    .trim()
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .substring(0, 255); // Max filename length on most systems
}

/**
 * Validates an email address
 * @param email - The email to validate
 * @returns True if the email is valid
 */
export function isValidEmail(email: string): boolean {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

/**
 * Checks if a string is empty or only whitespace
 * @param str - The string to check
 * @returns True if the string is empty or whitespace only
 */
export function isEmpty(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0;
}

/**
 * Validates a file extension
 * @param filename - The filename to check
 * @param allowedExtensions - Array of allowed extensions (e.g., ['.md', '.txt'])
 * @returns True if the file has an allowed extension
 */
export function hasValidExtension(filename: string, allowedExtensions: string[]): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return allowedExtensions.includes(ext);
}
