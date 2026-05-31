import type { ActorId, SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";
import {
  classifyBeat,
  pauseFrom,
  type PauseState,
  type TurnOutcome,
} from "./pacing.js";

export type SlotResult =
  | { readonly kind: "acted"; readonly post: Post }
  | { readonly kind: "passed" }
  | { readonly kind: "silent" };

/** Produce one actor's slot, given the posts already made earlier THIS round
 *  (后手看前手). Async-capable (real NPC/human later); sync in these tests. */
export type ProduceSlot = (
  actor: ActorId,
  seenThisRound: readonly Post[],
) => SlotResult | Promise<SlotResult>;

export interface RoundResult {
  readonly status: "released" | "held";
  readonly posts: readonly Post[];
  readonly outcomes: ReadonlyMap<ActorId, TurnOutcome>;
  readonly pause?: PauseState;
}

export async function runCombatRound(
  sceneId: SceneId,
  aidmId: ActorId,
  order: readonly ActorId[],
  produce: ProduceSlot,
): Promise<RoundResult> {
  const posts: Post[] = [];
  const outcomes = new Map<ActorId, TurnOutcome>();

  // The whole round runs to completion (溢出一轮): a silent actor never stops
  // later actors from getting their slot, so we iterate the full order before
  // classifying the beat.
  for (const actor of order) {
    const result = await produce(actor, [...posts]);
    if (result.kind === "acted") {
      posts.push(result.post);
      outcomes.set(actor, "acted");
    } else {
      outcomes.set(actor, result.kind);
    }
  }

  const status = classifyBeat(outcomes);
  if (status === "held") {
    return {
      status,
      posts,
      outcomes,
      pause: pauseFrom(sceneId, aidmId, order, outcomes),
    };
  }
  return { status, posts, outcomes };
}
