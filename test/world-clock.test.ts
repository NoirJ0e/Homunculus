import { describe, expect, test } from "vitest";
import type { WorldClockSpec } from "../src/domain/campaign.js";
import { initClock, tick, hasFired, dmView, playerSignal } from "../src/engine/world-clock.js";

const spec: WorldClockSpec = {
  id: "cult",
  name: "邪教仪式",
  segments: ["平静", "集结", "献祭前夜", "仪式完成"],
};

describe("#11 hidden world clock", () => {
  test("a fresh clock sits at the first segment, hidden by default", () => {
    const c = initClock(spec);
    expect(c.position).toBe(0);
    expect(c.hidden).toBe(true);
    expect(hasFired(c)).toBe(false);
  });

  test("ticking advances the clock and clamps at the final 'fired' segment", () => {
    let c = initClock(spec);
    c = tick(c); // 集结
    c = tick(c); // 献祭前夜
    expect(c.position).toBe(2);
    c = tick(c); // 仪式完成 (fired)
    expect(hasFired(c)).toBe(true);
    c = tick(c); // clamp — can't overshoot
    expect(c.position).toBe(3);
  });

  test("players never see the raw number — only a qualitative band", () => {
    const c = tick(tick(initClock(spec)));
    const signal = playerSignal(c);
    // The player-facing signal carries a band, NOT the raw position/total.
    expect(Object.keys(signal)).toEqual(["name", "band"]);
    expect(signal.band).toBe("imminent");
    expect(JSON.stringify(signal)).not.toContain("2");
  });

  test("the AIDM (omniscient) can read the raw numbers", () => {
    const c = tick(initClock(spec));
    expect(dmView(c)).toEqual({ name: "邪教仪式", segment: "集结", position: 1, total: 4 });
  });
});
