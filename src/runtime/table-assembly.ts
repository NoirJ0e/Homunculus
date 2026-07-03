import type { ActorId, CampaignId, SceneId } from "../domain/ids.js";
import { actorId } from "../domain/ids.js";
import type { Soul } from "../domain/soul.js";
import type { CampaignBible } from "../domain/campaign.js";
import type { DicePort } from "../ports/dice.js";
import type { CardStore } from "../ports/card-store.js";
import type { NpcPort } from "../ports/npc.js";
import type { TraceSink } from "../ports/trace-sink.js";
import type { RosterStore } from "../ports/roster-store.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { DiscordClient } from "../adapters/discord/discord-substrate.js";
import type { ActorPersona } from "../adapters/discord/scene-threads.js";
import type { PoolBot } from "../adapters/discord/bot-pool.js";
import { DiscordSubstrate } from "../adapters/discord/discord-substrate.js";
import { MultiBotSubstrate } from "../adapters/discord/multi-bot-substrate.js";
import { AgentNpc } from "../adapters/agent-sdk/agent-npc.js";
import { npcGenerate } from "../adapters/agent-sdk/sdk-runner.js";
import { messageToTraceEvents } from "../adapters/agent-sdk/trace-tap.js";
import {
  withTimeoutRetry,
  realClock,
  type Clock,
  type TimeoutRetryOptions,
} from "../adapters/agent-sdk/timeout-npc.js";
import { buildDmSystemPrompt } from "../adapters/agent-sdk/dm-prompt.js";
import { Referee } from "../engine/referee.js";
import { mapRoster } from "../engine/roster.js";
import { assembleAidmCast } from "./aidm-cast.js";
import { npcBotBindings } from "./npc-bot-assignment.js";
import { PushInbox } from "./push-inbox.js";
import { buildCampaignBrief } from "../domain/campaign.js";

/**
 * table-assembly.ts — the ONE recipe for opening a table (arch-C1).
 *
 * 「开一张牌桌」— trace taps, per-teammate NPC agents, bot-pool substrate,
 * Referee, DM prompt — used to be inlined in `runAidmQuery`'s closure and
 * re-copied (with drift) into every live script. Wiring bugs (the whole
 * #50–#57 class) had to be fixed in four places; the assembly itself had no
 * test entry point. This module owns the recipe: callers (the production
 * runner and the live scripts) feed stores + pool + config and get back an
 * assembled table; what remains outside is genuinely caller-specific — the
 * `query()` driver, channel provisioning, step-traces.
 *
 * The assembly is deterministic composition (no `query()` call, no wall
 * clock) — with fake ports it is unit-testable, which is the point: the
 * test surface finally covers the wiring itself.
 *
 * It also ABSORBS the scripts' roll-when-pending wrapper: production
 * `AgentNpc` only speaks/passes, so on the old runner path an NPC facing a
 * `call_check` could never emit its `roll` turn — the check loop worked in
 * diagnostics (each script hand-wrapped the port) and was broken in
 * production. The wrapper now lives HERE, on every assembled table.
 */

/** The human seat at the table, or "none" for an all-AI diagnostic table. */
export type HumanSeat =
  | {
      readonly id?: ActorId;
      readonly username?: string;
      /** Overrides the roster-derived Discord id for the cue @真人 ping (#56). */
      readonly discordUserId?: string;
    }
  | "none";

export interface TableDeps {
  /** The scene this table plays in (the channel IS the scene). */
  readonly scene: SceneId;
  /** The Discord channel/thread all scene posts route to. */
  readonly channelId: string;
  readonly campaign: CampaignId;

  // ── cast source ──────────────────────────────────────────────────────────
  readonly rosterStore: RosterStore;
  readonly soulStore: SoulStore;
  /** Defaults to the production human seat (`player`). Pass "none" for an
   *  all-AI table (diagnostic scripts). */
  readonly humanSeat?: HumanSeat;

  // ── substrate ────────────────────────────────────────────────────────────
  /** Webhook posting client (the AIDM + overflow personas speak through it). */
  readonly webhook: DiscordClient;
  /** NPC bot pool (#56). Empty/absent → single-webhook persona substrate. */
  readonly botPool?: readonly PoolBot[];
  /** Guild for per-NPC bot nicknames (best-effort, non-fatal). */
  readonly guildId?: string;

