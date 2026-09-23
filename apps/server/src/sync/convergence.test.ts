import type { DocHandle } from '@tessera/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDevice, type Device } from '../testing/devices';
import {
  bootstrap,
  cleanupServers,
  eventually,
  startTestServer,
  type TestServer,
} from '../testing/harness';

const servers: TestServer[] = [];
const devices: Device[] = [];

afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose();
  await cleanupServers(servers);
});

/** A small deterministic PRNG (mulberry32), so a failing seed can be replayed. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const DOCS = ['page:alpha', 'page:beta', 'db:gamma'];

function snapshot(doc: Y.Doc) {
  return {
    text: doc.getText('t').toString(),
    map: doc.getMap('m').toJSON(),
    list: doc.getArray('a').toJSON(),
  };
}

/**
 * Several devices edit the same docs concurrently with random operations, go offline and come
 * back at random, and close and reopen docs. Once everyone is online again, every device and the
 * server must hold exactly the same content.
 */
async function fuzz(seed: number, options: { devices: number; steps: number }) {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const t = await startTestServer();
  servers.push(t);
  const { ownerToken, workspaceId } = await bootstrap(t);
  const fleet: Device[] = [];
  for (let i = 0; i < options.devices; i += 1) {
    const d = await createDevice(t, { name: `device-${i}`, token: ownerToken, workspaceId });
    devices.push(d);
    fleet.push(d);
  }
  const open = new Map<Device, Map<string, DocHandle>>(fleet.map((d) => [d, new Map()]));
  const offline = new Set<Device>();

  for (let step = 0; step < options.steps; step += 1) {
    const d = pick(fleet);
    const handles = open.get(d) ?? new Map<string, DocHandle>();
    const roll = random();
    if (roll < 0.08) {
      if (offline.has(d)) {
        offline.delete(d);
        d.goOnline();
      } else {
        offline.add(d);
        d.goOffline();
      }
      continue;
    }
    const docName = pick(DOCS);
    let handle = handles.get(docName);
    if (roll < 0.14 && handle) {
      handle.release();
      handles.delete(docName);
      continue;
    }
    if (!handle) {
      handle = await d.open(docName);
      handles.set(docName, handle);
    }
    const doc = handle.doc;
    const op = random();
    if (op < 0.45) {
      const text = doc.getText('t');
      text.insert(Math.floor(random() * (text.length + 1)), `${d.name.slice(-1)}${step} `);
    } else if (op < 0.6) {
      const text = doc.getText('t');
      if (text.length > 0) {
        const index = Math.floor(random() * text.length);
        text.delete(index, Math.min(1 + Math.floor(random() * 4), text.length - index));
      }
    } else if (op < 0.8) {
      doc.getMap('m').set(`k${Math.floor(random() * 5)}`, `${d.name}@${step}`);
    } else {
      const list = doc.getArray('a');
      if (random() < 0.7 || list.length === 0)
        list.insert(Math.floor(random() * (list.length + 1)), [step]);
      else list.delete(Math.floor(random() * list.length), 1);
    }
    if (random() < 0.2)
      await new Promise((resolve) => setTimeout(resolve, Math.floor(random() * 30)));
  }

  // Everyone back online; close everything so the background sync must carry closed docs too.
  for (const d of offline) d.goOnline();
  for (const handles of open.values()) for (const handle of handles.values()) handle.release();
  for (const d of fleet) await d.manager.flush();
  for (const d of fleet) void d.replicator.runNow();

  const expected = new Y.Doc();
  await eventually(async () => {
    for (const docName of DOCS) {
      const server = new Y.Doc();
      const state = t.server.services.persistence.load(workspaceId, docName);
      if (state) Y.applyUpdate(server, state);
      const reference = snapshot(server);
      for (const d of fleet) {
        const handle = await d.open(docName);
        try {
          expect({ seed, device: d.name, docName, ...snapshot(handle.doc) }).toEqual({
            seed,
            device: d.name,
            docName,
            ...reference,
          });
        } finally {
          handle.release();
        }
      }
    }
  }, 30_000);
  expected.destroy();
  for (const d of fleet) await d.settled(20_000);
}

describe('convergence', () => {
  it.each([1, 7, 42])(
    'random concurrent edits with random disconnects converge (seed %i)',
    async (seed) => {
      await fuzz(seed, { devices: 4, steps: 160 });
    },
    120_000,
  );
});
