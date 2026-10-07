import {
  __resetVisualizationStoreForTests,
  useVisualizationStore,
} from '../visualizationStore';

beforeEach(() => {
  __resetVisualizationStoreForTests();
});

test('latency-first defaults per ADR-2/ADR-6', () => {
  const state = useVisualizationStore.getState();
  expect(state.tab).toBe('status');
  expect(state.metric).toBe('latency');
  expect(state.selectedSessionId).toBeNull();
  expect(state.showDemoWalk).toBe(false);
});

test('metric, tab, session and demo overlay update independently', () => {
  const store = useVisualizationStore.getState();
  store.setMetric('throughput');
  store.setTab('map');
  store.selectSession('s1');
  store.setShowDemoWalk(true);
  const next = useVisualizationStore.getState();
  expect(next.metric).toBe('throughput');
  expect(next.tab).toBe('map');
  expect(next.selectedSessionId).toBe('s1');
  expect(next.showDemoWalk).toBe(true);

  next.selectSession(null);
  expect(useVisualizationStore.getState().selectedSessionId).toBeNull();
});
