import type { PageSectionProps } from '@tessera/core';
import { RowPropertiesPanel } from '../ui/row-properties';

/** `pageTopSections`: a database row's properties, between its title and its content. */
export default function RowPropertiesSection({ pageId, readOnly }: PageSectionProps) {
  return (
    <div className="mt-4">
      <RowPropertiesPanel pageId={pageId} readOnly={readOnly} />
    </div>
  );
}
