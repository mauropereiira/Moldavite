/**
 * Frontend validation and presentation helpers for user-entered values.
 * These checks improve immediate feedback but are not a filesystem or network
 * security boundary; Rust commands and the plugin host must revalidate every
 * value before privileged work.
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
  const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
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

/** Maximum length for note titles */
export const MAX_NOTE_TITLE_LENGTH = 100;

/** Pattern for valid note titles: letters, numbers, spaces, hyphens only */
const VALID_NOTE_TITLE_PATTERN = /^[a-zA-Z0-9 -]+$/;

/** Maximum portable length for one folder path component */
export const MAX_FOLDER_NAME_LENGTH = 180;

function hasWindowsIllegalFilenameCharacter(name: string): boolean {
  return [...name].some(
    (character) => character.charCodeAt(0) <= 0x1f || '/\\:*?"<>|'.includes(character)
  );
}

/**
 * Windows reserves device names before the first extension. Apply this on
 * every platform so a synced Forge remains usable on Windows.
 */
function isWindowsReservedName(name: string): boolean {
  const stem = name.split('.', 1)[0].toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

/**
 * Validates a note name (strict mode - matches backend filename generation)
 * Only allows letters, numbers, spaces, and hyphens.
 * @param name - The note name to validate
 * @returns True if the note name is valid
 */
export function isValidNoteName(name: string): boolean {
  return getNoteTitleError(name) === null;
}

/**
 * Gets a specific error message for an invalid note title.
 * Returns null if the title is valid.
 * @param name - The note name to validate
 * @returns Error message string or null if valid
 */
export function getNoteTitleError(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) {
    return 'Note title cannot be empty';
  }

  if (trimmed.length > MAX_NOTE_TITLE_LENGTH) {
    return `Title must be ${MAX_NOTE_TITLE_LENGTH} characters or less`;
  }

  if (trimmed.includes('..')) {
    return 'Title cannot contain ".."';
  }

  if (isWindowsReservedName(trimmed)) {
    return 'Title cannot use a Windows reserved name';
  }

  if (!VALID_NOTE_TITLE_PATTERN.test(trimmed)) {
    return 'Title can only contain letters, numbers, spaces, and hyphens';
  }

  return null;
}

/**
 * Gets a specific error for a new folder name. Existing on-disk folder names
 * are not passed through this validator so legacy macOS names remain visible.
 */
export function getFolderNameError(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) {
    return 'Folder name cannot be empty';
  }

  if ([...trimmed].length > MAX_FOLDER_NAME_LENGTH) {
    return `Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or less`;
  }

  if (isWindowsReservedName(trimmed)) {
    return 'Folder name is reserved by Windows';
  }

  if (trimmed.endsWith('.')) {
    return 'Folder name cannot end with a dot';
  }

  if (trimmed.startsWith('.')) {
    return 'Folder name cannot start with a dot';
  }

  if (trimmed.includes('..')) {
    return 'Folder name cannot contain ".."';
  }

  if (hasWindowsIllegalFilenameCharacter(trimmed)) {
    return 'Folder name contains characters that Windows does not allow';
  }

  return null;
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

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(dateString);
  return (
    !isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
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
 * Checks if note content is effectively empty by stripping HTML tags.
 * This is used to determine whether to save or delete auto-created notes (daily/weekly).
 * @param content - The HTML content to check
 * @returns True if content contains no meaningful text
 */
export function isContentEmpty(content: string): boolean {
  if (!content) return true;

  // Embedded media counts as content even though it has no text — an
  // image-only daily note must never be treated as empty (and deleted).
  if (/<(img|video|audio|iframe)[\s/>]/i.test(content)) return false;

  // Remove HTML tags and check if anything remains
  const textOnly = content
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
    .trim();

  return textOnly === '';
}

/**
 * Sanitizes a note name for use as a filename
 * @param name - The note name to sanitize
 * @returns A sanitized filename-safe string
 */
export function sanitizeNoteName(name: string): string {
  return name
    .trim()
    .replace(/[/\\:*?"<>|]/g, '-')
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

/**
 * Password strength levels
 */
export type PasswordStrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

/**
 * Result of password strength check
 */
export interface PasswordStrength {
  /** Numerical score from 0-4 */
  score: 0 | 1 | 2 | 3 | 4;
  /** Human-readable strength level */
  level: PasswordStrengthLevel;
  /** Feedback message for the user */
  feedback: string;
  /** Whether the password meets minimum requirements */
  isAcceptable: boolean;
  /** Specific suggestions for improvement */
  suggestions: string[];
}

/**
 * Checks the strength of a password.
 * Based on OWASP and NIST guidelines for password security.
 *
 * @param password - The password to check
 * @returns Password strength information
 */
export function checkPasswordStrength(password: string): PasswordStrength {
  const suggestions: string[] = [];
  let score = 0;

  // Length checks (most important factor per NIST)
  if (password.length >= 8) {
    score++;
  } else {
    suggestions.push('Use at least 8 characters');
  }

  if (password.length >= 12) {
    score++;
  } else if (password.length >= 8) {
    suggestions.push('Consider using 12+ characters for better security');
  }

  // Character variety checks
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password);

  if (hasLowercase && hasUppercase) {
    score++;
  } else if (!hasLowercase || !hasUppercase) {
    suggestions.push('Mix uppercase and lowercase letters');
  }

  if (hasNumbers) {
    score += 0.5;
  } else {
    suggestions.push('Include at least one number');
  }

  if (hasSpecial) {
    score += 0.5;
  } else {
    suggestions.push('Include a special character (!@#$%...)');
  }

  // Check for common patterns (weak passwords)
  const commonPatterns = [
    /^(password|123456|qwerty|abc123|letmein|welcome|admin|login)/i,
    /^(.)\1+$/, // All same character
    /^(12345|123456|1234567|12345678)/,
    /^(abcdef|qwerty|asdfgh)/i,
  ];

  const hasCommonPattern = commonPatterns.some((pattern) => pattern.test(password));
  if (hasCommonPattern) {
    score = Math.max(0, score - 2);
    suggestions.unshift('Avoid common passwords and patterns');
  }

  // Normalize score to 0-4 range
  const normalizedScore = Math.min(4, Math.max(0, Math.round(score))) as 0 | 1 | 2 | 3 | 4;

  // Determine level and feedback
  let level: PasswordStrengthLevel;
  let feedback: string;

  switch (normalizedScore) {
    case 0:
      level = 'weak';
      feedback = 'Very weak password';
      break;
    case 1:
      level = 'weak';
      feedback = 'Weak password';
      break;
    case 2:
      level = 'fair';
      feedback = 'Fair password';
      break;
    case 3:
      level = 'good';
      feedback = 'Good password';
      break;
    case 4:
      level = 'strong';
      feedback = 'Strong password';
      break;
    default:
      level = 'weak';
      feedback = 'Weak password';
  }

  // Password is acceptable if score >= 2 and length >= 8
  const isAcceptable = normalizedScore >= 2 && password.length >= 8;

  return {
    score: normalizedScore,
    level,
    feedback,
    isAcceptable,
    suggestions: suggestions.slice(0, 3), // Max 3 suggestions
  };
}
