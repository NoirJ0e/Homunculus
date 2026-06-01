import { describe, expect, test } from "vitest";
import { StreamInputChannel } from "../../src/runtime/stream-input.js";

/** Pull `n` messages' text from the channel's async iterable. */
async function take(channel: StreamInputChannel, n: number): Promise<string[]> {
  const out: string[] = [];
  for await (const m of channel.iterable) {
    // SDKUserMessage shape: { type: "user", message: { role, content } }
    const content = m.message.content;
    out.push(typeof content === "string" ? content : JSON.stringify(content));
    if (out.length === n) break;
  }
  return out;
}

describe("#28 StreamInputChannel — pushed strings → AsyncIterable<SDKUserMessage>", () => {
  test("a message pushed before consumption is yielded", async () => {
    const channel = new StreamInputChannel();
    channel.push("我想跑《凡达林的矿坑》");
    const got = await take(channel, 1);
    expect(got).toEqual(["我想跑《凡达林的矿坑》"]);
  });

  test("yields each pushed message as a well-shaped SDKUserMessage", async () => {
    const channel = new StreamInputChannel();
    channel.push("hello");
    const it = channel.iterable[Symbol.asyncIterator]();
    const { value, done } = await it.next();
    expect(done).toBe(false);
    expect(value?.type).toBe("user");
    expect(value?.message.role).toBe("user");
    expect(value?.message.content).toBe("hello");
    expect(value?.parent_tool_use_id).toBe(null);
  });

  test("a message pushed during consumption is yielded in order", async () => {
    const channel = new StreamInputChannel();
    const collected: string[] = [];
    const consumer = (async () => {
      for await (const m of channel.iterable) {
        collected.push(m.message.content as string);
        if (collected.length === 3) break;
      }
    })();

    channel.push("a");
    await Promise.resolve();
    channel.push("b");
    await Promise.resolve();
    channel.push("c");

    await consumer;
    expect(collected).toEqual(["a", "b", "c"]);
  });

  test("close() terminates the iterator after draining buffered messages", async () => {
    const channel = new StreamInputChannel();
    channel.push("only");
    channel.close();

    const seen: string[] = [];
    for await (const m of channel.iterable) {
      seen.push(m.message.content as string);
    }
    expect(seen).toEqual(["only"]);
  });

  test("close() while a consumer is waiting ends iteration", async () => {
    const channel = new StreamInputChannel();
    const seen: string[] = [];
    const consumer = (async () => {
      for await (const m of channel.iterable) {
        seen.push(m.message.content as string);
      }
    })();

    await Promise.resolve();
    channel.close();
    await consumer;
    expect(seen).toEqual([]);
  });
});
