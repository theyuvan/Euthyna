import { keccak256, stringToHex, type Hex } from "viem";

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, bigint as decimal string,
 * undefined dropped. The dashboard's replay page must use the same rules to recompute the hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : normalize(x)));
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalize(x);
    }
    return out;
  }
  return v;
}

export function hashCanonical(json: string): Hex {
  return keccak256(stringToHex(json));
}
