import { useMediaQuery } from '@tessera/ui';
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import Sigma from 'sigma';
import type { Settings } from 'sigma/settings';
import type { EdgeAttributes, NodeAttributes, TesseraGraph } from './build';
import { mix, type GraphTheme } from './theme';

/**
 * Test hooks for e2e specs and screenshots (only while the search test hooks are on): node
 * positions to click, and whether the layout has settled.
 */
export function useGraphTestHooks(
  canvas: { current: GraphCanvasHandle | null },
  running: boolean,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.__tesseraSearch) return undefined;
    const hooks = {
      nodePosition: (id: string) => canvas.current?.nodeClientPosition(id) ?? null,
      settled: () => !running,
    };
    const target = window as unknown as { __tesseraGraph?: typeof hooks };
    target.__tesseraGraph = hooks;
    return () => {
      if (target.__tesseraGraph === hooks) delete target.__tesseraGraph;
    };
  }, [canvas, running]);
}

/** Imperative controls of a {@link GraphCanvas}. */
export interface GraphCanvasHandle {
  /** Centers the camera on a node (zooming in). */
  focusNode(id: string, ratio?: number): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Fits the whole graph. */
  reset(): void;
  /** A node's position in page coordinates (tests use it to click nodes), or null. */
  nodeClientPosition(id: string): { x: number; y: number } | null;
}

export interface GraphCanvasProps {
  graph: TesseraGraph;
  theme: GraphTheme;
  /** The focused page (search): it and its neighbors stay bright. */
  focused: string | null;
  onNodeClick(id: string): void;
  /** WebGL is unavailable (or the renderer failed to start). */
  onError?(error: unknown): void;
  /** Labels show for nodes at least this big on screen. */
  labelThreshold?: number;
  /** Space kept around the graph, in pixels (labels extend to the right of nodes). */
  padding?: number;
  className?: string;
  style?: CSSProperties;
  label: string;
  describedBy?: string;
}

type SigmaSettings = Partial<Settings<NodeAttributes, EdgeAttributes>>;

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function settingsFor(theme: GraphTheme, labelThreshold: number, padding: number): SigmaSettings {
  return {
    labelFont: theme.font,
    labelSize: 12,
    labelWeight: '500',
    labelColor: { color: theme.label },
    labelDensity: 0.4,
    labelGridCellSize: 180,
    labelRenderedSizeThreshold: labelThreshold,
    defaultEdgeColor: theme.edge,
    defaultNodeColor: theme.neutral,
    zIndex: true,
    minCameraRatio: 0.04,
    maxCameraRatio: 6,
    stagePadding: padding,
    allowInvalidContainer: true,
    // Labels get a halo in the background color, so they stay legible over edges and nodes.
    defaultDrawNodeLabel: (context, data, settings) => {
      if (!data.label) return;
      const size = settings.labelSize;
      context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
      const x = data.x + data.size + 4;
      const y = data.y + size / 3;
      context.lineJoin = 'round';
      context.lineWidth = 4;
      context.strokeStyle = theme.background;
      context.strokeText(data.label, x, y);
      context.fillStyle = theme.label;
      context.fillText(data.label, x, y);
    },
    // The default hover label is always white; this one follows the theme.
    defaultDrawNodeHover: (context, data, settings) => {
      const size = settings.labelSize;
      const text = data.label ?? '';
      context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
      const width = context.measureText(text).width;
      const boxX = data.x + data.size + 6;
      const boxY = data.y - size / 2 - 6;
      const boxWidth = width + 14;
      const boxHeight = size + 12;
      context.save();
      context.shadowColor = theme.dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 15, 15, 0.16)';
      context.shadowBlur = 12;
      context.shadowOffsetY = 3;
      context.fillStyle = theme.surface;
      roundRect(context, boxX, boxY, boxWidth, boxHeight, 6);
      context.fill();
      context.restore();
      context.strokeStyle = theme.border;
      context.lineWidth = 1;
      roundRect(context, boxX, boxY, boxWidth, boxHeight, 6);
      context.stroke();
      context.fillStyle = theme.labelStrong;
      context.textBaseline = 'middle';
      context.fillText(text, boxX + 7, data.y);
      context.textBaseline = 'alphabetic';
      // A ring around the node.
      context.beginPath();
      context.arc(data.x, data.y, data.size + 2.5, 0, Math.PI * 2);
      context.strokeStyle = data.color;
      context.lineWidth = 2;
      context.stroke();
    },
  };
}

