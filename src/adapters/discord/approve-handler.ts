import type { CampaignId } from "../../domain/ids.js";
import type { SanctionedException } from "../../domain/card-lifecycle.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";
import type { ExceptionStore } from "../../ports/exception-store.js";

/**
 * approve-handler.ts — the owner-only `/批准` (approve) handler (ADR-0012
 * Phase 6, #35), wired into #31's router as the owner-scoped `approve`
 * registration. The router's scope gate (Discord-verified invoker id; players
 * cannot forge it) is what makes this owner-only — the handler itself just
 * records the exception, trusting the gate ran first.
 *
 * It writes a {@link SanctionedException} via {@link ExceptionStore.add}. That
 * list is the SOLE exception authority the provenance-agnostic verifier reads;
 * a previously-rejected item passes re-verify ONLY after the owner approved it
 * here. The verifier never trusts "我跟 DM 商量过" prose — authority only flows
 * through this owner-only command.
 *
 * Command options (from #31's `CommandEvent.options`):
 *   - `项`    : the item being sanctioned (required).
 *   - `note` : optional owner note recorded with the approval.
 */

export interface ApproveDeps {
  readonly exceptionStore: ExceptionStore;
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
}

export function createApproveHandler(deps: ApproveDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const item = event.options["项"];
    if (item === undefined || item === "") {
      // No item to sanction — nothing to record.
      return;
    }
    const note = event.options["note"];
    const exception: SanctionedException =
      note !== undefined && note !== "" ? { item, note } : { item };

    deps.exceptionStore.add(deps.resolveCampaign(event), exception);
  };
}
