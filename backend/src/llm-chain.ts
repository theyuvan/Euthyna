import OpenAI from "openai";
import { config } from "./config.js";

// An ordered list of models to try. Each decision (and each invoice extraction) walks it until one
// returns a valid answer, so a quota-exhausted or failing model never stalls the agent.
//
// LLM_CHAIN="gemini:gemini-3.5-flash,gemini:gemini-2.5-flash,openrouter:liquid/lfm-2.5-2.6b:free"
// Each entry is provider:model, split on the first ':' only (OpenRouter ids contain ':free').
// Without LLM_CHAIN, the chain is the single LLM_PROVIDER:LLM_MODEL pair.

export type Provider = "anthropic" | "xai" | "gemini" | "openrouter";
export interface ChainEntry {
  provider: Provider;
  model: string;
}
export interface Attempt {
  model: string;
  error: string;
}

const PROVIDERS: Provider[] = ["anthropic", "xai", "gemini", "openrouter"];

export function llmChain(): ChainEntry[] {
  if (!config.LLM_CHAIN) return [{ provider: config.LLM_PROVIDER, model: config.LLM_MODEL }];
  const entries: ChainEntry[] = [];
  for (const raw of config.LLM_CHAIN.split(",")) {
    const s = raw.trim();
    const i = s.indexOf(":");
    if (i < 1) continue;
    const provider = s.slice(0, i) as Provider;
    const model = s.slice(i + 1).trim();
    if (PROVIDERS.includes(provider) && model) entries.push({ provider, model });
  }
  return entries.length ? entries : [{ provider: config.LLM_PROVIDER, model: config.LLM_MODEL }];
}

export const entryId = (e: ChainEntry) => `${e.provider}:${e.model}`;

// Short timeout and one retry: a hung provider must fail fast so the next model gets its turn
// (the SDK default is a 10-minute timeout with 2 retries).
const opts = { timeout: 60_000, maxRetries: 1 };
const clients: Record<Exclude<Provider, "anthropic">, { client: OpenAI; key: string | undefined; keyName: string }> = {
  xai: { client: new OpenAI({ apiKey: config.XAI_API_KEY || "unset", baseURL: config.XAI_BASE_URL, ...opts }), key: config.XAI_API_KEY, keyName: "XAI_API_KEY" },
  gemini: { client: new OpenAI({ apiKey: config.GEMINI_API_KEY || "unset", baseURL: config.GEMINI_BASE_URL, ...opts }), key: config.GEMINI_API_KEY, keyName: "GEMINI_API_KEY" },
  openrouter: { client: new OpenAI({ apiKey: config.OPENROUTER_API_KEY || "unset", baseURL: config.OPENROUTER_BASE_URL, ...opts }), key: config.OPENROUTER_API_KEY, keyName: "OPENROUTER_API_KEY" },
};

export function openAICompatible(provider: Exclude<Provider, "anthropic">) {
  return clients[provider];
}

export function hasKey(e: ChainEntry): boolean {
  if (e.provider === "anthropic") return Boolean(config.ANTHROPIC_API_KEY);
  return Boolean(clients[e.provider].key);
}

// Models that hit a rate limit or quota sit out for a while instead of being retried every run.
const coolingUntil = new Map<string, number>();

export function coolingDown(e: ChainEntry): boolean {
  const until = coolingUntil.get(entryId(e));
  return until !== undefined && until > Date.now();
}

export function noteFailure(e: ChainEntry, error: string | null) {
  if (!error) return;
  let minutes = 0;
  if (/\b404\b|not found|does not exist|unknown model/i.test(error)) minutes = 6 * 60; // bad model id
  else if (/per ?day|daily|PerDay/i.test(error)) minutes = 3 * 60; // daily free-tier quota
  else if (/\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED|\b402\b|credits/i.test(error)) minutes = 10;
  if (minutes) coolingUntil.set(entryId(e), Date.now() + minutes * 60_000);
}

export const shortError = (e: string | null) => (e ?? "unknown error").replace(/\s+/g, " ").slice(0, 200);
