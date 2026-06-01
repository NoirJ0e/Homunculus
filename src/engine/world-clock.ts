import type { WorldClockSpec } from "../domain/campaign.js";

/**
 * 世界时钟 (world clock) — a named, segmented progress track for the villain's
 * plan / 沦陷度 (ADR-0007). Default HIDDEN: players feel risk through fiction,
 * never the raw number; the AIDM may narrativize it but the digits stay engine-side.
 */
export interface WorldClockState {
  readonly id: string;
  readonly name: string;
  readonly segments: readonly string[];
  /** 0-based index into segments — the raw number, never shown to players. */
  readonly position: number;
  readonly hidden: boolean;
}

export function initClock(spec: WorldClockSpec): WorldClockState {
  return { id: spec.id, name: spec.name, segments: spec.segments, position: 0, hidden: true };
}

/** Advance one segment; clamps at the final ("fired") segment. */
export function tick(state: WorldClockState): WorldClockState {
  const last = state.segments.length - 1;
  if (state.position >= last) return state;
  return { ...state, position: state.position + 1 };
}

export function hasFired(state: WorldClockState): boolean {
  return state.position >= state.segments.length - 1;
}

export type ClockBand = "calm" | "rising" | "imminent" | "fired";

function band(state: WorldClockState): ClockBand {
  const last = state.segments.length - 1;
  if (state.position >= last) return "fired";
  if (state.position === 0) return "calm";
  return state.position < last / 2 ? "rising" : "imminent";
}

/** What a player may perceive: a qualitative band, NEVER the raw number. */
export function playerSignal(state: WorldClockState): { readonly name: string; readonly band: ClockBand } {
  return { name: state.name, band: band(state) };
}

/** The omniscient AIDM view, with raw numbers. */
export function dmView(state: WorldClockState): {
  readonly name: string;
  readonly segment: string;
  readonly position: number;
  readonly total: number;
} {
  return {
    name: state.name,
    segment: state.segments[state.position] ?? "",
    position: state.position,
    total: state.segments.length,
  };
}
