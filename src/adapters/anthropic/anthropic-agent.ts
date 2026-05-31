/**
 * AnthropicAgent — real LLM adapter behind AgentPort (issue #3).
 *
 * Architecture:
 *   - Accepts a `MessagesClient` interface for DI (real Anthropic SDK client or
 *     a stub in tests).  This keeps tests deterministic with zero network calls.
 *   - Implements the control-signal / tool-call protocol documented below.
 *   - Enables prompt caching via `cache_control: { type: "ephemeral" }` on the
 *     last system-prompt block and the last tool definition.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTROL-SIGNAL / TOOL-CALL PROTOCOL  (engine parser in #2 should align here)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The model is given two client tools in every request:
 *
 * 1. `set_pacing`  — AIDM only.  Drives the barrier / beat-advancement logic.
 *    Input schema:
 *      { action: "awaiting", actor_ids: string[] }   → ControlSignal awaiting
 *      { action: "continue" }                         → ControlSignal continue
 *
 * 2. `pass_turn`   — NPC agents.  Signals "I have nothing to add this beat."
 *    Input schema: {}  (empty — the presence of the call is the signal)
 *
 * Response content blocks are parsed left-to-right:
 *   - `type === "text"` blocks concatenate into AgentResponse.prose.
 *   - `type === "tool_use"`, name === "set_pacing"  → AgentResponse.control.
 *   - `type === "tool_use"`, name === "pass_turn"   → AgentResponse.pass = true.
 *
 * Plain text output with no tool calls → prose-only response (normal NPC/AIDM prose).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROMPT-CACHING BREAKPOINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Breakpoints are placed on:
 *   1. The last block of the `system` array  (persona core / role instructions)
 *   2. The last tool definition               (stable across turns in a scene)
 *
 * These two breakpoints maximise cache hit rate: the system prompt and tool
 * definitions are identical across all turns by the same actor in the same
 * scene. Only the `messages` array grows with the transcript.
 */

import type { AgentPort } from "../../ports/agent.js";
import type { AgentResponse, ControlSignal, TurnContext } from "../../domain/agent.js";
import { actorId } from "../../domain/ids.js";

// ─── Minimal SDK surface we depend on (DI-able interface) ───────────────────

/** Shape of a single message parameter passed to the API. */
export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}

/** A text block as accepted by the API (input side). */
export interface TextBlockParam {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" } | null;
}

/** A tool-use block as returned by the model (output side). */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

/** A text block as returned by the model (output side). */
export interface TextBlock {
  type: "text";
  text: string;
}

/** Union of content blocks on the output side. */
export type ContentBlock = TextBlock | ToolUseBlock | { type: string };

/** Union of content block params on the input side. */
export type ContentBlockParam = TextBlockParam;

/** A tool definition. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  cache_control?: { type: "ephemeral" } | null;
}

/** The response envelope from the Messages API. */
export interface MessageResponse {
  id: string;
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
}

/** The parameters accepted by messages.create (non-streaming). */
export interface CreateMessageParams {
  model: string;
  max_tokens: number;
  system: TextBlockParam[];
  messages: MessageParam[];
  tools: ToolDefinition[];
}

/**
 * Minimal injectable client interface.  The real Anthropic SDK's
 * `client.messages.create` satisfies this; in tests pass a vi.fn() stub.
 */
export interface MessagesClient {
  create(params: CreateMessageParams): Promise<MessageResponse>;
}

// ─── Agent configuration ────────────────────────────────────────────────────

export interface AnthropicAgentConfig {
  /** The model identifier, e.g. "claude-sonnet-4-6". */
  model: string;
  /**
   * Returns the system prompt string for a given TurnContext.  The caller is
   * responsible for injecting persona core, scene context, etc.
   */
  buildSystemPrompt: (ctx: TurnContext) => string;
  /** Maximum tokens to generate.  Defaults to 1024. */
  maxTokens?: number;
}

// ─── Tool definitions (stable across turns → cached) ───────────────────────

const SET_PACING_TOOL: ToolDefinition = {
  name: "set_pacing",
  description:
    "AIDM pacing control. Call with action='awaiting' + actor_ids to open a barrier waiting for those actors to respond; call with action='continue' to advance the beat after a barrier has released. Only the AIDM should call this tool.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["awaiting", "continue"],
        description: "'awaiting' opens a barrier; 'continue' advances the beat.",
      },
      actor_ids: {
        type: "array",
        items: { type: "string" },
        description: "Required when action='awaiting'. The actor IDs the barrier will wait for.",
      },
    },
    required: ["action"],
  },
};

const PASS_TURN_TOOL: ToolDefinition = {
  name: "pass_turn",
  description:
    "NPC explicit pass. Call this when you, as an NPC, have nothing meaningful to add to the current beat. An explicit pass unblocks the barrier faster than silence.",
  input_schema: {
    type: "object",
    properties: {},
  },
  // cache_control set on last tool — see buildTools()
};

function buildTools(): ToolDefinition[] {
  // Place cache_control breakpoint on the last tool definition.
  // These definitions are stable across all turns in a scene, so they will
  // be cache-hit on every turn after the first.
  const tools: ToolDefinition[] = [
    SET_PACING_TOOL,
    {
      ...PASS_TURN_TOOL,
      cache_control: { type: "ephemeral" },
    },
  ];
  return tools;
}

// ─── AnthropicAgent ─────────────────────────────────────────────────────────

export class AnthropicAgent implements AgentPort {
  private readonly client: MessagesClient;
  private readonly config: Required<AnthropicAgentConfig>;
  private readonly tools: ToolDefinition[];

