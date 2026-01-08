import { createClient } from '@worldfork/sdk';

const client = createClient({ baseUrl: 'http://localhost:3000' });

async function run() {
  const world = await client.createWorld({ name: 'Type Test World' });
  const worldId = (world as any).worldId ?? (world as any).id;

  await client.createBranch({ worldId, branchName: 'alt', ref: 'branch:main' });

  await client.upsertUnit({
    worldId,
    ref: 'branch:main',
    unitId: 'unit-1',
    unit: { type: 'character', fields: { name: 'Nova' } }
  });

  await client.commit({ worldId, branchName: 'main', message: 'Type commit' });

  await client.diff({ worldId, fromRef: 'branch:main', toRef: 'branch:alt' });

  await client.mergePreview({ worldId, ours: 'branch:main', theirs: 'branch:alt' });

  await client.mergeApply({
    worldId,
    ours: 'branch:main',
    theirs: 'branch:alt',
    resolutions: [{ unitId: 'unit-1', path: '/fields/name', resolution: 'ours' }]
  });

  await client.listWorlds();
  await client.listBranches({ worldId });
  await client.listCommits({ worldId, branchName: 'main' });
  await client.getUnits({ worldId, ref: 'branch:main' });
  await client.getUnit({ worldId, unitId: 'unit-1', ref: 'branch:main' });
}

void run();

// @ts-expect-error missing required name
client.createWorld({});

// @ts-expect-error ref must be string with prefix
client.getUnits({ worldId: 'world-1', ref: 123 });

// @ts-expect-error invalid resolution format
client.mergeApply({
  worldId: 'world-1',
  ours: 'branch:main',
  theirs: 'branch:alt',
  resolutions: [{ unitId: 'unit-1', path: '/fields/name', resolution: 42 }]
});
