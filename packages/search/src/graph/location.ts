import type { AppContext } from '@tessera/core';

export const GRAPH_PATH = '/graph';

/** The page `/graph?focus=<id>` asks to focus, if any. */
export function readGraphFocus(search: string = globalThis.location?.search ?? ''): string | null {
  const focus = new URLSearchParams(search).get('focus');
  return focus && /^[A-Za-z0-9_-]{1,64}$/.test(focus) ? focus : null;
}

/** Opens the graph view, optionally focused on a page. */
export function openGraph(ctx: Pick<AppContext, 'navigateTo'>, focus?: string | null): void {
  ctx.navigateTo(focus ? `${GRAPH_PATH}?focus=${encodeURIComponent(focus)}` : GRAPH_PATH);
}
