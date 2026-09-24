import { expect, type Locator, type Page } from '@playwright/test';

/** Helpers for the editor specs. Every test starts at onboarding, in a fresh browser context. */

/** A node of the editor's JSON (TipTap `getJSON()`), loosely typed. */
export interface NodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NodeJSON[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/** The editor surface. */
export function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Page content' });
}

/** The page title field. */
export function titleField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Page title' });
}

/** The sidebar page tree. */
export function pageTree(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Sidebar' }).getByRole('tree', { name: 'Pages' });
}

/** Opens the app and creates an empty workspace through onboarding. */
export async function createWorkspace(page: Page, name = 'Apollo research'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await expect(page.getByText('Your workspace is empty')).toBeVisible();
}

/**
 * Creates a page with the sidebar's "New page" button, types its title and waits for the editor.
 * With `enter`, Enter moves the caret into the body.
 */
export async function createPage(page: Page, title: string, { enter = true } = {}): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'New page', exact: true })
    .first()
    .click();
  await expect(titleField(page)).toBeFocused();
  // The editor is a lazy chunk: the first page of a session waits for it to load.
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.type(title);
  if (enter) {
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
  }
}

/** Opens a page from the sidebar tree. */
export async function openPage(page: Page, title: string): Promise<void> {
  await pageTree(page).getByRole('treeitem', { name: title, exact: true }).click();
  await expect(titleField(page)).toHaveValue(title);
  await expect(editor(page)).toBeVisible();
}

/** The editor's document as JSON (TipTap exposes the editor on its DOM element). */
export async function docJSON(page: Page): Promise<NodeJSON> {
  return editor(page).evaluate((element) => {
    const instance = (element as HTMLElement & { editor?: { getJSON(): unknown } }).editor;
    if (!instance) throw new Error('No editor on the page');
    return instance.getJSON() as NodeJSON;
  });
}

/** Replaces the document (through the editor, so it goes through Yjs like any edit). */
export async function setDoc(page: Page, doc: NodeJSON): Promise<void> {
  await editor(page).evaluate((element, content) => {
    const instance = (
      element as HTMLElement & { editor?: { commands: { setContent(value: unknown): boolean } } }
    ).editor;
    instance?.commands.setContent(content);
  }, doc);
}

function textOf(node: NodeJSON): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'pageLink') return '[link]';
  if (node.type === 'tag') return `#${String(node.attrs?.name ?? '')}`;
  return (node.content ?? []).map(textOf).join(node.type === 'doc' ? '\n' : '');
}

/**
 * Where the editor thinks the caret is: the text of its block and the offset in it. The browser
 * moves the caret itself for Home, End and arrow keys and tells the editor a moment later, so a
 * test that sends the next key at machine speed first waits for this to match (a person's pause
 * between keys is always longer).
 */
export async function caret(page: Page): Promise<{ text: string; offset: number }> {
  return editor(page).evaluate((element) => {
    const instance = (
      element as HTMLElement & {
        editor?: {
          state: {
            selection: { $head: { parent: { textContent: string }; parentOffset: number } };
          };
        };
      }
    ).editor;
    const head = instance?.state.selection.$head;
    return { text: head?.parent.textContent ?? '', offset: head?.parentOffset ?? -1 };
  });
}

/** `type:text` for each top-level block, for compact assertions. */
export async function outline(page: Page): Promise<string[]> {
  const doc = await docJSON(page);
  return (doc.content ?? []).map((node) => `${node.type}:${textOf(node)}`);
}

/** Every node of a type, anywhere in the document. */
export function findNodes(doc: NodeJSON, type: string): NodeJSON[] {
  const found: NodeJSON[] = [];
  const visit = (node: NodeJSON) => {
    if (node.type === type) found.push(node);
    node.content?.forEach(visit);
  };
  visit(doc);
  return found;
}

/** Marks on the text node with exactly this text. */
export function marksOn(doc: NodeJSON, text: string): string[] {
  const node = findNodes(doc, 'text').find((candidate) => candidate.text === text);
  return (node?.marks ?? []).map((mark) => mark.type);
}

/** Types into the slash menu and picks the first result with Enter. */
export async function slash(page: Page, query: string): Promise<void> {
  await page.keyboard.type(`/${query}`);
  const menu = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
}

/** Undo and redo through the keyboard (Ctrl on Windows and Linux, Cmd on macOS). */
export async function undo(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.keyboard.press('ControlOrMeta+z');
}

export async function redo(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.keyboard.press('ControlOrMeta+Shift+z');
}

/**
 * Dispatches a paste event with the given clipboard data on the editor. Firefox ignores
 * `clipboardData` in the event constructor (it creates an empty one), so the transfer is attached
 * to the event directly.
 */
export async function pasteData(page: Page, data: Record<string, string>): Promise<void> {
  await editor(page).evaluate((element, entries) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) transfer.setData(type, value);
    const event = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    element.dispatchEvent(event);
  }, data);
}

/** Dispatches a copy event on the editor and returns what it put on the clipboard. */
export async function copyData(page: Page): Promise<Record<string, string>> {
  return editor(page).evaluate((element) => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    element.dispatchEvent(event);
    return {
      'text/html': transfer.getData('text/html'),
      'text/plain': transfer.getData('text/plain'),
    };
  });
}

/** What `window.__tessera.diagnostics()` returns (names only). */
export interface Diagnostics {
  services: Record<string, string>;
  contributions: Record<string, string[]>;
  commands: string[];
  blockKinds: string[];
}

export async function readDiagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(() => {
    const api = (window as unknown as { __tessera?: { diagnostics(): Diagnostics } }).__tessera;
    return api ? api.diagnostics() : null;
  });
}
