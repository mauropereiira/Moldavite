import { useState } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useLaunchContextStore, wasLaunchedWithFile } from '@/lib/launchContext';
import { CloseButton } from '@/components/ui/CloseButton';

export function CalendarOnboardingModal() {
  const { sources, hasSeenOnboarding, setHasSeenOnboarding } = useCalendarStore();
  // Any connected source earns the walkthrough, not just EventKit — on
  // Windows and Linux, Google is the only source there is.
  const isAuthorized = sources.some((s) => s.available && s.connected);
  const [step, setStep] = useState(0);
  const launchContext = useLaunchContextStore();

  if (!launchContext.ready || wasLaunchedWithFile() || !isAuthorized || hasSeenOnboarding)
    return null;

  const steps = [
    {
      label: 'Calendar',
      title: 'Calendar Events in Your Timeline',
      description:
        'Your calendar events now appear in the right panel alongside your daily notes. Stay on top of your schedule while you write.',
    },
    {
      label: 'Settings',
      title: 'Customize Your Calendar',
      description:
        'Go to Settings → Calendar to connect accounts, choose which calendars to display, toggle all-day events, and more.',
    },
  ];

  const handleClose = () => {
    setHasSeenOnboarding(true);
  };

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  return (
    <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter">
      <div
        className="max-w-md mx-4 modal-elevated modal-content-enter overflow-hidden"
        style={{ backgroundColor: 'var(--bg-elevated)' }}
      >
        <CloseButton onClick={handleClose} label="Close" className="absolute top-3 right-3" />

        <div className="p-8 text-center">
          <div className="step-stack">
            {steps.map((page, i) => (
              <div
                key={page.label}
                className="step-stack-page"
                aria-hidden={i === step ? undefined : true}
                inert={i !== step}
              >
                <div
                  className="mb-6 text-[10px] uppercase"
                  style={{ color: 'var(--text-muted)', letterSpacing: '0.14em' }}
                >
                  {page.label}
                </div>

                <h2 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                  {page.title}
                </h2>

                <p className="mb-8 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {page.description}
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-2 mb-6">
            {steps.map((_, i) => (
              <div
                key={i}
                className="w-2 h-2 transition-colors"
                style={{
                  backgroundColor: i === step ? 'var(--text-primary)' : 'var(--border-strong)',
                }}
              />
            ))}
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm hover:text-[var(--text-secondary)] transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-medium border hover:bg-[var(--bg-inset)] transition-colors"
              style={{
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-panel)',
                borderColor: 'var(--border-default)',
              }}
            >
              {step < steps.length - 1 ? 'Next' : 'Get Started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
