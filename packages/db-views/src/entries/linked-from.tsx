import type { PageSectionProps } from '@tessera/core';
import { LinkedFrom } from '../ui/linked-from';

/** `pageTopSections`: rows that point at this page through one-way relations (none: nothing). */
export default function LinkedFromSection({ pageId }: PageSectionProps) {
  return <LinkedFrom pageId={pageId} />;
}
