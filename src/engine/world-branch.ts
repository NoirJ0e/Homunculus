/**
 * 兵分两路 (party split) = strictly isolated parallel branches over GLOBAL WORLD
 * STATE (ADR-0005). Branches may only touch disjoint seams of the world; because
 * deltas are disjoint, the merge is a deterministic union — no retcon, no LLM
 * arbitration. Character memory does NOT merge across branches (that lives with
 * the per-soul fork/merge in #8); only world state is unioned here.
 */
export type WorldState = Readonly<Record<string, unknown>>;

export interface WorldBranch {
  readonly branchId: string;
  readonly base: WorldState;
  /** Changes made on this branch (key → new value). */
  readonly delta: Map<string, unknown>;
}

/** Raised when two branches wrote the same world key to different values — a
 *  violation of the strict-isolation contract that must be reconciled first. */
export class WorldConflictError extends Error {
  constructor(public readonly key: string) {
    super(
      `party-split branches both wrote world key "${key}" to different values — ` +
        `strict isolation violated (ADR-0005); reconcile before merging`,
    );
    this.name = "WorldConflictError";
  }
}

/** Fork parallel branches off a shared base; each starts with an empty delta. */
export function splitWorld(base: WorldState, branchIds: readonly string[]): WorldBranch[] {
  return branchIds.map((branchId) => ({ branchId, base, delta: new Map() }));
}

export function writeWorld(branch: WorldBranch, key: string, value: unknown): void {
  branch.delta.set(key, value);
}

/**
 * Deterministic union of disjoint branch deltas onto the base. Two branches
 * writing the same key to *different* values is a conflict (thrown); writing it
 * to the *same* value is idempotent and allowed.
 */
export function mergeWorld(base: WorldState, branches: readonly WorldBranch[]): WorldState {
  const merged: Record<string, unknown> = { ...base };
  const claimed = new Map<string, unknown>();
  for (const branch of branches) {
    for (const [key, value] of branch.delta) {
      if (claimed.has(key) && !Object.is(claimed.get(key), value)) {
        throw new WorldConflictError(key);
      }
      claimed.set(key, value);
      merged[key] = value;
    }
  }
  return merged;
}
