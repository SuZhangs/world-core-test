import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

export function getRepoRoot(): string {
  return repoRoot;
}

export async function getArtifactsDir(): Promise<string> {
  const artifactsDir = path.join(repoRoot, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  return artifactsDir;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80);
}

export async function writeJsonArtifact(filename: string, data: unknown): Promise<string> {
  const artifactsDir = await getArtifactsDir();
  const fullPath = path.join(artifactsDir, filename);
  await writeFile(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  return fullPath;
}

export async function writeTextArtifact(filename: string, content: string): Promise<string> {
  const artifactsDir = await getArtifactsDir();
  const fullPath = path.join(artifactsDir, filename);
  await writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

export async function appendSummaryLine(line: string): Promise<void> {
  const artifactsDir = await getArtifactsDir();
  const summaryPath = path.join(artifactsDir, 'summary.txt');
  await appendFile(summaryPath, line.endsWith('\n') ? line : `${line}\n`, 'utf-8');
}
