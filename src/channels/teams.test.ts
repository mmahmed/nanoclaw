import { describe, expect, it } from 'vitest';

import { parseTeamsBotsFromEnvMap } from './teams.js';

describe('parseTeamsBotsFromEnvMap', () => {
  it('returns empty array for an empty env map', () => {
    expect(parseTeamsBotsFromEnvMap({})).toEqual([]);
  });

  it('returns empty array when no TEAMS_* keys are present', () => {
    expect(
      parseTeamsBotsFromEnvMap({
        SOMETHING_ELSE: 'value',
        SLACK_BOT_TOKEN: 'xoxb-xxx',
      }),
    ).toEqual([]);
  });

  it('parses a single bare credential set into channelType=teams', () => {
    expect(
      parseTeamsBotsFromEnvMap({
        TEAMS_APP_ID: 'abc123',
        TEAMS_APP_PASSWORD: 'secret',
        TEAMS_APP_TYPE: 'MultiTenant',
      }),
    ).toEqual([
      {
        channelType: 'teams',
        appId: 'abc123',
        appPassword: 'secret',
        appType: 'MultiTenant',
        appTenantId: undefined,
      },
    ]);
  });

  it('parses a single suffixed set into lowercased channelType', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_ALPHA_APP_ID: 'alpha-id',
      TEAMS_ALPHA_APP_PASSWORD: 'alpha-secret',
      TEAMS_ALPHA_APP_TYPE: 'MultiTenant',
    });
    expect(got).toHaveLength(1);
    expect(got[0].channelType).toBe('teams-alpha');
    expect(got[0].appId).toBe('alpha-id');
  });

  it('parses bare and suffixed sets coexisting into N entries', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_APP_ID: 'bare-id',
      TEAMS_APP_PASSWORD: 'bare-secret',
      TEAMS_APP_TYPE: 'MultiTenant',
      TEAMS_ALPHA_APP_ID: 'alpha-id',
      TEAMS_ALPHA_APP_PASSWORD: 'alpha-secret',
      TEAMS_ALPHA_APP_TYPE: 'MultiTenant',
      TEAMS_BETA_APP_ID: 'beta-id',
      TEAMS_BETA_APP_PASSWORD: 'beta-secret',
      TEAMS_BETA_APP_TYPE: 'MultiTenant',
    });
    expect(got).toHaveLength(3);
    const types = got.map((c) => c.channelType).sort();
    expect(types).toEqual(['teams', 'teams-alpha', 'teams-beta']);
  });

  it('treats suffixes with underscores as a single suffix segment', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_MY_BOT_APP_ID: 'mybot-id',
      TEAMS_MY_BOT_APP_PASSWORD: 'mybot-secret',
      TEAMS_MY_BOT_APP_TYPE: 'MultiTenant',
    });
    expect(got).toHaveLength(1);
    expect(got[0].channelType).toBe('teams-my_bot');
    expect(got[0].appId).toBe('mybot-id');
  });

  it('disambiguates APP_TENANT_ID from APP_ID in suffixed sets', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_ALPHA_APP_ID: 'alpha-id',
      TEAMS_ALPHA_APP_PASSWORD: 'alpha-secret',
      TEAMS_ALPHA_APP_TYPE: 'SingleTenant',
      TEAMS_ALPHA_APP_TENANT_ID: 'tenant-uuid',
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      channelType: 'teams-alpha',
      appId: 'alpha-id',
      appType: 'SingleTenant',
      appTenantId: 'tenant-uuid',
    });
  });

  it('skips a set missing APP_PASSWORD', () => {
    expect(
      parseTeamsBotsFromEnvMap({
        TEAMS_APP_ID: 'abc123',
        TEAMS_APP_TYPE: 'MultiTenant',
      }),
    ).toEqual([]);
  });

  it('skips a set missing APP_ID', () => {
    expect(
      parseTeamsBotsFromEnvMap({
        TEAMS_APP_PASSWORD: 'secret',
        TEAMS_APP_TYPE: 'MultiTenant',
      }),
    ).toEqual([]);
  });

  it('skips SingleTenant sets missing APP_TENANT_ID', () => {
    expect(
      parseTeamsBotsFromEnvMap({
        TEAMS_APP_ID: 'abc123',
        TEAMS_APP_PASSWORD: 'secret',
        TEAMS_APP_TYPE: 'SingleTenant',
      }),
    ).toEqual([]);
  });

  it('accepts MultiTenant sets without APP_TENANT_ID', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_APP_ID: 'abc123',
      TEAMS_APP_PASSWORD: 'secret',
      TEAMS_APP_TYPE: 'MultiTenant',
    });
    expect(got).toHaveLength(1);
    expect(got[0].appType).toBe('MultiTenant');
    expect(got[0].appTenantId).toBeUndefined();
  });

  it('accepts sets without APP_TYPE (appType stays undefined)', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_APP_ID: 'abc123',
      TEAMS_APP_PASSWORD: 'secret',
    });
    expect(got).toHaveLength(1);
    expect(got[0].appType).toBeUndefined();
  });

  it('treats an unknown APP_TYPE value as undefined (not an error)', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_APP_ID: 'abc123',
      TEAMS_APP_PASSWORD: 'secret',
      TEAMS_APP_TYPE: 'GarbageValue',
    });
    expect(got).toHaveLength(1);
    expect(got[0].appType).toBeUndefined();
  });

  it('lowercases suffix for channelType regardless of input case', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_MIXEDcase_APP_ID: 'id',
      TEAMS_MIXEDcase_APP_PASSWORD: 'secret',
      TEAMS_MIXEDcase_APP_TYPE: 'MultiTenant',
    });
    expect(got).toHaveLength(1);
    expect(got[0].channelType).toBe('teams-mixedcase');
  });

  it('skips one invalid set while keeping the other valid one', () => {
    // alpha set is missing APP_PASSWORD AND APP_TENANT_ID — skipped.
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_APP_ID: 'bare-id',
      TEAMS_APP_PASSWORD: 'bare-secret',
      TEAMS_APP_TYPE: 'MultiTenant',
      TEAMS_ALPHA_APP_ID: 'alpha-id',
      TEAMS_ALPHA_APP_TYPE: 'SingleTenant',
    });
    expect(got).toHaveLength(1);
    expect(got[0].channelType).toBe('teams');
  });

  it('ignores non-Teams keys mixed into the env map', () => {
    const got = parseTeamsBotsFromEnvMap({
      TEAMS_APP_ID: 'abc',
      TEAMS_APP_PASSWORD: 'secret',
      SLACK_BOT_TOKEN: 'xoxb-yyy',
      DISCORD_BOT_TOKEN: 'd-zzz',
      RANDOM_VAR: 'whatever',
    });
    expect(got).toHaveLength(1);
    expect(got[0].channelType).toBe('teams');
  });
});
