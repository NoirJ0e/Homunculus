/**
 * Soul genesis — deterministic seed expansion (ADR-0006).
 *
 * Every genesis path — light seed or one-click full-auto — distils a
 * structured `PersonaCore` via `createSoul`. Tests run fully deterministically;
 * no network, no real LLM.
 *
 * Future seam: inject a `SoulDistiller` to back the template expansion with a
 * real LLM call (same pattern as campaign-genesis.ts → CampaignDistiller).
 */

import type { ActorId } from "../domain/ids.js";
import type { Soul, PersonaCore, PersonaSeed } from "../domain/soul.js";
import { createSoul } from "../domain/soul.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A light seed for AI-teammate soul genesis (ADR-0006: 轻种子 + AI 充实).
 * A single concept sentence is enough; extra fields are optional overrides.
 */
export interface SoulSeed {
  /** The character's name (fixed; comes from the player or operator). */
  readonly name: string;
  /**
   * One-sentence concept — the source material the distiller expands.
   * Examples: "流浪的银发精灵猎手，隐藏着过去的背叛", "坚信秩序高于一切的老侦探"
   */
  readonly concept: string;
  /** Override derived goals. If omitted, goals are inferred from the concept. */
  readonly goals?: readonly string[];
  /** Override derived temperament. If omitted, distilled from concept. */
  readonly temperament?: string;
  /** Optional initial relationship stances (actorId → stance string). */
  readonly relationships?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Future seam — LLM distiller injection point
// ---------------------------------------------------------------------------

/**
 * Pluggable distiller seam (ADR-0006 soul genesis).
 * Default: deterministic template. Future: inject an LlmSoulDistiller.
 */
export interface SoulDistiller {
  distill(id: ActorId, seed: SoulSeed): PersonaSeed;
  fullAuto(id: ActorId, archetype: string): PersonaSeed;
}

// ---------------------------------------------------------------------------
// Deterministic template distiller (default — no network, no LLM)
// ---------------------------------------------------------------------------

/**
 * Keyword → temperament mapping. Simple deterministic lookup so expansion is
 * stable and fast. A real LLM can replace/supplement this later.
 */
const TEMPERAMENT_HINTS: ReadonlyArray<readonly [string, string]> = [
  ["骗", "擅长欺骗与伪装，内心深处渴望真实的连接"],
  ["侦探", "冷静分析，坚信真相高于一切"],
  ["猎手", "沉默而专注，行动先于言语"],
  ["战士", "勇猛直接，以身体力行证明一切"],
  ["法师", "博学沉思，以知识为武器"],
  ["游侠", "独来独往，对荒野的感情深于人群"],
  ["盗贼", "机智圆滑，在规则的夹缝中求存"],
  ["牧师", "虔诚坚定，信仰是铠甲也是枷锁"],
  ["骑士", "忠诚守护，荣誉重于生命"],
  ["德鲁伊", "与自然共鸣，变化是唯一的永恒"],
  ["精灵", "优雅而疏离，长寿带来难以言说的淡漠"],
  ["背叛", "内心存有旧伤，对信任既渴望又畏惧"],
  ["孤独", "习惯独处，不轻易依赖他人"],
  ["秩序", "规则优先，混乱让他/她深感不安"],
  ["流浪", "身无归处，用行动对抗虚无"],
];

function deriveTemperament(concept: string, archetype?: string): string {
  const src = (archetype ?? "") + concept;
  for (const [keyword, temperament] of TEMPERAMENT_HINTS) {
    if (src.includes(keyword)) {
      return temperament;
    }
  }
  // Fallback: generic but still non-empty.
  return "务实冷静，以目标为行动的北极星";
}

/**
 * Derive 1–2 goals from the concept text.
 * Deterministic: scans for action-cue keywords and builds goal strings.
 */
function deriveGoals(concept: string): readonly string[] {
  const goals: string[] = [];

  if (concept.includes("背叛") || concept.includes("过去")) {
    goals.push("直面过去的背叛，寻找和解或复仇");
  }
  if (concept.includes("家族") || concept.includes("家人") || concept.includes("弟") || concept.includes("兄") || concept.includes("姐") || concept.includes("妹")) {
    goals.push("保护家人，或找回失散的亲人");
  }
  if (concept.includes("秩序") || concept.includes("规则") || concept.includes("法律")) {
    goals.push("维护秩序，将混乱扼杀于萌芽");
  }
  if (concept.includes("真相") || concept.includes("真实") || concept.includes("线索")) {
    goals.push("追寻被掩盖的真相，不惜一切代价");
  }
  if (concept.includes("骗") || concept.includes("隐藏")) {
    goals.push("在危险的谎言网络中全身而退");
  }
  if (concept.includes("自由") || concept.includes("流浪")) {
    goals.push("在束缚收紧之前找到真正的归所");
  }

  // Always have at least one goal.
  if (goals.length === 0) {
    goals.push("在这场冒险中证明自身的价值");
  }

  return goals;
}

/** Build a PersonaSeed from a SoulSeed via deterministic template expansion. */
function distillSeed(seed: SoulSeed): PersonaSeed {
  const temperament = seed.temperament ?? deriveTemperament(seed.concept);
  const goals = seed.goals ?? deriveGoals(seed.concept);

  const personaSeed: PersonaSeed = {
    name: seed.name,
    temperament,
    goals,
  };

  if (seed.relationships !== undefined && Object.keys(seed.relationships).length > 0) {
    return { ...personaSeed, relationships: seed.relationships };
  }

  return personaSeed;
}

/**
 * Archetype → preset PersonaSeed mapping for the one-click full-auto path
 * (ADR-0006: 一键全自动，空座填补).
 */
const ARCHETYPE_PRESETS: Readonly<Record<string, PersonaSeed>> = {
  战士: {
    name: "铁拳·冈",
    temperament: "勇猛直接，以身体力行证明一切，对弱者有天然的庇护本能",
    goals: ["在战场上为队友挡下每一刀", "找到值得效忠的旗帜"],
  },
  法师: {
    name: "澄·玄月",
    temperament: "博学沉思，以知识为武器，对未解之谜有近乎偏执的好奇心",
    goals: ["破解这个世界最深的奥秘", "证明智慧能解决蛮力解决不了的问题"],
  },
  游侠: {
    name: "风影·苔",
    temperament: "独来独往，对荒野的感情深于人群，沉默是他/她最常用的语言",
    goals: ["追踪并猎杀一个古老的威胁", "找到真正值得守护的那片土地"],
  },
  盗贼: {
    name: "碎影",
    temperament: "机智圆滑，在规则的夹缝中求存，用幽默掩盖内心的警觉",
    goals: ["完成那个一直未完成的大局", "偿还一笔说不清楚的旧债"],
  },
  牧师: {
    name: "柔光·徵",
    temperament: "虔诚坚定，信仰是铠甲也是枷锁，对苦难有近乎超自然的承受力",
    goals: ["治愈无法被治愈的人", "弄清楚神明是否真的在看"],
  },
  骑士: {
    name: "铸誓·白锋",
    temperament: "忠诚守护，荣誉重于生命，对承诺的重量极为敏感",
    goals: ["守护所有承诺过的人", "在荣誉与情感的撕裂中找到答案"],
  },
  德鲁伊: {
    name: "根脉·雨苔",
    temperament: "与自然共鸣，变化是唯一的永恒，对城市文明保持着温和的疏离",
    goals: ["阻止对原始之地的破坏", "找到自然与文明可以共存的那个支点"],
  },
  骗术师: {
    name: "面具·昙",
    temperament: "擅长欺骗与伪装，内心深处渴望真实的连接，谎言是保护也是囚笼",
    goals: ["在危险的谎言网络中全身而退", "找到一个不需要伪装的地方"],
  },
};

const FALLBACK_PERSONA: PersonaSeed = {
  name: "无名旅者",
  temperament: "务实冷静，以目标为行动的北极星，不多说、做完再说",
  goals: ["完成眼前这一关", "找到下一个值得追求的目标"],
};

class DeterministicSoulDistiller implements SoulDistiller {
  distill(_id: ActorId, seed: SoulSeed): PersonaSeed {
    return distillSeed(seed);
  }

