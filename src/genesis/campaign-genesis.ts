/**
 * Campaign genesis — deterministic seed expansion (ADR-0007).
 *
 * Converts a light seed (premise + tone + desired climax + level band) into a
 * coarse CampaignBible skeleton. Details are JIT (deliberately sparse).
 *
 * BLINDBOX is the default (ADR-0007): the owner enters as a genuine player and
 * does NOT see the secret hook. `ownerView` gates visibility. The full
 * CampaignBible always carries `secretTruth` for the AIDM.
 *
 * A real-LLM distiller can be injected later via the `DistillerPort` seam
 * (see bottom of file). For now the deterministic template path is used; tests
 * run entirely on the deterministic path — no network, no real LLM.
 */

import type { CampaignBible, Milestone, WorldClockSpec } from "../domain/campaign.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The light seed a user provides to kick off a campaign. */
export interface CampaignSeed {
  /** One-sentence campaign premise. */
  readonly premise: string;
  /** Tonal genre label (e.g. "黑色侦探", "史诗奇幻", "克系恐怖"). */
  readonly tone: string;
  /** Desired climax beat (what "must happen" at the end). */
  readonly desiredClimax: string;
  /** [minLevel, maxLevel] — integer level band for the campaign. */
  readonly levelBand: readonly [number, number];
}

/** Options forwarded through genesisCampaign (does NOT change the generated bible). */
export interface CampaignGenesisOptions {
  /**
   * "blindbox"  — default, ADR-0007. Owner has no spoilers; secretTruth is
   *               AIDM-private. ownerView() strips it.
   * "spoiler"   — owner chose to see the full bible (removes the mystery but
   *               gives more authorial control).
   * "co-create" — same as spoiler; alias for when the owner actively writes.
   */
  readonly mode?: "blindbox" | "spoiler" | "co-create";
}

/**
 * The owner-facing view of a CampaignBible.
 * In blindbox mode `secretTruth` is absent; in spoiler/co-create it is present.
 */
export type OwnerView =
  | Omit<CampaignBible, "secretTruth">
  | (Omit<CampaignBible, "secretTruth"> & { readonly secretTruth: string });

// ---------------------------------------------------------------------------
// LLM distiller seam (future-proof injection point)
// ---------------------------------------------------------------------------

/**
 * Future seam: a pluggable distiller that can replace the deterministic
 * template expansion with a real LLM call. Tests always use the default
 * deterministic distiller. Production can inject an `LlmDistiller` later.
 */
export interface CampaignDistiller {
  distill(seed: CampaignSeed): CampaignBible;
}

// ---------------------------------------------------------------------------
// Deterministic template distiller (default — no network, no LLM)
// ---------------------------------------------------------------------------

/** Build a milestone id from an index (stable string, no randomness). */
function milestoneId(prefix: string, index: number): string {
  return `${prefix}-m${index + 1}`;
}

/** Build a world-clock id from a label (stable string, no randomness). */
function clockId(label: string): string {
  return `clock-${label.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Derive a 3-act milestone skeleton from the seed.
 * Acts: 开局 (setup/hook) → 对抗 (confrontation) → 高潮 (climax).
 * All detail fields (scenes, triggers, branchPoints) are left empty for JIT.
 */
function deriveMilestones(seed: CampaignSeed): readonly Milestone[] {
  const prefix = seed.premise.slice(0, 6).replace(/\s+/g, "");

  return [
    {
      id: milestoneId(prefix, 0),
      goal: `初入局——发现${seed.premise}的表面迹象`,
      enterCue: `玩家们被一个与"${seed.tone}"氛围呼应的异常事件吸引入场`,
      scenes: [],
      triggers: [],
      branchPoints: [],
    },
    {
      id: milestoneId(prefix, 1),
      goal: `深入调查——揭开${seed.premise}的内层真相`,
      enterCue: `关键线索出现，局势骤然复杂，退路开始关闭`,
      scenes: [],
      triggers: [],
      branchPoints: [],
    },
    {
      id: milestoneId(prefix, 2),
      goal: `终局对决——${seed.desiredClimax}`,
      enterCue: `幕后力量无法再藏匿，正面碰撞不可避免`,
      scenes: [],
      triggers: [],
      branchPoints: [],
      levelTarget: seed.levelBand[1],
    },
  ];
}

/**
 * Derive a hidden world clock from the seed.
 * The clock models the antagonist's escalating plan.
 */
function deriveWorldClocks(seed: CampaignSeed): readonly WorldClockSpec[] {
  const label = "antagonist-plan";
  return [
    {
      id: clockId(label),
      name: `幕后计划推进（${seed.tone}）`,
      segments: [
        "暗流涌动——计划悄然启动",
        "布局收紧——关键棋子就位",
        "危机临近——窗口期关闭",
        `终局引爆——${seed.desiredClimax.slice(0, 20)}`,
      ],
    },
  ];
}

/** Derive the AIDM-private secret truth from the premise. */
function deriveSecretTruth(seed: CampaignSeed): string {
  return (
    `【AIDM 底牌 — 严禁对玩家泄露】` +
    `\n幕后真相：${seed.premise}的核心在于一个被精心掩盖的阴谋。` +
    `\n最终高潮目标：${seed.desiredClimax}。` +
    `\n基调参考：${seed.tone}。` +
    `\n等级区间 ${seed.levelBand[0]}–${seed.levelBand[1]}，细节 JIT 充实。`
  );
}

class DeterministicDistiller implements CampaignDistiller {
  distill(seed: CampaignSeed): CampaignBible {
    return {
      secretTruth: deriveSecretTruth(seed),
      milestones: deriveMilestones(seed),
      npcs: [],
      worldClocks: deriveWorldClocks(seed),
      bespokeRules: {},
    };
  }
}

// Singleton default distiller (deterministic, stateless).
const DEFAULT_DISTILLER: CampaignDistiller = new DeterministicDistiller();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expand a light seed into a coarse `CampaignBible`.
 *
 * The returned bible always contains `secretTruth` (for the AIDM). Use
 * `ownerView(bible, mode?)` to produce the player-facing view that respects
 * the blindbox/spoiler toggle.
 *
 * To inject a real-LLM distiller: pass `distiller` in opts (future).
 */
export function genesisCampaign(
  seed: CampaignSeed,
  opts?: CampaignGenesisOptions & { distiller?: CampaignDistiller },
): CampaignBible {
  const distiller = opts?.distiller ?? DEFAULT_DISTILLER;
  return distiller.distill(seed);
}

/**
 * Produce the owner-facing view of a CampaignBible.
 *
 * - "blindbox" (default) — omits `secretTruth`. Owner enters as a genuine
 *   player; the AIDM's secret hook remains hidden.
 * - "spoiler" / "co-create" — includes `secretTruth`. The owner chose full
 *   authorial visibility.
 *
 * The full `CampaignBible` (with `secretTruth`) is always kept server-side
 * for the AIDM. This function only controls what is forwarded to the owner.
 */
export function ownerView(
  bible: CampaignBible,
  mode: "blindbox" | "spoiler" | "co-create" = "blindbox",
): OwnerView {
  if (mode === "blindbox") {
    // Destructure to omit secretTruth — never touches the string, never sends it.
    const { secretTruth: _omit, ...rest } = bible;
    void _omit; // explicitly unused — the point IS to drop it
    return rest;
  }
  // spoiler or co-create: forward everything including the secret truth.
  return bible;
}
