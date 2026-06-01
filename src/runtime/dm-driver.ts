/**
 * dm-driver.ts — the DM's long-lived self-driving loop (ADR-0009/0010).
 *
 * The DM is an Agent-SDK `query()` that autonomously calls the engine's MCP
 * tools (narrate / await_actors / …). Because `await_actors` blocks (gateway-
 * awaiting the table), one `query()` can run a whole session. The risk is the
 * model ending its turn prematurely; the restart net here simply re-invokes
 * `query()` to continue while the session is still active.
 *
 * `runQuery` is the DI seam: production passes a thunk that starts the real
 * `query({ mcpServers: { engine: createDmMcpServer(referee) }, … })`; tests pass
 * a stub async-iterable. The driver only manages the lifecycle — tool calls
 * happen inside the SDK, against the shared referee.
 */
export interface DmDriverDeps {
  /** Start one DM query turn; the returned stream is drained until it ends. */
  readonly runQuery: () => AsyncIterable<unknown>;
  /** Whether the table is still live — gates each (re)start. */
  readonly isSessionActive: () => boolean;
  /** Observe a query that threw; the loop then re-checks `isSessionActive`. */
  readonly onError?: (error: unknown) => void;
}

export async function runDmDriver(deps: DmDriverDeps): Promise<void> {
  while (deps.isSessionActive()) {
    try {
      for await (const _ of deps.runQuery()) {
        // Drain the stream; the model's tool calls drive the table via the
        // in-process MCP server. We don't need to inspect the messages here.
      }
    } catch (error) {
      deps.onError?.(error);
      // Fall through to the loop guard — restart iff still active.
    }
  }
}
