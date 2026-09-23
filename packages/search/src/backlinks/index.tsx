/**
 * `@tessera/search/backlinks`: the light wrappers the backlinks feature registers statically.
 * The footer host reads the workspace setting and loads the footer only when it is on; the panel
 * and the settings section load on demand.
 */
import type { PageSectionProps } from '@tessera/core';
import { useAppContext, useSetting } from '@tessera/core/react';
import { lazy, Suspense } from 'react';

/** Mirrors `SHOW_FOOTER_SETTING` in `./shared` (kept here so this module stays tiny). */
const SHOW_FOOTER = 'backlinks.showFooter';

const Footer = lazy(() => import('./footer'));
const Settings = lazy(() => import('./settings'));

/** Loads the backlinks panel (for `pageSidePanels`, which renders inside a Suspense boundary). */
export const BacklinksPanel = lazy(() => import('./panel'));

/** The footer section: nothing unless `backlinks.showFooter` is on. */
export function BacklinksFooterHost(props: PageSectionProps) {
  const ctx = useAppContext();
  const [show] = useSetting<boolean>(ctx.settings.workspace, SHOW_FOOTER, false);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <Footer {...props} />
    </Suspense>
  );
}

/** Settings → Backlinks. */
export function BacklinksSettingsHost() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  );
}
