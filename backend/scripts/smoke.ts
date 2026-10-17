// Live Arc testnet smoke test, no LLM and no database. Needs OWNER_PRIVATE_KEY and AGENT_PRIVATE_KEY
// (each funded with a little test USDC from faucet.circle.com) and FACTORY_ADDRESS.
// Proves what Foundry cannot: real USDC transfers through Arc's native precompile.
//   1. owner creates a vault (10-minute payee delay, 1 USDC floor) and funds it with 5 USDC
//   2. agent sweeps 2 USDC for 1 hour, then redeems 1 USDC
//   3. with --pay: waits out the payee delay, registers a 0.5 USDC owner bill, the agent pays it
import "dotenv/config";
import { createWalletClient, getAddress, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { factoryAbi, vaultAbi } from "../src/abi.js";
import { arcTestnet, publicClient, USDC, usdcAbi } from "../src/chain.js";
import { fmt, parse } from "../src/units.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing`);
  return v;
};
const owner = privateKeyToAccount(need("OWNER_PRIVATE_KEY") as Hex);
const agent = privateKeyToAccount(need("AGENT_PRIVATE_KEY") as Hex);
const factory = getAddress(need("FACTORY_ADDRESS"));
const payee = getAddress(process.env.SMOKE_PAYEE ?? owner.address);
const transport = http(process.env.ARC_RPC_URL);
const ow = createWalletClient({ account: owner, chain: arcTestnet, transport });
const ag = createWalletClient({ account: agent, chain: arcTestnet, transport });
const D = ("0x" + "11".repeat(32)) as Hex;

async function wait(hash: Hex) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  return r;
}
const usdcOf = (a: `0x${string}`) => publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] });

console.log(`owner ${owner.address} has ${fmt(await usdcOf(owner.address))} USDC; agent ${agent.address}`);

const created = await wait(
  await ow.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "createVaultWithParams",
    args: [
      agent.address,
      { baseLimit: parse("25"), rateBps: 20000, ownerCeiling: parse("1000"), ownerDailyCeiling: parse("3000"), minLiquid: parse("1"), grace: 3600n, payeeDelay: 600n, minHorizon: 3600n },
    ],
  }),
);
const vault = parseEventLogs({ abi: factoryAbi, logs: created.logs, eventName: "VaultCreated" })[0].args.vault;
console.log("vault", vault);
const read = (functionName: "liquid" | "reserve") => publicClient.readContract({ address: vault, abi: vaultAbi, functionName });

await wait(await ow.writeContract({ address: USDC, abi: usdcAbi, functionName: "transfer", args: [vault, parse("5")] }));
console.log("funded: liquid", fmt(await read("liquid")));

await wait(await ag.writeContract({ address: vault, abi: vaultAbi, functionName: "sweep", args: [parse("2"), 3600n, D] }));
console.log("swept 2: liquid", fmt(await read("liquid")), "reserve", fmt(await read("reserve")));
await wait(await ag.writeContract({ address: vault, abi: vaultAbi, functionName: "redeem", args: [parse("1"), D] }));
console.log("redeemed 1: liquid", fmt(await read("liquid")), "reserve", fmt(await read("reserve")));

await wait(await ow.writeContract({ address: vault, abi: vaultAbi, functionName: "addPayee", args: [payee, parse("10"), parse("50")] }));
if (process.argv.includes("--pay")) {
  console.log("waiting 10 minutes for the payee delay...");
  await new Promise((res) => setTimeout(res, 605_000));
  const due = BigInt(Math.floor(Date.now() / 1000) + 7200);
  const reg = await wait(
    await ow.writeContract({ address: vault, abi: vaultAbi, functionName: "registerObligation", args: [payee, parse("0.5"), due, D] }),
  );
  const id = parseEventLogs({ abi: vaultAbi, logs: reg.logs, eventName: "ObligationRegistered" })[0].args.id;
  const before = await usdcOf(payee);
  await wait(await ag.writeContract({ address: vault, abi: vaultAbi, functionName: "pay", args: [id, D] }));
  console.log(`paid bill ${id}: payee +${fmt((await usdcOf(payee)) - before)} USDC`);
}
console.log("smoke ok");
