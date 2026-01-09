import * as sdk from '@worldfork/sdk';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json'
};

export function createSdkClient(baseUrl: string): any {
  assertPublishedSdkResolved();
  if ('createClient' in sdk && typeof sdk.createClient === 'function') {
    return (sdk as any).createClient({ baseUrl });
  }
  if ('WorldForkClient' in sdk && typeof (sdk as any).WorldForkClient === 'function') {
    return new (sdk as any).WorldForkClient({ baseUrl });
  }
  if ('default' in sdk && typeof (sdk as any).default === 'function') {
    return new (sdk as any).default({ baseUrl });
  }
  throw new Error('Unable to construct SDK client: expected createClient or WorldForkClient export.');
}

type SdkResolutionInfo = {
  resolvedPackageJson: string;
  realpath: string;
  isSymlink: boolean;
  repoRoot: string;
  nodeModulesPath: string;
};

let sdkResolutionCache: SdkResolutionInfo | null = null;

export function getSdkResolutionInfo(): SdkResolutionInfo {
  if (sdkResolutionCache) {
    return sdkResolutionCache;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '../../..');
  const requireFn = createRequire(import.meta.url);
  const resolvedEntry = requireFn.resolve('@worldfork/sdk');
  const resolvedPackageJson = findPackageJson(resolvedEntry);
  const realpath = realpathSync(resolvedPackageJson);
  const nodeModulesPath = path.resolve(repoRoot, 'node_modules', '@worldfork', 'sdk');
  const isSymlink = existsSync(nodeModulesPath) ? lstatSync(nodeModulesPath).isSymbolicLink() : false;

  sdkResolutionCache = {
    resolvedPackageJson,
    realpath,
    isSymlink,
    repoRoot,
    nodeModulesPath
  };

  return sdkResolutionCache;
}

function findPackageJson(resolvedEntry: string): string {
  let currentDir = path.dirname(resolvedEntry);
  while (true) {
    const candidate = path.join(currentDir, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }
  throw new Error(`Unable to locate package.json for resolved entry: ${resolvedEntry}`);
}

export function assertPublishedSdkResolved(): void {
  const info = getSdkResolutionInfo();
  console.info(
    `[sdk-tests] @worldfork/sdk resolved to ${info.resolvedPackageJson} (realpath: ${info.realpath})`
  );

  const packagesSdkPath = path.resolve(info.repoRoot, 'packages', 'sdk');
  if (info.realpath.startsWith(packagesSdkPath)) {
    throw new Error(
      [
        'SDK resolution check failed: @worldfork/sdk is resolving to the workspace package.',
        `Resolved path: ${info.realpath}`,
        'This indicates a workspace link instead of the published npm package.',
        'Fix: remove the workspace package or install with --workspaces=false, or run npm run sdk:test:published.'
      ].join('\n')
    );
  }

  if (info.isSymlink) {
    throw new Error(
      [
        'SDK resolution check failed: node_modules/@worldfork/sdk is a symlink.',
        `Symlink path: ${info.nodeModulesPath}`,
        'This indicates a workspace link instead of the published npm package.',
        'Fix: remove the workspace package or install with --workspaces=false, or run npm run sdk:test:published.'
      ].join('\n')
    );
  }
}

export function buildJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...DEFAULT_HEADERS,
      ...headers
    }
  });
}

export function buildTextResponse(text: string, status = 500, headers: Record<string, string> = {}) {
  return new Response(text, {
    status,
    headers
  });
}

export function getErrorDetails(error: unknown) {
  const err = error as any;
  const code = err?.code ?? err?.error?.code ?? err?.response?.error?.code ?? err?.response?.code;
  const status = err?.status ?? err?.response?.status;
  const message = err?.message ?? String(error);
  const body = err?.body ?? err?.response?.body ?? err?.response;
  return { code, status, message, body };
}

export function formatError(error: unknown) {
  const details = getErrorDetails(error);
  return JSON.stringify(details, null, 2);
}

export function expectFetchCalled(fetchMock: any, expected: {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  if (!fetchMock.mock.calls.length) {
    throw new Error(`Expected fetch to be called but it was not.`);
  }
  const [input, init] = fetchMock.mock.calls[0];
  const actualUrl = typeof input === 'string' ? input : input?.url;
  if (actualUrl !== expected.url) {
    throw new Error(`Expected URL ${expected.url} but got ${actualUrl}`);
  }
  const actualMethod = init?.method ?? 'GET';
  if (actualMethod !== expected.method) {
    throw new Error(`Expected method ${expected.method} but got ${actualMethod}`);
  }
  if (expected.headers) {
    for (const [key, value] of Object.entries(expected.headers)) {
      const actualValue = init?.headers?.[key] ?? init?.headers?.[key.toLowerCase()];
      if (actualValue !== value) {
        throw new Error(`Expected header ${key}=${value} but got ${actualValue}`);
      }
    }
  }
  if (expected.body !== undefined) {
    const actualBody = init?.body;
    const parsed = typeof actualBody === 'string' ? JSON.parse(actualBody) : actualBody;
    if (JSON.stringify(parsed) !== JSON.stringify(expected.body)) {
      throw new Error(`Expected body ${JSON.stringify(expected.body)} but got ${JSON.stringify(parsed)}`);
    }
  }
}

export async function expectSdkError<T>(promise: Promise<T>, expected: {
  code?: string;
  status?: number;
  messageIncludes?: string;
}) {
  try {
    await promise;
  } catch (error) {
    const details = getErrorDetails(error);
    if (expected.code && details.code !== expected.code && !details.message.includes(expected.code)) {
      throw new Error(`Expected error code ${expected.code} but got ${details.code}. Details: ${formatError(error)}`);
    }
    if (expected.status && details.status !== expected.status && !details.message.includes(String(expected.status))) {
      throw new Error(`Expected status ${expected.status} but got ${details.status}. Details: ${formatError(error)}`);
    }
    if (expected.messageIncludes && !details.message.includes(expected.messageIncludes)) {
      throw new Error(
        `Expected error message to include "${expected.messageIncludes}". Details: ${formatError(error)}`
      );
    }
    return;
  }
  throw new Error(`Expected SDK to throw but it resolved.`);
}

export function pickId(value: any, keys: string[]) {
  for (const key of keys) {
    if (value?.[key]) {
      return value[key];
    }
  }
  throw new Error(`Unable to find id from keys: ${keys.join(', ')}. Response: ${JSON.stringify(value)}`);
}
