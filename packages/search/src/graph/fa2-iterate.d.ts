// graphology-layout-forceatlas2 ships no types for its single-iteration entry point.
declare module 'graphology-layout-forceatlas2/iterate.js' {
  export default function iterate(
    settings: Record<string, number | boolean>,
    nodeMatrix: Float32Array,
    edgeMatrix: Float32Array,
  ): unknown;
}
