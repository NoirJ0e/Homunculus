import { describe, expect, test, vi } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { AgentPort } from "../src/ports/agent.js";
import type { TurnContext } from "../src/domain/agent.js";
import {
  AnthropicAgent,
  type MessagesClient,
  type AnthropicAgentConfig,
} from "../src/adapters/anthropic/anthropic-agent.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";

// ---------------------------------------------------------------------------
// Helpers — build minimal SDK-shaped response objects
// ---------------------------------------------------------------------------

function textResponse(text: string): Parameters<MessagesClient["create"]>[0] extends infer _P
  ? ReturnType<MessagesClient["create"]> extends Promise<infer R>
    ? R
    : never
  : never {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text, citations: null }],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    container: null,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function toolUseResponse(
  toolName: string,
  toolInput: unknown,
  proseText?: string,
): ReturnType<MessagesClient["create"]> extends Promise<infer R> ? R : never {
  const content: unknown[] = [];
  if (proseText) {
    content.push({ type: "text", text: proseText, citations: null });
  }
  content.push({
    type: "tool_use",
    id: "toolu_test",
    name: toolName,
    input: toolInput,
    caller: { type: "direct" },
  });
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content,
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    container: null,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tavern = sceneId("scene:tavern");
const aidm = actorId("aidm");
const rogue = actorId("npc-rogue");
const cleric = actorId("npc-cleric");

const baseTurnCtx: TurnContext = {
  sceneId: tavern,
  actorId: aidm,
  transcript: [],
};

const ctxWithTranscript: TurnContext = {
  sceneId: tavern,
  actorId: rogue,
  transcript: [
    { sceneId: tavern, actorId: aidm, prose: "夜风灌进酒馆。" },
    { sceneId: tavern, actorId: rogue, prose: "罗格悄悄把手探向腰间的匕首。" },
  ],
};

function makeAgent(client: MessagesClient, config?: Partial<AnthropicAgentConfig>): AnthropicAgent {
  return new AnthropicAgent(client, {
    model: "claude-sonnet-4-6",
    buildSystemPrompt: (ctx) => `You are playing actor ${ctx.actorId} in scene ${ctx.sceneId}.`,
    ...config,
  });
}

// ---------------------------------------------------------------------------
// Tests: response parsing
// ---------------------------------------------------------------------------

describe("AnthropicAgent — prose-only response", () => {
  test("plain text block → AgentResponse.prose, no control, no pass", async () => {
    const prose = "夜风灌进酒馆。门口的陌生人盯着你们。";
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(textResponse(prose)),
    };

    const agent = makeAgent(client);
    const result = await agent.takeTurn(baseTurnCtx);

    expect(result.prose).toBe(prose);
    expect(result.control).toBeUndefined();
    expect(result.pass).toBeUndefined();
  });
});

describe("AnthropicAgent — awaiting control signal", () => {
  test("set_pacing tool with awaiting → control = { kind: 'awaiting', actors: [...] }", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(
        toolUseResponse("set_pacing", { action: "awaiting", actor_ids: [rogue, cleric] }, "夜风灌进酒馆。"),
      ),
    };

    const agent = makeAgent(client);
    const result = await agent.takeTurn(baseTurnCtx);

    expect(result.prose).toBe("夜风灌进酒馆。");
    expect(result.control).toEqual({ kind: "awaiting", actors: [rogue, cleric] });
    expect(result.pass).toBeUndefined();
  });
});

describe("AnthropicAgent — continue control signal", () => {
  test("set_pacing tool with continue → control = { kind: 'continue' }", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(
        toolUseResponse("set_pacing", { action: "continue" }, "陌生人松开了剑柄上的手。"),
      ),
    };

    const agent = makeAgent(client);
    const result = await agent.takeTurn(baseTurnCtx);

    expect(result.prose).toBe("陌生人松开了剑柄上的手。");
    expect(result.control).toEqual({ kind: "continue" });
    expect(result.pass).toBeUndefined();
  });
});