/**
 * A sigma.js (WebGL) rendering of a graph: hovering or focusing a page highlights it and its
 * neighbors and dims the rest, clicks open pages, and the camera animates (unless reduced motion
 * is on). The renderer is killed on unmount so no WebGL context leaks.
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    graph,
    theme,
    focused,
    onNodeClick,
    onError,
    labelThreshold = 7,
    padding = 40,
    className,
    style,
    label,
    describedBy,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma<NodeAttributes, EdgeAttributes> | null>(null);
  const hovered = useRef<string | null>(null);
  const focusedRef = useRef<string | null>(focused);
  const themeRef = useRef(theme);
  const clickRef = useRef(onNodeClick);
  const errorRef = useRef(onError);
  const highlight = useRef<() => void>(() => undefined);
  const dimmed = useRef(new Map<string, string>());
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const motion = useRef(reduceMotion);
  const initialGraph = useRef(graph);
  const initialThreshold = useRef(labelThreshold);
  const initialPadding = useRef(padding);
  useEffect(() => {
    clickRef.current = onNodeClick;
    errorRef.current = onError;
    motion.current = reduceMotion;
  });

  // The renderer is created once; later graphs are swapped in with `setGraph`.
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const dim = (color: string) => {
      let value = dimmed.current.get(color);
      if (!value) {
        const current = themeRef.current;
        value = mix(color, current.background, current.dark ? 0.78 : 0.84);
        dimmed.current.set(color, value);
      }
      return value;
    };
    let active: string | null = null;
    let near = new Set<string>();
    let renderer: Sigma<NodeAttributes, EdgeAttributes>;
    try {
      renderer = new Sigma<NodeAttributes, EdgeAttributes>(initialGraph.current, element, {
        ...settingsFor(themeRef.current, initialThreshold.current, initialPadding.current),
        nodeReducer: (node, data) => {
          if (!active) return data;
          if (node === active) return { ...data, zIndex: 2, forceLabel: true, highlighted: true };
          if (near.has(node)) return { ...data, zIndex: 1, forceLabel: near.size <= 24 };
          return { ...data, color: dim(data.color), label: null, zIndex: 0 };
        },
        edgeReducer: (edge, data) => {
          if (!active) return data;
          const [source, target] = renderer.getGraph().extremities(edge);
          if (source === active || target === active) {
            return {
              ...data,
              color: themeRef.current.edgeHighlight,
              size: data.size + 0.6,
              zIndex: 1,
            };
          }
          return { ...data, color: dim(data.color), zIndex: 0 };
        },
      });
    } catch (error) {
      // No WebGL (old hardware, disabled GPU): the view shows a message instead of crashing.
      console.warn('[graph] the renderer could not start', error);
      errorRef.current?.(error);
      return undefined;
    }
    highlight.current = () => {
      const current = renderer.getGraph();
      active = hovered.current ?? focusedRef.current;
      if (active && !current.hasNode(active)) active = null;
      near = active ? new Set(current.neighbors(active)) : new Set();
      renderer.refresh({ skipIndexation: true });
    };
    renderer.on('enterNode', ({ node }) => {
      hovered.current = node;
      element.style.cursor = 'pointer';
      highlight.current();
    });
    renderer.on('leaveNode', () => {
      hovered.current = null;
      element.style.cursor = '';
      highlight.current();
    });
    renderer.on('clickNode', ({ node }) => clickRef.current(node));
    sigma.current = renderer;
    // Sigma only listens to window resizes; panels and the sidebar resize the container too.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            renderer.resize();
            renderer.refresh();
          });
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      renderer.kill();
      sigma.current = null;
      highlight.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const renderer = sigma.current;
    if (renderer && renderer.getGraph() !== graph) {
      renderer.setGraph(graph);
      highlight.current();
    }
  }, [graph]);

  useEffect(() => {
    themeRef.current = theme;
    dimmed.current.clear();
    const renderer = sigma.current;
    if (!renderer) return;
    renderer.setSettings(settingsFor(theme, labelThreshold, padding));
    renderer.refresh();
  }, [theme, labelThreshold, padding]);

  useEffect(() => {
    focusedRef.current = focused;
    highlight.current();
  }, [focused]);

  useImperativeHandle(
    ref,
    () => ({
      focusNode(id, ratio = 0.35) {
        const renderer = sigma.current;
        const data = renderer?.getNodeDisplayData(id);
        if (!renderer || !data) return;
        void renderer
          .getCamera()
          .animate({ x: data.x, y: data.y, ratio }, { duration: motion.current ? 0 : 600 });
      },
      zoomIn() {
        void sigma.current?.getCamera().animatedZoom({ duration: motion.current ? 0 : 250 });
      },
      zoomOut() {
        void sigma.current?.getCamera().animatedUnzoom({ duration: motion.current ? 0 : 250 });
      },
      reset() {
        void sigma.current?.getCamera().animatedReset({ duration: motion.current ? 0 : 400 });
      },
      nodeClientPosition(id) {
        const renderer = sigma.current;
        const element = container.current;
        if (!renderer || !element || !graph.hasNode(id)) return null;
        const attributes = graph.getNodeAttributes(id);
        const point = renderer.graphToViewport({ x: attributes.x, y: attributes.y });
        const box = element.getBoundingClientRect();
        return { x: box.left + point.x, y: box.top + point.y };
      },
    }),
    [graph],
  );

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      className={className}
      style={style}
    />
  );
});
