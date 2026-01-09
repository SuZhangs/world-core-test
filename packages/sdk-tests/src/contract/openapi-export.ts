import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../integration/server';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../../..');
const outputDir = path.join(repoRoot, 'openapi');
const outputPath = path.join(outputDir, 'openapi.json');

async function run() {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/openapi.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
    }
    const raw = await response.text();
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, raw, 'utf-8');
    console.info(`[sdk-tests] OpenAPI spec saved to ${outputPath}`);
  } finally {
    await server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
