//! Security utilities for Notomattic
//!
//! This module provides brute-force protection through rate limiting
//! for note unlock attempts.

use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Maximum number of failed attempts before lockout (per note)
const MAX_ATTEMPTS: u32 = 5;

/// Maximum number of failed attempts globally before lockout
const GLOBAL_MAX_ATTEMPTS: u32 = 15;

/// Base lockout duration in seconds (doubles with each lockout)
const BASE_LOCKOUT_SECS: u64 = 30;

/// Maximum lockout duration (10 minutes)
const MAX_LOCKOUT_SECS: u64 = 600;

/// Time after which attempt counter resets (if no new attempts)
const ATTEMPT_RESET_SECS: u64 = 300; // 5 minutes

/// Global attempt tracking info
#[derive(Debug)]
struct GlobalAttemptInfo {
    /// Total failed attempts across all notes
    attempts: u32,
    /// Timestamp of the last attempt
    last_attempt: Instant,
    /// If locked out globally, when the lockout expires
    locked_until: Option<Instant>,
    /// Number of global lockouts (for exponential backoff)
    lockout_count: u32,
}

/// Information about unlock attempts for a specific note
#[derive(Debug, Clone)]
struct AttemptInfo {
    /// Number of failed attempts
    attempts: u32,
    /// Timestamp of the last attempt
    last_attempt: Instant,
    /// If locked out, when the lockout expires
    locked_until: Option<Instant>,
    /// Number of times this note has been locked out (for exponential backoff)
    lockout_count: u32,
}

impl AttemptInfo {
    fn new() -> Self {
        Self {
            attempts: 0,
            last_attempt: Instant::now(),
            locked_until: None,
            lockout_count: 0,
        }
    }
}

lazy_static! {
    /// Per-note attempt tracker - maps note identifiers to their attempt info
    static ref ATTEMPT_TRACKER: Mutex<HashMap<String, AttemptInfo>> = Mutex::new(HashMap::new());

    /// Global attempt tracker - limits total attempts across all notes
    static ref GLOBAL_TRACKER: Mutex<GlobalAttemptInfo> = Mutex::new(GlobalAttemptInfo {
        attempts: 0,
        last_attempt: Instant::now(),
        locked_until: None,
        lockout_count: 0,
    });
}

/// Result of a rate limit check
#[derive(Debug)]
pub struct RateLimitResult {
    /// Whether the action is allowed
    pub allowed: bool,
    /// If not allowed, seconds until lockout expires
    pub retry_after_secs: Option<u64>,
    /// Number of remaining attempts before lockout (if not locked)
    pub remaining_attempts: Option<u32>,
}

/// Checks if an unlock attempt is allowed for the given note.
///
/// Checks both per-note and global rate limits.
///
/// # Arguments
/// * `note_id` - Unique identifier for the note (e.g., filename)
///
/// # Returns
/// A `RateLimitResult` indicating whether the attempt is allowed
pub fn check_rate_limit(note_id: &str) -> RateLimitResult {
    // First check global rate limit
    {
        let global = GLOBAL_TRACKER.lock().unwrap();

        // Reset global counter if it's been a while
        if global.last_attempt.elapsed() > Duration::from_secs(ATTEMPT_RESET_SECS) {
            // Will be reset on next failed attempt
        } else if let Some(locked_until) = global.locked_until {
            if Instant::now() < locked_until {
                let remaining = locked_until.duration_since(Instant::now());
                return RateLimitResult {
                    allowed: false,
                    retry_after_secs: Some(remaining.as_secs() + 1),
                    remaining_attempts: None,
                };
            }
        }
    }

    // Then check per-note rate limit
    let mut tracker = ATTEMPT_TRACKER.lock().unwrap();

    // Clean up old entries while we have the lock
    cleanup_old_entries(&mut tracker);

    if let Some(info) = tracker.get(note_id) {
        // Check if currently locked out
        if let Some(locked_until) = info.locked_until {
            if Instant::now() < locked_until {
                let remaining = locked_until.duration_since(Instant::now());
                return RateLimitResult {
                    allowed: false,
                    retry_after_secs: Some(remaining.as_secs() + 1), // Round up
                    remaining_attempts: None,
                };
            }
        }

        // Not locked out, return remaining attempts
        let remaining = if info.attempts >= MAX_ATTEMPTS {
            0
        } else {
            MAX_ATTEMPTS - info.attempts
        };

        RateLimitResult {
            allowed: true,
            retry_after_secs: None,
            remaining_attempts: Some(remaining),
        }
    } else {
        // No previous attempts
        RateLimitResult {
            allowed: true,
            retry_after_secs: None,
            remaining_attempts: Some(MAX_ATTEMPTS),
        }
    }
}

