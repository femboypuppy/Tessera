import { defineFeature } from '@tessera/core';
import { createTestAppContext } from '@tessera/core/testing';
import { describe, expect, it } from 'vitest';
import { describeSession, installDiagnostics } from './diagnostics';

const Component = () => null;

describe('diagnostics', () => {
  it('describes features, services and contributions by name', async () => {
    const demo = defineFeature({
      id: 'demo',
      routes: [{ path: '/demo', component: Component }],
      pageBodies: { page: Component },
      overlays: [{ id: 'palette', component: Component }],
      commands: [{ id: 'demo.hello', title: 'Hello', run: () => undefined }],
      blockRenderers: [{ kind: 'web', component: Component }],
    });
    const broken = defineFeature({
      id: 'broken',
      activate: () => {
        throw new Error('boom');
      },
    });
    const { runtime, session, dispose } = await createTestAppContext({
      features: [demo, broken],
      runtime: { onError: () => undefined },
    });
    const snapshot = describeSession(runtime, session);
    expect(snapshot).toMatchObject({
      version: 1,
      workspaceId: session.workspace.id,
      features: ['demo', 'broken'],
      failedFeatures: ['broken'],
      services: {
        docStore: 'memory',
        syncProvider: 'local',
        searchIndex: 'naive',
        markdownCodec: 'basic',
      },
      commands: expect.arrayContaining(['demo.hello']),
      blockKinds: ['web'],
    });
    expect(snapshot.contributions.routes).toEqual(['/demo']);
    expect(snapshot.contributions.pageBodies).toEqual(['page']);
    expect(snapshot.contributions.overlays).toEqual(['palette']);
    expect(snapshot.contributions.pageSidePanels).toEqual([]);
    await dispose();
  });

  it('publishes window.__tessera until removed', async () => {
    const { runtime, session, dispose } = await createTestAppContext();
    const remove = installDiagnostics(runtime, session);
    expect(window.__tessera?.diagnostics().workspaceId).toBe(session.workspace.id);
    remove();
    expect(window.__tessera).toBeUndefined();
    await dispose();
  });
});
