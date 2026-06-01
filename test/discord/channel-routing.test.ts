import { describe, expect, test } from "vitest";
import {
  encodeTopic,
  parseTopic,
  type ChannelRouting,
} from "../../src/adapters/discord/channel-routing.js";

describe("channel-routing topic codec", () => {
  test("encode → parse round-trips with scene present", () => {
    const routing: ChannelRouting = {
      campaign: "mine-01",
      scene: "tavern",
      role: "aidm",
    };

    const topic = encodeTopic(routing);
    expect(topic).toBe("homunculus:campaign=mine-01;scene=tavern;role=aidm");
    expect(parseTopic(topic)).toEqual(routing);
  });

  test("scene is optional — round-trips when absent", () => {
    const routing: ChannelRouting = {
      campaign: "mine-01",
      role: "concierge",
    };

    const topic = encodeTopic(routing);
    expect(topic).toBe("homunculus:campaign=mine-01;role=concierge");

    const parsed = parseTopic(topic);
    expect(parsed).toEqual(routing);
    expect(parsed).not.toHaveProperty("scene");
  });

  test("non-Homunculus topic (a user-written channel description) → null", () => {
    expect(parseTopic("Welcome to our cozy tavern! campaign=mine-01")).toBeNull();
    expect(parseTopic("general chat about the campaign=foo;role=aidm")).toBeNull();
    expect(parseTopic("")).toBeNull();
    expect(parseTopic(null)).toBeNull();
  });

  test("missing required field → null, never throws", () => {
    // missing role
    expect(parseTopic("homunculus:campaign=mine-01;scene=tavern")).toBeNull();
    // missing campaign
    expect(parseTopic("homunculus:role=aidm;scene=tavern")).toBeNull();
    // prefix only, nothing else
    expect(parseTopic("homunculus:")).toBeNull();
  });

  test("dirty data → null, never throws", () => {
    // unrecognised role value is not a stable ChannelRole
    expect(parseTopic("homunculus:campaign=mine-01;role=wizard")).toBeNull();
    // empty campaign value
    expect(parseTopic("homunculus:campaign=;role=aidm")).toBeNull();
    // empty role value
    expect(parseTopic("homunculus:campaign=mine-01;role=")).toBeNull();
    // garbage segments without `=` must not throw
    expect(() => parseTopic("homunculus:;;;===;")).not.toThrow();
    expect(parseTopic("homunculus:;;;===;")).toBeNull();
  });
});