/// Records a failed unlock attempt for the given note.
///
/// If the maximum number of attempts is exceeded (per-note or globally),
/// a lockout is triggered.
///
/// # Arguments
/// * `note_id` - Unique identifier for the note
///
/// # Returns
/// A `RateLimitResult` with the current state after recording the failure
pub fn record_failed_attempt(note_id: &str) -> RateLimitResult {
    // Update global tracker first
    {
        let mut global = GLOBAL_TRACKER.lock().unwrap();

        // Reset global counter if it's been a while
        if global.last_attempt.elapsed() > Duration::from_secs(ATTEMPT_RESET_SECS) {
            global.attempts = 0;
            global.locked_until = None;
        }

        global.attempts += 1;
        global.last_attempt = Instant::now();

        // Check if we need to trigger a global lockout
        if global.attempts >= GLOBAL_MAX_ATTEMPTS {
            let lockout_multiplier = 2u64.pow(global.lockout_count);
            let lockout_secs = (BASE_LOCKOUT_SECS * lockout_multiplier).min(MAX_LOCKOUT_SECS);

            global.locked_until = Some(Instant::now() + Duration::from_secs(lockout_secs));
            global.lockout_count += 1;

            return RateLimitResult {
                allowed: false,
                retry_after_secs: Some(lockout_secs),
                remaining_attempts: Some(0),
            };
        }
    }

    // Then update per-note tracker
    let mut tracker = ATTEMPT_TRACKER.lock().unwrap();

    let info = tracker.entry(note_id.to_string()).or_insert_with(AttemptInfo::new);

    // Reset attempts if it's been a while since last attempt
    if info.last_attempt.elapsed() > Duration::from_secs(ATTEMPT_RESET_SECS) {
        info.attempts = 0;
        info.locked_until = None;
    }

    // Increment attempts
    info.attempts += 1;
    info.last_attempt = Instant::now();

    // Check if we need to trigger a per-note lockout
    if info.attempts >= MAX_ATTEMPTS {
        // Calculate lockout duration with exponential backoff
        let lockout_multiplier = 2u64.pow(info.lockout_count);
        let lockout_secs = (BASE_LOCKOUT_SECS * lockout_multiplier).min(MAX_LOCKOUT_SECS);

        info.locked_until = Some(Instant::now() + Duration::from_secs(lockout_secs));
        info.lockout_count += 1;

        return RateLimitResult {
            allowed: false,
            retry_after_secs: Some(lockout_secs),
            remaining_attempts: Some(0),
        };
    }

    RateLimitResult {
        allowed: true,
        retry_after_secs: None,
        remaining_attempts: Some(MAX_ATTEMPTS - info.attempts),
    }
}

/// Records a successful unlock attempt, clearing the attempt history.
///
/// # Arguments
/// * `note_id` - Unique identifier for the note
pub fn record_successful_attempt(note_id: &str) {
    let mut tracker = ATTEMPT_TRACKER.lock().unwrap();
    tracker.remove(note_id);
}

/// Cleans up old entries that haven't been accessed recently.
/// This prevents memory leaks from abandoned unlock attempts.
fn cleanup_old_entries(tracker: &mut HashMap<String, AttemptInfo>) {
    let cleanup_threshold = Duration::from_secs(ATTEMPT_RESET_SECS * 2);

    tracker.retain(|_, info| {
        // Keep entries that are currently locked out or were recently accessed
        info.locked_until.map_or(false, |until| Instant::now() < until)
            || info.last_attempt.elapsed() < cleanup_threshold
    });
}

/// Gets the current status for a note (for UI display).
///
/// # Arguments
/// * `note_id` - Unique identifier for the note
///
/// # Returns
/// A tuple of (remaining_attempts, locked_for_secs) where locked_for_secs is None if not locked
pub fn get_attempt_status(note_id: &str) -> (u32, Option<u64>) {
    let tracker = ATTEMPT_TRACKER.lock().unwrap();

    if let Some(info) = tracker.get(note_id) {
        let locked_for = info.locked_until.and_then(|until| {
            if Instant::now() < until {
                Some(until.duration_since(Instant::now()).as_secs() + 1)
            } else {
                None
            }
        });

        let remaining = if info.attempts >= MAX_ATTEMPTS {
            0
        } else {
            MAX_ATTEMPTS - info.attempts
        };

        (remaining, locked_for)
    } else {
        (MAX_ATTEMPTS, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limit_allows_initial_attempts() {
        let note_id = "test_note_1";
        record_successful_attempt(note_id); // Clear any previous state

        let result = check_rate_limit(note_id);
        assert!(result.allowed);
        assert_eq!(result.remaining_attempts, Some(MAX_ATTEMPTS));
    }

    #[test]
    fn test_rate_limit_decrements_attempts() {
        let note_id = "test_note_2";
        record_successful_attempt(note_id); // Clear any previous state

        // Record a failed attempt
        let result = record_failed_attempt(note_id);
        assert!(result.allowed);
        assert_eq!(result.remaining_attempts, Some(MAX_ATTEMPTS - 1));
    }

    #[test]
    fn test_rate_limit_locks_after_max_attempts() {
        let note_id = "test_note_3";
        record_successful_attempt(note_id); // Clear any previous state

        // Exhaust all attempts
        for _ in 0..MAX_ATTEMPTS {
            record_failed_attempt(note_id);
        }

        // Should now be locked
        let result = check_rate_limit(note_id);
        assert!(!result.allowed);
        assert!(result.retry_after_secs.is_some());
    }

    #[test]
    fn test_successful_attempt_clears_history() {
        let note_id = "test_note_4";
        record_successful_attempt(note_id); // Clear any previous state

        // Record some failed attempts
        record_failed_attempt(note_id);
        record_failed_attempt(note_id);

        // Clear with successful attempt
        record_successful_attempt(note_id);

        // Should be back to full attempts
        let result = check_rate_limit(note_id);
        assert!(result.allowed);
        assert_eq!(result.remaining_attempts, Some(MAX_ATTEMPTS));
    }
}
