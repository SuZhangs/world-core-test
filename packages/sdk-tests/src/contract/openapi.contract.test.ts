import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../../..');
const openApiPath = process.env.WORLD_CORE_OPENAPI_PATH ?? path.join(repoRoot, 'openapi', 'openapi.json');

type OpenApiSchema = {
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
};

function collectProperties(schema?: OpenApiSchema): Record<string, OpenApiSchema> {
  if (!schema) {
    return {};
  }
  let props: Record<string, OpenApiSchema> = { ...(schema.properties ?? {}) };
  for (const entry of schema.allOf ?? []) {
    props = { ...props, ...collectProperties(entry) };
  }
  for (const entry of schema.oneOf ?? []) {
    props = { ...props, ...collectProperties(entry) };
  }
  return props;
}

function resolveJsonSchema(response: any): OpenApiSchema | undefined {
  const jsonContent =
    response?.content?.['application/json'] ?? response?.content?.['application/problem+json'];
  return jsonContent?.schema;
}

function getSuccessResponse(operation: any) {
  const responses = operation?.responses ?? {};
  const successKey =
    Object.keys(responses).find((key) => key.startsWith('2')) ??
    Object.keys(responses).find((key) => key === 'default');
  return successKey ? responses[successKey] : undefined;
}

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
      '/v1/worlds/{worldId}/merge'
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
      diff: { method: 'get', path: '/v1/worlds/{worldId}/diff' },
      mergePreview: { method: 'post', path: '/v1/worlds/{worldId}/merge' },
      mergeApply: { method: 'post', path: '/v1/worlds/{worldId}/merge' }
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

  it('key responses include expected fields', async () => {
    const raw = await readFile(openApiPath, 'utf-8');
    const spec = JSON.parse(raw);
    const paths = spec.paths ?? {};

    const expectations: Array<{
      path: string;
      method: string;
      fields: string[];
    }> = [
      { path: '/v1/worlds', method: 'post', fields: ['worldId', 'id'] },
      { path: '/v1/worlds', method: 'get', fields: ['worlds'] },
      { path: '/v1/worlds/{worldId}/branches', method: 'post', fields: ['branchName', 'name'] },
      { path: '/v1/worlds/{worldId}/branches', method: 'get', fields: ['branches'] },
      { path: '/v1/worlds/{worldId}/units', method: 'post', fields: ['unitId', 'unit'] },
      { path: '/v1/worlds/{worldId}/units', method: 'get', fields: ['units'] },
      { path: '/v1/worlds/{worldId}/units/{unitId}', method: 'get', fields: ['unit', 'fields'] },
      { path: '/v1/worlds/{worldId}/commits', method: 'post', fields: ['commitId', 'id'] },
      { path: '/v1/worlds/{worldId}/commits', method: 'get', fields: ['commits'] },
      { path: '/v1/worlds/{worldId}/diff', method: 'get', fields: ['changes'] },
      { path: '/v1/worlds/{worldId}/merge', method: 'post', fields: ['conflicts', 'mergeCommitId'] }
    ];

    const failures: string[] = [];
    for (const { path: apiPath, method, fields } of expectations) {
      const operation = paths[apiPath]?.[method];
      if (!operation) {
        failures.push(`${method.toUpperCase()} ${apiPath}: missing operation`);
        continue;
      }
      const successResponse = getSuccessResponse(operation);
      const schema = resolveJsonSchema(successResponse);
      const properties = collectProperties(schema);
      const hasField = fields.some((field) => field in properties);
      if (!hasField) {
        failures.push(
          `${method.toUpperCase()} ${apiPath}: expected one of [${fields.join(
            ', '
          )}] in response schema but saw [${Object.keys(properties).join(', ')}]`
        );
      }
    }

    if (failures.length) {
      throw new Error(`OpenAPI response schema mismatches:\n${failures.join('\n')}`);
    }
  });
});
