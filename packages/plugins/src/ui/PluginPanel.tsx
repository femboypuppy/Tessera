import type { SidePanelProps } from '@tessera/core';
import { EmptyState, Spinner } from '@tessera/ui';
import { Puzzle } from 'lucide-react';
import type { ComponentType } from 'react';
import { t } from '../i18n';
import { SurfaceFrame } from './SurfaceFrame';
import { useHostVersion, usePluginHost } from './hooks';

const components = new Map<string, ComponentType<SidePanelProps>>();

/**
 * The side-panel component of one plugin panel. Cached per panel, so the component identity
 * survives plugin restarts and the open panel stays open.
 */
export function pluginPanelComponent(
  pluginId: string,
  panelId: string,
): ComponentType<SidePanelProps> {
  const key = `${pluginId}/${panelId}`;
  let component = components.get(key);
  if (!component) {
    const PluginPanel = ({ pageId, close }: SidePanelProps) => {
      const host = usePluginHost();
      useHostVersion(host);
      const instance = host?.instance(pluginId);
      const plugin = host?.manager.get(pluginId);
      const registration = instance?.registeredPanels.find((panel) => panel.id === panelId);
      if (!host || !instance || !plugin) {
        return (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        );
      }
      if (instance.status !== 'running' || !registration) {
        return (
          <EmptyState
            icon={<Puzzle />}
            title={t('panelUnavailable', { plugin: plugin.manifest.name })}
            description={instance.error ?? undefined}
          />
        );
      }
      return (
        <SurfaceFrame
          instance={instance}
          generation={instance.generation}
          surface={{ kind: 'panel', id: panelId, pageId }}
          title={t('panelFrameTitle', { title: registration.title, plugin: plugin.manifest.name })}
          onClose={close}
        />
      );
    };
    component = PluginPanel;
    components.set(key, component);
  }
  return component;
}
