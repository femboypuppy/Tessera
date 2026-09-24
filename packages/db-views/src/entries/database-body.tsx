import type { PageBodyProps } from '@tessera/core';
import { useEffect, useRef } from 'react';
import { DatabaseView } from '../ui/database-view';

/**
 * The body of a database page (`pageBodies.database`): its views, full size. Enter in the page
 * title moves focus into the active view.
 */
export default function DatabaseBody({ pageId, readOnly, registerFocusHandler }: PageBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      registerFocusHandler(() => {
        const target = ref.current?.querySelector<HTMLElement>(
          '[role="grid"], [data-card-id], [data-list-index], [role="tab"][aria-selected="true"]',
        );
        target?.focus();
      }),
    [registerFocusHandler],
  );
  return (
    <div ref={ref} className="mt-4">
      <DatabaseView databaseId={pageId} variant="page" readOnly={readOnly} />
    </div>
  );
}