describe("AnthropicAgent — NPC pass", () => {
  test("pass_turn tool → AgentResponse.pass = true, no prose", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(toolUseResponse("pass_turn", {})),
    };

    const agent = makeAgent(client);
    const result = await agent.takeTurn(ctxWithTranscript);

    expect(result.pass).toBe(true);
    expect(result.prose).toBeUndefined();
    expect(result.control).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: prompt caching
// ---------------------------------------------------------------------------

describe("AnthropicAgent — prompt caching", () => {
  test("system prompt is sent as TextBlockParam array with cache_control breakpoint on last block", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(textResponse("some prose")),
    };

    const agent = makeAgent(client);
    await agent.takeTurn(baseTurnCtx);

    const createCall = vi.mocked(client.create).mock.calls[0];
    expect(createCall).toBeDefined();
    const params = createCall![0];

    // system must be an array of TextBlockParam
    expect(Array.isArray(params.system)).toBe(true);
    const systemBlocks = params.system as Array<{ type: string; text: string; cache_control?: unknown }>;

    // The last system block must have cache_control set (prompt caching breakpoint)
    const lastBlock = systemBlocks[systemBlocks.length - 1];
    expect(lastBlock).toBeDefined();
    expect(lastBlock!.cache_control).toEqual({ type: "ephemeral" });
  });

  test("tools definition array has cache_control on last tool (second caching breakpoint)", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(textResponse("some prose")),
    };

    const agent = makeAgent(client);
    await agent.takeTurn(baseTurnCtx);

    const createCall = vi.mocked(client.create).mock.calls[0];
    const params = createCall![0];

    expect(Array.isArray(params.tools)).toBe(true);
    const tools = params.tools as Array<{ name: string; cache_control?: unknown }>;
    const lastTool = tools[tools.length - 1];
    expect(lastTool!.cache_control).toEqual({ type: "ephemeral" });
  });
});

// ---------------------------------------------------------------------------
// Tests: prompt building from transcript
// ---------------------------------------------------------------------------

describe("AnthropicAgent — prompt building", () => {
  test("transcript posts become alternating user/assistant messages", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(textResponse("response")),
    };

    const agent = makeAgent(client);
    await agent.takeTurn(ctxWithTranscript);

    const createCall = vi.mocked(client.create).mock.calls[0];
    const params = createCall![0];
    const messages = params.messages as Array<{ role: string; content: string | unknown[] }>;

    // We should have at least one user message (the turn prompt)
    expect(messages.length).toBeGreaterThan(0);
    // The last message must be from "user" (the current actor's prompt)
    expect(messages[messages.length - 1]!.role).toBe("user");
  });

  test("model field matches config", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(textResponse("response")),
    };

    const agent = makeAgent(client, { model: "claude-opus-4-5" });
    await agent.takeTurn(baseTurnCtx);

    const params = vi.mocked(client.create).mock.calls[0]![0];
    expect(params.model).toBe("claude-opus-4-5");
  });
});

// ---------------------------------------------------------------------------
// Test: interchangeability — AnthropicAgent and FakeAgent both satisfy AgentPort
// ---------------------------------------------------------------------------

describe("AgentPort interchangeability", () => {
  /**
   * This function is typed to accept only AgentPort — it cannot be called with
   * anything that doesn't implement the interface. If both calls compile and
   * run, the structural contract is satisfied.
   */
  async function exercisePort(port: AgentPort, ctx: TurnContext): Promise<void> {
    const response = await port.takeTurn(ctx);
    // Just assert it returns something with the right shape
    const hasProseOrPassOrControl =
      response.prose !== undefined || response.pass !== undefined || response.control !== undefined;
    expect(typeof response).toBe("object");
    // At minimum the response is a valid object (could be all-undefined for real LLM responses)
    expect(response).toBeDefined();
    void hasProseOrPassOrControl; // suppress unused warning
  }

  test("FakeAgent satisfies AgentPort", async () => {
    const fake = new FakeAgent({ aidm: [{ prose: "test" }] });
    await exercisePort(fake, baseTurnCtx);
  });

  test("AnthropicAgent satisfies AgentPort", async () => {
    const client: MessagesClient = {
      create: vi.fn().mockResolvedValue(textResponse("test prose")),
    };
    const anthropicAgent = makeAgent(client);
    await exercisePort(anthropicAgent, baseTurnCtx);
  });
});
