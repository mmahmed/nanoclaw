---
name: add-teams
description: Add Microsoft Teams channel integration via Chat SDK.
---

# Add Microsoft Teams Channel

Connect NanoClaw to Microsoft Teams for interactive chat in team channels, group chats, and direct messages.

## Install

NanoClaw doesn't ship channels in trunk. This skill copies the Teams adapter in from the `channels` branch.

### Pre-flight (idempotent)

Skip to **Credentials** if all of these are already in place:

- `src/channels/teams.ts` exists
- `src/channels/index.ts` contains `import './teams.js';`
- `@chat-adapter/teams` is listed in `package.json` dependencies

Otherwise continue. Every step below is safe to re-run.

### 1. Fetch the channels branch

```bash
git fetch origin channels
```

### 2. Copy the adapter

```bash
git show origin/channels:src/channels/teams.ts > src/channels/teams.ts
```

### 3. Append the self-registration import

Append to `src/channels/index.ts` (skip if the line is already present):

```typescript
import './teams.js';
```

### 4. Install the adapter package (pinned)

```bash
pnpm install @chat-adapter/teams@4.26.0
```

### 5. Build

```bash
pnpm run build
```

## Credentials

### Step 1: Create an Azure AD App Registration

1. Go to [Azure Portal](https://portal.azure.com) > **App registrations** > **New registration**
2. Name it (e.g., "NanoClaw")
3. Supported account types: **Single tenant** (your org only) or **Multi tenant** (any org)
4. Click **Register**
5. Copy the **Application (client) ID** and **Directory (tenant) ID** from the Overview page

### Step 2: Create a Client Secret

1. In the App Registration, go to **Certificates & secrets**
2. Click **New client secret**, description "nanoclaw", expiry 180 days
3. Click **Add** and **copy the Value immediately** (shown only once)

### Step 3: Create an Azure Bot

1. Go to Azure Portal > search **Azure Bot** > **Create**
2. Fill in:
   - **Bot handle**: unique name (e.g., "nanoclaw-bot")
   - **Type of App**: match your app registration (Single or Multi Tenant)
   - **Creation type**: **Use existing app registration**
   - **App ID**: paste from Step 1
   - **App tenant ID**: paste from Step 1 (Single Tenant only)
3. Click **Review + create** > **Create**

Or use Azure CLI:

```bash
az group create --name nanoclaw-rg --location eastus
az bot create \
  --resource-group nanoclaw-rg \
  --name nanoclaw-bot \
  --app-type SingleTenant \
  --appid YOUR_APP_ID \
  --tenant-id YOUR_TENANT_ID \
  --endpoint "https://your-domain/api/webhooks/teams"
```

### Step 4: Configure Messaging Endpoint

1. Go to your Azure Bot resource > **Configuration**
2. Set **Messaging endpoint** to `https://your-domain/api/webhooks/teams`
3. Click **Apply**

### Step 5: Enable Teams Channel

1. In the Azure Bot resource, go to **Channels**
2. Click **Microsoft Teams** > Accept terms > **Apply**

Or via CLI:

```bash
az bot msteams create --resource-group nanoclaw-rg --name nanoclaw-bot
```

### Step 6: Create and Sideload Teams App

Create a `manifest.json`:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "YOUR_APP_ID",
  "packageName": "com.nanoclaw.bot",
  "developer": {
    "name": "NanoClaw",
    "websiteUrl": "https://your-domain",
    "privacyUrl": "https://your-domain",
    "termsOfUseUrl": "https://your-domain"
  },
  "name": { "short": "NanoClaw", "full": "NanoClaw Assistant" },
  "description": {
    "short": "NanoClaw assistant bot",
    "full": "NanoClaw personal assistant powered by Claude."
  },
  "icons": { "outline": "outline.png", "color": "color.png" },
  "accentColor": "#4A90D9",
  "bots": [{
    "botId": "YOUR_APP_ID",
    "scopes": ["personal", "team", "groupchat"],
    "supportsFiles": false,
    "isNotificationOnly": false
  }],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["your-domain"]
}
```

Create two icon PNGs (32x32 `outline.png`, 192x192 `color.png`), zip all three files together.

**Sideload in Teams:**
1. Open Teams > **Apps** > **Manage your apps**
2. Click **Upload an app** > **Upload a custom app**
3. Select the zip file

Sideloading requires Teams admin access. Free personal Teams does NOT support sideloading. Use a Microsoft 365 Business account or developer tenant.

### Step 7: Receive All Messages (Optional)

By default, the bot only receives messages when @-mentioned. To receive all messages in a channel without @-mention, add RSC permissions to `manifest.json`:

```json
{
  "authorization": {
    "permissions": {
      "resourceSpecific": [
        { "name": "ChannelMessage.Read.Group", "type": "Application" }
      ]
    }
  }
}
```

### Configure environment

Add to `.env`:

```bash
TEAMS_APP_ID=your-app-id
TEAMS_APP_PASSWORD=your-client-secret
# For Single Tenant only:
TEAMS_APP_TENANT_ID=your-tenant-id
TEAMS_APP_TYPE=SingleTenant
```

Sync to container: `mkdir -p data/env && cp .env data/env/env`

### Webhook server

The Chat SDK bridge automatically starts a shared webhook server on port 3000 (configurable via `WEBHOOK_PORT` env var). The server handles `/api/webhooks/teams` for Teams and other webhook-based adapters. This port must be publicly reachable from the internet for Azure Bot Service to deliver activities.

For local development without a public URL, use a tunnel (e.g., `ngrok http 3000`) and update the messaging endpoint in Azure Bot Configuration.

## Multi-bot setup (advanced)

A single NanoClaw host can serve **multiple Teams bot identities** — distinct Azure AD app registrations, each with its own name, icon, and messaging endpoint. Each bot becomes its own registered channel under a suffixed `channelType` and serves on a per-bot webhook URL.

Use this when you need:
- One host running N separately-branded Teams bots (multi-tenant deployments, multi-team installs, brand separation).
- Routing the same Teams conversation through different bots without identity collision.

### Env-var convention

Each bot's credentials are namespaced with a suffix. The bare `TEAMS_APP_*` variables (no suffix) still work and register under `channelType: 'teams'` — that's bot #1 for backwards compatibility. Additional bots add a suffix segment:

```bash
# Bot #1 (bare — registers as channelType 'teams', webhook /webhook/teams)
TEAMS_APP_ID=bare-bot-app-id
TEAMS_APP_PASSWORD=bare-bot-secret
TEAMS_APP_TYPE=MultiTenant
TEAMS_APP_TENANT_ID=...   # for SingleTenant only

