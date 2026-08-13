/**
 * Integration test for the teams channel's single reach-in: the self-registration
 * import in the `src/channels/index.ts` barrel. Importing the barrel runs teams.ts's
 * top-level `registerChannelAdapter('teams', …)`; without the import the channel is
 * silently absent.
 *
 * Behavior, not structural: it imports the real barrel and asserts the registry
 * actually contains the channel. This reflects what happens at host boot — if the
 * `import './teams.js';` line is deleted, or the barrel fails to evaluate for any
 * reason (so the channel genuinely would not register), this goes red. A structural
 * check of the import line would falsely pass in that second case.
 *
 * Importing the barrel is safe: registration is a pure top-level call, and teams.ts
 * builds the SDK adapter / bridge only inside its factory (invoked at host startup),
 * never at import. It does require the adapter package (`@chat-adapter/teams`) to be installed,
 * which holds in a composed install: the skill's `pnpm install` step runs before this
 * test — so this test also implicitly guards that dependency (an unmocked import throws
 * if the package is missing).
 *
 * teams is a Chat SDK channel: teams.ts also consumes a load-bearing *core* API —
 * `createChatSdkBridge(...)` from ./chat-sdk-bridge.js. That core-consumption is a
 * typed call, so the build/typecheck leg (`pnpm run build`) guards it against upstream
 * drift, not this test. Every Chat SDK channel follows this same shape.
 */
import { describe, it, expect } from 'vitest';

import { getRegisteredChannelNames } from './channel-registry.js';
import { discoverTeamsBlocks } from './teams.js';
import './index.js'; // the real barrel — triggers every channel's self-registration

describe('teams channel registration', () => {
  it('registers teams via the channel barrel', () => {
    expect(getRegisteredChannelNames()).toContain('teams');
  });
});

/**
 * Multi-instance discovery. Pure over its `keys` argument so it runs without
 * a .env — the env read happens once at module scope, at the call site.
 */
describe('discoverTeamsBlocks', () => {
  it('always registers the default instance, even with no credentials', () => {
    expect(discoverTeamsBlocks([])).toEqual([{ instance: 'teams', prefix: 'TEAMS' }]);
  });

  it('maps a named block to instance and env prefix', () => {
    expect(discoverTeamsBlocks(['TEAMS_SUPPORT_APP_ID'])).toEqual([
      { instance: 'teams', prefix: 'TEAMS' },
      { instance: 'teams-support', prefix: 'TEAMS_SUPPORT' },
    ]);
  });

  it('lowercases and converts underscores to hyphens in the instance name', () => {
    expect(discoverTeamsBlocks(['TEAMS_FIRST_LINE_APP_ID'])[1]).toEqual({
      instance: 'teams-first-line',
      prefix: 'TEAMS_FIRST_LINE',
    });
  });

  it('does not mistake the default block, or other TEAMS_ keys, for a named one', () => {
    const keys = ['TEAMS_APP_ID', 'TEAMS_APP_PASSWORD', 'TEAMS_APP_TYPE', 'TEAMS_APP_TENANT_ID'];
    expect(discoverTeamsBlocks(keys)).toEqual([{ instance: 'teams', prefix: 'TEAMS' }]);
  });

  it('keeps every distinct named block', () => {
    const blocks = discoverTeamsBlocks(['TEAMS_SUPPORT_APP_ID', 'TEAMS_SALES_APP_ID']);
    expect(blocks.map((b) => b.instance)).toEqual(['teams', 'teams-support', 'teams-sales']);
  });

  it('skips a named block colliding with the default rather than replacing it', () => {
    // TEAMS__APP_ID normalizes to `teams-`, not `teams`; the real collision
    // case is a repeated name, which Set-dedupes to one entry.
    const blocks = discoverTeamsBlocks(['TEAMS_SUPPORT_APP_ID', 'TEAMS_SUPPORT_APP_ID']);
    expect(blocks.map((b) => b.instance)).toEqual(['teams', 'teams-support']);
  });
});
