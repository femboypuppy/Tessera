/**
 * `@tessera/search/graph`: the light pieces the graph feature registers statically. The graph view
 * and the local graph (sigma, graphology, the layout worker) load on demand.
 */
import { lazy } from 'react';

export { openGraph, GRAPH_PATH } from './location';
export { GraphSidebarItem } from './sidebar-item';

/** The `/graph` route. */
export const GraphViewRoute = lazy(() => import('./graph-view'));

/** The local graph side panel. */
export const LocalGraphPanel = lazy(() => import('./local-graph-panel'));
