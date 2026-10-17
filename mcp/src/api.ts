import { config } from "./config.js";

/**
 * GET from the public Euthyna API. The hosted backend can take a few seconds to wake up, so a failed or
 * slow request is retried a couple of times before giving up.
 */
export async function api<T = unknown>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${config.apiUrl}${path}`, { signal: AbortSignal.timeout(30_000) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as T;
    } catch (e) {
      lastError = e;
      if (e instanceof Error && /bad (vault address|id)|not found/i.test(e.message)) break; // not worth retrying
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export const txUrl = (hash: string) => `${config.explorer}/tx/${hash}`;
export const addressUrl = (address: string) => `${config.explorer}/address/${address}`;
