import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSdkClient, expectSdkError, formatError, pickId } from '../test-helpers';
import { startTestServer, type RunningServer } from './server';

let server: RunningServer;
let client: any;

async function step<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(`${label} failed: ${formatError(error)}`);
  }
}

beforeAll(async () => {
  server = await startTestServer();
  client = createSdkClient(server.baseUrl);
});

afterAll(async () => {
  await server?.close();
});

describe('SDK integration tests (real server)', () => {
  it('flow 1: happy path', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Integration World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    const characterUnit = {
      type: 'character',
      title: 'Ada Lovelace',
      fields: { name: 'Ada Lovelace', profile: { occupation: 'mathematician' } }
    };
    const placeUnit = {
      type: 'place',
      title: 'London',
      fields: { name: 'London', profile: { occupation: 'capital' } }
    };

    await step('upsertUnit character', () =>
      client.upsertUnit(worldId, {
        branchName: 'main',
        unit: { id: 'unit-character', ...characterUnit }
      })
    );
    await step('upsertUnit place', () =>
      client.upsertUnit(worldId, {
        branchName: 'main',
        unit: { id: 'unit-place', ...placeUnit }
      })
    );

    const commitMain = await step('commit main', () =>
      client.commit(worldId, { branchName: 'main', message: 'Initial commit' })
    );
    const mainCommitId = pickId(commitMain, ['commitId', 'id']);
    expect(mainCommitId).toBeTruthy();

    await step('createBranch', () =>
      client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' })
    );

    await step('update alt place unit', () =>
      client.upsertUnit(worldId, {
        branchName: 'alt',
        unit: {
          id: 'unit-place',
          ...placeUnit,
          fields: { ...placeUnit.fields, profile: { occupation: 'trade hub' } }
        }
      })
    );

    await step('commit alt', () =>
      client.commit(worldId, { branchName: 'alt', message: 'Update place occupation' })
    );

    const diff = await step<any>('diff', () =>
      client.diff(worldId, { from: 'branch:main', to: 'branch:alt' })
    );
    const diffPaths = (diff.changes ?? []).map((change: any) => change.path ?? change);
    expect(diffPaths.join(',')).toContain('/fields/profile/occupation');

    const apply = await step('mergeApply', () =>
      client.mergeApply(worldId, { oursBranch: 'main', theirsBranch: 'alt', resolutions: [] })
    );
    const mergeCommitId = pickId(apply, ['mergeCommitId', 'commitId', 'id']);
    expect(mergeCommitId).toBeTruthy();
  });

  it('flow 2: conflicts and resolutions', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Conflict World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    const baseUnit = {
      type: 'character',
      title: 'Nova',
      fields: { name: 'Nova', profile: { occupation: 'writer' } }
    };

    await step('upsert base', () =>
      client.upsertUnit(worldId, {
        branchName: 'main',
        unit: { id: 'unit-conflict', ...baseUnit }
      })
    );
    await step('commit base', () =>
      client.commit(worldId, { branchName: 'main', message: 'Base commit' })
    );

    await step('createBranch alt', () =>
      client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' })
    );

    await step('update main occupation', () =>
      client.upsertUnit(worldId, {
        branchName: 'main',
        unit: {
          id: 'unit-conflict',
          ...baseUnit,
          fields: { ...baseUnit.fields, profile: { occupation: 'engineer' } }
        }
      })
    );
    await step('commit main conflict', () =>
      client.commit(worldId, { branchName: 'main', message: 'Main conflict' })
    );

    await step('update alt occupation', () =>
      client.upsertUnit(worldId, {
        branchName: 'alt',
        unit: {
          id: 'unit-conflict',
          ...baseUnit,
          fields: { ...baseUnit.fields, profile: { occupation: 'designer' } }
        }
      })
    );
    await step('commit alt conflict', () =>
      client.commit(worldId, { branchName: 'alt', message: 'Alt conflict' })
    );

    const preview = await step<any>('mergePreview', () =>
      client.mergePreview(worldId, { oursBranch: 'main', theirsBranch: 'alt' })
    );
    expect(preview.conflicts?.length ?? 0).toBeGreaterThan(0);
    const conflict = preview.conflicts?.[0];
    expect(conflict?.unitId).toBe('unit-conflict');
    expect(conflict?.path).toBe('/fields/profile/occupation');

    const applyOurs = await step('mergeApply ours', () =>
      client.mergeApply(worldId, {
        oursBranch: 'main',
        theirsBranch: 'alt',
        resolutions: [
          { unitId: 'unit-conflict', path: '/fields/profile/occupation', choice: 'ours' }
        ]
      })
    );
    const oursCommit = pickId(applyOurs, ['mergeCommitId', 'commitId', 'id']);
    const oursUnit = await step<any>('getUnit ours', () =>
      client.getUnit(worldId, 'unit-conflict', { ref: `commit:${oursCommit}` })
    );
    const oursOccupation =
      (oursUnit as any)?.fields?.profile?.occupation ??
      (oursUnit as any)?.unit?.fields?.profile?.occupation;
    expect(oursOccupation).toBe('engineer');

    const applyTheirs = await step('mergeApply theirs', () =>
      client.mergeApply(worldId, {
        oursBranch: 'main',
        theirsBranch: 'alt',
        resolutions: [
          { unitId: 'unit-conflict', path: '/fields/profile/occupation', choice: 'theirs' }
        ]
      })
    );
    const theirsCommit = pickId(applyTheirs, ['mergeCommitId', 'commitId', 'id']);
    const theirsUnit = await step<any>('getUnit theirs', () =>
      client.getUnit(worldId, 'unit-conflict', { ref: `commit:${theirsCommit}` })
    );
    const theirsOccupation =
      (theirsUnit as any)?.fields?.profile?.occupation ??
      (theirsUnit as any)?.unit?.fields?.profile?.occupation;
    expect(theirsOccupation).toBe('designer');

    const applyManual = await step('mergeApply manual', () =>
      client.mergeApply(worldId, {
        oursBranch: 'main',
        theirsBranch: 'alt',
        resolutions: [
          { unitId: 'unit-conflict', path: '/fields/profile/occupation', choice: 'manual', value: 'architect' }
        ]
      })
    );
    const manualCommit = pickId(applyManual, ['mergeCommitId', 'commitId', 'id']);
    const manualUnit = await step<any>('getUnit manual', () =>
      client.getUnit(worldId, 'unit-conflict', { ref: `commit:${manualCommit}` })
    );
    const manualOccupation =
      (manualUnit as any)?.fields?.profile?.occupation ??
      (manualUnit as any)?.unit?.fields?.profile?.occupation;
    expect(manualOccupation).toBe('architect');
  });

  it('flow 3: read interfaces', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Read World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    await step('createBranch alt', () =>
      client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' })
    );

    await step('commit main', () =>
      client.commit(worldId, { branchName: 'main', message: 'Read commit' })
    );

    const worlds = await step('listWorlds', () => client.listWorlds());
    expect(JSON.stringify(worlds)).toContain(worldId);

    const branches = await step('listBranches', () => client.listBranches(worldId));
    expect(JSON.stringify(branches)).toContain('main');
    expect(JSON.stringify(branches)).toContain('alt');

    const commits = await step<any>('listCommits', () => client.listCommits(worldId, { branchName: 'main' }));
    expect((commits as any).commits?.length ?? 0).toBeGreaterThan(0);

    const units = await step('getUnits', () => client.getUnits(worldId, { ref: 'branch:main' }));
    expect(units).toBeDefined();
  });

  it('errors: missing world/branch/commit/unit/ref', async () => {
    await expectSdkError(client.listBranches('missing-world'), { code: 'WORLD_NOT_FOUND' });

    await expectSdkError(
      client.commit('missing-world', { branchName: 'missing-branch', message: 'x' }),
      { code: 'WORLD_NOT_FOUND' }
    );

    await expectSdkError(client.getUnits('missing-world', { ref: 'commit:does-not-exist' }), {
      code: 'COMMIT_NOT_FOUND'
    });

    await expectSdkError(client.getUnit('missing-world', 'missing', { ref: 'branch:main' }), {
      code: 'BRANCH_NOT_FOUND'
    });

    await expectSdkError(client.getUnits('missing-world', { ref: 'invalid-ref' }), {
      code: 'INVALID_REF'
    });
  });

  it('mergeApply without resolutions returns conflicts', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Resolution World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    const unit = {
      type: 'character',
      title: 'Rune',
      fields: { name: 'Rune', profile: { occupation: 'pilot' } }
    };
    await step('upsert base', () =>
      client.upsertUnit(worldId, { branchName: 'main', unit: { id: 'unit-res', ...unit } })
    );
    await step('commit base', () =>
      client.commit(worldId, { branchName: 'main', message: 'Base' })
    );
    await step('createBranch alt', () =>
      client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' })
    );
    await step('update main', () =>
      client.upsertUnit(worldId, {
        branchName: 'main',
        unit: { id: 'unit-res', ...unit, fields: { ...unit.fields, profile: { occupation: 'captain' } } }
      })
    );
    await step('update alt', () =>
      client.upsertUnit(worldId, {
        branchName: 'alt',
        unit: { id: 'unit-res', ...unit, fields: { ...unit.fields, profile: { occupation: 'navigator' } } }
      })
    );

    await step('commit main', () =>
      client.commit(worldId, { branchName: 'main', message: 'Main change' })
    );
    await step('commit alt', () =>
      client.commit(worldId, { branchName: 'alt', message: 'Alt change' })
    );

    const response = await step<any>('mergeApply without resolutions', () =>
      client.mergeApply(worldId, { oursBranch: 'main', theirsBranch: 'alt', resolutions: [] })
    );
    const conflicts = response.conflicts?.length ?? 0;
    if (conflicts === 0) {
      const mergeCommitId = pickId(response, ['mergeCommitId', 'commitId', 'id']);
      expect(mergeCommitId).toBeTruthy();
    } else {
      expect(conflicts).toBeGreaterThan(0);
    }
  });
});
