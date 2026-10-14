// Deploys EuthynaFactory with DEPLOYER_PRIVATE_KEY (alternative to forge script/Deploy.s.sol).
// Defaults match the spec; tune with env (BASE_LIMIT_USDC, RATE_BPS, FLOOR_USDC, GRACE_SECONDS, PAYEE_DELAY_SECONDS, ...).
import "dotenv/config";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { factoryAbi, factoryBytecode } from "../src/abi.js";
import { arcTestnet, publicClient, USDC } from "../src/chain.js";
import { parse } from "../src/units.js";

const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY missing");
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });
const env = (k: string, d: string) => process.env[k] ?? d;

const params = {
  baseLimit: parse(env("BASE_LIMIT_USDC", "25")),
  rateBps: Number(env("RATE_BPS", "20000")),
  ownerCeiling: parse(env("OWNER_CEILING_USDC", "1000")),
  ownerDailyCeiling: parse(env("OWNER_DAILY_CEILING_USDC", "3000")),
  minLiquid: parse(env("FLOOR_USDC", "50")),
  grace: BigInt(env("GRACE_SECONDS", "3600")),
  payeeDelay: BigInt(env("PAYEE_DELAY_SECONDS", "3600")),
};
const hash = await wallet.deployContract({ abi: factoryAbi, bytecode: factoryBytecode, args: [USDC, params] });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`EuthynaFactory ${receipt.contractAddress}\nblock ${receipt.blockNumber}\ntx ${hash}`);
console.log(`Add to worker/.env:\nFACTORY_ADDRESS=${receipt.contractAddress}\nFACTORY_START_BLOCK=${receipt.blockNumber}`);
