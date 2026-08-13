import fs from 'fs';
import path from 'path';
import { log } from './log.js';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  return parseEnvFile(new Set(keys));
}

/**
 * Names of the keys present in .env, without their values.
 *
 * For callers that discover configuration by pattern rather than by known
 * key — an adapter registering one instance per `TEAMS_<NAME>_APP_ID` block,
 * say. Values are deliberately withheld: the caller follows up with
 * `readEnvFile` for the keys it decides it wants, so secrets are still read
 * only at the point of use.
 */
export function listEnvKeys(): string[] {
  return Object.keys(parseEnvFile(undefined));
}

/** Shared .env parse. `wanted === undefined` keeps every key. */
function parseEnvFile(wanted: Set<string> | undefined): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch (err) {
    log.debug('.env file not found, using defaults', { err });
    return {};
  }

  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (wanted !== undefined && !wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}
