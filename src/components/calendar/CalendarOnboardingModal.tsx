import { useState } from 'react';
import { Calendar, Settings, ChevronRight, X } from 'lucide-react';
import { useCalendarStore } from '@/stores/calendarStore';

export function CalendarOnboardingModal() {
  const { isAuthorized, hasSeenOnboarding, setHasSeenOnboarding } = useCalendarStore();
  const [step, setStep] = useState(0);

  // Only show if authorized and hasn't seen onboarding
  if (!isAuthorized || hasSeenOnboarding) return null;

  const steps = [
    {
      icon: <Calendar className="w-12 h-12 text-blue-500" />,
      title: 'Calendar Events in Your Timeline',
      description:
        'Your calendar events now appear in the right panel alongside your daily notes. Stay on top of your schedule while you write.',
    },
    {
      icon: <Settings className="w-12 h-12 text-blue-500" />,
      title: 'Customize Your Calendar',
      description:
        'Go to Settings → Calendar to choose which calendar to display, toggle all-day events, and more.',
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
      <div className="bg-white dark:bg-gray-800 rounded-md max-w-md mx-4 modal-elevated modal-content-enter overflow-hidden">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded focus-ring"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8 text-center">
          {/* Icon */}
          <div className="flex justify-center mb-6">{steps[step].icon}</div>

          {/* Title */}
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            {steps[step].title}
          </h2>

          {/* Description */}
          <p className="text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
            {steps[step].description}
          </p>

          {/* Step indicators */}
          <div className="flex justify-center gap-2 mb-6">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors flex items-center gap-1.5"
            >
              {step < steps.length - 1 ? 'Next' : 'Get Started'}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