# Bot #2 (suffix ALPHA — registers as channelType 'teams-alpha', webhook /webhook/teams-alpha)
TEAMS_ALPHA_APP_ID=alpha-bot-app-id
TEAMS_ALPHA_APP_PASSWORD=alpha-bot-secret
TEAMS_ALPHA_APP_TYPE=MultiTenant

# Bot #3 (suffix BETA — registers as channelType 'teams-beta', webhook /webhook/teams-beta)
TEAMS_BETA_APP_ID=beta-bot-app-id
TEAMS_BETA_APP_PASSWORD=beta-bot-secret
TEAMS_BETA_APP_TYPE=MultiTenant
```

Rules:
- Suffix is uppercase by convention in the env-var key; the adapter lowercases it for the `channelType` (so `TEAMS_ALPHA_*` becomes `teams-alpha`).
- Suffixes can contain underscores (`TEAMS_MY_BOT_APP_*` → `teams-my_bot`).
- A bot with `APP_TYPE=SingleTenant` must also have `APP_TENANT_ID`; without it, that bot is skipped with a warning.
- Sets missing `APP_ID` or `APP_PASSWORD` are skipped with a warning — the host won't refuse to boot.

### Per-bot Azure setup

Each Teams bot needs its **own Azure resources** — there's no shortcut around this. For every additional bot, repeat the steps in [Credentials](#credentials) above (sections 1–7) with a fresh App Registration, Client Secret, Azure Bot, manifest, and sideload. Concretely, for each bot:

1. New Azure AD App Registration (its own App ID, Tenant ID, secret).
2. New Azure Bot resource with **messaging endpoint** pointed at `https://your-domain/webhook/teams-<suffix-lower>` (or `/webhook/teams` for the bare bot).
3. Teams channel enabled on the bot.
4. New Teams app manifest with that bot's App ID and a distinct app name + icons. Sideload separately so it appears as a distinct app in Teams.

If you're using `/setup` for the Azure portal walkthrough on an additional bot, **be careful**: the current setup flow writes back to bare `TEAMS_APP_*` env vars and would overwrite bot #1's credentials. Either run setup only for bot #1 (the bare set) and walk the Azure portal manually for additional bots, or interrupt setup before the env-write step and add the suffixed vars to `.env` yourself.

### Restart and verify

After updating `.env` with the new bot's env vars:

```bash
# Sync to container env
mkdir -p data/env && cp .env data/env/env

# Restart the host so module-load picks up the new bot
# (macOS)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# (Linux)
systemctl --user restart nanoclaw
```

The host log at startup should show one `Webhook adapter registered` line per bot, e.g.:

```
Webhook adapter registered { adapter: 'teams', path: '/webhook/teams' }
Webhook adapter registered { adapter: 'teams', path: '/webhook/teams-alpha' }
Webhook adapter registered { adapter: 'teams', path: '/webhook/teams-beta' }
```

(The `adapter` value is the Chat SDK adapter's internal name and stays `'teams'` for all instances; the `path` is the per-bot routing URL.)

Wire each bot to an agent via `/manage-channels` — the channel types `teams`, `teams-alpha`, `teams-beta` appear as separate channels in the wiring flow. Each bot creates its own user records, role entries, and DM cache: granting Alice admin via bot Alpha doesn't grant her admin via bot Beta. Grant roles explicitly per bot.

## Next Steps

If you're in the middle of `/setup`, return to the setup flow now.

Otherwise, run `/manage-channels` to wire this channel to an agent group.

## Channel Info

- **type**: `teams` (bare) or `teams-<suffix>` (multi-bot — see [Multi-bot setup](#multi-bot-setup-advanced) above)
- **terminology**: Teams has "teams" containing "channels." The bot can also receive DMs (personal scope) and group chat messages. Channels support threaded replies.
- **platform-id-format**: `teams:{base64-encoded-conversation-id}:{base64-encoded-service-url}` — auto-generated by the adapter, not human-readable. Use the auto-created messaging group ID for wiring.
- **how-to-find-id**: Send a message to the bot in the channel. NanoClaw auto-creates a messaging group and logs the platform ID. Use that messaging group ID for wiring.
- **supports-threads**: yes (channels only; DMs and group chats are flat)
- **typical-use**: Team collaboration with the bot in channels; personal assistant via DMs
- **default-isolation**: Separate agent group per team. DMs can share an agent group with your main channel for unified personal memory. Multi-bot installs typically use a separate agent group per bot.
