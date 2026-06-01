import type { PersonaCore, Soul } from "../domain/soul.js";

/**
 * 人格演化 + 反思 pass + 护栏 (ADR-0004). A reflection pass (run offline at scene
 * end) proposes persona-core updates; the engine enforces the guardrails that
 * stop a character from collapsing into a bland, agreeable assistant:
 *
 *   1. Evidence — every change must cite concrete experienced events; uncited or
 *      mis-cited changes are rejected.
 *   2. Inertia — the core temperament is high-inertia: a single event can't flip
 *      it; it takes several.
 *
 * Accepted changes accumulate as a changelog (a diff) on the branch, surfaced at
 * merge for per-item veto, with a let-go switch for full-auto acceptance.
 */

export interface PersonaChangeProposal {
  readonly kind: "temperament" | "relationship" | "goal";
  /** Relationship subject (the other actor id). Ignored for non-relationship. */
  readonly subject?: string;
  readonly to: string;
  /** Episodic memory seqs cited as evidence (有据). */
  readonly citedEvents: readonly number[];
}

export type RejectionReason = "no-evidence" | "bad-citation" | "insufficient-inertia";

/** Temperament needs at least this many cited events to shift (inertia). */
export const TEMPERAMENT_INERTIA = 2;

export interface ReflectionResult {
  readonly accepted: readonly PersonaChangeProposal[];
  readonly rejected: readonly { readonly change: PersonaChangeProposal; readonly reason: RejectionReason }[];
}

export function reflect(soul: Soul, proposals: readonly PersonaChangeProposal[]): ReflectionResult {
  const seqs = new Set(soul.episodic.map((m) => m.seq));
  const accepted: PersonaChangeProposal[] = [];
  const rejected: { change: PersonaChangeProposal; reason: RejectionReason }[] = [];

  for (const change of proposals) {
    if (change.citedEvents.length === 0) {
      rejected.push({ change, reason: "no-evidence" });
      continue;
    }
    if (!change.citedEvents.every((s) => seqs.has(s))) {
      rejected.push({ change, reason: "bad-citation" });
      continue;
    }
    if (change.kind === "temperament" && change.citedEvents.length < TEMPERAMENT_INERTIA) {
      rejected.push({ change, reason: "insufficient-inertia" });
      continue;
    }
    accepted.push(change);
  }

  return { accepted, rejected };
}

export interface ChangelogDecision {
  /** Indices (into the accepted list) the owner vetoed. */
  readonly veto?: readonly number[];
  /** "这次放手，你自己看着办" — accept every change automatically. */
  readonly letGo?: boolean;
}

/** Apply the reviewed changelog to a persona core, honoring vetoes / let-go. */
export function applyChangelog(
  core: PersonaCore,
  changes: readonly PersonaChangeProposal[],
  decision: ChangelogDecision = {},
): PersonaCore {
  const vetoed = new Set(decision.letGo ? [] : decision.veto ?? []);
  let temperament = core.temperament;
  const relationships: Record<string, string> = { ...core.relationships };
  const goals = [...core.goals];

  changes.forEach((change, i) => {
    if (vetoed.has(i)) return;
    switch (change.kind) {
      case "temperament":
        temperament = change.to;
        break;
      case "relationship":
        if (change.subject) relationships[change.subject] = change.to;
        break;
      case "goal":
        if (!goals.includes(change.to)) goals.push(change.to);
        break;
    }
  });

  return { ...core, temperament, relationships, goals };
}
