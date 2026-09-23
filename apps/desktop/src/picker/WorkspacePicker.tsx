import { toError } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from '@tessera/ui';
import {
  AlertTriangle,
  ArrowLeft,
  Cloud,
  FolderOpen,
  FolderSearch,
  FolderX,
  MoreHorizontal,
  Plus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FolderInfo } from '../backend/protocol';
import { t } from '../i18n';
import { displayPath, joinPath, revealLabel } from '../lib/paths';
import { getBackend } from '../runtime';
import type { DesktopWorkspace } from '../stores/workspace-registry';
import {
  createWorkspaceIn,
  desktopRegistry,
  locateWorkspace,
  pickAndOpenFolder,
  providerName,
} from '../workspace/flows';
import { closePicker } from './store';

interface Row {
  workspace: DesktopWorkspace;
  folder: FolderInfo | null;
}

type LoadState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: Row[] };

function WorkspaceBadge({ name, icon }: { name: string; icon?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-fg"
    >
      {icon ?? name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The desktop workspace picker (File → Open workspace…, Mod+O): recent workspaces with their
 * folders, and ways to open a folder or create a workspace. Each workspace is a folder on disk.
 */
export function WorkspacePicker({ initialView }: { initialView: 'list' | 'new' }) {
  const ctx = useAppContext();
  const registry = desktopRegistry(ctx.services.workspaceRegistry);
  const backend = getBackend();
  const [view, setView] = useState(initialView);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const home = useMemo(() => {
    const root = registry?.defaultFolder;
    return root ? root.replace(/[\\/][^\\/]+[\\/]?$/, '') : null;
  }, [registry]);

  const load = useCallback(async () => {
    if (!registry) return;
    try {
      const workspaces = await registry.listAll();
      const folders = await Promise.all(
        workspaces.map((workspace) =>
          workspace.status === 'missing'
            ? null
            : backend.inspectFolder(workspace.path).catch(() => null),
        ),
      );
      setState({
        status: 'ready',
        rows: workspaces.map((workspace, index) => ({
          workspace,
          folder: folders[index] ?? null,
        })),
      });
    } catch (error) {
      setState({ status: 'error', message: toError(error).message });
    }
  }, [backend, registry]);

  useEffect(() => {
    void load();
    return registry?.subscribe(() => void load());
  }, [load, registry]);

  if (!registry) return null;

  const switchTo = (id: string) => {
    closePicker();
    if (id !== ctx.workspace.info.id) ctx.switchWorkspace(id);
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const openFolder = () =>
    run(async () => {
      const id = await pickAndOpenFolder(backend, registry, ctx);
      if (id) switchTo(id);
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : closePicker())}>
      <DialogContent size="md" aria-describedby="desktop-picker-description">
        {view === 'list' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('pickerTitle')}</DialogTitle>
              <DialogDescription id="desktop-picker-description">
                {t('pickerDescription')}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="px-3">
              <WorkspaceList
                state={state}
                currentId={ctx.workspace.info.id}
                home={home}
                os={ctx.platform.os}
                onOpen={switchTo}
                onRetry={() => void load()}
                onReveal={(row) =>
                  void backend.revealFolder(row.workspace.path).catch((error: unknown) =>
                    ctx.toast({
                      variant: 'error',
                      title: t('openFailed'),
                      description: toError(error).message,
                    }),
                  )
                }
                onLocate={(row) =>
                  void run(async () => {
                    if (await locateWorkspace(backend, registry, ctx, row.workspace)) await load();
                  })
                }
                onRemove={(row) =>
                  void run(async () => {
                    const confirmed = await ctx.confirm({
                      title: t('removeConfirmTitle', { name: row.workspace.name }),
                      description: t('removeConfirmBody'),
                      confirmLabel: t('removeFromList'),
                      destructive: true,
                    });
                    if (!confirmed) return;
                    await registry.remove(row.workspace.id);
                    ctx.toast({ title: t('removed', { name: row.workspace.name }) });
                  })
                }
              />
            </DialogBody>
            <DialogFooter className="justify-between border-t border-border pt-4">
              <Button variant="secondary" onClick={() => void openFolder()} disabled={busy}>
                <FolderOpen aria-hidden="true" />
                {t('openFolder')}
              </Button>
              <Button variant="primary" onClick={() => setView('new')} disabled={busy}>
                <Plus aria-hidden="true" />
                {t('newWorkspace')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <NewWorkspaceForm
            defaultParent={registry.defaultFolder}
            home={home}
            showBack={initialView === 'list'}
            onBack={() => setView('list')}
            onCreate={async (input) => {
              const id = await createWorkspaceIn(backend, registry, ctx, input);
              if (id) switchTo(id);
            }}
            onBrowse={(current) => backend.pickFolder(t('chooseParentTitle'), current)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceList({
  state,
  currentId,
  home,
  os,
  onOpen,
  onRetry,
  onReveal,
  onLocate,
  onRemove,
}: {
  state: LoadState;
  currentId: string;
  home: string | null;
  os: string;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onReveal: (row: Row) => void;
  onLocate: (row: Row) => void;
  onRemove: (row: Row) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-2 px-2 py-1" aria-busy="true" aria-label={t('loading')}>
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex items-center gap-3 py-1.5">
            <Skeleton className="size-8 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <EmptyState
        tone="danger"
        icon={<AlertTriangle />}
        title={t('loadFailed', { message: state.message })}
        actions={
          <Button size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        }
      />
    );
  }
  if (state.rows.length === 0) {
    return <EmptyState icon={<FolderOpen />} title={t('noWorkspaces')} />;
  }

  // Arrow keys move between workspaces (Tab reaches each row's menu).
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-workspace-row]') ?? []),
    ];
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <section aria-labelledby="desktop-recent-heading">
      <h3
        id="desktop-recent-heading"
        className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle"
      >
        {t('recentWorkspaces')}
      </h3>
      {/* A list of rows, each a button plus a menu; arrows move between the rows' buttons. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow-key roving between the buttons inside */}
      <ul ref={listRef} className="flex flex-col gap-0.5" onKeyDown={onKeyDown}>
        {state.rows.map((row) => {
          const { workspace, folder } = row;
          const current = workspace.id === currentId;
          const missing = workspace.status === 'missing';
          return (
            <li key={workspace.id} className="group relative flex items-center">
              <button
                type="button"
                data-workspace-row=""
                disabled={missing}
                aria-current={current ? 'true' : undefined}
                onClick={() => onOpen(workspace.id)}
                className={cn(
                  'duration-fast flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 pr-11 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  missing ? 'cursor-default opacity-70' : 'hover:bg-hover',
                  current && 'bg-active',
                )}
              >
                {missing ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-fg-subtle"
                  >
                    <FolderX className="size-4" />
                  </span>
                ) : (
                  <WorkspaceBadge name={workspace.name} icon={workspace.icon} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{workspace.name}</span>
                    {current ? <Badge tone="accent">{t('currentWorkspace')}</Badge> : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-xs text-fg-subtle">
                    <span className="truncate" title={workspace.path}>
                      {displayPath(workspace.path, home)}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1 empty:hidden">
                    {missing ? <Badge tone="danger">{t('statusMissing')}</Badge> : null}
                    {workspace.status === 'new' ? (
                      <Badge tone="neutral">{t('statusNew')}</Badge>
                    ) : null}
                    {folder?.cloud ? (
                      <Badge tone="warning">
                        <Cloud className="size-3" aria-hidden="true" />
                        {t('syncedBy', { provider: providerName(folder.cloud.provider) })}
                      </Badge>
                    ) : null}
                    {folder && folder.conflicts.length > 0 ? (
                      <Badge tone="danger">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {t('conflictCount', { count: folder.conflicts.length })}
                      </Badge>
                    ) : null}
                  </span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('workspaceActions', { name: workspace.name })}
                    className="duration-fast absolute right-2 inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {missing ? (
                    <DropdownMenuItem icon={<FolderSearch />} onSelect={() => onLocate(row)}>
                      {t('locate')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem icon={<FolderOpen />} onSelect={() => onReveal(row)}>
                      {revealLabel(os)}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<X />}
                    destructive
                    disabled={current}
                    onSelect={() => onRemove(row)}
                  >
                    {t('removeFromList')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NewWorkspaceForm({
  defaultParent,
  home,
  showBack,
  onBack,
  onCreate,
  onBrowse,
}: {
  defaultParent: string | null;
  home: string | null;
  showBack: boolean;
  onBack: () => void;
  onCreate: (input: { name: string; parent: string }) => Promise<void>;
  onBrowse: (current: string | undefined) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(defaultParent ?? '');
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const preview = parent && trimmed ? joinPath(parent, trimmed) : null;

  const submit = async () => {
    if (!trimmed || !parent) return;
    setBusy(true);
    try {
      await onCreate({ name: trimmed, parent });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('newWorkspaceTitle')}</DialogTitle>
        <DialogDescription id="desktop-picker-description">
          {t('newWorkspaceDescription')}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 py-3">
        <Field label={t('nameLabel')}>
          {(props) => (
            <Input
              {...props}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the form opens for this field
              autoFocus
              value={name}
              maxLength={100}
              placeholder={t('defaultWorkspaceName')}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          label={t('locationLabel')}
          description={preview ? t('willCreate', { path: displayPath(preview, home) }) : undefined}
        >
          {(props) => (
            <div className="flex gap-2">
              <Input
                {...props}
                readOnly
                value={displayPath(parent, home)}
                title={parent}
                className="min-w-0 flex-1 text-fg-muted"
              />
              <Button
                type="button"
                onClick={() =>
                  void onBrowse(parent || undefined).then((picked) => {
                    if (picked) setParent(picked);
                  })
                }
              >
                {t('browse')}
              </Button>
            </div>
          )}
        </Field>
      </DialogBody>
      <DialogFooter className={cn(showBack && 'justify-between')}>
        {showBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {t('back')}
          </Button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={!trimmed || !parent || busy}
        >
          {t('createWorkspace')}
        </Button>
      </DialogFooter>
    </form>
  );
}
