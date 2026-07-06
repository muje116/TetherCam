import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let _dirname = '';
try {
  _dirname = __dirname;
} catch {
  _dirname = path.dirname(fileURLToPath(import.meta.url));
}

const LOG_PATH = path.join(_dirname, '../../debug-da00e2.log');

export function writeDebugLog(payload: Record<string, unknown>): void {
  try {
    fs.appendFileSync(LOG_PATH, `${JSON.stringify({ ...payload, timestamp: Date.now() })}\n`);
  } catch {
    // ignore logging failures
  }
}
