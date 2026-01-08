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
      fields: { name: 'Ada Lovelace', profile: { occupation: 'mathematician' } }
    };
    const placeUnit = {
      type: 'place',
      fields: { name: 'London', profile: { occupation: 'capital' } }
    };

    await step('upsertUnit character', () =>
      client.upsertUnit({ worldId, ref: 'branch:main', unitId: 'unit-character', unit: characterUnit })
    );
    await step('upsertUnit place', () =>
      client.upsertUnit({ worldId, ref: 'branch:main', unitId: 'unit-place', unit: placeUnit })
    );

    const commitMain = await step('commit main', () =>
      client.commit({ worldId, branchName: 'main', message: 'Initial commit' })
    );
    const mainCommitId = pickId(commitMain, ['commitId', 'id']);
    expect(mainCommitId).toBeTruthy();

    await step('createBranch', () =>
      client.createBranch({ worldId, branchName: 'alt', ref: 'branch:main' })
    );

    await step('update alt place unit', () =>
      client.upsertUnit({
        worldId,
        ref: 'branch:alt',
        unitId: 'unit-place',
        unit: {
          ...placeUnit,
          fields: { ...placeUnit.fields, profile: { occupation: 'trade hub' } }
        }
      })
    );

    await step('commit alt', () =>
      client.commit({ worldId, branchName: 'alt', message: 'Update place occupation' })
    );

    const diff = await step('diff', () =>
      client.diff({ worldId, fromRef: 'branch:main', toRef: 'branch:alt' })
    );
    const diffPaths = (diff.paths ?? diff.changes ?? []).map((change: any) => change.path ?? change);
    expect(diffPaths.join(',')).toContain('/fields/profile/occupation');

    const preview = await step('mergePreview', () =>
      client.mergePreview({ worldId, ours: 'branch:main', theirs: 'branch:alt' })
    );
    expect(preview.conflicts?.length ?? 0).toBe(0);

    const apply = await step('mergeApply', () =>
      client.mergeApply({ worldId, ours: 'branch:main', theirs: 'branch:alt', resolutions: [] })
    );
    const mergeCommitId = pickId(apply, ['mergeCommitId', 'commitId', 'id']);
    expect(mergeCommitId).toBeTruthy();
  });

  it('flow 2: conflicts and resolutions', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Conflict World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    const baseUnit = {
      type: 'character',
      fields: { name: 'Nova', profile: { occupation: 'writer' } }
    };

    await step('upsert base', () =>
      client.upsertUnit({ worldId, ref: 'branch:main', unitId: 'unit-conflict', unit: baseUnit })
    );
    await step('commit base', () =>
      client.commit({ worldId, branchName: 'main', message: 'Base commit' })
    );

    await step('createBranch alt', () =>
      client.createBranch({ worldId, branchName: 'alt', ref: 'branch:main' })
    );

    await step('update main occupation', () =>
      client.upsertUnit({
        worldId,
        ref: 'branch:main',
        unitId: 'unit-conflict',
        unit: { ...baseUnit, fields: { ...baseUnit.fields, profile: { occupation: 'engineer' } } }
      })
    );
    await step('commit main conflict', () =>
      client.commit({ worldId, branchName: 'main', message: 'Main conflict' })
    );

    await step('update alt occupation', () =>
      client.upsertUnit({
        worldId,
        ref: 'branch:alt',
        unitId: 'unit-conflict',
        unit: { ...baseUnit, fields: { ...baseUnit.fields, profile: { occupation: 'designer' } } }
      })
    );
    await step('commit alt conflict', () =>
      client.commit({ worldId, branchName: 'alt', message: 'Alt conflict' })
    );

    const preview = await step('mergePreview', () =>
      client.mergePreview({ worldId, ours: 'branch:main', theirs: 'branch:alt' })
    );
    expect(preview.conflicts?.length ?? 0).toBeGreaterThan(0);
    const conflict = preview.conflicts?.[0];
    expect(conflict?.unitId).toBe('unit-conflict');
    expect(conflict?.path).toBe('/fields/profile/occupation');

    const applyOurs = await step('mergeApply ours', () =>
      client.mergeApply({
        worldId,
        ours: 'branch:main',
        theirs: 'branch:alt',
        resolutions: [
          { unitId: 'unit-conflict', path: '/fields/profile/occupation', resolution: 'ours' }
        ]
      })
    );
    const oursCommit = pickId(applyOurs, ['mergeCommitId', 'commitId', 'id']);
    const oursUnit = await step('getUnit ours', () =>
      client.getUnit({ worldId, unitId: 'unit-conflict', ref: `commit:${oursCommit}` })
    );
    const oursOccupation = oursUnit?.unit?.fields?.profile?.occupation ?? oursUnit?.fields?.profile?.occupation;
    expect(oursOccupation).toBe('engineer');

    const applyTheirs = await step('mergeApply theirs', () =>
      client.mergeApply({
        worldId,
        ours: 'branch:main',
        theirs: 'branch:alt',
        resolutions: [
          { unitId: 'unit-conflict', path: '/fields/profile/occupation', resolution: 'theirs' }
        ]
      })
    );
    const theirsCommit = pickId(applyTheirs, ['mergeCommitId', 'commitId', 'id']);
    const theirsUnit = await step('getUnit theirs', () =>
      client.getUnit({ worldId, unitId: 'unit-conflict', ref: `commit:${theirsCommit}` })
    );
    const theirsOccupation =
      theirsUnit?.unit?.fields?.profile?.occupation ?? theirsUnit?.fields?.profile?.occupation;
    expect(theirsOccupation).toBe('designer');

    const applyManual = await step('mergeApply manual', () =>
      client.mergeApply({
        worldId,
        ours: 'branch:main',
        theirs: 'branch:alt',
        resolutions: [
          { unitId: 'unit-conflict', path: '/fields/profile/occupation', value: 'architect' }
        ]
      })
    );
    const manualCommit = pickId(applyManual, ['mergeCommitId', 'commitId', 'id']);
    const manualUnit = await step('getUnit manual', () =>
      client.getUnit({ worldId, unitId: 'unit-conflict', ref: `commit:${manualCommit}` })
    );
    const manualOccupation =
      manualUnit?.unit?.fields?.profile?.occupation ?? manualUnit?.fields?.profile?.occupation;
    expect(manualOccupation).toBe('architect');
  });

  it('flow 3: read interfaces', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Read World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    await step('createBranch alt', () =>
      client.createBranch({ worldId, branchName: 'alt', ref: 'branch:main' })
    );

    await step('commit main', () =>
      client.commit({ worldId, branchName: 'main', message: 'Read commit' })
    );

    const worlds = await step('listWorlds', () => client.listWorlds());
    expect(JSON.stringify(worlds)).toContain(worldId);

    const branches = await step('listBranches', () => client.listBranches({ worldId }));
    expect(JSON.stringify(branches)).toContain('main');
    expect(JSON.stringify(branches)).toContain('alt');

    const commits = await step('listCommits', () => client.listCommits({ worldId, branchName: 'main' }));
    expect(JSON.stringify(commits)).toContain('main');

    const units = await step('getUnits', () => client.getUnits({ worldId, ref: 'branch:main' }));
    expect(units).toBeDefined();
  });

  it('errors: missing world/branch/commit/unit/ref', async () => {
    await expectSdkError(client.listBranches({ worldId: 'missing-world' }), { code: 'WORLD_NOT_FOUND' });

    await expectSdkError(
      client.commit({ worldId: 'missing-world', branchName: 'missing-branch', message: 'x' }),
      { code: 'BRANCH_NOT_FOUND' }
    );

    await expectSdkError(client.getUnits({ worldId: 'missing-world', ref: 'commit:does-not-exist' }), {
      code: 'COMMIT_NOT_FOUND'
    });

    await expectSdkError(client.getUnit({ worldId: 'missing-world', unitId: 'missing', ref: 'branch:main' }), {
      code: 'UNIT_NOT_FOUND'
    });

    await expectSdkError(client.getUnits({ worldId: 'missing-world', ref: 'invalid-ref' }), {
      code: 'INVALID_REF'
    });
  });

  it('mergeApply without resolutions returns conflicts', async () => {
    const world = await step('createWorld', () => client.createWorld({ name: 'Resolution World' }));
    const worldId = pickId(world, ['worldId', 'id']);

    const unit = { type: 'character', fields: { name: 'Rune', profile: { occupation: 'pilot' } } };
    await step('upsert base', () =>
      client.upsertUnit({ worldId, ref: 'branch:main', unitId: 'unit-res', unit })
    );
    await step('commit base', () =>
      client.commit({ worldId, branchName: 'main', message: 'Base' })
    );
    await step('createBranch alt', () =>
      client.createBranch({ worldId, branchName: 'alt', ref: 'branch:main' })
    );
    await step('update main', () =>
      client.upsertUnit({
        worldId,
        ref: 'branch:main',
        unitId: 'unit-res',
        unit: { ...unit, fields: { ...unit.fields, profile: { occupation: 'captain' } } }
      })
    );
    await step('update alt', () =>
      client.upsertUnit({
        worldId,
        ref: 'branch:alt',
        unitId: 'unit-res',
        unit: { ...unit, fields: { ...unit.fields, profile: { occupation: 'navigator' } } }
      })
    );

    await step('commit main', () =>
      client.commit({ worldId, branchName: 'main', message: 'Main change' })
    );
    await step('commit alt', () =>
      client.commit({ worldId, branchName: 'alt', message: 'Alt change' })
    );

    const response = await step('mergeApply without resolutions', () =>
      client.mergeApply({ worldId, ours: 'branch:main', theirs: 'branch:alt' })
    );

    expect(response.conflicts?.length ?? 0).toBeGreaterThan(0);
  });
});
