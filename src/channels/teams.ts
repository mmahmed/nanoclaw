/**
 * Microsoft Teams channel adapter — uses Chat SDK bridge.
 *
 * Supports both single- and multi-bot installs. The .env file is scanned at
 * module load for two env-var shapes:
 *
 *   - Bare:     TEAMS_APP_ID, TEAMS_APP_PASSWORD, TEAMS_APP_TYPE, TEAMS_APP_TENANT_ID
 *   - Suffixed: TEAMS_<SUFFIX>_APP_ID, TEAMS_<SUFFIX>_APP_PASSWORD, ...
 *
 * One bridge is registered per discovered credential set. The bare set
 * registers under `channelType: 'teams'`; suffixed sets register under
 * `channelType: 'teams-<suffix-lower>'` and serve under
 * `/webhook/teams-<suffix-lower>`. Operators with N Azure AD app
 * registrations point each one's messaging endpoint at the matching webhook.
 *
 * Structural note: env reading moves from inside the factory (current
 * single-bot pattern) to module-top-level. The number of registrations is
 * determined at scan time, before any factory runs.
 */
import fs from 'fs';
import path from 'path';

import { createTeamsAdapter } from '@chat-adapter/teams';

import { log } from '../log.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

export interface TeamsBotConfig {
  /** Registry/webhook routing identifier: 'teams' (bare) or 'teams-<suffix-lower>'. */
  channelType: string;
  appId: string;
  appPassword: string;
  appType?: 'SingleTenant' | 'MultiTenant';
  appTenantId?: string;
}

// Non-greedy capture + explicit alternation handles suffixed keys including
// suffixes that contain underscores (e.g. TEAMS_MY_BOT_APP_ID → 'MY_BOT'),
// and disambiguates APP_ID from APP_TENANT_ID correctly.
const TEAMS_KEY_PATTERN = /^TEAMS_(.*?)_?APP_(ID|PASSWORD|TYPE|TENANT_ID)$/;

/**
 * Parse Teams bot configs from a {key→value} env map. Exported for testing.
 *
 * Sets missing `APP_ID` or `APP_PASSWORD` are skipped with a warning; sets
 * with `APP_TYPE=SingleTenant` but missing `APP_TENANT_ID` are also skipped.
 */
export function parseTeamsBotsFromEnvMap(env: Record<string, string>): TeamsBotConfig[] {
  // Group raw env values by suffix bucket. Empty string = bare set.
  const buckets = new Map<string, Record<string, string>>();

  for (const [key, value] of Object.entries(env)) {
    const match = key.match(TEAMS_KEY_PATTERN);
    if (!match) continue;
    const suffix = match[1]; // '' for bare, 'EVA' for suffixed
    const field = match[2]; // 'ID' | 'PASSWORD' | 'TYPE' | 'TENANT_ID'
    if (!buckets.has(suffix)) buckets.set(suffix, {});
    buckets.get(suffix)![field] = value;
  }

  // Validate each bucket; emit warn-and-skip for invalid sets.
  const configs: TeamsBotConfig[] = [];
  for (const [suffix, fields] of buckets) {
    const channelType = suffix ? `teams-${suffix.toLowerCase()}` : 'teams';

    if (!fields.ID || !fields.PASSWORD) {
      log.warn('Teams bot missing APP_ID or APP_PASSWORD; skipping', {
        channelType,
        suffix: suffix || '(bare)',
      });
      continue;
    }

    const appType: 'SingleTenant' | 'MultiTenant' | undefined =
      fields.TYPE === 'SingleTenant' || fields.TYPE === 'MultiTenant' ? fields.TYPE : undefined;

    if (appType === 'SingleTenant' && !fields.TENANT_ID) {
      log.warn('Teams bot with APP_TYPE=SingleTenant requires APP_TENANT_ID; skipping', {
        channelType,
        suffix: suffix || '(bare)',
      });
      continue;
    }

    configs.push({
      channelType,
      appId: fields.ID,
      appPassword: fields.PASSWORD,
      appType,
      appTenantId: fields.TENANT_ID || undefined,
    });
  }

  return configs;
}

// Read .env and return KEY=VALUE pairs whose KEY matches `pattern`. Same
// parsing rules as `readEnvFile` in src/env.ts — no process.env pollution,
// comment + blank-line skipping, surrounding-quote stripping. Inlined here
// (rather than exposed in env.ts) so the multi-bot Teams change is fully
// self-contained: a single channels-side file diff with no trunk touch.
function readEnvKeysMatching(pattern: RegExp): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!pattern.test(key)) continue;
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

// Register one bridge per discovered Teams bot. Scan happens at module load
// (not inside a factory) because the number of registrations must be known
// before any factory runs.
for (const bot of parseTeamsBotsFromEnvMap(readEnvKeysMatching(TEAMS_KEY_PATTERN))) {
  const { channelType, appId, appPassword, appType, appTenantId } = bot;
  registerChannelAdapter(channelType, {
    factory: () => {
      const teamsAdapter = createTeamsAdapter({
        appId,
        appPassword,
        appType,
        appTenantId,
      });
      return createChatSdkBridge({
        adapter: teamsAdapter,
        channelType,
        concurrency: 'concurrent',
        supportsThreads: true,
      });
    },
  });
}
