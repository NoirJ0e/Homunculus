import { describe, expect, test } from "vitest";
import { buildConciergePrompt } from "../src/adapters/agent-sdk/concierge-prompt.js";

/**
 * #26 — the concierge system prompt (ADR-0011). The concierge chats a player
 * into a CampaignSeed (premise / tone / desiredClimax / levelBand), then builds
 * the channel skeleton and writes the routing pointer into the topic.
 *
 * IRON RULE under test: the concierge is provisioning-only. The prompt must
 * guide collecting the four seed fields and must carry NO narrate authorization
 * and NO license to speak/act as any character.
 */
describe("concierge prompt", () => {
  const prompt = buildConciergePrompt();

  test("guides the player toward all four CampaignSeed fields", () => {
    // premise / tone / desiredClimax / levelBand — the four fields of CampaignSeed.
    expect(prompt).toContain("premise");
    expect(prompt).toContain("tone");
    expect(prompt).toContain("desiredClimax");
    expect(prompt).toContain("levelBand");
  });

  test("describes the provisioning job: skeleton + topic routing pointer", () => {
    // It should mention building the campaign skeleton and writing the topic.
    expect(prompt).toMatch(/category|频道|skeleton|骨架/);
    expect(prompt).toMatch(/topic/);
  });

  test("carries NO narrate authorization and NO speak-as-character license", () => {
    // The concierge must never be granted narration or character voice.
    expect(prompt).not.toMatch(/await_actors/);
    // No tool-grant of narrate (the AIDM-only power).
    expect(prompt).not.toMatch(/你可以\s*narrate|授权.*narrate|narrate\(/);
    // Explicitly forbids speaking/acting as a character somewhere in the prompt.
    expect(prompt).toMatch(/不.*(叙事|narrate)/);
    expect(prompt).toMatch(/不.*替.*角色|不.*演|不替任何角色/);
  });
});
