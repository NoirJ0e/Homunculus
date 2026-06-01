/**
 * command-router.ts — the slash-command dispatch seam (ADR-0012 Phase 3, #31).
 *
 * Slash commands are the HUMAN→bot control surface: a real user invokes e.g.
 * `/create-character-card`, Discord emits `interactionCreate`. Webhooks cannot
 * invoke them and the bot cannot invoke them — so AI agents never touch this
 * path (their output flows through the separate webhook-post channel). The bot
 * RESPONDS via the interaction reply.
 *
 * This module is the pure, headless-testable core: a {@link CommandEvent} type,
 * a name→handler {@link createCommandRouter router}, and a permission gate that
 * takes the campaign authority context via INJECTED predicates ({@link
 * CommandAuthority}). It does NOT depend on #30's concrete stores nor on
 * discord.js — those land in `command-interaction.ts` (live wiring) and the
 * #30/#33 store wiring. Tests hand-drive stub predicates and stub handlers.
 */

/**
 * A command invocation, normalised away from discord.js. The live adapter maps
 * a discord.js ChatInputCommandInteraction into this shape (see
 * `command-interaction.ts`); tests construct it directly.
 */
export interface CommandEvent {
  /** ASCII-safe command name, e.g. "create-character-card". */
  readonly name: string;
  /** Discord user snowflake of the human who invoked the command. */
  readonly invokerId: string;
  /** Discord channel snowflake the command was invoked in. */
  readonly channelId: string;
  /** Discord thread snowflake, when invoked inside a thread. */
  readonly threadId?: string;
  /** Named string options supplied with the command. */
  readonly options: Record<string, string>;
}

/**
 * Who a command is for. Declared in the command's registration; enforced by the
 * permission gate before the handler runs.
 *   - "owner"  : only the campaign owner (invokerId === ownerId).
 *   - "player" : only invokers on the campaign roster.
 *   - "any"    : no authority check (e.g. lobby/help commands).
 */
export type CommandScope = "owner" | "player" | "any";

/** A handler for a dispatched command. Async so live handlers can do I/O. */
export type CommandHandler = (event: CommandEvent) => Promise<void>;

/** One registered command: its name, required scope, and handler. */
export interface CommandRegistration {
  readonly name: string;
  readonly scope: CommandScope;
  readonly handler: CommandHandler;
}

/**
 * Injected authority predicates. This is the seam that keeps the gate free of
 * #30's concrete stores: real wiring binds these to the roster/campaign stores,
 * tests pass stubs. `campaignId` is derived per-event by the wiring (channel →
 * campaign); here the predicates take whatever identity they need.
 */
export interface CommandAuthority {
  /** True when `userId` owns the campaign the command targets. */
  isOwner(event: CommandEvent): boolean;
  /** True when `userId` is on the roster of the campaign the command targets. */
  inRoster(event: CommandEvent): boolean;
}

/** The outcome of dispatching a CommandEvent through the router. */
export type DispatchResult =
  | { readonly kind: "dispatched"; readonly name: string }
  | { readonly kind: "unknown-command"; readonly name: string }
  | { readonly kind: "denied"; readonly name: string; readonly scope: CommandScope };

export interface CommandRouter {
  dispatch(event: CommandEvent): Promise<DispatchResult>;
}

function permitted(scope: CommandScope, event: CommandEvent, authority: CommandAuthority): boolean {
  switch (scope) {
    case "any":
      return true;
    case "owner":
      return authority.isOwner(event);
    case "player":
      return authority.inRoster(event);
  }
}

/**
 * Builds a router over the given registrations. On dispatch it looks the command
 * up by name (unknown → no handler run, `unknown-command`), checks the declared
 * scope against the injected authority (fail → no handler run, `denied`), then
 * runs the handler (`dispatched`).
 */
export function createCommandRouter(
  registrations: readonly CommandRegistration[],
  authority: CommandAuthority,
): CommandRouter {
  const byName = new Map<string, CommandRegistration>();
  for (const reg of registrations) byName.set(reg.name, reg);

  return {
    async dispatch(event: CommandEvent): Promise<DispatchResult> {
      const reg = byName.get(event.name);
      if (reg === undefined) {
        return { kind: "unknown-command", name: event.name };
      }
      if (!permitted(reg.scope, event, authority)) {
        return { kind: "denied", name: event.name, scope: reg.scope };
      }
      await reg.handler(event);
      return { kind: "dispatched", name: event.name };
    },
  };
}
