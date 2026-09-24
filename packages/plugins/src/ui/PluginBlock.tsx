import { hasPluginPermission, parseEmbedKind, type BlockRendererProps } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { Button, cn, Skeleton } from '@tessera/ui';
import { AlertTriangle, Puzzle, RotateCcw, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { SurfaceFrame } from './SurfaceFrame';
import { useHostVersion, usePluginHost } from './hooks';

function Placeholder({
  icon,
  title,
  description,
  actions,
  tone = 'neutral',
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-dashed border-border-strong bg-bg-subtle px-3.5 py-3 text-ui"
      role={tone === 'warning' ? 'alert' : 'note'}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
          tone === 'warning' ? 'bg-warning-subtle text-warning-text' : 'bg-hover text-fg-muted',
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{title}</p>
        {description ? <p className="mt-0.5 break-words text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/**
 * Renders every `plugin:<id>/<type>` embed. The block itself runs in the plugin's sandboxed frame;
 * this component handles everything around it: a missing, disabled, crashed or not-yet-started
 * plugin, a block type the plugin doesn't provide, and a missing permission.
 */
export default function PluginBlock(props: BlockRendererProps) {
  const ctx = useAppContext();
  const host = usePluginHost();
  useHostVersion(host);
  const parsed = parseEmbedKind(props.kind);
  if (parsed.type !== 'plugin') {
    return <Placeholder icon={<Puzzle />} title={t('invalidBlock')} description={props.kind} />;
  }
  const { pluginId, blockType } = parsed;
  const settingsLink = `/settings/plugins?plugin=${encodeURIComponent(pluginId)}`;
  if (!host) return <Skeleton className="h-24 w-full rounded-lg" />;
  const plugin = host.manager.get(pluginId);
  if (!plugin) {
    return (
      <Placeholder
        icon={<Puzzle />}
        title={t('blockNeedsPlugin', { plugin: pluginId })}
        description={t('blockNeedsPluginHint')}
        actions={
          <Button
            size="sm"
            onClick={() =>
              ctx.navigateTo(`/settings/plugins?tab=browse&q=${encodeURIComponent(pluginId)}`)
            }
          >
            {t('browsePlugins')}
          </Button>
        }
      />
    );
  }
  const name = plugin.manifest.name;
  if (!plugin.enabled) {
    return (
      <Placeholder
        icon={<span className="text-base">{plugin.manifest.icon ?? '🧩'}</span>}
        title={t('pluginDisabled', { plugin: name })}
        description={t('pluginDisabledHint')}
        actions={
          <Button size="sm" onClick={() => void host.manager.setEnabled(pluginId, true)}>
            {t('turnOn')}
          </Button>
        }
      />
    );
  }
  const instance = host.instance(pluginId);
  if (!instance || instance.status === 'starting' || instance.status === 'stopped') {
    return (
      <div
        className="flex h-24 w-full flex-col gap-2 rounded-lg p-3"
        aria-busy="true"
        aria-label={t('loadingPlugin', { plugin: name })}
      >
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (instance.status === 'crashed' || instance.status === 'error') {
    return (
      <Placeholder
        tone="warning"
        icon={<AlertTriangle />}
        title={t('pluginStopped', { plugin: name })}
        description={instance.error ?? undefined}
        actions={
          <>
            <Button size="sm" onClick={() => void host.restart(pluginId)}>
              <RotateCcw aria-hidden="true" />
              {t('restart')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => ctx.navigateTo(settingsLink)}>
              <Settings2 aria-hidden="true" />
              {t('pluginSettings')}
            </Button>
          </>
        }
      />
    );
  }
  if (!instance.hasBlock(blockType)) {
    const missingPermission = !hasPluginPermission(plugin.granted, 'ui:blocks');
    return (
      <Placeholder
        tone={missingPermission ? 'warning' : 'neutral'}
        icon={<span className="text-base">{plugin.manifest.icon ?? '🧩'}</span>}
        title={
          missingPermission
            ? t('blockNeedsPermission', { plugin: name })
            : t('blockUnknownType', { plugin: name, type: blockType })
        }
        actions={
          missingPermission ? (
            <Button size="sm" onClick={() => ctx.navigateTo(settingsLink)}>
              {t('review')}
            </Button>
          ) : undefined
        }
      />
    );
  }
  const registration = instance.registeredBlocks.find((block) => block.type === blockType);
  return (
    <SurfaceFrame
      instance={instance}
      generation={instance.generation}
      surface={{
        kind: 'block',
        type: blockType,
        pageId: props.pageId,
        blockId: props.blockId,
        data: props.data,
        readOnly: props.readOnly,
        selected: props.selected,
      }}
      title={t('blockFrameTitle', { title: registration?.title ?? blockType, plugin: name })}
      heightKey={props.blockId ?? `${props.pageId}:${props.kind}`}
      onSetData={(data) => props.updateData(data)}
      onRemove={() => props.deleteBlock()}
      className={cn(props.selected && 'ring-2 ring-focus')}
    />
  );
}
