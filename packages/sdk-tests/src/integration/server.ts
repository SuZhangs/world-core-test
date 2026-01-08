import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RunningServer = {
  baseUrl: string;
  close: () => Promise<void>;
  databasePath?: string;
};

export async function startTestServer(): Promise<RunningServer> {
  const envUrl = process.env.WORLD_CORE_SERVER_URL;
  if (envUrl) {
    return { baseUrl: envUrl, close: async () => undefined };
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '../../..');
  const databaseDir = await mkdtemp(path.join(tmpdir(), 'worldfork-sdk-tests-'));
  const databasePath = path.join(databaseDir, 'test.db');
  process.env.DATABASE_URL = `file:${databasePath}`;
  process.env.NODE_ENV = 'test';

  const factoryServer = await tryStartWithFactory(repoRoot);
  if (factoryServer) {
    return { ...factoryServer, databasePath };
  }

  const port = await getAvailablePort();
  const command = process.env.WORLD_CORE_SERVER_CMD ?? 'npm';
  const args = process.env.WORLD_CORE_SERVER_CMD ? process.env.WORLD_CORE_SERVER_CMD.split(' ').slice(1) : ['run', 'dev'];
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: `file:${databasePath}`
    },
    stdio: 'inherit'
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, '/openapi.json');

  return {
    baseUrl,
    databasePath,
    close: async () => {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      await rm(databaseDir, { recursive: true, force: true });
    }
  };
}

async function tryStartWithFactory(repoRoot: string): Promise<RunningServer | null> {
  const candidates = [
    'packages/server/src/app',
    'packages/server/src/server',
    'server/src/app',
    'server/src/server',
    'src/app',
    'src/server'
  ];
  const extensions = ['.ts', '.js', '.mjs', '.cjs'];

  for (const candidate of candidates) {
    for (const ext of extensions) {
      const fullPath = path.resolve(repoRoot, `${candidate}${ext}`);
      if (!existsSync(fullPath)) {
        continue;
      }

      const mod = await import(pathToFileUrl(fullPath));
      const factory =
        mod.createApp ??
        mod.createServer ??
        mod.buildApp ??
        mod.makeServer ??
        mod.default ??
        mod.app;

      if (typeof factory === 'function') {
        const app = await factory();
        if (typeof app?.listen === 'function') {
          const address = await app.listen({ port: 0, host: '127.0.0.1' });
          const portMatch = typeof address === 'string' ? address.match(/:(\d+)/) : null;
          const port = portMatch ? Number(portMatch[1]) : app.server?.address?.().port;
          if (!port) {
            await app.close?.();
            continue;
          }
          return {
            baseUrl: `http://127.0.0.1:${port}`,
            close: async () => {
              await app.close?.();
            }
          };
        }
      }
    }
  }

  return null;
}

function pathToFileUrl(filePath: string) {
  return path.toNamespacedPath(filePath).startsWith('\\\\')
    ? new URL(`file:${filePath.replace(/\\/g, '/')}`).href
    : new URL(`file://${filePath}`).href;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    server.on('listening', () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Unable to acquire port')));
      }
    });
    server.on('error', reject);
  });
}

async function waitForServer(baseUrl: string, pathName: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${pathName}`);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not respond at ${baseUrl}${pathName}`);
}
