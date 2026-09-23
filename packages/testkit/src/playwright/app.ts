/**
 * Helpers for driving the app shell in Playwright, using the labels the shell exposes to
 * assistive technology (see e2e/architect). Feature UIs are driven by the journeys themselves.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  describeMissing,
  missingFeatures,
  readDiagnostics,
  type Diagnostics,
  type FeatureName,
} from './features';

export class TesseraApp {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  sidebar(): Locator {
    return this.page.getByRole('navigation', { name: 'Sidebar' });
  }

  pageTree(): Locator {
    return this.sidebar().getByRole('tree', { name: 'Pages' });
  }

  treeItem(title: string): Locator {
    return this.pageTree().getByRole('treeitem', { name: title, exact: true });
  }

  titleField(): Locator {
    return this.page.getByRole('textbox', { name: 'Page title' });
  }

  /** Opens the app and creates an empty workspace through onboarding. */
  async createWorkspace(name = 'Journey workspace'): Promise<void> {
    await this.page.goto('/');
    await this.page.getByLabel('Workspace name').fill(name);
    await this.page.getByRole('button', { name: 'Create an empty workspace' }).click();
    await expect(this.page.getByText('Your workspace is empty')).toBeVisible();
  }

  /** Creates a page with the sidebar's "New page" button and types its title. */
  async newPage(title: string): Promise<void> {
    await this.sidebar().getByRole('button', { name: 'New page', exact: true }).first().click();
    await expect(this.titleField()).toBeFocused();
    await expect(this.titleField()).toHaveValue('');
    await this.page.keyboard.type(title);
    await expect(this.treeItem(title)).toBeVisible();
  }

  /** Opens a page from the sidebar tree and waits for its title. */
  async openPage(title: string): Promise<void> {
    await this.treeItem(title).click();
    await expect(this.titleField()).toHaveValue(title);
  }

  /** Presses a shortcut written like the app's (`Mod+K`: ⌘ on macOS, Ctrl elsewhere). */
  async shortcut(keys: string): Promise<void> {
    await this.page.keyboard.press(keys.replace(/\bMod\b/g, 'ControlOrMeta'));
  }

  /** The diagnostics of the open workspace (waits until a workspace is open). */
  async diagnostics(): Promise<Diagnostics> {
    await expect
      .poll(() => readDiagnostics(this.page), { message: 'a workspace to open' })
      .not.toBeNull();
    const diagnostics = await readDiagnostics(this.page);
    if (!diagnostics) throw new Error('No workspace is open');
    return diagnostics;
  }

  /**
   * Skips the current test, with a message naming what is missing and who builds it, unless the
   * running app has every feature in `required`. Call it after a workspace is open.
   */
  async requireFeatures(...required: FeatureName[]): Promise<void> {
    const missing = missingFeatures(await this.diagnostics(), required);
    test.skip(missing.length > 0, describeMissing(missing));
  }
}
