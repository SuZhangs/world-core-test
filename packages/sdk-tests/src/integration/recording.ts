import path from 'node:path';
import { appendSummaryLine, slugify, writeJsonArtifact } from '../artifacts';
import { getSdkResolutionInfo } from '../test-helpers';

export type IntegrationRecord = {
  testName: string;
  timestamp: string;
  baseUrl?: string;
  sdkResolution: ReturnType<typeof getSdkResolutionInfo>;
  data: Record<string, unknown>;
  status?: 'passed' | 'failed';
};

export function createIntegrationRecorder(testName: string, baseUrl?: string) {
  const record: IntegrationRecord = {
    testName,
    timestamp: new Date().toISOString(),
    baseUrl,
    sdkResolution: getSdkResolutionInfo(),
    data: {}
  };

  return {
    record,
    set(key: string, value: unknown) {
      record.data[key] = value;
    },
    push(key: string, value: unknown) {
      const existing = record.data[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        record.data[key] = [value];
      }
    },
    async flush(status: 'passed' | 'failed' = 'passed') {
      record.status = status;
      const filename = `integration-${slugify(testName)}-${Date.now()}.json`;
      const fullPath = await writeJsonArtifact(filename, record);
      const relative = path.relative(process.cwd(), fullPath);
      await appendSummaryLine(`[${status}] ${testName} -> ${relative}`);
    }
  };
}
