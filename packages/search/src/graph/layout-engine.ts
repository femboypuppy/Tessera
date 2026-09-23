// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the untyped deep import's declaration must reach every program that compiles this file (the web app too), and an import cannot load a .d.ts
/// <reference path="./fa2-iterate.d.ts" />
import iterate from 'graphology-layout-forceatlas2/iterate.js';

/** What the layout needs: positions (x, y per node), sizes, and edges as node index pairs. */
export interface LayoutInput {
  positions: Float32Array;
  sizes: Float32Array;
  edges: Uint32Array;
  weights: Float32Array;
  /** Nodes that must not move (index list), for example the page a local graph is about. */
  fixed?: Uint32Array;
}

export interface LayoutOptions {
  /** Hard cap on iterations. Default: 1,200 for small graphs, fewer for large ones. */
  maxIterations?: number;
  /** Mean displacement (relative to the layout's size) under which it counts as settled. */
  settleThreshold?: number;
}

// Matrix layout of graphology-layout-forceatlas2 (see its helpers.js).
const PPN = 10;
const PPE = 3;

/**
 * ForceAtlas2 driven step by step with a cooling schedule, so the layout settles and stops
 * instead of jittering forever. Pure: the layout worker runs it, and so does the main-thread
 * fallback (in small time slices).
 */
export class LayoutEngine {
  private readonly nodes: Float32Array;
  private readonly edges: Float32Array;
  private readonly count: number;
  private readonly settings: Record<string, number | boolean>;
  private readonly maxIterations: number;
  private readonly threshold: number;
  private iterations = 0;
  private calm = 0;
  private finished = false;

  constructor(input: LayoutInput, options: LayoutOptions = {}) {
    this.count = input.sizes.length;
    this.nodes = new Float32Array(this.count * PPN);
    for (let i = 0; i < this.count; i += 1) {
      const n = i * PPN;
      this.nodes[n] = input.positions[i * 2] ?? 0;
      this.nodes[n + 1] = input.positions[i * 2 + 1] ?? 0;
      this.nodes[n + 6] = 1; // mass: 1 + weighted degree (below)
      this.nodes[n + 7] = 1; // convergence
      this.nodes[n + 8] = input.sizes[i] ?? 1;
    }
    for (const index of input.fixed ?? []) {
      if (index < this.count) this.nodes[index * PPN + 9] = 1;
    }
    const edgeCount = input.weights.length;
    this.edges = new Float32Array(edgeCount * PPE);
    for (let e = 0; e < edgeCount; e += 1) {
      const source = input.edges[e * 2] ?? 0;
      const target = input.edges[e * 2 + 1] ?? 0;
      const weight = input.weights[e] ?? 1;
      this.edges[e * PPE] = source * PPN;
      this.edges[e * PPE + 1] = target * PPN;
      this.edges[e * PPE + 2] = weight;
      this.nodes[source * PPN + 6] = (this.nodes[source * PPN + 6] ?? 1) + weight;
      this.nodes[target * PPN + 6] = (this.nodes[target * PPN + 6] ?? 1) + weight;
    }
    const order = Math.max(1, this.count);
    // LinLog attraction pulls communities into tight, separate clusters; gentle gravity keeps
    // disconnected pieces from drifting away.
    this.settings = {
      linLogMode: true,
      outboundAttractionDistribution: false,
      adjustSizes: false,
      edgeWeightInfluence: 1,
      scalingRatio: order > 2000 ? 6 : 12,
      strongGravityMode: false,
      gravity: 1,
      slowDown: 1 + Math.log(order),
      barnesHutOptimize: order > 600,
      barnesHutTheta: 0.6,
    };
    this.maxIterations = options.maxIterations ?? (order > 5000 ? 400 : order > 1500 ? 700 : 1200);
    this.threshold = options.settleThreshold ?? 0.00035;
  }

  get done(): boolean {
    return this.finished;
  }

  get iteration(): number {
    return this.iterations;
  }

  /** Runs up to `iterations` steps; returns true once the layout has settled. */
  step(iterations: number): boolean {
    if (this.finished || this.count === 0) {
      this.finished = true;
      return true;
    }
    for (let i = 0; i < iterations && !this.finished; i += 1) {
      const before = this.snapshot();
      // Cooling: slow down over time so late iterations only polish.
      const base = 1 + Math.log(Math.max(1, this.count));
      this.settings.slowDown = base * (1 + this.iterations / 150);
      iterate(this.settings, this.nodes, this.edges);
      this.iterations += 1;
      const movement = this.movement(before);
      this.calm = movement < this.threshold ? this.calm + 1 : 0;
      if (this.calm >= 12 || this.iterations >= this.maxIterations) this.finished = true;
    }
    return this.finished;
  }

  /** Current positions (x, y per node). */
  positions(): Float32Array {
    const out = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i += 1) {
      out[i * 2] = this.nodes[i * PPN] ?? 0;
      out[i * 2 + 1] = this.nodes[i * PPN + 1] ?? 0;
    }
    return out;
  }

  private snapshot(): Float32Array {
    return this.positions();
  }

  /** Mean displacement since `before`, relative to the layout's extent. */
  private movement(before: Float32Array): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let total = 0;
    for (let i = 0; i < this.count; i += 1) {
      const x = this.nodes[i * PPN] ?? 0;
      const y = this.nodes[i * PPN + 1] ?? 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      total += Math.hypot(x - (before[i * 2] ?? 0), y - (before[i * 2 + 1] ?? 0));
    }
    const extent = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY));
    return total / this.count / extent;
  }
}
