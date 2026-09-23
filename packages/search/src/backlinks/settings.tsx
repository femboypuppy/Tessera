import { useAppContext, useSetting } from '@tessera/core/react';
import { Switch } from '@tessera/ui';
import { useId } from 'react';
import { t } from '../i18n';
import { SHOW_FOOTER_SETTING } from './shared';

/** Settings → Backlinks: the footer toggle (a workspace setting, shared with collaborators). */
export default function BacklinksSettings() {
  const ctx = useAppContext();
  const [show, setShow] = useSetting<boolean>(ctx.settings.workspace, SHOW_FOOTER_SETTING, false);
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={show}
        aria-describedby={`${id}-hint`}
        onCheckedChange={(checked) => setShow(checked)}
        className="mt-0.5"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {t('showFooter')}
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-ui text-fg-muted">
          {t('showFooterHint')}
        </p>
      </div>
    </div>
  );
}
