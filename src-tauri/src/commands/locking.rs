//! Note locking/unlocking commands (AES-256-GCM based).

use std::fs;
use zeroize::Zeroizing;

use crate::encryption;
use crate::paths::{get_daily_dir, get_standalone_dir, get_weekly_dir};
use crate::security;
use crate::validation::is_safe_filename;

/// Lock a note by encrypting it with a password
#[tauri::command]
pub(crate) fn lock_note(filename: String, password: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    // Zeroize the password buffer when this function returns.
    let password = Zeroizing::new(password);
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let original_path = dir.join(&filename);
    let locked_path = dir.join(format!("{}.locked", filename));

    // Check if original file exists
    if !original_path.exists() {
        return Err("Note not found".to_string());
    }

    // Check if already locked
    if locked_path.exists() {
        return Err("Note is already locked".to_string());
    }

    // Read the original content
    let content = fs::read_to_string(&original_path)
        .map_err(|e| format!("Failed to read note: {}", e))?;

    // Encrypt the content
    let encrypted = encryption::encrypt_content(&content, &password)?;

    // Write the encrypted content to the new file
    fs::write(&locked_path, encrypted)
        .map_err(|e| format!("Failed to write locked note: {}", e))?;

    // Set restrictive permissions on the locked file
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&locked_path, permissions).ok();
    }

    // Delete the original unencrypted file
    fs::remove_file(&original_path)
        .map_err(|e| format!("Failed to remove original note: {}", e))?;

    Ok(())
}

/// Unlock a note temporarily to view it (returns decrypted content without saving)
/// Includes brute-force protection with rate limiting.
#[tauri::command]
pub(crate) fn unlock_note(filename: String, password: String, is_daily: bool, is_weekly: bool) -> Result<String, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    let password = Zeroizing::new(password);
    // Create a unique identifier for this note
    let note_id = format!("{}:{}:{}", if is_weekly { "weekly" } else if is_daily { "daily" } else { "standalone" }, filename, "");

    // Check rate limit before attempting
    let rate_check = security::check_rate_limit(&note_id);
    if !rate_check.allowed {
        let secs = rate_check.retry_after_secs.unwrap_or(30);
        return Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs));
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let locked_path = dir.join(format!("{}.locked", filename));

    // Check if locked file exists
    if !locked_path.exists() {
        return Err("Locked note not found".to_string());
    }

    // Read the encrypted content
    let encrypted = fs::read_to_string(&locked_path)
        .map_err(|e| format!("Failed to read locked note: {}", e))?;

    // Attempt to decrypt
    match encryption::decrypt_content(&encrypted, &password) {
        Ok(content) => {
            // Success - clear the attempt history
            security::record_successful_attempt(&note_id);
            Ok(content)
        }
        Err(_) => {
            // Failed - record the attempt and return error with remaining attempts
            let result = security::record_failed_attempt(&note_id);
            if !result.allowed {
                let secs = result.retry_after_secs.unwrap_or(30);
                Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs))
            } else {
                let remaining = result.remaining_attempts.unwrap_or(0);
                Err(format!("WRONG_PASSWORD:{}:Incorrect password. {} attempts remaining.", remaining, remaining))
            }
        }
    }
}

/// Permanently unlock a note (decrypt and save as regular .md file)
/// Includes brute-force protection with rate limiting.
#[tauri::command]
pub(crate) fn permanently_unlock_note(filename: String, password: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    let password = Zeroizing::new(password);
    // Create a unique identifier for this note (same as unlock_note)
    let note_id = format!("{}:{}:{}", if is_weekly { "weekly" } else if is_daily { "daily" } else { "standalone" }, filename, "");

    // Check rate limit before attempting
    let rate_check = security::check_rate_limit(&note_id);
    if !rate_check.allowed {
        let secs = rate_check.retry_after_secs.unwrap_or(30);
        return Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs));
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let locked_path = dir.join(format!("{}.locked", filename));
    let original_path = dir.join(&filename);

    // Check if locked file exists
    if !locked_path.exists() {
        return Err("Locked note not found".to_string());
    }

    // Read the encrypted content
    let encrypted = fs::read_to_string(&locked_path)
        .map_err(|e| format!("Failed to read locked note: {}", e))?;

    // Attempt to decrypt the content
    let decrypted = match encryption::decrypt_content(&encrypted, &password) {
        Ok(content) => {
            // Success - clear the attempt history
            security::record_successful_attempt(&note_id);
            content
        }
        Err(_) => {
            // Failed - record the attempt and return error with remaining attempts
            let result = security::record_failed_attempt(&note_id);
            if !result.allowed {
                let secs = result.retry_after_secs.unwrap_or(30);
                return Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs));
            } else {
                let remaining = result.remaining_attempts.unwrap_or(0);
                return Err(format!("WRONG_PASSWORD:{}:Incorrect password. {} attempts remaining.", remaining, remaining));
            }
        }
    };

    // Write the decrypted content to the original path
    fs::write(&original_path, &decrypted)
        .map_err(|e| format!("Failed to write unlocked note: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&original_path, permissions).ok();
    }

    // Delete the locked file
    fs::remove_file(&locked_path)
        .map_err(|e| format!("Failed to remove locked note: {}", e))?;

    Ok(())
}

/// Check if a note is locked
#[tauri::command]
pub(crate) fn is_note_locked(filename: String, is_daily: bool, is_weekly: bool) -> bool {
    if !is_safe_filename(&filename) {
        return false;
    }
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let locked_path = dir.join(format!("{}.locked", filename));
    locked_path.exists()
}
