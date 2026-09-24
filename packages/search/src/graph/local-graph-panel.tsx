import type { AppContext, SidePanelProps } from '@tessera/core';
import { useAppContext, useSetting } from '@tessera/core/react';
import { Button, EmptyState, Spinner } from '@tessera/ui';
import { Network, TriangleAlert, Waypoints } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { buildGraph, colorGraph, DEFAULT_FILTERS, type TesseraGraph } from './build';
import { loadNeighborhood, useGraphData } from './data';
import { GraphCanvas, useGraphTestHooks, type GraphCanvasHandle } from './graph-canvas';
import { openGraph } from './location';
import { useGraphTheme } from './theme';
import { useGraphLayout } from './use-layout';

const DEPTH_SETTING = 'graph.localDepth';

function clampDepth(value: unknown): number {
  return value === 2 || value === 3 ? value : 1;
}

/**
 * The local graph side panel (`PANELS.localGraph`): the current page and the pages within 1–3
 * links of it. The page itself stays pinned in the middle, in the accent color.
 */
export default function LocalGraphPanel({ pageId }: SidePanelProps) {
  const ctx = useAppContext();
  const theme = useGraphTheme();
  const [storedDepth, setDepth] = useSetting<number>(ctx.settings.device, DEPTH_SETTING, 1);
  const depth = clampDepth(storedDepth);
  const sliderId = useId();
  const hintId = useId();
  const [failed, setFailed] = useState(false);
  const load = useCallback(
    (app: AppContext) =>
      pageId
        ? loadNeighborhood(app, pageId, depth)
        : Promise.resolve({ nodes: [], edges: [], tags: [] }),
    [pageId, depth],
  );
  const data = useGraphData(load, `${pageId ?? ''}:${depth}`);
  const current = useRef<TesseraGraph | null>(null);
  const graph = useMemo(() => {
    if (!data.snapshot || !pageId) return null;
    const previous = new Map<string, { x: number; y: number }>();
    current.current?.forEachNode((id, attributes) =>
      previous.set(id, { x: attributes.x, y: attributes.y }),
    );
    if (!previous.has(pageId)) previous.set(pageId, { x: 0, y: 0 });
    const built = buildGraph(data.snapshot, { ...DEFAULT_FILTERS, showRows: true }, previous);
    if (built.hasNode(pageId)) built.setNodeAttribute(pageId, 'center', true);
    return built;
  }, [data.snapshot, pageId]);
  useEffect(() => {
    current.current = graph;
  }, [graph]);
  useEffect(() => {
    if (!graph || !data.snapshot) return;
    colorGraph(
      graph,
      data.snapshot,
      'parent',
      theme,
      { other: t('moreOther'), none: t('graphNoTag'), untitled: t('untitled') },
      { reserveAccent: true },
    );
    if (pageId && graph.hasNode(pageId)) {
      const size = graph.getNodeAttribute(pageId, 'size');
      graph.mergeNodeAttributes(pageId, {
        size: Math.max(size, 10),
        color: theme.accent,
        forceLabel: true,
      });
    }
  }, [graph, data.snapshot, theme, pageId]);
  const fixed = useMemo(() => (pageId ? [pageId] : []), [pageId]);
  const running = useGraphLayout(graph ?? EMPTY, { fixed, run: 0 });
  const canvas = useRef<GraphCanvasHandle>(null);
  useGraphTestHooks(canvas, running);

  if (!pageId) {
    return <EmptyState icon={<Waypoints />} title={t('localGraphNoPage')} className="py-10" />;
  }
  return (
    <div className="flex h-full min-h-[22rem] flex-col">
      <div className="relative min-h-0 flex-1">
        <p id={hintId} className="sr-only">
          {t('graphDescription')}
        </p>
        {data.status === 'error' && !data.snapshot ? (
          <EmptyState
            tone="danger"
            icon={<TriangleAlert />}
            title={t('graphFailed')}
            className="py-10"
            actions={
              <Button size="sm" onClick={data.retry}>
                {t('retry')}
              </Button>
            }
          />
        ) : !graph ? (
          <div className="flex h-full items-center justify-center gap-2 text-ui text-fg-muted">
            <Spinner size="sm" label="" />
            {t('graphLoading')}
          </div>
        ) : graph.order <= 1 ? (
          <EmptyState
            icon={<Waypoints />}
            title={t('localGraphEmpty')}
            description={t('localGraphEmptyHint')}
            className="py-10"
          />
        ) : failed ? (
          <EmptyState
            tone="danger"
            icon={<TriangleAlert />}
            title={t('graphFailed')}
            description={t('graphFailedHint')}
            className="py-10"
          />
        ) : (
          <GraphCanvas
            ref={canvas}
            graph={graph}
            theme={theme}
            focused={null}
            labelThreshold={4}
            padding={72}
            onNodeClick={(id) => {
              if (id !== pageId) ctx.navigate(id);
            }}
            onError={() => setFailed(true)}
            label={`${t('localGraph')}: ${t('graphStats', { nodes: graph.order, edges: graph.size })}`}
            describedBy={hintId}
            className="absolute inset-0"
          />
        )}
        {running && graph && graph.order > 1 ? (
          <span className="pointer-events-none absolute top-2 right-2">
            <Spinner size="sm" label={t('graphLayoutRunning')} />
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
        <div className="flex items-center gap-3">
          <label htmlFor={sliderId} className="shrink-0 text-ui text-fg-muted">
            {t('localGraphDepth', { depth })}
          </label>
          <input
            id={sliderId}
            type="range"
            min={1}
            max={3}
            step={1}
            value={depth}
            onChange={(event) => setDepth(clampDepth(Number(event.target.value)))}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--tess-accent)]"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => openGraph(ctx, pageId)}>
          <Network aria-hidden="true" />
          {t('openInGraph')}
        </Button>
      </div>
    </div>
  );
}

const EMPTY = buildGraph({ nodes: [], edges: [], tags: [] }, DEFAULT_FILTERS);
