# Discord Adapter — Human-in-the-Loop Runbook

This directory contains the real Discord adapter for the Substrate + HumanInbox ports.

## Architecture Summary

| Concept | Discord mapping |
|---|---|
| 场景 (scene) | Discord thread (or channel) |
| 人格分身 (persona) | Webhook with actor name + avatar |
| Human turn inbound | Bot reads messages from thread |
| Agent post outbound | Webhook POST with actor persona |

## What is HITL-blocked

The acceptance criterion **"在真实 Discord 服务器里人工验证跑通一整回合"** requires:
1. A real Discord server with a human player present.
2. A live bot token and webhook URL (secrets — never committed).
3. Manual play of at least one full beat: AIDM emits → human reads → human types → engine polls → processes.

This cannot be automated in CI and must be verified by a human.

---

## Human Runbook — Full Setup

### Step 1: Create a Discord Application

1. Go to <https://discord.com/developers/applications>.
2. Click **New Application** → give it a name (e.g. "Homunculus Engine").
3. Under **Bot**, click **Add Bot** (confirm).
4. Copy the **Bot Token** → set as `DISCORD_BOT_TOKEN` env var.
5. Enable **Message Content Intent** under Privileged Gateway Intents.

### Step 2: Create a Webhook

1. In your Discord server, go to the channel you want to use as the main scene.
2. Channel Settings → **Integrations** → **Webhooks** → **New Webhook**.
3. Name it anything (it will be overridden per-message by actor personas).
4. Copy the **Webhook URL** → set as `DISCORD_WEBHOOK_URL` env var.

### Step 3: Invite the Bot

1. Under **OAuth2 > URL Generator**, select scopes: `bot`.
2. Under **Bot Permissions**, select:
   - `Send Messages`
   - `Read Message History`
   - `View Channels`
3. Copy and open the generated URL to invite the bot to your server.

### Step 4: Get Thread IDs

1. Enable **Developer Mode** in Discord (User Settings → Advanced).
2. For each scene, create a thread in the channel.
3. Right-click each thread → **Copy Thread ID**.
4. Build a `SceneThreadMap`:

```typescript
const threadMap = {
  [sceneId("scene-tavern")]:  "1234567890123456789",  // thread snowflake
  [sceneId("scene-dungeon")]: "9876543210987654321",
};
```

### Step 5: Get Human Player Discord User IDs

1. Right-click a player's Discord username → **Copy User ID**.
2. Set `discordUserId` on their `ActorPersona`:

```typescript
const personas: ActorPersona[] = [
  {
    actorId: actorId("actor-fighter"),
    username: "Thorin Oakenshield",
    avatarURL: "https://your-cdn.com/thorin.png",
    discordUserId: "111222333444555666",  // player's Discord snowflake
  },
  {
    actorId: actorId("actor-dm"),
    username: "The Dungeon Master",
    avatarURL: "https://your-cdn.com/dm.png",
    // no discordUserId — AI agent, never polled via inbox
  },
];
```

### Step 6: Wire it in the entry point

```typescript
import { createRealDiscordClient } from "./src/adapters/discord/create-real-discord.js";
import { DiscordSubstrate } from "./src/adapters/discord/discord-substrate.js";
import { DiscordInbox } from "./src/adapters/discord/discord-inbox.js";

const client = await createRealDiscordClient({
  botToken:   process.env.DISCORD_BOT_TOKEN!,
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
});
const substrate = new DiscordSubstrate(client, personas, threadMap);
const inbox     = new DiscordInbox(client, personas, threadMap);

// Pass substrate and inbox to the engine...
```

### Step 7: Verify one full beat manually

1. Start the engine with `DISCORD_BOT_TOKEN` and `DISCORD_WEBHOOK_URL` set.
2. The AIDM emits a post → verify it appears in the Discord thread with the DM's name + avatar.
3. A human player types a message in the thread (e.g. "I search the room.").
4. Verify the engine polls and processes the human's message as a prose turn.
5. The AIDM emits a response → verify it appears in the thread.
6. Test roll: human types `.ra 侦查` → verify the engine receives `{ kind: "roll" }`.
7. Test pass: human types `pass` → verify the engine receives `{ kind: "pass" }`.

---

## v1 playable — `npm start` (ADR-0010)

The first playable session (1 AIDM + 1 NPC companion + 1 human, single thread)
is wired in `src/main.ts`. You don't hand-wire anything — just set env + run.

**Auth** (preferred, 省钱): `claude setup-token` → paste into `.env` as
`CLAUDE_CODE_OAUTH_TOKEN`. Or set `ANTHROPIC_API_KEY`.

**`.env`** (copy from `.env.example`):

```
CLAUDE_CODE_OAUTH_TOKEN=...        # or ANTHROPIC_API_KEY=...
DISCORD_BOT_TOKEN=...              # bot with Message Content Intent ENABLED
DISCORD_WEBHOOK_URL=...            # webhook in the channel hosting the scene thread
DISCORD_SCENE_THREAD_ID=...        # the thread = the single scene
DISCORD_PLAYER_USER_ID=...         # your Discord user id (routes your turns)
```

**Run:**

```bash
npm start          # = node --env-file=.env --import tsx src/main.ts
```

The DM (a long-lived Agent-SDK `query()`) narrates into the thread, then calls
`await_actors`; the engine pulls up the NPC (its own `query()`) and **blocks on
the Discord gateway** waiting for you to type. Real-time waiting is gateway-push
(`createGatewaySource`), not REST polling — so the bot must have the **Message
Content Intent** on. An AFK human = the await never resolves (ADR-0003 hold);
Ctrl-C to stop (serializable pause/resume is a later slice).

> Note: `DiscordInbox` (REST poll) remains for tests; production uses
> `GatewayInbox` (gateway push). Known v1 cosmetic: your own message is also
> re-emitted as a "玩家" webhook post (the engine records every turn); harmless,
> tidied in a later slice.

---

## Skipped HITL Integration Test

A skipped live-smoke test can be run against a real Discord server:

```bash
DISCORD_BOT_TOKEN=... DISCORD_WEBHOOK_URL=... DISCORD_TEST_THREAD_ID=... npx vitest run test/discord/discord-hitl.test.ts
```

See `test/discord/discord-hitl.test.ts` for the test (guarded by `test.skip` and env checks).
