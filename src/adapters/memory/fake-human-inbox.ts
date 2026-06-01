import type { ActorId, SceneId } from "../../domain/ids.js";
import type { HumanInboxPort, HumanTurn } from "../../ports/human-inbox.js";

/**
 * Scripted human inbox: maps an actor id to its turn, or `undefined` for a
 * silent human (the headless way to reproduce an AFK player).
 */
export class FakeHumanInbox implements HumanInboxPort {
  private readonly turns: Record<string, HumanTurn | undefined>;

  constructor(turns: Record<string, HumanTurn | undefined>) {
    this.turns = turns;
  }

  async poll(actor: ActorId, _sceneId: SceneId): Promise<HumanTurn | undefined> {
    return this.turns[actor];
  }
}
