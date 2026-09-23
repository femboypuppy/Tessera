import type { PluginPermission } from '@tessera/core';
import { Badge, cn } from '@tessera/ui';
import {
  Blocks,
  Command,
  Database,
  DatabaseZap,
  FilePen,
  FileText,
  Globe,
  HardDrive,
  PanelRight,
  type LucideIcon,
} from 'lucide-react';
import { t } from '../../i18n';
import { describePermission } from '../../manifest';
import type { InstanceStatus } from '../../host/instance';

/** A plugin's emoji on a tile. */
export function PluginIcon({
  icon,
  size = 'md',
  className,
}: {
  icon: string | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-border bg-bg-subtle leading-none',
        size === 'sm' && 'size-8 text-base',
        size === 'md' && 'size-10 text-xl',
        size === 'lg' && 'size-14 rounded-xl text-3xl',
        className,
      )}
    >
      {icon ?? '🧩'}
    </span>
  );
}

const PERMISSION_ICONS: Record<string, LucideIcon> = {
  'pages:read': FileText,
  'pages:write': FilePen,
  'databases:read': Database,
  'databases:write': DatabaseZap,
  'ui:commands': Command,
  'ui:panels': PanelRight,
  'ui:blocks': Blocks,
  storage: HardDrive,
};

/** The icon of a permission. */
export function PermissionIcon({
  permission,
  className,
}: {
  permission: PluginPermission;
  className?: string;
}) {
  const Icon = permission.startsWith('network:') ? Globe : (PERMISSION_ICONS[permission] ?? Blocks);
  return <Icon className={cn('size-4', className)} aria-hidden="true" />;
}

/** A permission in plain language: icon, title, explanation and a risk badge for risky ones. */
export function PermissionSummary({
  permission,
  badge,
}: {
  permission: PluginPermission;
  badge?: string;
}) {
  const description = describePermission(permission);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
          description.risk === 'high'
            ? 'bg-warning-subtle text-warning-text'
            : description.risk === 'medium'
              ? 'bg-accent-subtle text-accent-text'
              : 'bg-hover text-fg-muted',
        )}
      >
        <PermissionIcon permission={permission} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
          <span className="break-words">{description.title}</span>
          {badge ? <Badge tone="accent">{badge}</Badge> : null}
          {description.risk === 'high' ? <Badge tone="warning">{t('riskHigh')}</Badge> : null}
          {description.risk === 'medium' ? <Badge tone="neutral">{t('riskMedium')}</Badge> : null}
        </p>
        <p className="mt-0.5 text-ui text-fg-muted">{description.text}</p>
      </div>
    </div>
  );
}

/** A colored dot and label for a plugin's status. */
export function StatusLabel({
  status,
  enabled,
  className,
}: {
  status: InstanceStatus | undefined;
  enabled: boolean;
  className?: string;
}) {
  let label: string;
  let dot: string;
  if (!enabled) {
    label = t('statusOff');
    dot = 'bg-fg-disabled';
  } else if (status === 'running') {
    label = t('statusRunning');
    dot = 'bg-success';
  } else if (status === 'crashed') {
    label = t('statusCrashed');
    dot = 'bg-danger';
  } else if (status === 'error') {
    label = t('statusError');
    dot = 'bg-danger';
  } else {
    label = t('statusStarting');
    dot = 'bg-warning';
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-fg-muted', className)}>
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden="true" />
      {label}
    </span>
  );
}
