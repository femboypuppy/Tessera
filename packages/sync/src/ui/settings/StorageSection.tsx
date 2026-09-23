import { Button, Callout } from '@tessera/ui';
import { ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { isStoragePersisted, requestPersistentStorage } from '../../feature/storage-health';
import { t } from '../../i18n';
import { useAsync } from '../hooks';
import { Section } from './parts';

/**
 * Whether the browser may evict this device's copy under storage pressure, and a button to ask
 * it not to. (Some browsers show a permission prompt, so it's only asked on request.)
 */
export function StorageSection() {
  const id = useId();
  const persisted = useAsync(() => isStoragePersisted(), []);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  if (persisted.status !== 'ready' || persisted.data === null) return null;
  return (
    <Section title={t('storageSection')} labelledBy={`${id}-storage`}>
      {persisted.data ? (
        <p className="flex items-center gap-2 text-ui text-fg-muted">
          <ShieldCheck className="size-4 shrink-0 text-success-text" aria-hidden="true" />
          {t('storageProtected')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ui text-fg-muted">{t('storageNotProtected')}</p>
          {denied ? <Callout tone="info">{t('storageProtectDenied')}</Callout> : null}
          <Button
            className="self-start"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void requestPersistentStorage({ interactive: true }).then((granted) => {
                setBusy(false);
                setDenied(!granted);
                if (granted) persisted.reload();
              });
            }}
          >
            <ShieldCheck aria-hidden="true" />
            {t('protectStorage')}
          </Button>
        </div>
      )}
    </Section>
  );
}
