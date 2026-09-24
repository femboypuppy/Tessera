import { LayoutEngine, type LayoutInput, type LayoutOptions } from './layout-engine';
import type { LayoutRequest, LayoutTick } from './layout-protocol';

type TickListener = (positions: Float32Array, done: boolean) => void;

function isTick(value: unknown): value is LayoutTick {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'tick' &&
    (value as { positions?: unknown }).positions instanceof Float32Array
  );
}

/**
 * Runs layouts in the layout worker and reports positions as they improve. Without workers (or if
 * the worker fails), it runs the same engine on the main thread in 4 ms slices per frame, so the
 * page stays responsive either way.
 */
export class LayoutRunner {
  private worker: Worker | null = null;
  private workerFailed = false;
  private runId = 0;
  private frame: number | null = null;
  private listener: TickListener | null = null;
  private lastRun: { input: LayoutInput; options: LayoutOptions } | null = null;

  /** Starts a layout (stopping the previous one). `onTick` gets every new set of positions. */
  start(input: LayoutInput, onTick: TickListener, options: LayoutOptions = {}, warmup = 40): void {
    this.stop();
    this.runId += 1;
    this.listener = onTick;
    this.lastRun = { input, options };
    const worker = this.ensureWorker();
    if (worker) {
      const copy: LayoutInput = {
        positions: input.positions.slice(),
        sizes: input.sizes.slice(),
        edges: input.edges.slice(),
        weights: input.weights.slice(),
      };
      if (input.fixed) copy.fixed = input.fixed.slice();
      const message: LayoutRequest = {
        type: 'start',
        runId: this.runId,
        input: copy,
        options,
        warmup,
      };
      worker.postMessage(message, [
        copy.positions.buffer,
        copy.sizes.buffer,
        copy.edges.buffer,
        copy.weights.buffer,
      ]);
      return;
    }
    this.runOnMainThread(input, options, this.runId);
  }

  stop(): void {
    this.worker?.postMessage({ type: 'stop' } satisfies LayoutRequest);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.runId += 1;
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.listener = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed || typeof Worker === 'undefined') return this.worker;
    try {
      const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), {
        type: 'module',
        name: 'tessera-graph-layout',
      });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const tick = event.data;
        if (!isTick(tick) || tick.runId !== this.runId) return;
        this.listener?.(tick.positions, tick.done);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        console.warn('[graph] layout worker failed; laying out on the main thread', event.message);
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        const run = this.lastRun;
        if (run) this.runOnMainThread(run.input, run.options, this.runId);
      };
      this.worker = worker;
    } catch (error) {
      console.warn('[graph] no layout worker', error);
      this.workerFailed = true;
    }
    return this.worker;
  }

  /** The fallback: no warm-up, since every slice on the main thread must stay short. */
  private runOnMainThread(input: LayoutInput, options: LayoutOptions, id: number): void {
    const engine = new LayoutEngine(input, options);
    const tick = () => {
      this.frame = null;
      if (id !== this.runId) return;
      const started = performance.now();
      let done = false;
      do {
        done = engine.step(1);
      } while (!done && performance.now() - started < 4);
      this.listener?.(engine.positions(), done);
      if (!done) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
