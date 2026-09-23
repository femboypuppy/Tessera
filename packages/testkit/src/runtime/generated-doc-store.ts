import { MemoryDocStore, MemoryDocStoreBackend, type DocStore } from '@tessera/core';
import type { GeneratedWorkspace } from '../generator';

/**
 * A {@link DocStore} that starts out holding a generated workspace. Docs are built the first time
 * they load (a 5,000-page workspace opens without building 5,000 page docs); after that it
 * behaves exactly like core's `MemoryDocStore`: edits are stored, deletes stick, and several
 * instances sharing one backend see each other's writes like browser tabs.
 *
 * @example
 * const store = new GeneratedDocStore(generateWorkspace({ seed: 1 }), 'ws1');
 * const update = await store.load('ws:ws1'); // the generated workspace doc
 */
export class GeneratedDocStore implements DocStore {
  readonly memory: MemoryDocStore;
  private readonly generated: GeneratedWorkspace;
  private readonly workspaceId: string;
  /** Doc names already taken from the generator, or deleted: never generated again. */
  private readonly settled: Set<string>;

  constructor(
    generated: GeneratedWorkspace,
    workspaceId: string,
    backend: MemoryDocStoreBackend = new MemoryDocStoreBackend(),
    settled: Set<string> = new Set(),
  ) {
    this.generated = generated;
    this.workspaceId = workspaceId;
    this.memory = new MemoryDocStore(backend);
    this.settled = settled;
  }

  private seed(docName: string): void {
    if (this.settled.has(docName)) return;
    this.settled.add(docName);
    if (this.memory.backend.docs.has(docName)) return;
    const update = this.generated.docUpdate(docName, this.workspaceId);
    // Stored directly in the backend: seeding is not a write other "tabs" should hear about.
    if (update) this.memory.backend.docs.set(docName, [update]);
  }

  async load(docName: string): Promise<Uint8Array | null> {
    this.seed(docName);
    return this.memory.load(docName);
  }

  async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    this.seed(docName);
    await this.memory.storeUpdate(docName, update);
  }

  async compact(docName: string): Promise<void> {
    await this.memory.compact(docName);
  }

  async delete(docName: string): Promise<void> {
    this.settled.add(docName);
    await this.memory.delete(docName);
  }

  async list(prefix = ''): Promise<string[]> {
    const names = new Set(await this.memory.list(prefix));
    for (const name of this.generated.docNames(this.workspaceId)) {
      if (name.startsWith(prefix) && !this.settled.has(name)) names.add(name);
    }
    return [...names].sort();
  }

  watch(docName: string, onUpdate: (update: Uint8Array) => void): () => void {
    return this.memory.watch(docName, onUpdate);
  }

  async flush(): Promise<void> {
    await this.memory.flush();
  }
}
