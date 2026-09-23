import { expect, test as base, type Page } from '@playwright/test';
import {
  installFakeTauri,
  type FakeFolder,
  type FakeTauriHandle,
  type FakeTauriOptions,
} from '../../apps/desktop/src/testing/fake-tauri';
import { readDiagnostics } from '../architect/helpers';

/**
 * The desktop feature runs only inside Tauri. These specs run the production web build in the
 * browser with the fake Tauri runtime (`apps/desktop/src/testing/fake-tauri.ts`) injected before
 * the app loads: every IPC command answers like the Rust side, with a fake disk kept in
 * localStorage (so reloads and the quick-capture window share it).
 */

export const HOME = 'C:/Users/ada';

/** Installs the fake before any page script runs (main window unless `windowLabel` says otherwise). */
export async function useDesktop(page: Page, options: FakeTauriOptions = {}): Promise<void> {
  await page.addInitScript(installFakeTauri, {
    home: HOME,
    os: 'windows',
    persist: true,
    ...options,
  });
}

/** A copy of the fake's state: registry, fake disk, menus, window title, zoom, mirror files… */
export async function fakeState(page: Page): Promise<FakeTauriHandle['state']> {
  return page.evaluate(
    () => (window as unknown as { __fakeTauri: FakeTauriHandle }).__fakeTauri.state,
  );
}

/** Adds a folder to the fake disk (and saves it for later reloads). */
export async function addFolder(page: Page, path: string, folder: FakeFolder): Promise<void> {
  await page.evaluate(
    ({ path, folder }) =>
      (window as unknown as { __fakeTauri: FakeTauriHandle }).__fakeTauri.addFolder(path, folder),
    { path, folder },
  );
}

/** Answers the next native folder dialog. */
export async function queuePick(page: Page, path: string | null): Promise<void> {
  await page.evaluate(
    (path) => (window as unknown as { __fakeTauri: FakeTauriHandle }).__fakeTauri.queuePick(path),
    path,
  );
}

/** Simulates a click on a native menu item (Rust emits `desktop://menu`). */
export async function clickMenu(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (id) =>
      (window as unknown as { __fakeTauri: FakeTauriHandle }).__fakeTauri.emit(
        'desktop://menu',
        id,
      ),
    id,
  );
}

/** Creates a workspace through onboarding and waits for the desktop services. */
export async function createDesktopWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await expect(page.getByText('Your workspace is empty')).toBeVisible();
  await expect
    .poll(async () => (await readDiagnostics(page))?.services.docStore)
    .toBe('tauri-sqlite');
}

export const test = base;
export { expect };