  fullAuto(_id: ActorId, archetype: string): PersonaSeed {
    return ARCHETYPE_PRESETS[archetype] ?? FALLBACK_PERSONA;
  }
}

// Singleton default distiller (deterministic, stateless).
const DEFAULT_DISTILLER: SoulDistiller = new DeterministicSoulDistiller();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Genesis from a light seed (ADR-0006: 轻种子 + AI 充实).
 *
 * Distils a structured `PersonaCore` via `createSoul`. Deterministic by
 * default; inject a `SoulDistiller` to swap in a real LLM later.
 */
export function genesisSoul(
  id: ActorId,
  seed: SoulSeed,
  distiller: SoulDistiller = DEFAULT_DISTILLER,
): Soul {
  const personaSeed = distiller.distill(id, seed);
  return createSoul(id, personaSeed);
}

/**
 * One-click full-auto genesis (ADR-0006: 一键全自动，空座填补).
 *
 * Fills an empty seat with a complete, immediately-playable soul from an
 * archetype label (e.g. "战士", "骗术师"). Every path yields a structured
 * `PersonaCore`.
 */
export function genesisFullAuto(
  id: ActorId,
  archetype: string,
  distiller: SoulDistiller = DEFAULT_DISTILLER,
): Soul {
  const personaSeed = distiller.fullAuto(id, archetype);
  return createSoul(id, personaSeed);
}
