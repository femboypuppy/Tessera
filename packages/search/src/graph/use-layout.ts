import { useEffect, useRef, useState } from 'react';
import { applyPositions, layoutInput, type TesseraGraph } from './build';
import type { LayoutOptions } from './layout-engine';
import { LayoutRunner } from './layout-runner';

/**
 * Lays out `graph` in the layout worker whenever it changes (starting from its current positions)
 * and streams positions into it; sigma redraws on each update. Returns whether it is still running.
 */
export function useGraphLayout(
  graph: TesseraGraph,
  options: { fixed?: readonly string[]; layout?: LayoutOptions; run: number },
): boolean {
  const runner = useRef<LayoutRunner | null>(null);
  const [running, setRunning] = useState(false);
  const fixedKey = (options.fixed ?? []).join(',');
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
    if (!current || graph.order === 0) {
      setRunning(false);
      return undefined;
    }
    setRunning(true);
    // Apply at most one set of positions per frame: ticks can arrive faster than the screen draws.
    let latest: Float32Array | null = null;
    let finished = false;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (latest) applyPositions(graph, latest);
      latest = null;
      if (finished) setRunning(false);
    };
    current.start(
      layoutInput(graph, fixedKey ? fixedKey.split(',') : []),
      (positions, done) => {
        latest = positions;
        finished = done;
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
