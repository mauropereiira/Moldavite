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

export function PasswordModal({
  isOpen,
  onClose,
  onSubmit,
  mode,
  noteTitle,
}: PasswordModalProps) {
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
        setErrorInfo({ type: 'generic', message: 'Password must be at least 8 characters for locking notes' });
        return;
      }

      if (passwordStrength && !passwordStrength.isAcceptable) {
        setErrorInfo({ type: 'generic', message: 'Password is too weak. Please choose a stronger password.' });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {mode === 'lock' ? (
              <Lock className="w-5 h-5 text-amber-500" />
            ) : (
              <Unlock className="w-5 h-5 text-blue-500" />
            )}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {titles[mode]}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {/* Note title */}
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-white">
                {noteTitle}
              </span>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {descriptions[mode]}
            </p>

            {/* Error message */}
            {errorInfo && (
              <div className={`flex items-start gap-2 p-3 rounded-md ${
                errorInfo.type === 'rate_limited'
                  ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
              }`}>
                {errorInfo.type === 'rate_limited' ? (
                  <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`text-sm ${
                    errorInfo.type === 'rate_limited'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {errorInfo.type === 'rate_limited' && lockoutSeconds !== null
                      ? `Too many failed attempts. Please wait ${lockoutSeconds} seconds.`
                      : errorInfo.message}
                  </p>
                  {errorInfo.type === 'wrong_password' && errorInfo.value !== undefined && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {errorInfo.value} {errorInfo.value === 1 ? 'attempt' : 'attempts'} remaining before lockout
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Password input */}
            <div className="space-y-1">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
                  className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter password"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus-ring rounded"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
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
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          index < passwordStrength.score
                            ? passwordStrength.level === 'weak'
                              ? 'bg-red-500'
                              : passwordStrength.level === 'fair'
                              ? 'bg-amber-500'
                              : passwordStrength.level === 'good'
                              ? 'bg-green-500'
                              : 'bg-emerald-500'
                            : 'bg-gray-200 dark:bg-gray-600'
                        }`}
                      />
                    ))}
                  </div>
                  {/* Strength label and feedback */}
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`font-medium ${
                        passwordStrength.level === 'weak'
                          ? 'text-red-500'
                          : passwordStrength.level === 'fair'
                          ? 'text-amber-500'
                          : passwordStrength.level === 'good'
                          ? 'text-green-500'
                          : 'text-emerald-500'
                      }`}
                    >
                      {passwordStrength.feedback}
                    </span>
                  </div>
                  {/* Suggestions */}
                  {passwordStrength.suggestions.length > 0 && passwordStrength.score < 3 && (
                    <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                      {passwordStrength.suggestions.map((suggestion, index) => (
                        <li key={index} className="flex items-start gap-1">
                          <span className="text-gray-400">•</span>
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
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Confirm password"
                  autoComplete="off"
                />
              </div>
            )}

            {/* Warning for lock mode */}
            {mode === 'lock' && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Warning:</strong> If you forget your password, there
                  is no way to recover the note. Make sure to remember it.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (lockoutSeconds !== null && lockoutSeconds > 0)}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                mode === 'lock'
                  ? 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-400 disabled:cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 disabled:cursor-not-allowed'
              }`}
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
