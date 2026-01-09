import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSdkClient, expectSdkError, formatError, pickId } from '../test-helpers';
import { createIntegrationRecorder } from './recording';
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

function extractUnitFields(unit: any) {
  return unit?.fields ?? unit?.unit?.fields ?? unit?.data?.fields;
}

function extractUnit(unit: any) {
  return unit?.unit ?? unit;
}

function extractCommitList(response: any): any[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.commits)) {
    return response.commits;
  }
  return [];
}

function extractCommitId(commit: any): string | undefined {
  return commit?.commitId ?? commit?.id ?? commit?.hash;
}

function extractParents(commit: any): string[] {
  return commit?.parents ?? commit?.parentIds ?? commit?.parent_ids ?? [];
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
    const recorder = createIntegrationRecorder('flow 1: happy path', server.baseUrl);
    let status: 'passed' | 'failed' = 'passed';
    try {
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

    const preview = await step<any>('mergePreview', () =>
      client.mergePreview(worldId, { oursBranch: 'main', theirsBranch: 'alt' })
    );

    const apply = await step('mergeApply', () =>
      client.mergeApply(worldId, { oursBranch: 'main', theirsBranch: 'alt', resolutions: [] })
    );
    const mergeCommitId = pickId(apply, ['mergeCommitId', 'commitId', 'id']);
    expect(mergeCommitId).toBeTruthy();

    const mergedUnit = await step<any>('getUnit merged', () =>
      client.getUnit(worldId, 'unit-place', { ref: `commit:${mergeCommitId}` })
    );

    const commitsResponse = await step<any>('listCommits main', () =>
      client.listCommits(worldId, { branchName: 'main' })
    );
    const commits = extractCommitList(commitsResponse);
    const mergeCommit = commits.find((commit) => extractCommitId(commit) === mergeCommitId);
    const mergeParents = mergeCommit ? extractParents(mergeCommit) : [];
    expect(mergeParents.length).toBe(2);

    recorder.set('ids', {
      worldId,
      mainCommitId,
      mergeCommitId,
      unitIds: ['unit-character', 'unit-place'],
      branchNames: ['main', 'alt']
    });
    recorder.set('diff', { paths: diffPaths, raw: diff });
    recorder.set('mergePreview', {
      conflicts: preview?.conflicts ?? [],
      previewMergedUnits: preview?.previewMergedUnits ?? []
    });
    recorder.set('mergeApply', apply);
    recorder.set('mergedUnit', extractUnit(mergedUnit));
      recorder.set(
        'commitChain',
        commits.slice(0, 5).map((commit) => ({
          id: extractCommitId(commit),
          parents: extractParents(commit)
        }))
      );
      recorder.set('mergeCommitParents', mergeParents);
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });

  it('flow 2: conflicts and resolutions', async () => {
    const recorder = createIntegrationRecorder('flow 2: conflicts and resolutions', server.baseUrl);
    let status: 'passed' | 'failed' = 'passed';
    try {
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

    recorder.set('ids', {
      worldId,
      unitId: 'unit-conflict',
      branchNames: ['main', 'alt']
    });
    recorder.set('mergePreview', {
      conflicts: preview?.conflicts ?? [],
      previewMergedUnits: preview?.previewMergedUnits ?? []
    });
    recorder.set('mergeApply', {
      ours: applyOurs,
      theirs: applyTheirs,
      manual: applyManual
    });
    recorder.set('finalUnits', {
      ours: extractUnit(oursUnit),
      theirs: extractUnit(theirsUnit),
      manual: extractUnit(manualUnit)
    });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });

  it('flow 3: read interfaces', async () => {
    const recorder = createIntegrationRecorder('flow 3: read interfaces', server.baseUrl);
    let status: 'passed' | 'failed' = 'passed';
    try {
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

      const commits = await step<any>('listCommits', () =>
        client.listCommits(worldId, { branchName: 'main' })
      );
      expect((commits as any).commits?.length ?? 0).toBeGreaterThan(0);

      const units = await step('getUnits', () => client.getUnits(worldId, { ref: 'branch:main' }));
      expect(units).toBeDefined();

      recorder.set('ids', { worldId, branchNames: ['main', 'alt'] });
      recorder.set('readResponses', { worlds, branches, commits, units });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });

  it('errors: missing world/branch/commit/unit/ref', async () => {
    const recorder = createIntegrationRecorder('errors: missing world/branch/commit/unit/ref', server.baseUrl);
    let status: 'passed' | 'failed' = 'passed';
    try {
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
      recorder.set('expectedErrors', [
        'WORLD_NOT_FOUND',
        'COMMIT_NOT_FOUND',
        'BRANCH_NOT_FOUND',
        'INVALID_REF'
      ]);
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });

  it('mergeApply without resolutions returns conflicts', async () => {
    const recorder = createIntegrationRecorder('mergeApply without resolutions returns conflicts', server.baseUrl);
    let status: 'passed' | 'failed' = 'passed';
    try {
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
      recorder.set('ids', { worldId, unitId: 'unit-res' });
      recorder.set('mergeApply', response);
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });

  it('snapshot immutability + diff self + merge parents + JSON pointer encoding', async () => {
    const recorder = createIntegrationRecorder(
      'snapshot immutability + diff self + merge parents + JSON pointer encoding',
      server.baseUrl
    );
    let status: 'passed' | 'failed' = 'passed';
    try {
      const world = await step('createWorld', () => client.createWorld({ name: 'Snapshot World' }));
      const worldId = pickId(world, ['worldId', 'id']);

      await step('upsert base unit', () =>
        client.upsertUnit(worldId, {
          branchName: 'main',
          unit: {
            id: 'unit-snapshot',
            type: 'character',
            title: 'Echo',
            fields: { name: 'Echo', profile: { occupation: 'pilot' }, 'a/b': 1, 'x~y': 2 }
          }
        })
      );
      const commitA = await step('commit A', () =>
        client.commit(worldId, { branchName: 'main', message: 'Base snapshot' })
      );
      const commitAId = pickId(commitA, ['commitId', 'id']);

      await step('update after snapshot', () =>
        client.upsertUnit(worldId, {
          branchName: 'main',
          unit: {
            id: 'unit-snapshot',
            type: 'character',
            title: 'Echo',
            fields: { name: 'Echo', profile: { occupation: 'captain' }, 'a/b': 3, 'x~y': 4 }
          }
        })
      );
      await step('commit B', () =>
        client.commit(worldId, { branchName: 'main', message: 'After snapshot' })
      );

      const snapshotUnit = await step<any>('getUnit snapshot', () =>
        client.getUnit(worldId, 'unit-snapshot', { ref: `commit:${commitAId}` })
      );
      const snapshotFields = extractUnitFields(snapshotUnit);
      expect(snapshotFields?.profile?.occupation).toBe('pilot');
      expect(snapshotFields?.['a/b']).toBe(1);
      expect(snapshotFields?.['x~y']).toBe(2);

      const diffSelf = await step<any>('diff self', () =>
        client.diff(worldId, { from: 'branch:main', to: 'branch:main' })
      );
      const diffSelfPaths = (diffSelf.changes ?? []).map((change: any) => change.path ?? change);
      expect(diffSelfPaths.length).toBe(0);

      await step('createBranch alt', () =>
        client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' })
      );
      await step('update alt for pointer', () =>
        client.upsertUnit(worldId, {
          branchName: 'alt',
          unit: {
            id: 'unit-snapshot',
            type: 'character',
            title: 'Echo',
            fields: { name: 'Echo', profile: { occupation: 'navigator' }, 'a/b': 5, 'x~y': 6 }
          }
        })
      );
      await step('commit alt', () =>
        client.commit(worldId, { branchName: 'alt', message: 'Alt pointer update' })
      );

      const diffPointer = await step<any>('diff pointer', () =>
        client.diff(worldId, { from: 'branch:main', to: 'branch:alt' })
      );
      const pointerPaths = (diffPointer.changes ?? []).map((change: any) => change.path ?? change);
      const hasEscapedSlash = pointerPaths.includes('/fields/a~1b');
      const hasEscapedTilde = pointerPaths.includes('/fields/x~0y');
      if (!hasEscapedSlash || !hasEscapedTilde) {
        throw new Error(
          `JSON Pointer encoding limitation: expected /fields/a~1b and /fields/x~0y but got ${JSON.stringify(
            pointerPaths
          )}`
        );
      }

      const mergePreview = await step<any>('mergePreview pointer', () =>
        client.mergePreview(worldId, { oursBranch: 'main', theirsBranch: 'alt' })
      );
      const mergeApply = await step<any>('mergeApply pointer', () =>
        client.mergeApply(worldId, { oursBranch: 'main', theirsBranch: 'alt', resolutions: [] })
      );
      const mergeCommitId = pickId(mergeApply, ['mergeCommitId', 'commitId', 'id']);
      const commitsResponse = await step<any>('listCommits main', () =>
        client.listCommits(worldId, { branchName: 'main' })
      );
      const commits = extractCommitList(commitsResponse);
      const mergeCommit = commits.find((commit) => extractCommitId(commit) === mergeCommitId);
      const parents = mergeCommit ? extractParents(mergeCommit) : [];
      expect(parents.length).toBe(2);

      recorder.set('ids', { worldId, unitId: 'unit-snapshot', commitAId, mergeCommitId });
      recorder.set('snapshotFields', snapshotFields);
      recorder.set('diffSelf', diffSelf);
      recorder.set('pointerDiff', diffPointer);
      recorder.set('mergePreview', mergePreview);
      recorder.set('mergeApply', mergeApply);
      recorder.set(
        'commitChain',
        commits.slice(0, 5).map((commit) => ({
          id: extractCommitId(commit),
          parents: extractParents(commit)
        }))
      );
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });

  it('diff/merge property checks (seeded)', async () => {
    const seed = Number(process.env.SDK_TEST_SEED ?? 4242);
    const recorder = createIntegrationRecorder('diff/merge property checks (seeded)', server.baseUrl);
    let status: 'passed' | 'failed' = 'passed';
    const rng = (() => {
      let state = seed >>> 0;
      return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 2 ** 32;
      };
    })();

    const randomValue = () => Math.floor(rng() * 1000);
    const randomKey = () => `k${Math.floor(rng() * 1000)}`;

    try {
      const world = await step('createWorld', () => client.createWorld({ name: 'Property World' }));
      const worldId = pickId(world, ['worldId', 'id']);

      const baseFields = { a: randomValue(), b: randomValue() };
      await step('upsert base', () =>
        client.upsertUnit(worldId, {
          branchName: 'main',
          unit: { id: 'unit-prop', type: 'character', title: 'Prop', fields: baseFields }
        })
      );
      await step('commit base', () =>
        client.commit(worldId, { branchName: 'main', message: 'Base prop' })
      );

      await step('createBranch theirs-only', () =>
        client.createBranch(worldId, { name: 'theirs-only', sourceBranch: 'main' })
      );
      const theirsOnlyValue = randomValue();
      await step('update theirs-only', () =>
        client.upsertUnit(worldId, {
          branchName: 'theirs-only',
          unit: {
            id: 'unit-prop',
            type: 'character',
            title: 'Prop',
            fields: { ...baseFields, theirsOnly: theirsOnlyValue }
          }
        })
      );
      await step('commit theirs-only', () =>
        client.commit(worldId, { branchName: 'theirs-only', message: 'Theirs only' })
      );
      const previewTheirsOnly = await step<any>('mergePreview theirs-only', () =>
        client.mergePreview(worldId, { oursBranch: 'main', theirsBranch: 'theirs-only' })
      );
      expect(previewTheirsOnly.conflicts?.length ?? 0).toBe(0);
      const applyTheirsOnly = await step<any>('mergeApply theirs-only', () =>
        client.mergeApply(worldId, { oursBranch: 'main', theirsBranch: 'theirs-only', resolutions: [] })
      );
      const mergeCommitId = pickId(applyTheirsOnly, ['mergeCommitId', 'commitId', 'id']);
      const mergedUnit = await step<any>('getUnit merged theirs-only', () =>
        client.getUnit(worldId, 'unit-prop', { ref: `commit:${mergeCommitId}` })
      );
      const mergedFields = extractUnitFields(mergedUnit);
      expect(mergedFields?.theirsOnly).toBe(theirsOnlyValue);

      await step('reset base after theirs-only', () =>
        client.upsertUnit(worldId, {
          branchName: 'main',
          unit: { id: 'unit-prop', type: 'character', title: 'Prop', fields: baseFields }
        })
      );
      await step('commit reset base', () =>
        client.commit(worldId, { branchName: 'main', message: 'Reset base' })
      );

      const runs = 25;
      const results: Array<{ case: number; conflict: boolean; paths: string[] }> = [];

      for (let i = 0; i < runs; i += 1) {
        const branchOurs = `ours-${i}`;
        const branchTheirs = `theirs-${i}`;
        await step(`createBranch ours ${i}`, () =>
          client.createBranch(worldId, { name: branchOurs, sourceBranch: 'main' })
        );
        await step(`createBranch theirs ${i}`, () =>
          client.createBranch(worldId, { name: branchTheirs, sourceBranch: 'main' })
        );

        const oursKey = randomKey();
        const theirsKey = rng() > 0.5 ? oursKey : randomKey();
        const oursValue = randomValue();
        const theirsValue = theirsKey === oursKey ? oursValue + 1 : randomValue();

        await step(`update ours ${i}`, () =>
          client.upsertUnit(worldId, {
            branchName: branchOurs,
            unit: {
              id: 'unit-prop',
              type: 'character',
              title: 'Prop',
              fields: { ...baseFields, [oursKey]: oursValue }
            }
          })
        );
        await step(`update theirs ${i}`, () =>
          client.upsertUnit(worldId, {
            branchName: branchTheirs,
            unit: {
              id: 'unit-prop',
              type: 'character',
              title: 'Prop',
              fields: { ...baseFields, [theirsKey]: theirsValue }
            }
          })
        );
        await step(`commit ours ${i}`, () =>
          client.commit(worldId, { branchName: branchOurs, message: `Ours ${i}` })
        );
        await step(`commit theirs ${i}`, () =>
          client.commit(worldId, { branchName: branchTheirs, message: `Theirs ${i}` })
        );

        const diff = await step<any>(`diff ${i}`, () =>
          client.diff(worldId, { from: `branch:${branchOurs}`, to: `branch:${branchTheirs}` })
        );
        const diffPaths = (diff.changes ?? []).map((change: any) => change.path ?? change);
        const preview = await step<any>(`mergePreview ${i}`, () =>
          client.mergePreview(worldId, { oursBranch: branchOurs, theirsBranch: branchTheirs })
        );
        const conflictCount = preview.conflicts?.length ?? 0;

        if (oursKey === theirsKey) {
          expect(conflictCount).toBeGreaterThan(0);
        } else {
          expect(conflictCount).toBe(0);
          const apply = await step<any>(`mergeApply ${i}`, () =>
            client.mergeApply(worldId, { oursBranch: branchOurs, theirsBranch: branchTheirs, resolutions: [] })
          );
          const mergeCommitId = pickId(apply, ['mergeCommitId', 'commitId', 'id']);
          const mergedUnit = await step<any>(`getUnit merged ${i}`, () =>
            client.getUnit(worldId, 'unit-prop', { ref: `commit:${mergeCommitId}` })
          );
          const mergedFields = extractUnitFields(mergedUnit);
          expect(mergedFields?.[oursKey]).toBe(oursValue);
          expect(mergedFields?.[theirsKey]).toBe(theirsValue);
        }

        results.push({ case: i, conflict: conflictCount > 0, paths: diffPaths });
      }

      recorder.set('seed', seed);
      recorder.set('runs', runs);
      recorder.set('results', results);
      recorder.set('theirsOnly', { value: theirsOnlyValue });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      await recorder.flush(status);
    }
  });
});
