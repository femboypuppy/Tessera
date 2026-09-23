import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
} from '@tessera/ui';
import { ChevronsUpDown, Plus, Settings } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../../i18n';
import { useWorkspaceControl } from '../WorkspaceRoot';

/** A small square with the workspace's emoji or initial. */
export function WorkspaceBadge({ name, icon }: { name: string; icon?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-accent text-2xs font-semibold text-accent-fg"
    >
      {icon ?? name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const control = useWorkspaceControl();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await control.create(name.trim());
      onOpenChange(false);
      setName('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t('newWorkspace')}</DialogTitle>
            <DialogDescription>{t('welcomeBody')}</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-2">
            <Field label={t('workspaceNameLabel')}>
              {(props) => (
                <Input
                  {...props}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens for this input
                  autoFocus
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('defaultWorkspaceName')}
                />
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
              {t('newWorkspace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The workspace menu at the top of the sidebar: switch, create, settings. */
export function WorkspaceSwitcher() {
  const control = useWorkspaceControl();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const current = control.current;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('switchWorkspace')}
            className="duration-fast flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-fg transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover"
          >
            {current ? <WorkspaceBadge name={current.name} icon={current.icon} /> : null}
            <span className="min-w-0 flex-1 truncate">{current?.name ?? t('appName')}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{t('workspaces')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current?.id ?? ''}
            onValueChange={(id) => control.switchTo(id)}
          >
            {control.workspaces.map((workspace) => (
              <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <WorkspaceBadge name={workspace.name} icon={workspace.icon} />
                  <span className="truncate">{workspace.name}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Plus />} onSelect={() => setCreating(true)}>
            {t('newWorkspace')}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Settings />} onSelect={() => void navigate('/settings')}>
            {t('settings')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
