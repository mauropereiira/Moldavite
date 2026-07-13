import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Lock, Unlock, Eye, EyeOff, AlertCircle, Clock } from 'lucide-react';
import { checkPasswordStrength, type PasswordStrength } from '@/lib/validation';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  mode: 'lock' | 'unlock' | 'permanent-unlock';
  noteTitle: string;
}

interface ErrorInfo {
  type: 'rate_limited' | 'wrong_password' | 'generic';
  message: string;
  value?: number; // remaining attempts or lockout seconds
}

export function PasswordModal({ isOpen, onClose, onSubmit, mode, noteTitle }: PasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Calculate password strength for lock mode
  const passwordStrength: PasswordStrength | null = useMemo(() => {
    if (mode !== 'lock' || !password) return null;
    return checkPasswordStrength(password);
  }, [mode, password]);

  // Parse error message from backend
  const parseError = useCallback((errorMessage: string): ErrorInfo => {
    // Format: TYPE:VALUE:MESSAGE
    // e.g., "RATE_LIMITED:30:Too many failed attempts..."
    // or "WRONG_PASSWORD:4:Incorrect password. 4 attempts remaining."
    const parts = errorMessage.split(':');
    if (parts.length >= 3) {
      const type = parts[0];
      const value = parseInt(parts[1], 10);
      const message = parts.slice(2).join(':');

      if (type === 'RATE_LIMITED') {
        return { type: 'rate_limited', message, value };
      } else if (type === 'WRONG_PASSWORD') {
        return { type: 'wrong_password', message, value };
      }
    }
    return { type: 'generic', message: errorMessage };
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (lockoutSeconds === null || lockoutSeconds <= 0) {
      setLockoutSeconds(null);
      return;
    }

    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev === null || prev <= 1) {
          setErrorInfo(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setErrorInfo(null);
      setIsSubmitting(false);
      setLockoutSeconds(null);
      // Focus the input when modal opens
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorInfo(null);

    // Don't allow submit if locked out
    if (lockoutSeconds !== null && lockoutSeconds > 0) {
      return;
    }

    // Validation
    if (!password) {
      setErrorInfo({ type: 'generic', message: 'Password is required' });
      return;
    }

    // For lock mode, enforce stronger password requirements
    if (mode === 'lock') {
      if (password.length < 8) {
        setErrorInfo({
          type: 'generic',
          message: 'Password must be at least 8 characters for locking notes',
        });
        return;
      }

      if (passwordStrength && !passwordStrength.isAcceptable) {
        setErrorInfo({
          type: 'generic',
          message: 'Password is too weak. Please choose a stronger password.',
        });
        return;
      }

      if (password !== confirmPassword) {
        setErrorInfo({ type: 'generic', message: 'Passwords do not match' });
        return;
      }
    } else {
      // For unlock modes, just require minimum length
      if (password.length < 4) {
        setErrorInfo({ type: 'generic', message: 'Password must be at least 4 characters' });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onSubmit(password);
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Operation failed';
      const parsed = parseError(errorMessage);
      setErrorInfo(parsed);

      // Start lockout countdown if rate limited
      if (parsed.type === 'rate_limited' && parsed.value) {
        setLockoutSeconds(parsed.value);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const titles = {
    lock: 'Lock Note',
    unlock: 'Unlock Note',
    'permanent-unlock': 'Remove Lock',
  };

  const descriptions = {
    lock: 'This will encrypt your note with AES-256 encryption. You will need this password to view or edit the note.',
    unlock: 'Enter your password to view this locked note.',
    'permanent-unlock': 'Enter your password to permanently remove the lock from this note.',
  };

  const submitLabels = {
    lock: 'Lock Note',
    unlock: 'Unlock',
    'permanent-unlock': 'Remove Lock',
  };

  const strengthColor = passwordStrength
    ? passwordStrength.level === 'weak'
      ? 'var(--error)'
      : passwordStrength.level === 'fair'
        ? 'var(--warning)'
        : passwordStrength.level === 'good'
          ? 'var(--success)'
          : 'var(--accent-primary)'
    : 'var(--border-default)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-dark">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal */}
      <div className="relative modal-elevated w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <div className="flex items-center gap-3">
            {mode === 'lock' ? (
              <Lock className="w-5 h-5" style={{ color: 'var(--warning)' }} />
            ) : (
              <Unlock className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            )}
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {titles[mode]}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost p-1 focus-ring"
            aria-label="Close password dialog"
          >
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {/* Note title */}
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {noteTitle}
              </span>
            </div>

            {/* Description */}
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              {descriptions[mode]}
            </p>

            {/* Error message */}
            {errorInfo && (
              <div
                className="flex items-start gap-2 p-3 rounded-md border"
                style={{
                  backgroundColor:
                    errorInfo.type === 'rate_limited'
                      ? 'var(--warning-muted)'
                      : 'var(--error-muted)',
                  borderColor:
                    errorInfo.type === 'rate_limited' ? 'var(--warning)' : 'var(--error)',
                }}
              >
                {errorInfo.type === 'rate_limited' ? (
                  <Clock
                    className="w-4 h-4 flex-shrink-0 mt-0.5"
                    style={{ color: 'var(--warning)' }}
                  />
                ) : (
                  <AlertCircle
                    className="w-4 h-4 flex-shrink-0 mt-0.5"
                    style={{ color: 'var(--error)' }}
                  />
                )}
                <div className="flex-1">
                  <p
                    className="text-sm"
                    style={{
                      color: errorInfo.type === 'rate_limited' ? 'var(--warning)' : 'var(--error)',
                    }}
                  >
                    {errorInfo.type === 'rate_limited' && lockoutSeconds !== null
                      ? `Too many failed attempts. Please wait ${lockoutSeconds} seconds.`
                      : errorInfo.message}
                  </p>
                  {errorInfo.type === 'wrong_password' && errorInfo.value !== undefined && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      {errorInfo.value} {errorInfo.value === 1 ? 'attempt' : 'attempts'} remaining
                      before lockout
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Password input */}
            <div className="space-y-1">
              <label
                htmlFor="password"
                className="block text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="Enter password"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 transition-colors focus-ring rounded"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password strength indicator (only for lock mode) */}
              {mode === 'lock' && passwordStrength && (
                <div className="mt-2 space-y-1">
                  {/* Strength bar */}
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((index) => (
                      <div
                        key={index}
                        className="h-1 flex-1 rounded-full transition-colors"
                        style={{
                          backgroundColor:
                            index < passwordStrength.score
                              ? strengthColor
                              : 'var(--border-default)',
                        }}
                      />
                    ))}
                  </div>
                  {/* Strength label and feedback */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium" style={{ color: strengthColor }}>
                      {passwordStrength.feedback}
                    </span>
                  </div>
                  {/* Suggestions */}
                  {passwordStrength.suggestions.length > 0 && passwordStrength.score < 3 && (
                    <ul className="text-xs space-y-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {passwordStrength.suggestions.map((suggestion, index) => (
                        <li key={index} className="flex items-start gap-1">
                          <span style={{ color: 'var(--text-muted)' }}>•</span>
                          <span>{suggestion}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Confirm password (only for lock mode) */}
            {mode === 'lock' && (
              <div className="space-y-1">
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input"
                  placeholder="Confirm password"
                  autoComplete="off"
                />
              </div>
            )}

            {/* Warning for lock mode */}
            {mode === 'lock' && (
              <div
                className="p-3 border rounded-md"
                style={{ backgroundColor: 'var(--warning-muted)', borderColor: 'var(--warning)' }}
              >
                <p className="text-xs" style={{ color: 'var(--warning)' }}>
                  <strong>Warning:</strong> If you forget your password, there is no way to recover
                  the note. Make sure to remember it.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex justify-end gap-3 px-6 py-4 border-t"
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-default)' }}
          >
            <button type="button" onClick={onClose} className="btn focus-ring">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (lockoutSeconds !== null && lockoutSeconds > 0)}
              className="btn btn-primary focus-ring"
            >
              {isSubmitting
                ? 'Processing...'
                : lockoutSeconds !== null && lockoutSeconds > 0
                  ? `Wait ${lockoutSeconds}s`
                  : submitLabels[mode]}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
