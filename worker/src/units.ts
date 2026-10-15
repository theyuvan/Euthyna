import { encodePacked, keccak256, type Address, type Hex } from "viem";
import { formatUnits, parseUnits } from "viem";

/** USDC ERC-20 units (6 decimals) <-> decimal string. Never use 18 decimals anywhere. */
export const DECIMALS = 6;
export const fmt = (units: bigint): string => formatUnits(units, DECIMALS);
export const parse = (usdc: string): bigint => parseUnits(usdc, DECIMALS);
export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const max = (a: bigint, b: bigint) => (a > b ? a : b);
export const iso = (seconds: bigint | number) => new Date(Number(seconds) * 1000).toISOString();
export const HOUR = 3600n;

/** "A bill with ref (a hash of payee and invoice number)" — the one canonical place this is computed. */
export const obligationRef = (payee: Address, invoiceNumber: string): Hex =>
  keccak256(encodePacked(["address", "string"], [payee, invoiceNumber]));
