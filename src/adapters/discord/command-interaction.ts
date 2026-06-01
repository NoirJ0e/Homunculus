import type { CommandEvent, CommandRegistration, CommandScope } from "./command-router.js";

/**
 * command-interaction.ts — the live discord.js wiring for slash commands
 * (ADR-0012 Phase 3, #31), mirroring create-gateway-source.ts: discord.js is
 * DYNAMIC-imported (never loaded in tests). The pure mapping
 * {@link mapInteractionToCommandEvent} is split out so the interaction→event
 * transform is unit-testable against a minimal interaction-shaped object without
 * touching discord.js. {@link createCommandSource} (gateway → CommandEvent) and
 * {@link registerGuildCommands} (publishes the command set so it appears in
 * Discord) are HITL glue run by a bot-token holder; a bot CANNOT invoke a slash
 * command, so a real human invocation is verified in the all-chain issue #36.
 */

/** The minimal slice of discord.js' ChatInputCommandInteraction the mapping reads. */
interface InteractionLike {
  isChatInputCommand(): boolean;
  readonly commandName: string;
  readonly user: { readonly id: string };
  readonly channelId: string;
  readonly channel: { isThread(): boolean } | null;
  readonly options: { readonly data: ReadonlyArray<{ name: string; value: unknown }> };
}

/**
 * Pure transform: a discord.js chat-input interaction → a {@link CommandEvent}.
 * Returns null for any non-chat-input interaction (buttons, autocomplete, …) so
 * the source can drop it. threadId is set only when the channel is a thread.
 * Option values are coerced to strings (the CommandEvent option bag is
 * `Record<string, string>`); undefined/null values are skipped.
 */
export function mapInteractionToCommandEvent(interaction: InteractionLike): CommandEvent | null {
  if (!interaction.isChatInputCommand()) return null;

  const options: Record<string, string> = {};
  for (const opt of interaction.options.data) {
    if (opt.value === undefined || opt.value === null) continue;
    options[opt.name] = String(opt.value);
  }

  const isThread = interaction.channel?.isThread() === true;

  return {
    name: interaction.commandName,
    invokerId: interaction.user.id,
    channelId: interaction.channelId,
    options,
    ...(isThread ? { threadId: interaction.channelId } : {}),
  };
}

/** A source that pushes a CommandEvent for every human slash-command invocation. */
export interface CommandEventSource {
  onCommand(handler: (event: CommandEvent) => void): void;
}

/**
 * GLUE — HITL, NOT unit-tested. Logs in a discord.js client and pushes a
 * CommandEvent for each `interactionCreate` that is a chat-input command (via
 * the pure mapping above). Webhooks/bots cannot fire these — only real humans.
 */
export async function createCommandSource(botToken: string): Promise<CommandEventSource> {
  const { Client, GatewayIntentBits, MessageFlags } = await import("discord.js");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const handlers: Array<(e: CommandEvent) => void> = [];

  client.on("interactionCreate", (interaction) => {
    const chat = interaction as unknown as InteractionLike & {
      reply: (options: unknown) => Promise<unknown>;
    };
    if (!chat.isChatInputCommand()) return;
    // ACK inside Discord's 3-second window, else the client shows "The
    // application did not respond". The command's real output is posted to the
    // channel/thread via webhook by the handlers, so an ephemeral receipt is
    // all the interaction itself needs. Ack BEFORE dispatching (handlers may do
    // slow async work — create a thread, run a query — and don't hold the
    // interaction object).
    void chat.reply({ content: "收到，正在处理……", flags: MessageFlags.Ephemeral }).catch(() => {});
    const event = mapInteractionToCommandEvent(chat);
    if (event === null) return;
    for (const h of handlers) h(event);
  });

  await client.login(botToken);

  return { onCommand: (handler) => handlers.push(handler) };
}

/** A command's public descriptor (name + description) for guild registration. */
export interface CommandDescriptor {
  readonly name: string;
  readonly description: string;
  readonly scope: CommandScope;
}

/**
 * GLUE — HITL, NOT unit-tested. Publishes the command SET as guild application
 * commands so they appear in the Discord client. Run once by a bot-token holder
 * (the bot itself can never invoke them). Uses discord.js' REST/Routes, dynamic-
 * imported. `descriptors` typically come from {@link describeCommands}.
 */
export async function registerGuildCommands(
  botToken: string,
  appId: string,
  guildId: string,
  descriptors: readonly CommandDescriptor[],
): Promise<void> {
  const { REST, Routes } = await import("discord.js");

  const body = descriptors.map((d) => ({ name: d.name, description: d.description }));
  const rest = new REST({ version: "10" }).setToken(botToken);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
}

/**
 * Derive registration descriptors (name + scope) from the command set's
 * registrations, attaching a human-facing description. Keeps the live
 * registration body in lockstep with the routed command set.
 */
export function describeCommands(
  registrations: readonly CommandRegistration[],
  descriptions: Readonly<Record<string, string>>,
): CommandDescriptor[] {
  return registrations.map((reg) => ({
    name: reg.name,
    description: descriptions[reg.name] ?? reg.name,
    scope: reg.scope,
  }));
}
