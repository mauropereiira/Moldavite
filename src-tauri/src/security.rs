//! In-memory brute-force throttling for password-protected note unlocks.
//!
//! Failed attempts are tracked both per note and globally. Lockouts back off
//! exponentially to a fixed cap; stale entries expire after inactivity, and a
//! successful unlock clears only the relevant note state. The tracker is process
//! local and supplements authenticated encryption rather than replacing it.

use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// Lock a mutex, recovering the guard on poisoning instead of propagating the
/// panic. A single panicking holder must not turn every later lock/unlock
/// into a permanent failure of this in-memory rate limiter.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

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

/// Time left on a lockout that has not expired, or `None` when there is none.
fn lockout_remaining(locked_until: Option<Instant>, now: Instant) -> Option<Duration> {
    locked_until
        .filter(|until| now < *until)
        .map(|until| until.duration_since(now))
}

/// The refusal an unexpired global lockout produces, if there is one.
///
/// A lockout outlives the attempt-counter reset. `MAX_LOCKOUT_SECS` is twice
/// `ATTEMPT_RESET_SECS`, so deciding on the quiet period first would let a
/// caller sit out five minutes and walk away from the remaining five.
fn global_denial(global: &GlobalAttemptInfo, now: Instant) -> Option<RateLimitResult> {
    lockout_remaining(global.locked_until, now).map(|remaining| RateLimitResult {
        allowed: false,
        retry_after_secs: Some(remaining.as_secs() + 1),
        remaining_attempts: None,
    })
}

/// Checks if an unlock attempt is allowed for the given note.
///
/// Checks both per-note and global rate limits.
pub fn check_rate_limit(note_id: &str) -> RateLimitResult {
    {
        let global = lock(&GLOBAL_TRACKER);
        if let Some(denial) = global_denial(&global, Instant::now()) {
            return denial;
        }
    }

    let mut tracker = lock(&ATTEMPT_TRACKER);

    // Clean up old entries while we have the lock
    cleanup_old_entries(&mut tracker);

    if let Some(info) = tracker.get(note_id) {
        if let Some(remaining) = lockout_remaining(info.locked_until, Instant::now()) {
            return RateLimitResult {
                allowed: false,
                retry_after_secs: Some(remaining.as_secs() + 1), // Round up
                remaining_attempts: None,
            };
        }

        let remaining = MAX_ATTEMPTS.saturating_sub(info.attempts);

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
pub fn record_failed_attempt(note_id: &str) -> RateLimitResult {
    {
        let mut global = lock(&GLOBAL_TRACKER);

        // Reset the global counter after a quiet period, but never shorten a
        // lockout that is still running.
        if global.last_attempt.elapsed() > Duration::from_secs(ATTEMPT_RESET_SECS)
            && lockout_remaining(global.locked_until, Instant::now()).is_none()
        {
            global.attempts = 0;
            global.locked_until = None;
        }

        global.attempts += 1;
        global.last_attempt = Instant::now();

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

    let mut tracker = lock(&ATTEMPT_TRACKER);

    let info = tracker
        .entry(note_id.to_string())
        .or_insert_with(AttemptInfo::new);

    // Reset attempts after a quiet period, but never shorten a lockout that is
    // still running.
    if info.last_attempt.elapsed() > Duration::from_secs(ATTEMPT_RESET_SECS)
        && lockout_remaining(info.locked_until, Instant::now()).is_none()
    {
        info.attempts = 0;
        info.locked_until = None;
    }

    info.attempts += 1;
    info.last_attempt = Instant::now();

    if info.attempts >= MAX_ATTEMPTS {
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
pub fn record_successful_attempt(note_id: &str) {
    let mut tracker = lock(&ATTEMPT_TRACKER);
    tracker.remove(note_id);
}

/// Cleans up old entries that haven't been accessed recently.
/// This prevents memory leaks from abandoned unlock attempts.
fn cleanup_old_entries(tracker: &mut HashMap<String, AttemptInfo>) {
    let cleanup_threshold = Duration::from_secs(ATTEMPT_RESET_SECS * 2);

    tracker.retain(|_, info| {
        info.locked_until
            .is_some_and(|until| Instant::now() < until)
            || info.last_attempt.elapsed() < cleanup_threshold
    });
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

        let result = record_failed_attempt(note_id);
        assert!(result.allowed);
        assert_eq!(result.remaining_attempts, Some(MAX_ATTEMPTS - 1));
    }

    #[test]
    fn test_rate_limit_locks_after_max_attempts() {
        let note_id = "test_note_3";
        record_successful_attempt(note_id); // Clear any previous state

        for _ in 0..MAX_ATTEMPTS {
            record_failed_attempt(note_id);
        }

        let result = check_rate_limit(note_id);
        assert!(!result.allowed);
        assert!(result.retry_after_secs.is_some());
    }

    #[test]
    fn test_successful_attempt_clears_history() {
        let note_id = "test_note_4";
        record_successful_attempt(note_id); // Clear any previous state

        record_failed_attempt(note_id);
        record_failed_attempt(note_id);

        record_successful_attempt(note_id);

        let result = check_rate_limit(note_id);
        assert!(result.allowed);
        assert_eq!(result.remaining_attempts, Some(MAX_ATTEMPTS));
    }

    #[test]
    fn security_regression_a_quiet_period_does_not_clear_a_running_global_lockout() {
        // Built by hand rather than through the shared tracker: planting a real
        // global lockout would deny every other test running beside this one.
        let now = Instant::now();
        let global = GlobalAttemptInfo {
            attempts: GLOBAL_MAX_ATTEMPTS,
            // Quiet for longer than the attempt-counter reset...
            last_attempt: now - Duration::from_secs(ATTEMPT_RESET_SECS + 1),
            // ...but the ten-minute lockout it earned still has half to run.
            locked_until: Some(now + Duration::from_secs(MAX_LOCKOUT_SECS / 2)),
            lockout_count: 1,
        };

        let denial = global_denial(&global, now).expect("the lockout has not expired");
        assert!(!denial.allowed);
        assert_eq!(denial.retry_after_secs, Some(MAX_LOCKOUT_SECS / 2 + 1));

        // It does stop mattering once it actually expires.
        let after = now + Duration::from_secs(MAX_LOCKOUT_SECS);
        assert!(global_denial(&global, after).is_none());
    }

    #[test]
    fn lock_recovers_from_a_poisoned_mutex() {
        // A dedicated local mutex, not the shared trackers — poisoning one of
        // those would bleed into every other test in this file.
        let mutex = Mutex::new(0i32);
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = lock(&mutex);
            panic!("simulated panic while holding the lock");
        }));
        assert!(panicked.is_err());
        assert!(mutex.is_poisoned());

        // A single panicking holder must not turn every later lock into a
        // permanent failure.
        *lock(&mutex) += 1;
        assert_eq!(*lock(&mutex), 1);
    }
}
