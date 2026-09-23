/**
 * The graph layout worker: runs ForceAtlas2 (`LayoutEngine`) off the main thread and streams
 * positions back until the layout settles.
 */
import { LayoutEngine, type LayoutInput, type LayoutOptions } from './layout-engine';
import type { LayoutRequest, LayoutTick } from './layout-protocol';

interface WorkerScope {
  postMessage(message: LayoutTick, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
let engine: LayoutEngine | null = null;
let runId = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const SLICE_MS = 14;

function loop(id: number): void {
  timer = null;
  if (!engine || id !== runId) return;
  const started = performance.now();
  let done = false;
  do {
    done = engine.step(1);
  } while (!done && performance.now() - started < SLICE_MS);
  const positions = engine.positions();
  scope.postMessage({ type: 'tick', runId: id, positions, done, iteration: engine.iteration }, [
    positions.buffer,
  ]);
  if (!done) timer = setTimeout(() => loop(id), 0);
}

function start(input: LayoutInput, options: LayoutOptions, id: number, warmup: number): void {
  if (timer) clearTimeout(timer);
  runId = id;
  engine = new LayoutEngine(input, options);
  // A few silent iterations first, so the first frame is already roughly laid out.
  engine.step(warmup);
  loop(id);
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'start') {
    start(message.input, message.options, message.runId, message.warmup);
  } else if (message.type === 'stop') {
    if (timer) clearTimeout(timer);
    timer = null;
    engine = null;
  }
};
