import {
  __resetBackgroundStoreForTests,
  useBackgroundStore,
} from '../backgroundStore';

beforeEach(() => {
  __resetBackgroundStoreForTests();
});

test('starts idle with no runs', () => {
  const state = useBackgroundStore.getState();
  expect(state.status).toBe('idle');
  expect(state.lastRunAt).toBeNull();
  expect(state.lastOutcome).toBeNull();
  expect(state.lastReason).toBeNull();
  expect(state.runsCompleted).toBe(0);
});

test('scheduling and running move the status without touching the last run', () => {
  useBackgroundStore.getState().setStatus('scheduled');
  expect(useBackgroundStore.getState().status).toBe('scheduled');
  useBackgroundStore.getState().setStatus('running');
  expect(useBackgroundStore.getState().status).toBe('running');
  expect(useBackgroundStore.getState().runsCompleted).toBe(0);
});

test('recordRun publishes outcome, reason and run count', () => {
  useBackgroundStore.getState().recordRun({
    at: 5000,
    outcome: 'degraded',
    reason: 'Network degradation: 1.1.1.1 loss 25% above 10%',
  });
  const state = useBackgroundStore.getState();
  expect(state.lastRunAt).toBe(5000);
  expect(state.lastOutcome).toBe('degraded');
  expect(state.lastReason).toContain('1.1.1.1');
  expect(state.runsCompleted).toBe(1);

  useBackgroundStore.getState().recordRun({
    at: 6000,
    outcome: 'ok',
    reason: null,
  });
  const next = useBackgroundStore.getState();
  expect(next.lastOutcome).toBe('ok');
  expect(next.lastReason).toBeNull();
  expect(next.runsCompleted).toBe(2);
});
