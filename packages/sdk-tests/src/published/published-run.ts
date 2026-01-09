import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeJsonArtifact } from '../artifacts';
import { startTestServer } from '../integration/server';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../../..');

async function exec(cmd: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function loadPublishedSdk(tempDir: string) {
  const requireFromTemp = createRequire(path.join(tempDir, 'package.json'));
  const packageJsonPath = requireFromTemp.resolve('@worldfork/sdk/package.json');
  const entryPath = requireFromTemp.resolve('@worldfork/sdk');
  const sdk = await import(pathToFileURL(entryPath).href);
  return { sdk, packageJsonPath };
}

async function runFlow(sdk: any, baseUrl: string) {
  const client =
    typeof sdk.createClient === 'function'
      ? sdk.createClient({ baseUrl })
      : sdk.WorldForkClient
      ? new sdk.WorldForkClient({ baseUrl })
      : new sdk.default({ baseUrl });

  const world = await client.createWorld({ name: 'Published SDK World' });
  const worldId = world.worldId ?? world.id;

  await client.upsertUnit(worldId, {
    branchName: 'main',
    unit: {
      id: 'unit-published',
      type: 'character',
      title: 'Published',
      fields: { name: 'Published', profile: { occupation: 'tester' } }
    }
  });
  const baseCommit = await client.commit(worldId, { branchName: 'main', message: 'Base commit' });
  const baseCommitId = baseCommit.commitId ?? baseCommit.id;

  await client.createBranch(worldId, { name: 'alt', sourceBranch: 'main' });
  await client.upsertUnit(worldId, {
    branchName: 'main',
    unit: {
      id: 'unit-published',
      type: 'character',
      title: 'Published',
      fields: { name: 'Published', profile: { occupation: 'engineer' } }
    }
  });
  const mainCommit = await client.commit(worldId, { branchName: 'main', message: 'Main conflict' });
  const mainCommitId = mainCommit.commitId ?? mainCommit.id;

  await client.upsertUnit(worldId, {
    branchName: 'alt',
    unit: {
      id: 'unit-published',
      type: 'character',
      title: 'Published',
      fields: { name: 'Published', profile: { occupation: 'architect' } }
    }
  });
  const altCommit = await client.commit(worldId, { branchName: 'alt', message: 'Alt commit' });
  const altCommitId = altCommit.commitId ?? altCommit.id;

  const diff = await client.diff(worldId, { from: 'branch:main', to: 'branch:alt' });
  const preview = await client.mergePreview(worldId, { oursBranch: 'main', theirsBranch: 'alt' });
  const conflict = preview.conflicts?.[0];
  const resolutions = conflict
    ? [{ unitId: conflict.unitId, path: conflict.path, choice: 'ours' }]
    : [];
  const apply = await client.mergeApply(worldId, {
    oursBranch: 'main',
    theirsBranch: 'alt',
    resolutions
  });
  const mergeCommitId = apply.mergeCommitId ?? apply.commitId ?? apply.id;
  const mergedUnit = await client.getUnit(worldId, 'unit-published', { ref: `commit:${mergeCommitId}` });
  const commitsResponse = await client.listCommits(worldId, { branchName: 'main' });
  const commits = Array.isArray(commitsResponse) ? commitsResponse : commitsResponse?.commits ?? [];
  const mergeCommit = commits.find((commit: any) => (commit.commitId ?? commit.id) === mergeCommitId);
  const parents = mergeCommit?.parents ?? mergeCommit?.parentIds ?? [];

  return {
    worldId,
    baseCommitId,
    mainCommitId,
    altCommitId,
    diff,
    preview,
    apply,
    mergeCommitId,
    mergedUnit,
    mergeCommitParents: parents,
    diffPaths: (diff.changes ?? []).map((change: any) => change.path ?? change)
  };
}

async function run() {
  const sdkVersion = process.env.WORLDFORK_SDK_VERSION ?? 'latest';
  const tempDir = await mkdtemp(path.join(tmpdir(), 'worldfork-sdk-published-'));
  const server = await startTestServer();

  try {
    await exec('npm', ['init', '-y'], tempDir);
    await exec('npm', ['install', `@worldfork/sdk@${sdkVersion}`], tempDir);

    const { sdk, packageJsonPath } = await loadPublishedSdk(tempDir);
    if (packageJsonPath.startsWith(repoRoot)) {
      throw new Error(
        `Published SDK check failed: resolved package.json at ${packageJsonPath} which is inside repo ${repoRoot}`
      );
    }
    const data = await runFlow(sdk, server.baseUrl);

    const output = {
      sdkVersion,
      sdkPackageJsonPath: packageJsonPath,
      baseUrl: server.baseUrl,
      tempDir,
      ...data
    };

    const filename = `published-run-${Date.now()}.json`;
    const outputPath = await writeJsonArtifact(filename, output);
    console.info(`[sdk-tests] Published SDK run recorded at ${outputPath}`);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
