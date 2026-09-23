import { useAppContext } from '@tessera/core/react';
import { Button, EmptyState } from '@tessera/ui';
import { Compass } from 'lucide-react';
import { t } from '../../i18n';

/** Any address that matches no route. */
export function NotFoundView() {
  const ctx = useAppContext();
  return (
    <EmptyState
      className="mt-24"
      icon={<Compass />}
      title={t('notFound')}
      description={t('notFoundHint')}
      actions={<Button onClick={() => ctx.navigateTo('/')}>{t('goHome')}</Button>}
    />
  );
}
