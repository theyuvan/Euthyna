// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EuthynaVault} from "../src/EuthynaVault.sol";
import {EuthynaFactory} from "../src/EuthynaFactory.sol";

/// Deploys the factory and (optionally) a first vault owned by the deployer.
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_KEY --broadcast
/// Env: AGENT_ADDRESS (optional) creates a first vault with that agent.
contract Deploy is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint128 constant U = 1e6;

    function run() external {
        EuthynaVault.Params memory p = EuthynaVault.Params({
            baseLimit: uint128(vm.envOr("BASE_LIMIT_USDC", uint256(25))) * U,
            rateBps: uint32(vm.envOr("RATE_BPS", uint256(20_000))),
            ownerCeiling: uint128(vm.envOr("OWNER_CEILING_USDC", uint256(1_000))) * U,
            ownerDailyCeiling: uint128(vm.envOr("OWNER_DAILY_CEILING_USDC", uint256(3_000))) * U,
            minLiquid: uint128(vm.envOr("FLOOR_USDC", uint256(50))) * U,
            grace: uint64(vm.envOr("GRACE_SECONDS", uint256(1 hours))),
            payeeDelay: uint64(vm.envOr("PAYEE_DELAY_SECONDS", uint256(1 hours)))
        });
        address agent = vm.envOr("AGENT_ADDRESS", address(0));

        vm.startBroadcast();
        EuthynaFactory factory = new EuthynaFactory(IERC20(ARC_USDC), p);
        console2.log("EuthynaFactory:", address(factory));
        if (agent != address(0)) {
            EuthynaVault vault = factory.createVault(agent);
            console2.log("EuthynaVault:", address(vault));
        }
        vm.stopBroadcast();
    }
}
