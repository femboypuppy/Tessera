import { useServerLink } from '../hooks';
import { ConnectedWorkspace } from './ConnectedWorkspace';
import { ConnectFlow } from './ConnectFlow';
import { StorageSection } from './StorageSection';

/**
 * Settings → Sync & account. A local workspace can connect to a server (upload it, or open a
 * server workspace instead); a connected one shows its status, account, people, invites and
 * devices. `?join=1` (the first-run "join" button) opens the connect form right away.
 */
export function SyncSettingsPanel() {
  const link = useServerLink();
  const autoStart =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('join');
  return (
    <div className="flex flex-col gap-8">
      {link ? <ConnectedWorkspace link={link} /> : <ConnectFlow autoStart={autoStart} />}
      <StorageSection />
    </div>
  );
}
