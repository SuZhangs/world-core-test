import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const openApiPath = path.join(repoRoot, 'openapi', 'openapi.json');

describe('OpenAPI contract checks', () => {
  it('contains all key SDK paths', async () => {
    const raw = await readFile(openApiPath, 'utf-8');
    const spec = JSON.parse(raw);
    const paths = spec.paths ?? {};

    const requiredPaths = [
      '/v1/worlds',
      '/v1/worlds/{worldId}/branches',
      '/v1/worlds/{worldId}/units',
      '/v1/worlds/{worldId}/units/{unitId}',
      '/v1/worlds/{worldId}/commits',
      '/v1/worlds/{worldId}/diff',
      '/v1/worlds/{worldId}/merge/preview',
      '/v1/worlds/{worldId}/merge/apply'
    ];

    const missing = requiredPaths.filter((p) => !paths[p]);
    if (missing.length) {
      throw new Error(`OpenAPI missing required paths: ${missing.join(', ')}`);
    }
  });

  it('SDK method to OpenAPI mapping exists', async () => {
    const raw = await readFile(openApiPath, 'utf-8');
    const spec = JSON.parse(raw);
    const paths = spec.paths ?? {};

    const mapping: Record<string, { method: string; path: string }> = {
      createWorld: { method: 'post', path: '/v1/worlds' },
      listWorlds: { method: 'get', path: '/v1/worlds' },
      createBranch: { method: 'post', path: '/v1/worlds/{worldId}/branches' },
      listBranches: { method: 'get', path: '/v1/worlds/{worldId}/branches' },
      upsertUnit: { method: 'post', path: '/v1/worlds/{worldId}/units' },
      getUnits: { method: 'get', path: '/v1/worlds/{worldId}/units' },
      getUnit: { method: 'get', path: '/v1/worlds/{worldId}/units/{unitId}' },
      commit: { method: 'post', path: '/v1/worlds/{worldId}/commits' },
      listCommits: { method: 'get', path: '/v1/worlds/{worldId}/commits' },
      diff: { method: 'post', path: '/v1/worlds/{worldId}/diff' },
      mergePreview: { method: 'post', path: '/v1/worlds/{worldId}/merge/preview' },
      mergeApply: { method: 'post', path: '/v1/worlds/{worldId}/merge/apply' }
    };

    const missing: string[] = [];
    for (const [method, config] of Object.entries(mapping)) {
      if (!paths[config.path] || !paths[config.path][config.method]) {
        missing.push(`${method} -> ${config.method.toUpperCase()} ${config.path}`);
      }
    }

    if (missing.length) {
      throw new Error(`OpenAPI missing SDK method mappings:\n${missing.join('\n')}`);
    }
  });
});
