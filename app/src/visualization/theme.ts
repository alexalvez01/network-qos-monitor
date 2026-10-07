/**
 * Stage 5 shared palette.
 *
 * Same instrument theme as StatusScreen (deep-sea panel, signal-green
 * accent) so Map and History read as the same product. Components import
 * these tokens; no raw hex lives in component files.
 */

export const COLORS = {
  abyss: '#0A1F33',
  panel: '#14324C',
  panelEdge: '#1E4565',
  ink: '#EAF4FA',
  muted: '#8FA9BE',
  signal: '#41E6A4',
  warn: '#FFB224',
  danger: '#FF5C5C',
};

export const CHART_SERIES = {
  latency: '#FFB224',
  throughput: '#41E6A4',
};
