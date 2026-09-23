/** The print view's route (the PDF export opens it). */
export const PRINT_ROUTE = '/print/:pageId';

/** The print view of a page; `print` opens the print dialog once it has rendered. */
export function printPath(pageId: string, print = false): string {
  return `/print/${encodeURIComponent(pageId)}${print ? '?print=1' : ''}`;
}
