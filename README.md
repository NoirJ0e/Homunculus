# Homunculus

A Discord-native AI tabletop runner: a deterministic engine/referee plus generative agents (an AIDM narrator + AI teammates). One bot, one process — the concierge provisions campaigns at runtime and a **command-driven character-card lifecycle** (ADR-0012) carries play from genesis to the opening scene.

See `CONTEXT.md` for the domain model and `docs/adr/` for the decisions.

## Run it

```sh
cp .env.example .env      # fill in auth + Discord ids (see below)
npm install
npm start                 # node --env-file=.env --import tsx src/main.ts
npm test                  # vitest run (the headless suite)
```

`npm start` is the composition root (`src/main.ts`) — the irreducible HITL boundary (real `query()` + discord.js); it is type-checked, not unit-tested. Ctrl-C stops it.

### Environment (`.env`)

| Var | Required | Purpose |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | one of these two | Claude subscription token (preferred). |
| `ANTHROPIC_API_KEY` | one of these two | Pay-per-token fallback. |
| `DISCORD_BOT_TOKEN` | yes | Gateway login, provisioning, webhooks. |
| `DISCORD_GUILD_ID` | yes | The server campaigns are provisioned into. |
| `DISCORD_APP_ID` | for slash commands | Application (client) id — needed to register the slash commands so they appear in Discord. Unset ⇒ bot runs but commands aren't registered. |
| `DATA_DIR` | optional | File-store root (default `./data`, gitignored). |
| `HOMUNCULUS_LOBBY_CAMPAIGN` | optional | Lobby campaign id (default `lobby`). |
| `HOMUNCULUS_DEFAULT_ARCHETYPE` | optional | Default AI-seat / genesis archetype (default `战士`). |

Invite the bot with the **Administrator** permission and the `applications.commands` scope (see the URL in `.env.example`), and enable the **Message Content Intent** in the Developer Portal.

## The command-driven lifecycle (ADR-0012)

Control flow lives in **slash commands** (deterministic; a player cannot forge the invoker id Discord verifies); free text is fed only to the agent bound to that channel/thread (concierge chat, open-card chat, or IC narration). Slash commands are registered as guild application commands on startup.

The flow a session walks through:

1. **Genesis** — in any topicless channel, an owner says e.g. `我想跑《…》`; the concierge chats out a campaign and provisions its channels (ADR-0011).
2. **`/set-roster`** *(owner)* — declare the party (@players). Records the owner + one unapproved seat per player.
3. **`/create-character-card`** *(player)* — launches the player's private thread and an open-card assistant; the thread's free text routes to that session.
4. **`/verify-card`** *(player, in-thread)* — runs the stateful 审卡反馈环: the **provenance-agnostic verifier** adjudicates the card against the campaign's authoritative legality (bible knobs + owner-approved exceptions only — never `secretTruth`, never prose-approval claims), posts feedback, and on a PASS **binds** the card (soul saved + sheet written + roster marked approved). Re-invoking continues the same session after an in-thread revise.
5. **`/approve <项>`** *(owner)* — writes a sanctioned exception (the *sole* exception authority the verifier reads).
6. **`/add-ai-seat`** *(owner)* — adds an AI teammate seat that walks the **same** create → verify → bind path: genesis draft → the same verifier → capped automated revise loop → bind on pass (owner notified, *not* bound, on cap-exhaustion).
7. **`/start-game`** *(owner)* — the open gate. Spawns the AIDM only when every roster seat is approved (otherwise reports who's missing). The main channel no longer auto-starts on a plain message.

### How a command reaches a handler

`interactionCreate` (discord.js) → `mapInteractionToCommandEvent` → a normalized `CommandEvent` → the command source pre-resolves the channel's campaign → `CommandRouter.dispatch` looks the command up, runs the scope gate (`owner`/`player`/`any`) against the real `CampaignAuthority` (stored owner + roster) → the bound handler runs with its real store/seam deps.

### LLM seams

The verifier and the AI-seat reviser are real one-shot `query()` calls (`src/adapters/agent-sdk/card-llm-seams.ts`, sdk-runner style — HITL-unverified glue). Their deterministic prompt builders + verdict/draft parsers (`card-verifier-prompt.ts`) are unit-tested. The verdict parse **fails closed**: a malformed reply never silently binds an unverified card.

## Persistence (ADR-0012 file stores)

```
data/campaigns/<campaignId>/
  bible.json        # CampaignBible (incl. AIDM-private secretTruth)
  exceptions.json   # owner /approve exceptions
  roster.json       # explicit roster + per-seat approval state
  souls/<actorId>.json    # narrative persona / memory (SoulStore)
  sheets/<actorId>.json   # mechanical values (CardWriter / read-only CardStore)
```