  constructor(client: MessagesClient, config: AnthropicAgentConfig) {
    this.client = client;
    this.config = {
      model: config.model,
      buildSystemPrompt: config.buildSystemPrompt,
      maxTokens: config.maxTokens ?? 1024,
    };
    this.tools = buildTools();
  }

  async takeTurn(ctx: TurnContext): Promise<AgentResponse> {
    const params = this.buildParams(ctx);
    const response = await this.client.create(params);
    return this.parseResponse(response);
  }

  // ── Prompt construction ──────────────────────────────────────────────────

  private buildParams(ctx: TurnContext): CreateMessageParams {
    const systemText = this.config.buildSystemPrompt(ctx);

    // System prompt as a single TextBlockParam with cache_control breakpoint.
    // If the caller provides multi-block system prompts in the future, they
    // should extend buildSystemPrompt to return TextBlockParam[]; for now a
    // single cached block covers the persona core.
    const system: TextBlockParam[] = [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" },
      },
    ];

    const messages = this.buildMessages(ctx);

    return {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system,
      messages,
      tools: this.tools,
    };
  }

  /**
   * Converts the transcript into alternating user/assistant messages, then
   * appends a final user message asking the current actor to take their turn.
   *
   * The Anthropic API requires alternating user/assistant roles.  We map:
   *   - Posts from OTHER actors → "user" role (from the actor's perspective,
   *     other speakers are the "outside world").
   *   - Posts from THIS actor   → "assistant" role (prior turns by this actor).
   *
   * This is a simplified mapping; a richer system might group consecutive same-
   * actor posts or use multi-turn interleaving.  Sufficient for v1.
   */
  private buildMessages(ctx: TurnContext): MessageParam[] {
    const messages: MessageParam[] = [];

    for (const post of ctx.transcript) {
      const role: "user" | "assistant" = post.actorId === ctx.actorId ? "assistant" : "user";

      // Merge consecutive same-role messages to satisfy the alternating rule.
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === role) {
        // Append to the last message's text content
        if (typeof lastMsg.content === "string") {
          lastMsg.content = `${lastMsg.content}\n\n${post.actorId}: ${post.prose}`;
        } else {
          // shouldn't happen in our current code, but handle gracefully
          lastMsg.content = `${post.actorId}: ${post.prose}`;
        }
      } else {
        messages.push({
          role,
          content: `${post.actorId}: ${post.prose}`,
        });
      }
    }

    // Final user turn: prompt the current actor to respond.
    const turnPrompt =
      `It is now your turn as actor "${ctx.actorId}" in scene "${ctx.sceneId}". ` +
      `Respond with your narrative contribution (prose). ` +
      `If you are the AIDM and want to pause for actor responses, call set_pacing with action='awaiting'. ` +
      `If you are the AIDM and want to advance the beat, call set_pacing with action='continue'. ` +
      `If you are an NPC with nothing to add, call pass_turn.`;

    messages.push({ role: "user", content: turnPrompt });

    return messages;
  }

  // ── Response parsing ─────────────────────────────────────────────────────

  private parseResponse(response: MessageResponse): AgentResponse {
    let prose: string | undefined;
    let control: ControlSignal | undefined;
    let pass: boolean | undefined;

    for (const block of response.content) {
      if (block.type === "text") {
        const textBlock = block as TextBlock;
        const trimmed = textBlock.text.trim();
        if (trimmed.length > 0) {
          prose = prose ? `${prose}\n\n${trimmed}` : trimmed;
        }
      } else if (block.type === "tool_use") {
        const toolBlock = block as ToolUseBlock;

        if (toolBlock.name === "set_pacing") {
          control = this.parsePacingInput(toolBlock.input);
        } else if (toolBlock.name === "pass_turn") {
          pass = true;
        }
      }
    }

    const result: AgentResponse = {};
    if (prose !== undefined) {
      (result as { prose?: string }).prose = prose;
    }
    if (control !== undefined) {
      (result as { control?: ControlSignal }).control = control;
    }
    if (pass !== undefined) {
      (result as { pass?: boolean }).pass = pass;
    }
    return result;
  }

  private parsePacingInput(rawInput: unknown): ControlSignal {
    // The model returns input as an arbitrary JSON object; we narrow carefully.
    if (rawInput === null || typeof rawInput !== "object") {
      // Malformed — default to continue so the beat doesn't stall.
      return { kind: "continue" };
    }
    const input = rawInput as Record<string, unknown>;
    const action = input["action"];

    if (action === "awaiting") {
      const actorIds = input["actor_ids"];
      const actors = Array.isArray(actorIds)
        ? actorIds.filter((x): x is string => typeof x === "string").map(actorId)
        : [];
      return { kind: "awaiting", actors };
    }

    // "continue" or anything else → continue
    return { kind: "continue" };
  }
}

// ─── Factory for production use (uses real Anthropic SDK) ───────────────────

/**
 * Creates an AnthropicAgent backed by the real Anthropic SDK.
 * Requires ANTHROPIC_API_KEY in the environment.
 *
 * Import this function only in the application entry point — never in tests.
 * In tests, inject a stub MessagesClient directly into AnthropicAgent.
 */
export async function createRealAnthropicAgent(
  config: AnthropicAgentConfig,
): Promise<AnthropicAgent> {
  // Dynamic import so the SDK is tree-shaken in test environments that never
  // call this factory.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const sdk = new Anthropic();
  // Adapt the SDK's messages.create to our MessagesClient interface.
  const client: MessagesClient = {
    create: (params) =>
      sdk.messages.create({
        ...params,
        // The SDK's type for system accepts TextBlockParam[] directly.
        system: params.system,
      }) as Promise<MessageResponse>,
  };
  return new AnthropicAgent(client, config);
}
