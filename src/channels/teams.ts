/**
 * Microsoft Teams channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 *
 * Supports one bot or several. A Teams bot is a distinct Entra app
 * registration with its own credentials and its own messaging endpoint, so
 * an install fronting several assistants needs one adapter instance per bot.
 * Two shapes, and this file registers whichever the .env describes:
 *
 *   TEAMS_APP_ID=…          → default instance, keyed `teams`,
 *                             webhook /webhook/teams
 *   TEAMS_<NAME>_APP_ID=…   → instance `teams-<name>`,
 *                             webhook /webhook/teams-<name>
 *
 * Both may be present; each block registers independently, and the default
 * is always registered whether or not it is configured (see
 * discoverTeamsBlocks). `channelType` stays `teams` throughout — the
 * instance is a separate dimension, so user identity, message formatting
 * and container config stay keyed on the platform instead of fragmenting
 * per bot.
 *
 * Instance names lowercase with `_` → `-`, so TEAMS_SALES_APP_ID becomes
 * `teams-sales`. Two blocks that normalize to the same name would collide;
 * the later one is skipped with a warning rather than silently replacing
 * the first.
 */
import { createTeamsAdapter } from '@chat-adapter/teams';

import { listEnvKeys, readEnvFile } from '../env.js';
import { log } from '../log.js';
import type { ChannelDefaults } from './adapter.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

/**
 * Dedicated bot app on a threaded platform. 'mention' (not sticky) is the
 * conservative group default; operators upgrade per wiring.
 */
const TEAMS_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  group: { engageMode: 'mention', threads: true, unknownSenderPolicy: 'request_approval' },
  mentions: 'platform',
};

/** `TEAMS_SALES_APP_ID` → captures `SALES`. `TEAMS_APP_ID` does not match. */
const NAMED_BLOCK_RE = /^TEAMS_(.+)_APP_ID$/;

interface TeamsBlock {
  /** Registry key, and bridge instance unless it is the default. */
  instance: string;
  /** Env key prefix, e.g. `TEAMS_SALES` or `TEAMS`. */
  prefix: string;
}

/**
 * Credential blocks to register: always the default, plus one per named
 * block found in .env.
 *
 * The default is registered unconditionally even with no `TEAMS_APP_ID`,
 * matching every other channel — registration is cheap and the factory
 * returns null when credentials are absent, which the registry reports as
 * "credentials missing, skipping". Registering it only when configured
 * would make `teams` conditionally absent from the registry and change
 * behaviour for single-bot installs; this way the named blocks are purely
 * additive. It also means the default wins any collision with a named block
 * that normalizes to `teams`.
 */
export function discoverTeamsBlocks(keys: string[]): TeamsBlock[] {
  const blocks: TeamsBlock[] = [{ instance: 'teams', prefix: 'TEAMS' }];
  const seen = new Set<string>(['teams']);

  for (const key of keys) {
    const m = NAMED_BLOCK_RE.exec(key);
    if (!m) continue;
    const instance = `teams-${m[1].toLowerCase().replace(/_/g, '-')}`;
    if (seen.has(instance)) {
      log.warn('Teams: duplicate instance name, skipping block', { key, instance });
      continue;
    }
    seen.add(instance);
    blocks.push({ instance, prefix: `TEAMS_${m[1]}` });
  }

  return blocks;
}

function registerBlock({ instance, prefix }: TeamsBlock): void {
  registerChannelAdapter(instance, {
    factory: () => {
      const env = readEnvFile([
        `${prefix}_APP_ID`,
        `${prefix}_APP_PASSWORD`,
        `${prefix}_APP_TENANT_ID`,
        `${prefix}_APP_TYPE`,
      ]);
      const appId = env[`${prefix}_APP_ID`];
      if (!appId) return null;

      const teamsAdapter = createTeamsAdapter({
        appId,
        appPassword: env[`${prefix}_APP_PASSWORD`],
        appType: (env[`${prefix}_APP_TYPE`] as 'SingleTenant' | 'MultiTenant') || undefined,
        appTenantId: env[`${prefix}_APP_TENANT_ID`] || undefined,
      });

      return createChatSdkBridge({
        adapter: teamsAdapter,
        concurrency: 'concurrent',
        supportsThreads: true,
        defaults: TEAMS_DEFAULTS,
        // Deliberately omitted for the default block. Passing
        // `instance: 'teams'` routes identically, but the bridge namespaces
        // Chat SDK state for any explicitly-named instance, and the default
        // instance must stay on the legacy unprefixed keyspace.
        ...(instance === 'teams' ? {} : { instance }),
      });
    },
    defaults: TEAMS_DEFAULTS,
  });
}

for (const block of discoverTeamsBlocks(listEnvKeys())) registerBlock(block);
