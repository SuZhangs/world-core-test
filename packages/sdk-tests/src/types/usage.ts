import { createClient } from '@worldfork/sdk';

const client = createClient({ baseUrl: 'http://localhost:3000' });

async function run() {
  const world = await client.createWorld({ name: 'Type Test World' });
  const worldId = (world as any).worldId ?? (world as any).id;

  await client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' });

  await client.upsertUnit(worldId, {
    branchName: 'main',
    unit: { id: 'unit-1', type: 'character', title: 'Nova', fields: { name: 'Nova' } }
  });

  await client.commit(worldId, { branchName: 'main', message: 'Type commit' });

  await client.diff(worldId, { from: 'branch:main', to: 'branch:alt' });

  await client.mergePreview(worldId, { oursBranch: 'main', theirsBranch: 'alt' });

  await client.mergeApply(worldId, {
    oursBranch: 'main',
    theirsBranch: 'alt',
    resolutions: [{ unitId: 'unit-1', path: '/fields/name', choice: 'ours' }]
  });

  await client.listWorlds();
  await client.listBranches(worldId);
  await client.listCommits(worldId, { branchName: 'main' });
  await client.getUnits(worldId, { ref: 'branch:main' });
  await client.getUnit(worldId, 'unit-1', { ref: 'branch:main' });
}

void run();

// @ts-expect-error missing required name
client.createWorld({});

// @ts-expect-error ref must be string with prefix
client.getUnits('world-1', { ref: 123 });

client.mergeApply('world-1', {
  oursBranch: 'main',
  theirsBranch: 'alt',
  resolutions: [
    {
      unitId: 'unit-1',
      path: '/fields/name',
      // @ts-expect-error invalid resolution format
      choice: 42
    }
  ]
});
