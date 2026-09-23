import type { LayoutInput, LayoutOptions } from './layout-engine';

/** Messages to the layout worker. */
export type LayoutRequest =
  | { type: 'start'; runId: number; input: LayoutInput; options: LayoutOptions; warmup: number }
  | { type: 'stop' };

/** Positions streamed back while the layout runs. */
export interface LayoutTick {
  type: 'tick';
  runId: number;
  positions: Float32Array;
  done: boolean;
  iteration: number;
}
