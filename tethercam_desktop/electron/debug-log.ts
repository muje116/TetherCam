import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(moduleDirectory, '../../debug-da00e2.log');

export function writeDebugLog(payload: Record<string, unknown>): void {
  try {
    fs.appendFileSync(LOG_PATH, `${JSON.stringify({ ...payload, timestamp: Date.now() })}\n`);
  } catch {
    // ignore logging failures
  }
}
