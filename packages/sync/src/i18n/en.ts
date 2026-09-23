/** English strings of the `sync` namespace. */
export const en = {
  // Local storage
  storageFullTitle: 'Storage is full',
  storageFullBody:
    'Your latest changes are safe in this tab but can’t be saved to disk yet. Free up disk space; Tessera keeps retrying.',
  storageClosedTitle: 'This workspace changed in another tab',
  storageClosedBody: 'Reload the page to keep working.',
  storageErrorTitle: 'Couldn’t save your latest changes',
  storageErrorBody: 'Tessera keeps them in this tab and retries. Details: {message}',
  storageUnavailableTitle: 'This browser won’t keep your work',
  storageUnavailableBody:
    'Tessera can’t store data here (private browsing?). Changes are lost when you close the tab.',
  reload: 'Reload',
} as const;
