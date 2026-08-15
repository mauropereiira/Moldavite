import { SignatureEmptyState } from '@/components/ui/SignatureMark';

/**
 * Shown where events would go when no calendar source can be connected at all
 * — Apple is macOS-only, and Google is compiled out of builds without OAuth
 * credentials (issue #96). That is not a state the user can fix from Settings,
 * so it must not read like the "connect a calendar" prompt, which can be.
 *
 * Deliberately says "here" rather than naming Windows: the condition is
 * derived from what the backend reports, not from the platform, so it also
 * covers a build that simply shipped without credentials.
 */
export function CalendarSyncComingSoon() {
  return (
    <SignatureEmptyState vertical className="flex-1 justify-center px-4 py-8 text-center">
      <p style={{ fontSize: '13px', lineHeight: 1.5 }}>
        Calendar sync isn&apos;t available here yet.
      </p>
      <p style={{ fontSize: '12px', lineHeight: 1.5 }}>Events will appear here when it arrives.</p>
    </SignatureEmptyState>
  );
}
