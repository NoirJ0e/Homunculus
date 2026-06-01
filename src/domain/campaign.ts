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

/**
 * The rule system a campaign runs under. ORTHOGONAL to tone/genre: you can run a
 * 克系恐怖 (CoC-flavoured) game under D&D5e. The system is what decides which
 * CHARACTER OPTIONS are legal — a half-elf ranger is a D&D5e construct that has
 * no meaning under CoC7 (which has occupations + stats, no races/classes). The
 * card verifier checks card-vs-SYSTEM fit, not card-vs-tone.
 */
export type RuleSystem = "coc7" | "dnd5e";

export interface CampaignBible {
  /** DM-private backstory — never posted (ADR-0002: hiding = not sending). */
  readonly secretTruth: string;
  /** The rule system (NON-secret — players know it; chosen at campaign creation). */
  readonly system: RuleSystem;
  /** Tonal genre, NON-secret (e.g. "克系恐怖"). Flavour, not a legality axis. */
  readonly tone: string;
  /** [minLevel, maxLevel] power band, NON-secret. */
  readonly levelBand: readonly [number, number];
  readonly milestones: readonly Milestone[];
  readonly npcs: readonly PersonaTemplate[];
  readonly worldClocks: readonly WorldClockSpec[];
  /** Residual bucket for bespoke mechanics — essentially empty in v1. */
  readonly bespokeRules: Record<string, unknown>;
}
