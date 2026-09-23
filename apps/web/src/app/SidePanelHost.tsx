import { useAppContext, useContributions, usePage } from '@tessera/core/react';
import {
  EmptyState,
  FeatureBoundary,
  IconButton,
  Panel,
  PanelBody,
  PanelHeader,
  Spinner,
} from '@tessera/ui';
import { PanelRight } from 'lucide-react';
import { Suspense } from 'react';
import { t } from '../i18n';
import { useUiStore } from './ui-store';

/** The right-hand panel host: shows one `pageSidePanels` contribution, with tabs to switch. */
export function SidePanelHost({ panelId }: { panelId: string }) {
  const ctx = useAppContext();
  const pageId = useUiStore((state) => state.currentPageId);
  const setPanel = useUiStore((state) => state.setSidePanel);
  const page = usePage(pageId) ?? null;
  const panels = useContributions('pageSidePanels').filter(
    (panel) => !panel.when || panel.when(page, ctx),
  );
  const panel = panels.find((candidate) => candidate.id === panelId);
  const close = () => setPanel(null);
  const tabs =
    panels.length > 1
      ? panels.map((candidate) => {
          const Icon = candidate.icon ?? PanelRight;
          return (
            <IconButton
              key={candidate.id}
              size="sm"
              label={candidate.title}
              icon={<Icon />}
              aria-pressed={candidate.id === panelId}
              onClick={() => setPanel(candidate.id)}
            />
          );
        })
      : null;
  if (!panel) {
    return (
      <Panel aria-label={t('panels')}>
        <PanelHeader title={t('panels')} onClose={close} actions={tabs} />
        <PanelBody>
          <EmptyState icon={<PanelRight />} title={t('noBodyTitle')} />
        </PanelBody>
      </Panel>
    );
  }
  const Icon = panel.icon;
  const Component = panel.component;
  return (
    <Panel aria-label={panel.title}>
      <PanelHeader
        title={panel.title}
        icon={Icon ? <Icon /> : undefined}
        actions={tabs}
        onClose={close}
      />
      <PanelBody className="p-0">
        <FeatureBoundary featureId={panel.featureId} resetKeys={[pageId, panel.id]} className="m-3">
          <Suspense
            fallback={
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            }
          >
            <Component pageId={pageId} page={page} close={close} />
          </Suspense>
        </FeatureBoundary>
      </PanelBody>
    </Panel>
  );
}
