// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {EuthynaVault} from "../src/EuthynaVault.sol";
import {EuthynaFactory} from "../src/EuthynaFactory.sol";

/// Reads real Arc testnet state. Skipped unless ARC_RPC_URL is set:
///   ARC_RPC_URL=https://rpc.testnet.arc.io forge test --match-contract ArcFork -vvv
/// Note: Arc's USDC transfer goes through a native precompile (0x1800...) that Foundry's EVM cannot
/// execute, so transfers are exercised on the live chain by worker/scripts/smoke.ts, not here.
contract ArcForkTest is Test {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint128 constant U = 1e6;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
    }

    // #22: one balance, two faces. Native value is 18 decimals, the ERC-20 view is 6.
    function test_nativeBalanceIsErc20BalanceIn6Decimals() public {
        assertEq(IERC20Metadata(ARC_USDC).decimals(), 6);
        address a = makeAddr("holder");
        vm.deal(a, 10 ether); // 10 USDC natively
        assertEq(IERC20(ARC_USDC).balanceOf(a), 10 * U);
    }

    function test_vaultReadsArcUsdc() public {
        EuthynaFactory f = new EuthynaFactory(
            IERC20(ARC_USDC), EuthynaVault.Params(25 * U, 20_000, 1_000 * U, 3_000 * U, 50 * U, 1 hours, 1 hours, 1 hours)
        );
        EuthynaVault v = f.createVault(makeAddr("agent"));
        vm.deal(address(v), 500 ether);
        assertEq(v.liquid(), 500 * U);
        assertEq(v.autonomousLimit(), 25 * U);
    }
}
