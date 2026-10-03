import { ACTIVE_SEASON } from '@/lib/seasons';

export const APP_ONBOARDING_VERSION = 3;

type StepKey = 'welcome' | 'forge' | 'tour' | 'ai-agents' | 'ai-search' | 'season' | 'open-files';

const STEPS: ReadonlyArray<{ key: StepKey; since: number; mobile: boolean }> = [
  { key: 'welcome', since: 1, mobile: true },
  { key: 'forge', since: 1, mobile: true },
  { key: 'tour', since: 1, mobile: true },
  { key: 'ai-agents', since: 2, mobile: false },
  { key: 'ai-search', since: 2, mobile: false },
  { key: 'season', since: 3, mobile: true },
  { key: 'open-files', since: 3, mobile: false },
];

export function getAppOnboardingSteps(
  mobile: boolean,
  firstRun: boolean,
  lastSeenVersion: number
): StepKey[] {
  // Version 0 predates the cursor; existing users had already seen v1.
  const seen = firstRun ? 0 : Math.max(lastSeenVersion, 1);
  const steps = STEPS.filter(
    (step) =>
      step.since > seen &&
      (!mobile || step.mobile) &&
      (step.key !== 'season' || ACTIVE_SEASON !== null)
  ).map((step) => step.key);
  return firstRun && steps.includes('season')
    ? [...steps.filter((key) => key !== 'season'), 'season']
    : steps;
}
