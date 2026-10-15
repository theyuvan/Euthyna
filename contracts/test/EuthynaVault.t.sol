// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EuthynaVault} from "../src/EuthynaVault.sol";
import {EuthynaFactory} from "../src/EuthynaFactory.sol";
import {MockUSDC, HookUSDC} from "./mocks/MockUSDC.sol";

contract EuthynaVaultTest is Test {
    uint128 constant U = 1e6; // 1 USDC

    MockUSDC usdc;
    EuthynaFactory factory;
    EuthynaVault vault;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice"); // allowlisted payee
    address bob = makeAddr("bob"); // allowlisted payee
    address mallory = makeAddr("mallory"); // never allowlisted
    address rando = makeAddr("rando");

    bytes32 constant H = keccak256("decision");

    function _params() internal pure returns (EuthynaVault.Params memory) {
        return EuthynaVault.Params({
            baseLimit: 25 * U,
            rateBps: 20_000,
            ownerCeiling: 1_000 * U,
            ownerDailyCeiling: 3_000 * U,
            minLiquid: 50 * U,
            grace: 1 hours,
            payeeDelay: 1 hours,
            minHorizon: 1 hours
        });
    }

    function setUp() public {
        vm.warp(1_760_000_000);
        usdc = new MockUSDC();
        factory = new EuthynaFactory(IERC20(address(usdc)), _params());
        vm.prank(owner);
        vault = factory.createVault(agent);
        usdc.mint(address(vault), 1_000 * U);

        vm.startPrank(owner);
        vault.addPayee(alice, 100 * U, 300 * U);
        vault.addPayee(bob, 100 * U, 300 * U);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 hours);
    }

    // ---------------------------------------------------------------- helpers

    function _ownerBill(address payee, uint128 amount, uint64 dueIn, string memory inv) internal returns (uint32) {
        vm.prank(owner);
        return vault.registerObligation(payee, amount, uint64(block.timestamp) + dueIn, keccak256(abi.encode(payee, inv)));
    }

    function _agentBill(address payee, uint128 amount, uint64 dueIn, string memory inv) internal returns (uint32) {
        vm.prank(agent);
        return vault.agentRegisterObligation(
            payee, amount, uint64(block.timestamp) + dueIn, keccak256(abi.encode(payee, inv)), H
        );
    }

    function _pay(uint32 id) internal {
        vm.prank(agent);
        vault.pay(id, H);
    }

    function _sweep(uint128 amount, uint64 horizon) internal returns (uint32) {
        vm.prank(agent);
        return vault.sweep(amount, horizon, H);
    }

    function _settleAfter(uint32 cid) internal {
        EuthynaVault.Commitment memory c = vault.getCommitment(cid);
        vm.warp(uint256(c.T) + vault.grace());
        vm.prank(rando);
        vault.settle(cid);
    }

    /// One clean hit: owner bill of `bill` due in 12h, sweep `amt` for 24h, pay, settle.
    function _earnHit(uint128 bill, uint128 amt, string memory inv) internal returns (uint32 cid) {
        uint32 id = _ownerBill(alice, bill, 12 hours, inv);
        cid = _sweep(amt, 24 hours);
        vm.warp(block.timestamp + 11 hours);
        _pay(id);
        _settleAfter(cid);
    }

    // ===================================== money leaving to the wrong place

    // #1: the agent has no path to an arbitrary address; an unknown payee cannot even be registered.
    function test_agentCannotRegisterBillForUnknownPayee() public {
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.PayeeNotAllowed.selector);
        vault.agentRegisterObligation(mallory, 10 * U, uint64(block.timestamp + 1 days), keccak256("x"), H);
    }

    function test_payGoesToObligationPayeeOnly() public {
        uint32 id = _agentBill(alice, 10 * U, 1 days, "inv-1");
        _pay(id);
        assertEq(usdc.balanceOf(alice), 10 * U);
        assertEq(usdc.balanceOf(agent), 0);
    }

    // #2
    function test_agentCannotAddPayee() public {
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.NotOwner.selector);
        vault.addPayee(mallory, 1_000 * U, 1_000 * U);
    }

    function test_newPayeeNotLiveUntilDelay() public {
        vm.prank(owner);
        vault.addPayee(mallory, 100 * U, 300 * U);
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.PayeeNotActive.selector);
        vault.agentRegisterObligation(mallory, 10 * U, uint64(block.timestamp + 1 days), keccak256("m"), H);

        vm.warp(block.timestamp + 1 hours);
        _agentBill(mallory, 10 * U, 1 days, "m");
    }

    // #3
    function test_duplicateRefRejected() public {
        _agentBill(alice, 10 * U, 1 days, "inv-1");
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.RefUsed.selector);
        vault.agentRegisterObligation(alice, 10 * U, uint64(block.timestamp + 1 days), keccak256(abi.encode(alice, "inv-1")), H);
    }

    function test_cannotPayTwice() public {
        uint32 id = _agentBill(alice, 10 * U, 1 days, "inv-1");
        _pay(id);
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.BadStatus.selector);
        vault.pay(id, H);
    }

    // #4
    function test_invoiceAndMonthCaps() public {
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.OverInvoiceCap.selector);
        vault.agentRegisterObligation(alice, 101 * U, uint64(block.timestamp + 1 days), keccak256("big"), H);

        _agentBill(alice, 100 * U, 1 days, "a");
        _agentBill(alice, 100 * U, 1 days, "b");
        _agentBill(alice, 100 * U, 1 days, "c");
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.OverMonthCap.selector);
        vault.agentRegisterObligation(alice, 1 * U, uint64(block.timestamp + 1 days), keccak256("d"), H);

        // A new month frees the cap again.
        vm.warp(block.timestamp + 30 days);
        _agentBill(alice, 100 * U, 1 days, "e");
    }

    function test_payAboveLimitRevertsAndDailyCap() public {
        uint32 big = _agentBill(alice, 26 * U, 1 days, "big");
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.OverLimit.selector);
        vault.pay(big, H);

        // daily cap = 3 x 25 = 75
        _pay(_agentBill(alice, 25 * U, 1 days, "1"));
        _pay(_agentBill(alice, 25 * U, 1 days, "2"));
        _pay(_agentBill(alice, 25 * U, 1 days, "3"));
        uint32 fourth = _agentBill(bob, 25 * U, 2 days, "4");
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.OverDailyCap.selector);
        vault.pay(fourth, H);

        vm.warp(block.timestamp + 1 days);
        _pay(fourth);
    }

    // #5
    function test_pauseAndRevokeStopAgent() public {
        uint32 id = _agentBill(alice, 10 * U, 1 days, "inv-1");
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.IsPaused.selector);
        vault.pay(id, H);
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.IsPaused.selector);
        vault.sweep(100 * U, 6 hours, H);

        vm.startPrank(owner);
        vault.unpause();
        vault.setAgent(address(0));
        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.NotOwnerOrAgent.selector);
        vault.pay(id, H);
    }

    // #6
    function test_sweepKeepsFloor() public {
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.BelowFloor.selector);
        vault.sweep(951 * U, 6 hours, H);
        _sweep(950 * U, 6 hours);
        assertEq(vault.liquid(), 50 * U);
    }

    // #7
    function test_blocklistedPayeeRevertsAndStaysPending() public {
        uint32 id = _agentBill(alice, 10 * U, 1 days, "inv-1");
        usdc.setBlocked(alice, true);
        vm.prank(agent);
        vm.expectRevert(bytes("blocklisted"));
        vault.pay(id, H);
        assertEq(uint8(vault.getObligation(id).status), uint8(EuthynaVault.OStatus.PENDING));
        assertEq(usdc.balanceOf(address(vault)), 1_000 * U);

        // Owner can cancel it so it is never scored.
        vm.prank(owner);
        vault.cancelObligation(id);
        assertEq(uint8(vault.getObligation(id).status), uint8(EuthynaVault.OStatus.CANCELLED));
    }

    // ================================================== gaming the score

    function test_hitRaisesScoreAndLimit() public {
        uint32 cid = _earnHit(20 * U, 500 * U, "rent");
        EuthynaVault.Commitment memory c = vault.getCommitment(cid);
        assertTrue(c.hit);
        // min(avg 500, paid 20) * 1 day / 30 days
        uint256 expected = (uint256(20 * U) * 1 days) / 30 days;
        assertEq(c.credit, expected);
        assertEq(vault.score(), expected);
        assertEq(vault.autonomousLimit(), 25 * U + expected * 2);
        assertEq(vault.reserve(), 0, "reserve released at settle");
    }

    // #10
    function test_agentBillsEarnNoCredit() public {
        uint32 id = _agentBill(alice, 20 * U, 12 hours, "self-made");
        uint32 cid = _sweep(500 * U, 24 hours);
        _pay(id);
        _settleAfter(cid);
        assertTrue(vault.getCommitment(cid).hit);
        assertEq(vault.getCommitment(cid).credit, 0);
        assertEq(vault.score(), 0);
    }

    // #12: anyone can settle, by id only
    function test_anyoneCanSettle() public {
        uint32 cid = _sweep(100 * U, 6 hours);
        _settleAfter(cid); // pranked as rando
        assertTrue(vault.getCommitment(cid).settled);
    }

    // #13: matured-but-unsettled commitments still count toward the cap of 5
    function test_unsettledCommitmentsBlockNewSweeps() public {
        for (uint256 i = 0; i < 5; i++) _sweep(10 * U, 1 hours);
        vm.warp(block.timestamp + 10 days);
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.TooManyOpen.selector);
        vault.sweep(10 * U, 1 hours, H);

        vault.settle(1);
        _sweep(10 * U, 1 hours);
    }

    // #14
    function test_sweepThenInstantRedeemEarnsNothing() public {
        uint32 id = _ownerBill(alice, 20 * U, 12 hours, "rent");
        uint32 cid = _sweep(500 * U, 24 hours);
        vm.prank(agent);
        vault.redeem(500 * U, H);
        vm.warp(block.timestamp + 11 hours);
        _pay(id);
        _settleAfter(cid);
        assertTrue(vault.getCommitment(cid).hit);
        assertEq(vault.getCommitment(cid).credit, 0);
    }

    // #15
    function test_noOwnerBillNoCredit() public {
        uint32 cid = _sweep(500 * U, 24 hours);
        _settleAfter(cid);
        assertTrue(vault.getCommitment(cid).hit);
        assertEq(vault.getCommitment(cid).credit, 0);
    }

    // #16
    function test_limitNeverAboveOwnerCeiling() public {
        _earnHit(20 * U, 500 * U, "rent");
        assertGt(vault.autonomousLimit(), 25 * U);
        vm.prank(owner);
        vault.setCeilings(10 * U, 30 * U);
        assertEq(vault.autonomousLimit(), 10 * U);
        assertEq(vault.dailyCap(), 30 * U);
    }

    function test_missHalvesScoreAndCoolsDown() public {
        _earnHit(20 * U, 500 * U, "rent-1");
        uint256 before = vault.score();
        assertGt(before, 0);

        _ownerBill(alice, 20 * U, 12 hours, "rent-2"); // never paid
        uint32 cid = _sweep(100 * U, 24 hours);
        _settleAfter(cid);
        assertFalse(vault.getCommitment(cid).hit);
        assertEq(vault.score(), before / 2);

        // Miss followed by a cooldown sweep attempt.
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.InCooldown.selector);
        vault.sweep(10 * U, 6 hours, H);
        vm.warp(block.timestamp + 24 hours);
        _sweep(10 * U, 6 hours);
    }

    function test_latePaymentIsMiss() public {
        uint32 id = _ownerBill(alice, 20 * U, 2 hours, "rent");
        uint32 cid = _sweep(100 * U, 24 hours);
        vm.warp(block.timestamp + 2 hours + 1 hours + 1); // past due + grace
        _pay(id);
        _settleAfter(cid);
        assertFalse(vault.getCommitment(cid).hit);
    }

    function test_paidWithinGraceIsOnTime() public {
        uint32 id = _ownerBill(alice, 20 * U, 2 hours, "rent");
        uint32 cid = _sweep(100 * U, 24 hours);
        vm.warp(block.timestamp + 2 hours + 1 hours);
        _pay(id);
        _settleAfter(cid);
        assertTrue(vault.getCommitment(cid).hit);
    }

    // ============================================== unfairness to the agent

    // #17
    function test_ownerBillAddedMidWindowIsExcluded() public {
        uint32 cid = _sweep(100 * U, 24 hours);
        _ownerBill(alice, 20 * U, 6 hours, "ambush"); // added after open, never paid
        _settleAfter(cid);
        assertTrue(vault.getCommitment(cid).hit);
    }

    // #18
    function test_escalatedBillExcludedFromScoring() public {
        _ownerBill(alice, 80 * U, 12 hours, "big"); // above limit 25
        uint32 cid = _sweep(100 * U, 24 hours);
        vm.prank(agent);
        vault.escalate(1, H);
        // Owner never approves.
        _settleAfter(cid);
        assertTrue(vault.getCommitment(cid).hit);
    }

    function test_cannotEscalateBillItCouldPay() public {
        uint32 id = _ownerBill(alice, 10 * U, 12 hours, "small");
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.NotEscalatable.selector);
        vault.escalate(id, H);
    }

    function test_approveEscalationPays() public {
        uint32 id = _ownerBill(alice, 80 * U, 12 hours, "big");
        vm.prank(agent);
        vault.escalate(id, H);
        vm.prank(owner);
        vault.approveEscalation(id);
        assertEq(usdc.balanceOf(alice), 80 * U);
        assertEq(uint8(vault.getObligation(id).status), uint8(EuthynaVault.OStatus.PAID));
    }

    function test_failedForLiquidityIsMiss() public {
        uint32 id = _ownerBill(alice, 80 * U, 12 hours, "big");
        uint32 cid = _sweep(940 * U, 24 hours); // liquid left: 60 < 80
        vm.prank(agent);
        vault.escalate(id, H);
        vm.prank(owner);
        vault.approveEscalation(id); // does not revert
        assertTrue(vault.getObligation(id).failedForLiquidity);
        _settleAfter(cid);
        assertFalse(vault.getCommitment(cid).hit);
    }

    // ========================================================= correctness

    function test_settleOnlyAfterTPlusGrace() public {
        uint32 cid = _sweep(100 * U, 6 hours);
        EuthynaVault.Commitment memory c = vault.getCommitment(cid);
        vm.warp(c.T);
        vm.expectRevert(EuthynaVault.NotMatured.selector);
        vault.settle(cid);
        vm.warp(uint256(c.T) + 1 hours - 1);
        vm.expectRevert(EuthynaVault.NotMatured.selector);
        vault.settle(cid);
        vm.warp(uint256(c.T) + 1 hours);
        vault.settle(cid);
    }

    function test_settleTwiceReverts() public {
        uint32 cid = _sweep(100 * U, 6 hours);
        _settleAfter(cid);
        vm.expectRevert(EuthynaVault.AlreadySettled.selector);
        vault.settle(cid);
    }

    function test_redeemMoreThanReserveReverts() public {
        _sweep(100 * U, 6 hours);
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.OverReserve.selector);
        vault.redeem(101 * U, H);
    }

    function test_redeemNewestFirst() public {
        uint32 a = _sweep(100 * U, 24 hours);
        uint32 b = _sweep(100 * U, 24 hours);
        vm.prank(owner);
        vault.redeem(150 * U, H);
        assertEq(vault.getCommitment(b).remaining, 0);
        assertEq(vault.getCommitment(a).remaining, 50 * U);
        assertEq(vault.reserve(), 50 * U);
        assertEq(vault.liquid(), 950 * U);
    }

    function test_capitalSecondsAccrue() public {
        uint32 cid = _sweep(100 * U, 10 hours);
        vm.warp(block.timestamp + 4 hours);
        vm.prank(agent);
        vault.redeem(50 * U, H);
        vm.warp(block.timestamp + 100 hours); // well past T
        // 100 x 4h + 50 x 6h
        assertEq(vault.pendingCapitalSeconds(cid), uint256(100 * U) * 4 hours + uint256(50 * U) * 6 hours);
    }

    function test_payeeRemovedBetweenRegistrationAndPay() public {
        uint32 id = _agentBill(alice, 10 * U, 1 days, "inv-1");
        vm.prank(owner);
        vault.removePayee(alice);
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.PayeeNotAllowed.selector);
        vault.pay(id, H);
    }

    function test_withdrawOnlyToOwner() public {
        vm.prank(agent);
        vm.expectRevert(EuthynaVault.NotOwner.selector);
        vault.withdraw(1 * U);
        _sweep(900 * U, 6 hours);
        vm.prank(owner);
        vm.expectRevert(EuthynaVault.InsufficientLiquid.selector);
        vault.withdraw(101 * U);
        vm.prank(owner);
        vault.withdraw(100 * U);
        assertEq(usdc.balanceOf(owner), 100 * U);
    }

    function test_horizonBounds() public {
        vm.startPrank(agent);
        vm.expectRevert(EuthynaVault.BadHorizon.selector);
        vault.sweep(10 * U, 59 minutes, H);
        vm.expectRevert(EuthynaVault.BadHorizon.selector);
        vault.sweep(10 * U, 14 days + 1, H);
        vm.stopPrank();
    }

    /// minHorizon is per-vault: a demo/test vault can be deployed with a short one (floored by
    /// ABSOLUTE_MIN_HORIZON) without touching a production vault's 1-hour-minimum bytecode.
    function test_minHorizonIsPerVaultAndFloored() public {
        EuthynaVault.Params memory p = _params();
        p.minHorizon = 2 minutes;
        vm.prank(owner);
        EuthynaVault demo = factory.createVaultWithParams(agent, p);
        usdc.mint(address(demo), 1_000 * U);

        vm.prank(agent);
        vm.expectRevert(EuthynaVault.BadHorizon.selector); // below the demo vault's own 2-minute floor
        demo.sweep(10 * U, 1 minutes, H);

        vm.prank(agent);
        uint32 cid = demo.sweep(10 * U, 2 minutes, H); // allowed here, would revert on the 1-hour `vault`
        assertEq(cid, 1);

        p.minHorizon = 30 seconds; // below ABSOLUTE_MIN_HORIZON
        vm.expectRevert(EuthynaVault.BadParam.selector);
        factory.createVaultWithParams(agent, p);
    }

    function test_materializeRecurring() public {
        vm.prank(owner);
        uint32 rid = vault.addRecurring(alice, 15 * U, 1 days, uint64(block.timestamp + 10 days));
        vm.expectRevert(EuthynaVault.NotDueYet.selector);
        vault.materializeRecurring(rid);

        vm.warp(block.timestamp + 4 days);
        vm.prank(rando);
        uint32 id = vault.materializeRecurring(rid);
        EuthynaVault.Obligation memory o = vault.getObligation(id);
        assertEq(uint8(o.source), uint8(EuthynaVault.Source.OWNER));
        assertEq(o.amount, 15 * U);
        assertEq(vault.getRecurring(rid).nextDueAt, o.dueAt + 1 days);

        // Missed occurrences are skipped, not created in the past.
        vm.warp(block.timestamp + 30 days);
        uint32 id2 = vault.materializeRecurring(rid);
        assertGt(vault.getObligation(id2).dueAt, block.timestamp);
    }

    function test_factoryTracksVaults() public {
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultsOf(owner)[0], address(vault));
        assertEq(vault.owner(), owner);
        assertEq(vault.agent(), agent);
    }
}

