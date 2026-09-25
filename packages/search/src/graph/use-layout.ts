import { useEffect, useRef, useState } from 'react';
import { applyPositions, layoutInput, type TesseraGraph } from './build';
import type { LayoutOptions } from './layout-engine';
import { LayoutRunner } from './layout-runner';

/**
 * Lays out `graph` in the layout worker whenever it changes (starting from its current positions)
 * and streams positions into it; sigma redraws on each update. Returns whether it is still running:
 * true from the first render of a graph (or a new run) until its layout has finished, so nothing
 * reads a graph as settled before its layout even started.
 */
export function useGraphLayout(
  graph: TesseraGraph,
  options: { fixed?: readonly string[]; layout?: LayoutOptions; run: number },
): boolean {
  const runner = useRef<LayoutRunner | null>(null);
  const fixedKey = (options.fixed ?? []).join(',');
  const key = `${fixedKey}|${options.run}`;
  const [finished, setFinished] = useState<{ graph: TesseraGraph; key: string } | null>(null);
  const running = graph.order > 0 && (finished?.graph !== graph || finished.key !== key);
  const layout = useRef(options.layout);
  layout.current = options.layout;
  useEffect(() => {
    runner.current = new LayoutRunner();
    return () => {
      runner.current?.dispose();
      runner.current = null;
    };
  }, []);
  useEffect(() => {
    const current = runner.current;
    const runKey = `${fixedKey}|${options.run}`;
    if (!current || graph.order === 0) return undefined;
    // Apply at most one set of positions per frame: ticks can arrive faster than the screen draws.
    let latest: Float32Array | null = null;
    let done = false;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (latest) applyPositions(graph, latest);
      latest = null;
      if (done) setFinished({ graph, key: runKey });
    };
    current.start(
      layoutInput(graph, fixedKey ? fixedKey.split(',') : []),
      (positions, last) => {
        latest = positions;
        done = last;
        frame ??= requestAnimationFrame(flush);
      },
      layout.current,
    );
    return () => {
      current.stop();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [graph, fixedKey, options.run]);
  return running;
}
