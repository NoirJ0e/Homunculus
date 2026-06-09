/**
 * parse-bot-mention.ts — resolve which POOL bot(s) a message @-mentioned (#56).
 *
 * Discord renders a user mention as `<@id>` (or `<@!id>` for a nicknamed member).
 * The main bot's gateway sees every channel message; this pure parse picks out
 * the mentions that point at a pool bot, in order of appearance, deduped. It is
 * the seam the #57 @bot coordination channel builds on (route a `@周慎 …` aside
 * to 周慎's queued instruction).
 */
const MENTION = /<@!?(\d+)>/g;

export function parseBotMentions(content: string, poolBotUserIds: readonly string[]): string[] {
  const pool = new Set(poolBotUserIds);
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const m of content.matchAll(MENTION)) {
    const id = m[1];
    if (id !== undefined && pool.has(id) && !seen.has(id)) {
      seen.add(id);
      hits.push(id);
    }
  }
  return hits;
}