/// Reentrancy on pay and withdraw, using a token that calls back into the recipient.
contract ReentrancyTest is Test {
    HookUSDC token;
    EuthynaVault v;
    Attacker atk;

    function test_payAndWithdrawAreNonReentrant() public {
        vm.warp(1_760_000_000);
        token = new HookUSDC();
        atk = new Attacker();
        v = new EuthynaVault(
            IERC20(address(token)),
            address(atk),
            address(atk),
            EuthynaVault.Params(25e6, 20_000, 1_000e6, 3_000e6, 0, 1 hours, 10 minutes, 1 hours)
        );
        token.mint(address(v), 1_000e6);
        atk.setVault(v);

        atk.addSelfAsPayee();
        vm.warp(block.timestamp + 10 minutes);
        uint32 id1 = atk.registerBill(10e6, "a");
        atk.registerBill(10e6, "b");

        atk.setMode(1); // re-enter pay
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        atk.pay(id1);

        atk.setMode(2); // re-enter withdraw
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        atk.withdraw(10e6);
    }
}

contract Attacker {
    EuthynaVault public v;
    uint8 public mode;

    function setVault(EuthynaVault v_) external {
        v = v_;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function addSelfAsPayee() external {
        v.addPayee(address(this), 100e6, 1_000e6);
    }

    function registerBill(uint128 amount, string calldata inv) external returns (uint32) {
        return v.registerObligation(address(this), amount, uint64(block.timestamp + 1 days), keccak256(bytes(inv)));
    }

    function pay(uint32 id) external {
        v.pay(id, bytes32(0));
    }

    function withdraw(uint128 amount) external {
        v.withdraw(amount);
    }

    function onTokenReceived() external {
        if (mode == 1) {
            mode = 0;
            v.pay(2, bytes32(0));
        } else if (mode == 2) {
            mode = 0;
            v.withdraw(1e6);
        }
    }
}
