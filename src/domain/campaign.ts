import type { SceneId } from "./ids.js";

/**
 * CampaignBible — the plot spine and the target structure for future module
 * import (ADR-0007). A spine is a string of load-bearing milestone beats; only
 * the beats are fixed, everything between them is improvised.
 */

/** A consequential ("后果性") fork — a real choice with real stakes. Quantum
 *  shifting is FORBIDDEN here (ADR-0007); the story choice is genuine. */
export interface BranchPoint {
  readonly id: string;
  readonly prompt: string;
}

/** A load-bearing beat: "this must happen". Details are filled in JIT. */
export interface Milestone {
  readonly id: string;
  readonly goal: string;
  readonly enterCue: string;
  readonly scenes: readonly SceneId[];
  readonly triggers: readonly string[];
  readonly branchPoints: readonly BranchPoint[];
  readonly levelTarget?: number;
}

/** A named, segmented progress track (反派计划 / 沦陷度). Default hidden. */
export interface WorldClockSpec {
  readonly id: string;
  readonly name: string;
  /** Ordered named stages; the last is "fired" (the threat lands). */
  readonly segments: readonly string[];
}

/** A persona seed the AIDM distills into a soul (ADR-0006, fleshed out in #12). */
export interface PersonaTemplate {
  readonly id: string;
  readonly name: string;
  readonly seed: string;
}

export interface CampaignBible {
  /** DM-private backstory — never posted (ADR-0002: hiding = not sending). */
  readonly secretTruth: string;
  readonly milestones: readonly Milestone[];
  readonly npcs: readonly PersonaTemplate[];
  readonly worldClocks: readonly WorldClockSpec[];
  /** Residual bucket for bespoke mechanics — essentially empty in v1. */
  readonly bespokeRules: Record<string, unknown>;
}
