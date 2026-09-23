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
    current.start(
      layoutInput(graph, fixedKey ? fixedKey.split(',') : []),
      (positions, done) => {
        applyPositions(graph, positions);
        if (done) setRunning(false);
      },
      layout.current,
    );
    return () => current.stop();
  }, [graph, fixedKey, options.run]);
  return running;
}
