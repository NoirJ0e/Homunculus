import type { ActorId, SceneId } from "../domain/ids.js";
import type { HumanInboxPort, HumanTurn } from "../ports/human-inbox.js";
import type { GatewayMessage } from "../adapters/discord/message-events.js";
import { mapContentToTurn } from "../adapters/discord/message-mapping.js";

/**
 * push-inbox.ts — the per-channel HumanInboxPort the dispatcher PUSHES into
 * (ADR-0011 + the dispatcher↔engine reconciliation).
 *
 * The engine PULLS: inside `await_actors` the referee calls `poll(actor, scene)`
 * and blocks on the returned promise (the ADR-0003 infinite hold). But messages
 * arrive via the dispatcher's gateway PUSH — every in-channel message for an
 * AIDM channel is `deliver`ed here. This adapter bridges the two: a delivered
 * in-character turn resolves a waiting poll, or is buffered if no poll waits yet
 * (a fast human is never dropped — mirrors `GatewayInbox`).
 *
 * One channel = one AIDM = one human seat in v1, so this inbox is single-queue:
 * it ignores the `actor`/`scene` arguments (the channel already scopes them) and
 * keeps a single FIFO of pending turns + a single waiter. OOC (`(`-prefixed) is
 * skipped exactly like `GatewayInbox`: never resolves, never buffers, never
 * reaches the DM (ADR-0011 前缀表).
 */
export class PushInbox implements HumanInboxPort {
  private readonly buffer: HumanTurn[] = [];
  private waiter: ((turn: HumanTurn) => void) | undefined;

  /** Feed a dispatched message. OOC is skipped; a real turn resolves/buffers. */
  deliver(message: GatewayMessage): void {
    const mapped = mapContentToTurn(message.content);
    if (mapped.kind === "ooc") return; // skip — not a turn (ADR-0011)
    const turn: HumanTurn = mapped;

    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve(turn);
      return;
    }
    this.buffer.push(turn);
  }

  async poll(_actor: ActorId, _scene: SceneId): Promise<HumanTurn | undefined> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return buffered;
    // Block until the next delivered in-character turn (the ADR-0003 hold).
    return new Promise<HumanTurn>((resolve) => {
      this.waiter = resolve;
    });
  }
}
