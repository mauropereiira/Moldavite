//! Note encryption/locking operations
//!
//! This module handles encryption-related Tauri commands including:
//! - Locking notes with a password
//! - Unlocking notes for viewing (with rate limiting)
//! - Permanently unlocking notes
//! - Checking lock status
//!
//! # Security
//! - Uses AES-256-GCM for encryption
//! - Uses Argon2 for key derivation
//! - Rate limiting prevents brute force attacks (5 attempts, then exponential backoff)
//! - Passwords are zeroized from memory after use

// The actual encryption logic is in the encryption.rs module at the crate root
// Rate limiting is handled by the security.rs module

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module is a placeholder for the encryption commands.
//
// Commands to be migrated here:
// - lock_note
// - unlock_note
// - permanently_unlock_note
// - is_note_locked
//
// These commands use:
// - crate::encryption module for AES-256-GCM operations
// - crate::security module for rate limiting
