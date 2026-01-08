import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { createSdkClient, expectSdkError } from '../test-helpers';

const baseUrl = 'http://sdk-unit.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

function trackRequest() {
  const store: { url?: string; method?: string; body?: any; headers?: Record<string, string> } = {};
  return {
    store,
    handler:
      (resolver: (info: { request: Request }) => Promise<HttpResponse> | HttpResponse) =>
      async (info: { request: Request }) => {
        const { request } = info;
        store.url = request.url;
        store.method = request.method;
        store.headers = Object.fromEntries(request.headers.entries());
        if (request.method !== 'GET') {
          store.body = await request.clone().json().catch(() => undefined);
        }
        return resolver(info);
      }
  };
}

function expectRequest(store: { url?: string; method?: string; body?: any }, expected: { url: string; method: string; body?: any }) {
  expect(store.url).toBe(expected.url);
  expect(store.method).toBe(expected.method);
  if (expected.body !== undefined) {
    expect(store.body).toEqual(expected.body);
  }
}

describe('SDK unit tests (mock fetch)', () => {
  it('createWorld sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(`${baseUrl}/v1/worlds`, tracker.handler(() => HttpResponse.json({ worldId: 'world-1' })))
    );

    const client = createSdkClient(baseUrl);
    await client.createWorld({ name: 'My World' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds`,
      method: 'POST',
      body: { name: 'My World' }
    });
  });

  it('createBranch sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/branches`,
        tracker.handler(() => HttpResponse.json({ branchName: 'alt' }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.createBranch({ worldId: 'world-1', branchName: 'alt', ref: 'branch:main' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/branches`,
      method: 'POST',
      body: { branchName: 'alt', ref: 'branch:main' }
    });
  });

  it('upsertUnit sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/units`,
        tracker.handler(() => HttpResponse.json({ unitId: 'unit-1' }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.upsertUnit({
      worldId: 'world-1',
      ref: 'branch:main',
      unitId: 'unit-1',
      unit: { type: 'character', fields: { name: 'Ada' } }
    });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/units`,
      method: 'POST',
      body: {
        ref: 'branch:main',
        unitId: 'unit-1',
        unit: { type: 'character', fields: { name: 'Ada' } }
      }
    });
  });

  it('commit sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/commits`,
        tracker.handler(() => HttpResponse.json({ commitId: 'commit-1' }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.commit({ worldId: 'world-1', branchName: 'main', message: 'Commit test' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/commits`,
      method: 'POST',
      body: { branchName: 'main', message: 'Commit test' }
    });
  });

  it('diff sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/diff`,
        tracker.handler(() => HttpResponse.json({ changes: [] }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.diff({ worldId: 'world-1', fromRef: 'branch:main', toRef: 'branch:alt' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/diff`,
      method: 'POST',
      body: { fromRef: 'branch:main', toRef: 'branch:alt' }
    });
  });

  it('mergePreview sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/merge/preview`,
        tracker.handler(() => HttpResponse.json({ conflicts: [], previewMergedUnits: [] }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.mergePreview({ worldId: 'world-1', ours: 'branch:main', theirs: 'branch:alt' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/merge/preview`,
      method: 'POST',
      body: { ours: 'branch:main', theirs: 'branch:alt' }
    });
  });

  it('mergeApply sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/merge/apply`,
        tracker.handler(() => HttpResponse.json({ mergeCommitId: 'commit-merge-1' }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.mergeApply({
      worldId: 'world-1',
      ours: 'branch:main',
      theirs: 'branch:alt',
      resolutions: [{ unitId: 'unit-1', path: '/fields/name', value: 'Ada' }]
    });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/merge/apply`,
      method: 'POST',
      body: {
        ours: 'branch:main',
        theirs: 'branch:alt',
        resolutions: [{ unitId: 'unit-1', path: '/fields/name', value: 'Ada' }]
      }
    });
  });

  it('listWorlds sends correct request', async () => {
    const tracker = trackRequest();
    server.use(http.get(`${baseUrl}/v1/worlds`, tracker.handler(() => HttpResponse.json({ worlds: [] }))));

    const client = createSdkClient(baseUrl);
    await client.listWorlds();

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds`,
      method: 'GET'
    });
  });

  it('listBranches sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.get(`${baseUrl}/v1/worlds/world-1/branches`, tracker.handler(() => HttpResponse.json({ branches: [] })))
    );

    const client = createSdkClient(baseUrl);
    await client.listBranches({ worldId: 'world-1' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/branches`,
      method: 'GET'
    });
  });

  it('listCommits sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.get(`${baseUrl}/v1/worlds/world-1/commits?branchName=main`, tracker.handler(() => HttpResponse.json({ commits: [] })))
    );

    const client = createSdkClient(baseUrl);
    await client.listCommits({ worldId: 'world-1', branchName: 'main' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/commits?branchName=main`,
      method: 'GET'
    });
  });

  it('getUnits sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.get(`${baseUrl}/v1/worlds/world-1/units?ref=branch:main`, tracker.handler(() => HttpResponse.json({ units: [] })))
    );

    const client = createSdkClient(baseUrl);
    await client.getUnits({ worldId: 'world-1', ref: 'branch:main' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/units?ref=branch:main`,
      method: 'GET'
    });
  });

  it('getUnit sends correct request', async () => {
    const tracker = trackRequest();
    server.use(
      http.get(
        `${baseUrl}/v1/worlds/world-1/units/unit-1?ref=commit:abc123`,
        tracker.handler(() => HttpResponse.json({ unitId: 'unit-1' }))
      )
    );

    const client = createSdkClient(baseUrl);
    await client.getUnit({ worldId: 'world-1', unitId: 'unit-1', ref: 'commit:abc123' });

    expectRequest(tracker.store, {
      url: `${baseUrl}/v1/worlds/world-1/units/unit-1?ref=commit:abc123`,
      method: 'GET'
    });
  });

  it('handles structured error responses', async () => {
    server.use(
      http.post(
        `${baseUrl}/v1/worlds`,
        () =>
          HttpResponse.json(
            { error: { code: 'INVALID_REF', message: 'Invalid ref format' } },
            { status: 400 }
          )
      )
    );

    const client = createSdkClient(baseUrl);
    await expectSdkError(client.createWorld({ name: 'Bad', ref: 'invalid' }), {
      code: 'INVALID_REF',
      status: 400
    });
  });

  it('surface merge conflict previews', async () => {
    server.use(
      http.post(
        `${baseUrl}/v1/worlds/world-1/merge/preview`,
        () =>
          HttpResponse.json(
            {
              conflicts: [
                {
                  unitId: 'unit-1',
                  path: '/fields/profile/occupation',
                  base: 'writer',
                  ours: 'engineer',
                  theirs: 'designer'
                }
              ],
              previewMergedUnits: []
            },
            { status: 200 }
          )
      )
    );

    const client = createSdkClient(baseUrl);
    const response = await client.mergePreview({ worldId: 'world-1', ours: 'branch:main', theirs: 'branch:alt' });
    expect(response.conflicts?.length ?? 0).toBeGreaterThan(0);
  });

  it('handles non-json error bodies', async () => {
    server.use(
      http.post(`${baseUrl}/v1/worlds`, () => new HttpResponse('boom', { status: 500 }))
    );

    const client = createSdkClient(baseUrl);
    await expectSdkError(client.createWorld({ name: 'Crash' }), {
      status: 500,
      messageIncludes: 'boom'
    });
  });

  it('handles network errors', async () => {
    server.use(
      http.post(`${baseUrl}/v1/worlds`, () => {
        return HttpResponse.error();
      })
    );

    const client = createSdkClient(baseUrl);
    await expectSdkError(client.createWorld({ name: 'Offline' }), {
      messageIncludes: 'network'
    });
  });
});
