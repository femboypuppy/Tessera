import { useAppContext, usePages } from '@tessera/core/react';
import { Button, EmptyState } from '@tessera/ui';
import { FilePlus2 } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { t } from '../../i18n';
import { createPageAndOpen } from '../page-helpers';

/** `/`: reopens the last page, or the first one, or offers to create one. */
export function HomeView() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const snapshot = usePages();
  const lastPageId = ctx.settings.device.get(`shell.lastPage.${ctx.workspace.info.id}`);
  const last = typeof lastPageId === 'string' ? snapshot.get(lastPageId) : undefined;
  const target = last && !snapshot.isTrashed(last.id) ? last : snapshot.children(null)[0];
  if (target) return <Navigate to={`/p/${target.id}`} replace />;
  return (
    <EmptyState
      className="mt-[18vh]"
      icon={<FilePlus2 />}
      title={t('emptyWorkspaceTitle')}
      description={t('emptyWorkspaceHint')}
      actions={
        <Button variant="primary" onClick={() => createPageAndOpen(ctx, navigate)}>
          {t('newPage')}
        </Button>
      }
    />
  );
}
