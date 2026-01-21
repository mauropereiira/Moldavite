/**
 * Application-wide constants
 */

// Application metadata
export const APP_NAME = 'Moldavite';
export const APP_VERSION = '1.0.0';
export const APP_DESCRIPTION = 'A local-first note-taking app for connected thinking';

// File system
export const NOTES_DIR = 'notes';
export const DAILY_NOTES_DIR = 'daily';
export const TEMPLATES_DIR = 'templates';
export const NOTE_EXTENSION = '.md';

// Default values
export const DEFAULT_AUTO_SAVE_DELAY = 500; // milliseconds
export const DEFAULT_SIDEBAR_WIDTH = 280; // pixels
export const DEFAULT_FONT_SIZE = 'medium';
export const DEFAULT_LINE_HEIGHT = 'comfortable';
export const DEFAULT_NOTE_TYPE = 'standalone';

// UI constraints
export const MIN_SIDEBAR_WIDTH = 200; // pixels
export const MAX_SIDEBAR_WIDTH = 400; // pixels
export const MIN_AUTO_SAVE_DELAY = 100; // milliseconds
export const MAX_AUTO_SAVE_DELAY = 2000; // milliseconds

// Search
export const SEARCH_DEBOUNCE_MS = 300;
export const MAX_SEARCH_RESULTS = 50;
export const SEARCH_PREVIEW_LENGTH = 60; // characters

// Templates
export const DEFAULT_DAILY_NOTE_TEMPLATE = `# {{date}}

## Notes

`;

export const DEFAULT_NOTE_TEMPLATE = `# {{title}}

`;

// Date formats
export const DAILY_NOTE_DATE_FORMAT = 'yyyy-MM-dd'; // YYYY-MM-DD
export const DISPLAY_DATE_FORMAT = 'EEEE, MMMM d, yyyy'; // Monday, January 1, 2024
export const DISPLAY_TIME_FORMAT = 'h:mm a'; // 3:30 PM

// Editor
export const EDITOR_PLACEHOLDER = 'Start writing...';
export const MAX_HEADING_LEVEL = 3;
export const WIKI_LINK_TRIGGER_CHAR = '[';
export const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g;

// Keyboard shortcuts
export const SHORTCUT_SETTINGS = 'Cmd+,';
export const SHORTCUT_NEW_NOTE = 'Cmd+N';
export const SHORTCUT_THEME_TOGGLE = 'Cmd+Shift+L';
export const SHORTCUT_TEMPLATE_PICKER = 'Cmd+T';
export const SHORTCUT_BOLD = 'Cmd+B';
export const SHORTCUT_ITALIC = 'Cmd+I';
export const SHORTCUT_UNDERLINE = 'Cmd+U';
export const SHORTCUT_LINK = 'Cmd+K';
export const SHORTCUT_HIGHLIGHT = 'Cmd+Shift+H';
export const SHORTCUT_UNDO = 'Cmd+Z';
export const SHORTCUT_REDO = 'Cmd+Shift+Z';

// Animation durations (milliseconds)
export const ANIMATION_DURATION_FAST = 150;
export const ANIMATION_DURATION_NORMAL = 200;
export const ANIMATION_DURATION_SLOW = 300;
export const SAVE_SUCCESS_DISPLAY_DURATION = 2000;

// Toast notifications
export const TOAST_DURATION_SHORT = 2000; // milliseconds
export const TOAST_DURATION_NORMAL = 3000;
export const TOAST_DURATION_LONG = 5000;

// Calendar
export const CALENDAR_EVENTS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
export const CALENDAR_DEFAULT_TIME_RANGE = 7; // days

// Validation
export const MAX_NOTE_NAME_LENGTH = 255; // characters
export const MAX_TEMPLATE_NAME_LENGTH = 100;
export const MIN_NOTE_NAME_LENGTH = 1;

// Error messages
export const ERROR_NOTE_NOT_FOUND = 'Note not found';
export const ERROR_INVALID_NOTE_NAME = 'Invalid note name';
export const ERROR_NOTE_SAVE_FAILED = 'Failed to save note';
export const ERROR_NOTE_LOAD_FAILED = 'Failed to load note';
export const ERROR_NOTE_DELETE_FAILED = 'Failed to delete note';
export const ERROR_TEMPLATE_NOT_FOUND = 'Template not found';
export const ERROR_CALENDAR_PERMISSION_DENIED = 'Calendar access denied';

// Success messages
export const SUCCESS_NOTE_CREATED = 'Note created';
export const SUCCESS_NOTE_SAVED = 'Note saved';
export const SUCCESS_NOTE_DELETED = 'Note deleted';
export const SUCCESS_TEMPLATE_SAVED = 'Template saved';
export const SUCCESS_TEMPLATE_APPLIED = 'Template applied';

// Confirmation messages
export const CONFIRM_DELETE_NOTE = 'Delete this note? This cannot be undone.';
export const CONFIRM_DELETE_ALL_NOTES = 'This will permanently delete ALL notes. This cannot be undone.';
export const CONFIRM_DELETE_TEMPLATE = 'Delete this template?';
export const CONFIRM_CREATE_MISSING_NOTE = (name: string) => `Note "${name}" doesn't exist. Create it?`;

// Local storage keys
export const STORAGE_KEY_THEME = 'theme';
export const STORAGE_KEY_SETTINGS = 'settings';
export const STORAGE_KEY_NOTES = 'notes';
export const STORAGE_KEY_CURRENT_NOTE = 'currentNote';
export const STORAGE_KEY_SELECTED_DATE = 'selectedDate';
