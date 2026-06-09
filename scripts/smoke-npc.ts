import { npcGenerate } from "../src/adapters/agent-sdk/sdk-runner.js";
const t0 = Date.now();
const out = await npcGenerate("你是一个粗豪的战士铁拳·冈。用第一人称、一句话回应：酒馆里有人提到一桩失窃案。只出你这一句台词。");
console.log(`[npc out ${Date.now()-t0}ms]:`, JSON.stringify(out));
process.exit(0);
