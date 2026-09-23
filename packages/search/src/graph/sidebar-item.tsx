import { COMMANDS } from '@tessera/core';
import { useAppContext, useEvent } from '@tessera/core/react';
import { SidebarItem } from '@tessera/ui';
import { Network } from 'lucide-react';
import { useState } from 'react';
import { t } from '../i18n';
import { GRAPH_PATH, openGraph } from './location';

/** "Graph view" in the sidebar (a `sidebarSections` entry; light, part of the startup bundle). */
export function GraphSidebarItem() {
  const ctx = useAppContext();
  const [path, setPath] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.pathname,
  );
  useEvent('navigation.changed', (event) => setPath(event.path));
  return (
    <SidebarItem
      icon={<Network />}
      label={t('graphTitle')}
      active={path === GRAPH_PATH}
      onClick={() => {
        openGraph(ctx);
        // At phone width the sidebar is a drawer: the shell's toggle closes it.
        if (window.matchMedia('(max-width: 767px)').matches) {
          void ctx.commands.execute(COMMANDS.toggleSidebar, { source: 'menu' });
        }
      }}
    />
  );
}
