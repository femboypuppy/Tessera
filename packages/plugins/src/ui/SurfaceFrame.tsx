import type { JsonValue } from '@tessera/core';
import { Button, cn, Skeleton } from '@tessera/ui';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PLUGIN_LIMITS } from '../constants';
import type { PluginInstance, SurfaceController } from '../host/instance';
import type { UiSurfaceInit } from '../sandbox/runtime-ui';
import { t } from '../i18n';

/** Last known heights of blocks, so a re-mounted block doesn't jump. */
const heights = new Map<string, number>();

/** Props of {@link SurfaceFrame}. */
export interface SurfaceFrameProps {
  instance: PluginInstance;
  /** Changes when the plugin restarts (a new frame is needed). */
  generation: number;
  surface: UiSurfaceInit;
  /** Accessible name of the frame. */
  title: string;
  /** Block only. */
  onSetData?(data: JsonValue): void;
  onRemove?(): void;
  /** Panel only. */
  onClose?(): void;
  /** Key for remembering a block's height. */
  heightKey?: string;
  className?: string;
}

/**
 * Hosts one plugin panel or block frame: creates it through the plugin instance, keeps its state
 * current (page, data, read-only, selection), sizes blocks to their content, and shows loading
 * and error states. Blocks mount when they come near the viewport.
 */
export function SurfaceFrame({
  instance,
  generation,
  surface,
  title,
  onSetData,
  onRemove,
  onClose,
  heightKey,
  className,
}: SurfaceFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SurfaceController | null>(null);
  const latest = useRef({ surface, onSetData, onRemove, onClose });
  useLayoutEffect(() => {
    latest.current = { surface, onSetData, onRemove, onClose };
  });
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const [attempt, setAttempt] = useState(0);
  const isBlock = surface.kind === 'block';
  const [height, setHeight] = useState<number | null>(() =>
    heightKey ? (heights.get(heightKey) ?? null) : null,
  );
  const [visible, setVisible] = useState(!isBlock || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (visible || !containerRef.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '400px' },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!visible || !container || instance.status !== 'running') return undefined;
    setState('loading');
    const controller = instance.mountSurface({
      container,
      surface: latest.current.surface,
      title,
      callbacks: {
        onReady: () => setState('ready'),
        onError: (message) => setState({ error: message }),
        onResize: (next) => {
          const clamped = Math.min(
            Math.max(next, PLUGIN_LIMITS.blockMinHeight),
            PLUGIN_LIMITS.blockMaxHeight,
          );
          if (heightKey) heights.set(heightKey, clamped);
          setHeight(clamped);
        },
        setBlockData: (data) => latest.current.onSetData?.(data),
        removeBlock: () => latest.current.onRemove?.(),
        closePanel: () => latest.current.onClose?.(),
        isReadOnly: () =>
          latest.current.surface.kind === 'block' ? latest.current.surface.readOnly : true,
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // The frame is created once per plugin run (`generation`) or retry (`attempt`); surface changes
    // go through `update` below, and callbacks read the latest props from `latest`.
  }, [instance, instance.status, generation, visible, attempt, title, heightKey]);

  const pageId = surface.kind === 'panel' ? surface.pageId : null;
  const blockData = surface.kind === 'block' ? JSON.stringify(surface.data) : null;
  const readOnly = surface.kind === 'block' ? surface.readOnly : false;
  const selected = surface.kind === 'block' ? surface.selected : false;
  useEffect(() => {
    if (surface.kind === 'panel') controllerRef.current?.update({ pageId });
  }, [surface.kind, pageId]);
  useEffect(() => {
    if (surface.kind !== 'block' || blockData === null) return;
    controllerRef.current?.update({ data: JSON.parse(blockData) as JsonValue, readOnly, selected });
  }, [surface.kind, blockData, readOnly, selected]);

  const error = typeof state === 'object' ? state.error : null;
  return (
    <div
      className={cn(
        'relative w-full',
        isBlock
          ? 'duration-fast overflow-hidden rounded-lg transition-[height] ease-out'
          : 'flex h-full min-h-60 flex-col',
        className,
      )}
      style={isBlock ? { height: error ? undefined : (height ?? 120) } : undefined}
      data-plugin-surface={surface.kind}
      data-state={error ? 'error' : state}
    >
      <div
        ref={containerRef}
        className={cn('size-full', error && 'hidden', state === 'loading' && 'opacity-0')}
      />
      {state === 'loading' ? (
        <div className="absolute inset-0 flex flex-col gap-2 p-3" aria-hidden="true">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-3/4" />
          {!isBlock ? <Skeleton className="h-24 w-full" /> : null}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-ui"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-fg">{t('surfaceError')}</p>
            <p className="mt-0.5 break-words text-fg-muted">{error}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
            <RotateCcw aria-hidden="true" />
            {t('reload')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
