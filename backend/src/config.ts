import "dotenv/config";
import { z } from "zod";

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
// Empty env vars ("FACTORY_ADDRESS=" with nothing after it) arrive as "", not undefined.
const optionalHex = z.preprocess((v) => (v === "" ? undefined : v), hex.optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  // Tried in order when the primary errors or rate-limits. Must accept 5000-block getLogs ranges
  // (LOG_CHUNK_BLOCKS) — drpc caps at 100 and quicknode 429s readily, so neither is listed.
  ARC_RPC_FALLBACK_URLS: z
    .string()
    .default("https://rpc.blockdaemon.testnet.arc.io")
    .transform((s) => s.split(",").map((u) => u.trim()).filter(Boolean)),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  EXPLORER_URL: z.string().default("https://testnet.arcscan.app"),
  FACTORY_ADDRESS: optionalHex,
  FACTORY_START_BLOCK: z.coerce.bigint().default(0n),

  // "circle" = Circle dev-controlled SCA wallet per vault (production path).
  // "local"  = a raw private key, for testing before Circle is set up.
  EXECUTOR: z.enum(["circle", "local"]).default("circle"),
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_WALLET_SET_ID: z.string().optional(),
  CIRCLE_FEE_LEVEL: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  AGENT_PRIVATE_KEY: optionalHex,

  // "anthropic" calls Claude directly. "xai", "gemini" and "openrouter" call their OpenAI-compatible
  // endpoints. Either way the model only proposes actions; policy.ts and the contract are what gate
  // money. "openrouter" is a second path to the same Gemini models, for when Google's own free-tier
  // daily quota (20 req/day per model) is exhausted -- OpenRouter bills per token instead, no daily cap.
  LLM_PROVIDER: z.enum(["anthropic", "xai", "gemini", "openrouter"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  // Optional ordered fallback list, "provider:model,provider:model,…" — see llm-chain.ts.
  LLM_CHAIN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  PROMPT_VERSION: z.string().default("euthyna-v1"),
  // Test only: read the decision from this JSON file instead of calling the model. Recorded as model "stub".
  LLM_STUB_FILE: z.string().optional(),

  AGENT_INTERVAL_MIN: z.coerce.number().default(30),
  // Automatic agent runs skip is_test vaults unless this is "true".
  AGENT_INCLUDE_TEST: z.preprocess((v) => v === "true" || v === true, z.boolean()).default(false),
  SETTLER_INTERVAL_MIN: z.coerce.number().default(10),
  INDEXER_INTERVAL_SEC: z.coerce.number().default(60),
  LOG_CHUNK_BLOCKS: z.coerce.bigint().default(5000n),
  // Policy safety net: pay a payable owner bill due within this many hours if the LLM skipped it.
  AUTO_PAY_WITHIN_HOURS: z.coerce.number().default(2),

  PORT: z.coerce.number().default(8787),
  ADMIN_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().default("*"),
  // The builder's own owner wallets. /api/businesses labels their vaults "builder" so the public
  // numbers can tell independent businesses apart from the team's own.
  BUILDER_ADDRESSES: z
    .string()
    .default("0x7a869bcf4075292b4628d3d7ae6df95910b61c9a,0xbf74f5f0cf561f04ee745edb56b27948d6e040cf")
    .transform((s) => s.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)),
});

export type Config = z.infer<typeof schema>;

export const config: Config = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  const c = parsed.data;
  if (c.EXECUTOR === "circle" && (!c.CIRCLE_API_KEY || !c.CIRCLE_ENTITY_SECRET)) {
    console.error("EXECUTOR=circle needs CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
    process.exit(1);
  }
  if (c.EXECUTOR === "local" && !c.AGENT_PRIVATE_KEY) {
    console.error("EXECUTOR=local needs AGENT_PRIVATE_KEY");
    process.exit(1);
  }
  return c;
})();
