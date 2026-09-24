import { Badge, Button, cn } from '@tessera/ui';
import { AlertTriangle, Info, Terminal, XCircle } from 'lucide-react';
import { useState } from 'react';
import { pluginConsoles } from '../../host/registry';
import type { ConsoleEntry } from '../../host/console';
import { t } from '../../i18n';
import { usePluginConsoleVersion } from './console-hooks';

/** Entries shown before "Show all". */
const VISIBLE = 100;

const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function LevelIcon({ level }: { level: ConsoleEntry['level'] }) {
  if (level === 'error')
    return <XCircle className="size-3.5 text-danger-text" aria-hidden="true" />;
  if (level === 'warn')
    return <AlertTriangle className="size-3.5 text-warning-text" aria-hidden="true" />;
  if (level === 'info') return <Info className="size-3.5 text-info-text" aria-hidden="true" />;
  return <span className="size-3.5" aria-hidden="true" />;
}

/** A plugin's console: its logs, errors, crashes and every call Tessera refused. */
export function ConsoleView({ pluginId, pluginName }: { pluginId: string; pluginName: string }) {
  usePluginConsoleVersion();
  const [showAll, setShowAll] = useState(false);
  const entries = pluginConsoles.entries(pluginId);
  // Newest first: the latest error is what people look for.
  const newest = [...entries].reverse();
  const shown = showAll ? newest : newest.slice(0, VISIBLE);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ui text-fg-muted">{entries.length ? null : t('consoleEmpty')}</p>
        <Button size="sm" disabled={!entries.length} onClick={() => pluginConsoles.clear(pluginId)}>
          {t('clearConsole')}
        </Button>
      </div>
      <div
        role="log"
        aria-label={t('consoleLabel', { plugin: pluginName })}
        className="min-h-32 rounded-lg border border-border bg-bg-subtle font-mono text-xs"
      >
        {entries.length ? (
          <ol className="divide-y divide-border">
            {shown.map((entry) => (
              <li
                key={entry.id}
                data-level={entry.level}
                className={cn(
                  'flex items-start gap-2 px-3 py-1.5',
                  entry.level === 'error' && 'bg-danger-subtle/40',
                  entry.level === 'warn' && 'bg-warning-subtle/40',
                )}
              >
                <span className="mt-0.5 flex shrink-0">
                  <LevelIcon level={entry.level} />
                </span>
                <time
                  className="shrink-0 text-fg-subtle tabular-nums"
                  dateTime={new Date(entry.time).toISOString()}
                >
                  {time.format(entry.time)}
                </time>
                <Badge tone={entry.source === 'host' ? 'accent' : 'neutral'} className="shrink-0">
                  {entry.source === 'host' ? t('consoleFromHost') : t('consoleFromPlugin')}
                  {entry.surface ? ` · ${entry.surface}` : ''}
                </Badge>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap text-fg">
                  {entry.message}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex h-32 items-center justify-center text-fg-subtle">
            <Terminal className="size-5" aria-hidden="true" />
          </div>
        )}
      </div>
      {!showAll && entries.length > VISIBLE ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
            {t('showAllEntries', { count: entries.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