  // ── mechanics + spine ────────────────────────────────────────────────────
  /** The campaign's mechanical judge (#44). Absent → rolls stay passes. */
  readonly dice?: DicePort;
  /** Read-only sheets for the DM's `read_card` (ADR-0001/0002). Another line
   *  only the scripts used to wire — production `read_card` always came back
   *  empty. Absent → the tool reports no card. */
  readonly cards?: CardStore;
  /** The registered bible (plot spine #45 + brief + rule system). */
  readonly bible?: CampaignBible;

  // ── NPC agents ───────────────────────────────────────────────────────────
  /** One NPC generation turn (DI seam). Defaults to the live Agent-SDK
   *  {@link npcGenerate}; tests/scripts may stub. */
  readonly generate?: (
    prompt: string,
    onMessage?: (message: unknown) => void,
  ) => Promise<string>;
  /** #53 timeout/retry guard config. Absent → unguarded generate. */
  readonly npcTimeout?: TimeoutRetryOptions;
  /** Injected clock for the guard (tests). Defaults to the wall clock. */
  readonly clock?: Clock;

  // ── observability ────────────────────────────────────────────────────────
  /** Trace sink + runId: every agent's stream (DM via `observe`, each NPC by
   *  its real name) records here. Absent → no tracing. */
  readonly traceSink?: TraceSink;
  readonly runId?: string;

  readonly onError?: (where: string, error: unknown) => void;
}

export interface AssembledTable {
  readonly referee: Referee;
  readonly substrate: DiscordSubstrate | MultiBotSubstrate;
  readonly inbox: PushInbox;
  readonly aidmId: ActorId;
  /** The human seat's actor id; undefined on an all-AI table. */
  readonly humanId: ActorId | undefined;
  /** The bound AI teammate souls (empty → the AIDM opened solo, flagged). */
  readonly teammates: readonly Soul[];
  /** Per-actor NpcPort seam (#51 — one port per teammate, never shared). */
  readonly npcFor: (actor: ActorId) => NpcPort | undefined;
  readonly degraded: boolean;
  /** The DM system prompt for this table (brief + cast names + system). */
  readonly systemPrompt: string;
  /** Trace tap factory (`observe("aidm")` for the DM stream); undefined when
   *  no sink was supplied. */
  readonly observe?: (agent: string) => (message: unknown) => void;
}

