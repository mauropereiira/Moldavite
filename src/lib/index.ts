/**
 * Library utilities for Notomattic
 *
 * This module re-exports all library utilities for convenient imports:
 *
 * ```tsx
 * import { readNote, writeNote, markdownToHtml } from '@/lib';
 * ```
 *
 * ## Modules
 *
 * - `fileSystem` - File operations (notes, folders, encryption)
 * - `templates` - Template management utilities
 * - `validation` - Input validation and password strength
 * - `constants` - Application constants
 * - `tags` - Tag parsing and management
 *
 * @module lib
 */

export * from './fileSystem';
export * from './templates';
export * from './validation';
export * from './constants';
export * from './tags';
