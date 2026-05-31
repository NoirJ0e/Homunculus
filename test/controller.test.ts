import { describe, expect, test } from "vitest";
import { actorId } from "../src/domain/ids.js";
import { ControllerRegistry } from "../src/engine/controller.js";

/**
 * Soul/controller decoupling (ADR-0006), at the registry level. The old
 * #13 hot-swap test drove these semantics through the deleted Engine director;
 * with ADR-0009 the director is gone, so the registry's invariants are tested
 * directly here. The pacing consequences (a silent human holds; an inert actor
 * is skipped) now belong to the combat-round / referee slices (#16/#17).
 */
const kael = actorId("soul:kael");

describe("ControllerRegistry — the mutable soul→controller binding", () => {
  test("an unbound soul defaults to AI (the empty-seat assumption)", () => {
    const reg = new ControllerRegistry();
    expect(reg.controllerOf(kael)).toEqual({ kind: "ai" });
  });

  test("only explicit handoff changes a binding — no AFK auto-takeover", () => {
    const reg = new ControllerRegistry({ "soul:kael": { kind: "human", userId: "u1" } });
    // Merely reading the controller never mutates it (a silent human stays human).
    expect(reg.controllerOf(kael)).toEqual({ kind: "human", userId: "u1" });
    expect(reg.controllerOf(kael)).toEqual({ kind: "human", userId: "u1" });
  });

  test("explicit handoff human→AI swaps the wheel; the soul id is unchanged", () => {
    const reg = new ControllerRegistry({ "soul:kael": { kind: "human", userId: "u1" } });
    reg.handoff(kael, { kind: "ai" });
    expect(reg.controllerOf(kael)).toEqual({ kind: "ai" });
  });

  test('"别管我" sets a long-lived inert pass', () => {
    const reg = new ControllerRegistry({ "soul:kael": { kind: "human", userId: "u1" } });
    reg.setInert(kael);
    expect(reg.controllerOf(kael)).toEqual({ kind: "inert" });
  });
});