export function assembleTable(deps: TableDeps): AssembledTable {
  const onError = deps.onError ?? (() => {});
  const aidm = actorId("aidm");
  const seat = deps.humanSeat ?? {};
  const humanId = seat === "none" ? undefined : (seat.id ?? actorId("player"));

  // Observability: one tap per agent into the shared sink.
  const sink = deps.traceSink;
  const runId = deps.runId ?? "table";
  const observe = sink
    ? (agent: string) =>
        (message: unknown): void => {
          for (const ev of messageToTraceEvents(agent, runId, message)) sink.record(ev);
        }
    : undefined;

  // One NpcPort per teammate (#51 修共脑), traced under its REAL name, guarded
  // by the #53 timeout decorator, and — the absorbed script wrapper — emitting
  // `roll` whenever the DM has a check pending on it (without this, production
  // NPCs could never resolve a call_check).
  const hold: { ref?: Referee } = {};
  const generate = deps.generate ?? npcGenerate;
  const makeNpc = ({ soul, persona }: { soul: Soul; persona: string }): NpcPort => {
    const label = `npc:${soul.personaCore.name}`;
    const base = observe ? (p: string) => generate(p, observe(label)) : (p: string) => generate(p);
    const guarded = deps.npcTimeout
      ? withTimeoutRetry(base, deps.npcTimeout, deps.clock ?? realClock)
      : base;
    const agent = new AgentNpc({ persona, generate: guarded });
    return {
      takeTurn: async (ctx) =>
        hold.ref?.pendingCheckFor(ctx.actorId) !== undefined
          ? { kind: "roll" }
          : agent.takeTurn(ctx),
    };
  };

  // The human player's real Discord id (cue @真人, #56): explicit override
  // first, then the campaign roster's first human seat.
  const humanDiscordId =
    seat !== "none"
      ? (seat.discordUserId ??
        (deps.rosterStore.get(deps.campaign) ?? []).find((e) => e.kind === "human")
          ?.discordUserId)
      : undefined;

  const cast = assembleAidmCast({
    rosterStore: deps.rosterStore,
    soulStore: deps.soulStore,
    campaign: deps.campaign,
    humanId: humanId ?? actorId("player"),
    ...(seat !== "none" && seat.username !== undefined && { humanUsername: seat.username }),
    ...(humanDiscordId !== undefined && { humanDiscordId }),
    makeNpc,
  });
  if (cast.degraded) {
    onError(`table:${deps.channelId}`, new Error("no bound AI teammate — AIDM opening solo"));
  }

  // On an all-AI table the human persona/roster entries are simply unused;
  // what matters is presentActors below (the nominate round never points at
  // an absent human).
  const personas: ActorPersona[] = [{ actorId: aidm, username: "地下城主" }, ...cast.personas];
  const threadMap = { [deps.scene]: deps.channelId };

  // #56 — bind each teammate to its own pool bot; degrade to single-webhook.
  const pool = deps.botPool ?? [];
  let substrate: DiscordSubstrate | MultiBotSubstrate;
  if (pool.length > 0) {
    const botByActor = npcBotBindings(
      cast.teammates.map((t) => ({ id: t.id, name: t.personaCore.name })),
      pool,
      (bot, name) => {
        if (deps.guildId !== undefined) {
          void bot
            .setNickname(deps.guildId, name)
            .catch((e) => onError(`table:${deps.channelId}:nickname`, e));
        }
      },
    );
    substrate = new MultiBotSubstrate({
      webhook: deps.webhook,
      personas,
      threadMap,
      botFor: (a) => botByActor.get(a),
    });
  } else {
    substrate = new DiscordSubstrate(deps.webhook, personas, threadMap);
  }

  const inbox = new PushInbox();

  // #57 协商通道内核: a teammate's prose that names another present actor queues
  // a directed instruction for them. Built from the cast's REAL names — another
  // recipe line the production runner never had (only the scripts wired it).
  const nameToId: ReadonlyArray<readonly [string, ActorId]> = cast.teammates.map((t) => [
    t.personaCore.name,
    t.id,
  ]);
  const mentionsOf = (prose: string, speaker: ActorId): ActorId[] => {
    const hits = new Set<ActorId>();
    for (const [name, id] of nameToId) if (id !== speaker && prose.includes(name)) hits.add(id);
    return [...hits];
  };

  const referee = new Referee({
    aidmId: aidm,
    substrate,
    humanInbox: inbox,
    roster: mapRoster(cast.rosterKinds),
    npcFor: cast.npcFor,
    mentionsOf,
    // #52 — the round roster `nominate` covers.
    presentActors: [
      ...(humanId !== undefined ? [humanId] : []),
      ...cast.teammates.map((t) => t.id),
    ],
    ...(deps.dice !== undefined && { dice: deps.dice }),
    ...(deps.cards !== undefined && { cards: deps.cards }),
    ...(deps.bible !== undefined && { campaign: deps.bible }),
  });
  hold.ref = referee;

  const campaignBrief = deps.bible
    ? buildCampaignBrief(deps.bible)
    : `战役 ${deps.campaign}：未登记战役语境，按通用开场处理。`;
  const teammateNames = cast.teammates.map((t) => t.personaCore.name).join("、");
  const opening =
    cast.teammates.length > 0
      ? humanId !== undefined
        ? `在主线频道开场，承接玩家与队友 ${teammateNames} 的行动。`
        : `在主线频道开场，这桌全员为 AI 调查员（${teammateNames}），逐个点名推进。`
      : "在主线频道开场，承接玩家的行动（暂无 AI 队友，独自开场）。";
  const systemPrompt = buildDmSystemPrompt({
    brief: `${campaignBrief}\n\n${opening}`,
    sceneId: deps.scene,
    cast: [
      ...cast.teammates.map((t) => ({
        actorId: t.id,
        role: "npc" as const,
        name: t.personaCore.name,
      })),
      ...(humanId !== undefined ? [{ actorId: humanId, role: "human" as const }] : []),
    ],
    ...(deps.bible?.system && { system: deps.bible.system }),
  });

  return {
    referee,
    substrate,
    inbox,
    aidmId: aidm,
    humanId,
    teammates: cast.teammates,
    npcFor: cast.npcFor,
    degraded: cast.degraded,
    systemPrompt,
    ...(observe && { observe }),
  };
}
