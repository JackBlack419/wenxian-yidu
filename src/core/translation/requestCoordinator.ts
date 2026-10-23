import { createAbortController } from "../../utils/abort";
import { Semaphore } from "../../utils/Semaphore";
import { assertNotCancelled, cancelled } from "./providerAdapters";

interface SharedJob { controller: AbortController; promise: Promise<string>; consumers: number; settled: boolean }
const pending = new Map<string, SharedJob>();
const gates = new Map<string, Semaphore>();

/** A cancelled caller detaches; other readers sharing the request keep working. */
export function sharedRequest(key: string, work: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<string> {
  assertNotCancelled(signal);
  let job = pending.get(key);
  if (!job || job.controller.signal.aborted) {
    const controller = createAbortController() as AbortController;
    job = { controller, promise: Promise.resolve(""), consumers: 0, settled: false };
    const current = job;
    current.promise = Promise.resolve().then(() => work(controller.signal)).finally(() => {
      current.settled = true;
      if (pending.get(key) === current) pending.delete(key);
    });
    // All consumers may cancel while the network request is still settling.
    void current.promise.catch(() => {});
    pending.set(key, current);
  }
  const current = job;
  current.consumers++;
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const detach = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      current.consumers--;
      if (!current.settled && current.consumers === 0) current.controller.abort();
      return true;
    };
    const onAbort = () => { if (detach()) reject(cancelled()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    current.promise.then(value => { if (detach()) resolve(value); }, error => { if (detach()) reject(error); });
  });
}

export async function providerSlot<T>(engine: string, concurrency: number, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  assertNotCancelled(signal);
  let gate = gates.get(engine);
  if (!gate) { gate = new Semaphore(concurrency); gates.set(engine, gate); }
  const release = await gate.acquire();
  try { assertNotCancelled(signal); return await work(); }
  finally { release(); }
}

/** Keep every code point, preferring sentence/word boundaries near the limit. */
export function splitLongText(text: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("翻译分段长度必须为正整数。");
  const chars = Array.from(text);
  if (chars.length <= limit) return [text];
  const parts: string[] = [];
  let offset = 0;
  while (offset < chars.length) {
    let end = Math.min(chars.length, offset + limit);
    if (end < chars.length) {
      for (let i = end; i > offset + limit * 0.6; i--) {
        if (/[\s.!?。！？；;]/u.test(chars[i - 1])) { end = i; break; }
      }
      // Never split a formula position token between requests.
      const tail = chars.slice(offset, end).join("");
      const unfinished = tail.match(/\{v\d*$/);
      if (unfinished && end - unfinished[0].length > offset) end -= unfinished[0].length;
    }
    parts.push(chars.slice(offset, end).join("")); offset = end;
  }
  return parts;
}
