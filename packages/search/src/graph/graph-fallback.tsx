import { Button, cn } from '@tessera/ui';
import { ArrowRight, MonitorOff } from 'lucide-react';
import { useId, useMemo } from 'react';
import { t } from '../i18n';
import type { TesseraGraph } from './build';

const LISTED = 12;

/** The title a node shows, as a person reads it. */
function titleOf(graph: TesseraGraph, id: string): string {
  const label = graph.getNodeAttribute(id, 'label');
  return typeof label === 'string' && label.trim() ? label : t('untitled');
}

/**
 * What the graph shows when it can't be drawn (no WebGL, or the context was lost): why, how to
 * turn it on, a way to try again, and the same graph as a list, its most connected pages first,
 * so the view is still useful (and keyboard and screen reader friendly) without a canvas.
 */
export function GraphFallback({
  graph,
  onOpen,
  onRetry,
  exclude,
  compact = false,
}: {
  graph: TesseraGraph;
  onOpen(id: string): void;
  onRetry(): void;
  /** A node left out of the list (the local graph's own page). */
  exclude?: string;
  compact?: boolean;
}) {
  const headingId = useId();
  const pages = useMemo(
    () =>
      graph
        .filterNodes((id) => id !== exclude)
        .map((id) => ({ id, title: titleOf(graph, id), links: graph.degree(id) }))
        .sort((a, b) => b.links - a.links || a.title.localeCompare(b.title))
        .slice(0, LISTED),
    [graph, exclude],
  );
  return (
    <div
      role="region"
      aria-label={t('graphUnavailable')}
      className={cn(
        'mx-auto flex w-full max-w-md flex-col gap-4 px-4',
        compact ? 'py-6' : 'pt-28 pb-8',
      )}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-hover text-fg-muted [&_svg]:size-5">
          <MonitorOff aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-fg">{t('graphUnavailable')}</p>
        <p className="text-ui text-fg-muted">{t('graphUnavailableHint')}</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
      {pages.length ? (
        <section aria-labelledby={headingId} className="flex flex-col gap-1">
          <h2 id={headingId} className="px-2 text-xs font-medium text-fg-subtle">
            {exclude ? t('graphLinkedPages') : t('graphMostConnected')}
          </h2>
          <ul className="flex flex-col">
            {pages.map((page) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => onOpen(page.id)}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-fg hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {t('graphLinkCount', { count: page.links })}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
