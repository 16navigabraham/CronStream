// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {CronStreamRouter} from "../src/CronStreamRouter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock Token ───────────────────────────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @dev ERC-20 that burns `TAX_BPS` basis points on every transfer.
contract MockFeeToken is ERC20 {
    uint256 public immutable TAX_BPS;

    constructor(uint256 taxBps) ERC20("Fee Token", "FEE") {
        TAX_BPS = taxBps;
    }

    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 tax      = (value * TAX_BPS) / 10_000;
        uint256 afterTax = value - tax;
        super._update(from, to, afterTax);
        super._update(from, address(0), tax);
    }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

contract CronStreamTest is Test {

    // ── Contracts ─────────────────────────────────────────────────────────────
    CronStreamRouter router;
    MockUSDC         usdc;

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin        = makeAddr("admin");
    address company      = makeAddr("company");
    address contractor   = makeAddr("contractor");
    address feeRecipient = makeAddr("feeRecipient");
    address attacker     = makeAddr("attacker");

    // ── Agent signer ──────────────────────────────────────────────────────────
    uint256 constant AGENT_PRIV_KEY = 0xA11CE;
    address agentSigner;

    // ── Default stream params ─────────────────────────────────────────────────
    uint256 constant RATE     = 1e6;   // 1 USDC/second (6 decimals)
    uint256 constant DURATION = 86400; // 24 hours
    uint256 constant FEE_BPS  = 50;    // 0.5%

    // ── EIP-712 ───────────────────────────────────────────────────────────────
    bytes32 DOMAIN_SEPARATOR;

    bytes32 constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 constant VOUCHER_TYPEHASH = keccak256(
        "ExtensionVoucher(bytes32 streamId,uint256 extensionDurationSeconds,uint256 nonce,uint256 expiry)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        agentSigner = vm.addr(AGENT_PRIV_KEY);

        router = new CronStreamRouter(agentSigner, FEE_BPS, feeRecipient, admin);
        usdc   = new MockUSDC();

        usdc.mint(company, 100_000_000e6);
        vm.prank(company);
        usdc.approve(address(router), type(uint256).max);

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("CronStream")),
            keccak256(bytes("1")),
            block.chainid,
            address(router)
        ));
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Legacy single-window stream (initialDuration > 0, deposit = rate * duration)
    function _createStream() internal returns (bytes32) {
        return _createStreamWith(contractor, RATE, DURATION);
    }

    function _createStreamWith(
        address _recipient,
        uint256 _rate,
        uint256 _duration
    ) internal returns (bytes32) {
        uint256 deposit = _rate * _duration;
        vm.prank(company);
        return router.createStream(_recipient, address(usdc), _rate, _duration, deposit);
    }

    /// Locked-start stream: initialDuration = 0, deposit covers N periods.
    function _createLockedStream(uint256 numPeriods) internal returns (bytes32) {
        uint256 deposit = RATE * DURATION * numPeriods;
        vm.prank(company);
        return router.createStream(contractor, address(usdc), RATE, 0, deposit);
    }

    function _signVoucher(
        bytes32 streamId,
        uint256 extensionDuration,
        uint256 nonce,
        uint256 expiry,
        uint256 privKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            streamId,
            extensionDuration,
            nonce,
            expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _extend(bytes32 streamId) internal {
        _extendBy(streamId, DURATION);
    }

    function _extendBy(bytes32 streamId, uint256 extDuration) internal {
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, extDuration, nonce, expiry, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, extDuration, expiry, sig);
    }

    function _totalDeposited(uint256 rate, uint256 duration) internal pure returns (uint256) {
        return rate * duration;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. createStream — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_createStream_happy() public {
        uint256 deposit  = _totalDeposited(RATE, DURATION);
        uint256 companyBalBefore = usdc.balanceOf(company);

        bytes32 streamId = _createStream();

        (
            address sender, address recipient, address token,
            uint256 ratePerSecond, uint256 startTime, uint256 streamValidUntil,
            uint256 totalDeposited, uint256 totalWithdrawn, uint256 nonce,
            uint256 earnedSnapshot, uint256 lastWindowStart
        ) = router.streams(streamId);

        assertEq(sender,           company,                    "sender");
        assertEq(recipient,        contractor,                 "recipient");
        assertEq(token,            address(usdc),              "token");
        assertEq(ratePerSecond,    RATE,                       "rate");
        assertEq(startTime,        block.timestamp,            "startTime");
        assertEq(streamValidUntil, block.timestamp + DURATION, "validUntil");
        assertEq(totalDeposited,   deposit,                    "totalDeposited");
        assertEq(totalWithdrawn,   0,                          "totalWithdrawn");
        assertEq(nonce,            0,                          "nonce starts at 0");
        assertEq(earnedSnapshot,   0,                          "earnedSnapshot zero at start");
        assertEq(lastWindowStart,  block.timestamp,            "lastWindowStart = startTime");

        assertEq(usdc.balanceOf(company),          companyBalBefore - deposit, "company balance");
        assertEq(usdc.balanceOf(address(router)),  deposit,                    "router holds deposit");
    }

    function test_createStream_lockedStart_happy() public {
        uint256 periods = 5;
        uint256 deposit = RATE * DURATION * periods;
        uint256 companyBalBefore = usdc.balanceOf(company);

        bytes32 streamId = _createLockedStream(periods);

        (
            , , ,
            , uint256 startTime, uint256 streamValidUntil,
            uint256 totalDeposited, , ,
            uint256 earnedSnapshot, uint256 lastWindowStart
        ) = router.streams(streamId);

        // Locked start: streamValidUntil = startTime (immediate expiry)
        assertEq(streamValidUntil, startTime,          "locked: validUntil = startTime");
        assertEq(totalDeposited,   deposit,             "full deposit locked");
        assertEq(earnedSnapshot,   0,                   "nothing earned yet");
        assertEq(lastWindowStart,  startTime,           "window clock starts at creation");

        assertEq(usdc.balanceOf(company),         companyBalBefore - deposit, "company paid full deposit");
        assertEq(usdc.balanceOf(address(router)), deposit,                    "router holds full deposit");
    }

    function test_createStream_lockedStart_balanceIsZero() public {
        bytes32 streamId = _createLockedStream(3);

        // No time has passed — but even if it does, nothing earns until first extension
        vm.warp(block.timestamp + DURATION * 10);
        assertEq(router.balanceOf(streamId), 0, "locked: contractor earns nothing before first extension");
    }

    function test_createStream_emitsEvent() public {
        bytes32 expected = keccak256(abi.encodePacked(company, contractor, address(usdc), uint256(0)));

        vm.expectEmit(true, true, true, true);
        emit CronStreamRouter.StreamCreated(expected, company, contractor, RATE);

        _createStream();
    }

    function test_createStream_nonce_increments() public {
        _createStream();
        assertEq(router.streamNonces(company), 1);
        _createStream();
        assertEq(router.streamNonces(company), 2);
    }

    function test_createStream_revert_zeroRecipient() public {
        vm.prank(company);
        vm.expectRevert("Recipient cannot be zero address");
        router.createStream(address(0), address(usdc), RATE, DURATION, RATE * DURATION);
    }

    function test_createStream_revert_zeroToken() public {
        vm.prank(company);
        vm.expectRevert("Token cannot be zero address");
        router.createStream(contractor, address(0), RATE, DURATION, RATE * DURATION);
    }

    function test_createStream_revert_zeroRate() public {
        vm.prank(company);
        vm.expectRevert("Rate per second must be greater than zero");
        router.createStream(contractor, address(usdc), 0, DURATION, RATE * DURATION);
    }

    function test_createStream_revert_zeroDeposit() public {
        vm.prank(company);
        vm.expectRevert("Deposit amount must be greater than zero");
        router.createStream(contractor, address(usdc), RATE, DURATION, 0);
    }

    function test_createStream_revert_depositBelowInitialWindow() public {
        // Deposit must cover at least the initial window
        vm.prank(company);
        vm.expectRevert("Deposit must cover initial window");
        router.createStream(contractor, address(usdc), RATE, DURATION, RATE * DURATION - 1);
    }

    function test_createStream_multipleStreams_sameRecipient() public {
        bytes32 id1 = _createStream();
        bytes32 id2 = _createStream();
        assertTrue(id1 != id2, "stream IDs must be unique");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. extendStreamWindowWithSignature — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_extend_happy_activeStream() public {
        bytes32 streamId = _createStream();
        (, , , , , uint256 validUntilBefore, , , uint256 nonceBefore, ,) = router.streams(streamId);

        _extend(streamId);

        (, , , , , uint256 validUntilAfter, , , uint256 nonceAfter, ,) = router.streams(streamId);
        assertEq(validUntilAfter, validUntilBefore + DURATION, "validUntil extended");
        assertEq(nonceAfter, nonceBefore + 1,                  "nonce incremented");
    }

    function test_extend_expiredStream_reactivates() public {
        // Locked-start: stream is already expired at creation — extension should work
        bytes32 streamId = _createLockedStream(3);

        // Warp past the locked expiry
        vm.warp(block.timestamp + 10);

        uint256 extendAt = block.timestamp;
        _extend(streamId);

        (, , , , , uint256 validUntilAfter, , , uint256 nonceAfter, , uint256 lastWindowStart) = router.streams(streamId);
        assertEq(validUntilAfter,  extendAt + DURATION, "reactivated: validUntil = now + window");
        assertEq(nonceAfter,       1,                   "nonce incremented");
        assertEq(lastWindowStart,  extendAt,            "window clock reset to extension time");
    }

    function test_extend_expiredStream_gapTimeNotEarned() public {
        // Contractor does nothing → stream expires.
        // Company should be able to reclaim without being robbed.
        // After re-extension the gap is not counted as earned.
        bytes32 streamId = _createLockedStream(3);

        // Warp far past expiry — simulates contractor doing nothing
        vm.warp(block.timestamp + DURATION * 100);
        assertEq(router.balanceOf(streamId), 0, "no earnings during dead gap");

        // Agent verifies and extends (period 1 begins now)
        uint256 extendAt = block.timestamp;
        _extend(streamId);

        // One second into period 1
        vm.warp(block.timestamp + 1);
        assertEq(router.balanceOf(streamId), RATE * 1, "only 1 second of period 1 earned");

        // Full period 1 elapsed
        vm.warp(extendAt + DURATION);
        assertEq(router.balanceOf(streamId), RATE * DURATION, "exactly one period earned, gap excluded");
    }

    function test_extend_lockedStart_firstExtensionUnlocksEarning() public {
        bytes32 streamId = _createLockedStream(2);

        // Before any extension: zero balance no matter how much time passes
        vm.warp(block.timestamp + DURATION);
        assertEq(router.balanceOf(streamId), 0, "still locked before first extension");

        // Agent verifies period 1
        uint256 extendAt = block.timestamp;
        _extend(streamId);

        // Half way through period 1
        vm.warp(extendAt + DURATION / 2);
        assertEq(router.balanceOf(streamId), RATE * (DURATION / 2), "earning during period 1");

        // Contractor can withdraw
        uint256 earned = router.balanceOf(streamId);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);
        assertEq(router.balanceOf(streamId), 0, "zero after withdrawal");
    }

    function test_extend_multiPeriod_correctAccounting() public {
        bytes32 streamId = _createLockedStream(3);
        uint256 totalDeposit = RATE * DURATION * 3;

        // Period 1 opens
        uint256 p1Start = block.timestamp + 10;
        vm.warp(p1Start);
        _extend(streamId); // period 1 starts now

        // Period 1 ends, contractor withdraws
        vm.warp(p1Start + DURATION);
        uint256 earned1 = router.balanceOf(streamId);
        assertEq(earned1, RATE * DURATION, "period 1: full window earned");

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned1);

        // Gap before period 2
        vm.warp(p1Start + DURATION + 5000); // 5000s of dead time
        assertEq(router.balanceOf(streamId), 0, "gap: nothing earned");

        // Period 2 opens
        uint256 p2Start = block.timestamp;
        _extend(streamId);

        vm.warp(p2Start + DURATION / 2);
        assertEq(router.balanceOf(streamId), RATE * (DURATION / 2), "period 2: half window earned");

        // Total withdrawn so far = period 1 earnings
        // Total deposited still = 3 * period
        (, , , , , , uint256 deposited, uint256 withdrawn, , ,) = router.streams(streamId);
        assertEq(deposited,  totalDeposit,        "totalDeposited unchanged");
        assertEq(withdrawn,  RATE * DURATION,     "only period 1 withdrawn so far");
    }

    function test_extend_emitsEvent() public {
        bytes32 streamId = _createStream();
        (, , , , , uint256 validUntil, , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry  = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.expectEmit(true, false, false, true);
        emit CronStreamRouter.StreamExtended(streamId, validUntil + DURATION, nonce + 1);

        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_streamDoesNotExist() public {
        bytes32 fakeId = keccak256("fake");
        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(fakeId, DURATION, 0, expiry, AGENT_PRIV_KEY);

        vm.expectRevert(CronStreamRouter.StreamDoesNotExist.selector);
        router.extendStreamWindowWithSignature(fakeId, DURATION, expiry, sig);
    }

    function test_extend_revert_voucherExpired() public {
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry = block.timestamp + 100;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.warp(block.timestamp + 200); // past voucher expiry

        vm.expectRevert(CronStreamRouter.VoucherExpired.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_invalidSignature_wrongKey() public {
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, 0xBAD);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_replayAttack() public {
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_multipleExtensions() public {
        bytes32 streamId = _createStream();
        (, , , , , uint256 initialValidUntil, , , , ,) = router.streams(streamId);

        _extend(streamId);
        _extend(streamId);
        _extend(streamId);

        (, , , , , uint256 finalValidUntil, , , uint256 nonce, ,) = router.streams(streamId);
        assertEq(finalValidUntil, initialValidUntil + (DURATION * 3), "3 extensions applied");
        assertEq(nonce,           3,                                   "nonce is 3");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. balanceOf — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_balanceOf_zeroAtStart() public {
        bytes32 streamId = _createStream();
        assertEq(router.balanceOf(streamId), 0, "nothing earned at t=0");
    }

    function test_balanceOf_accrues_linearly() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + 1000);
        assertEq(router.balanceOf(streamId), RATE * 1000, "earned = rate x elapsed");
    }

    function test_balanceOf_freezes_at_expiry() public {
        bytes32 streamId = _createStream();

        uint256 expectedEarned = RATE * DURATION;

        vm.warp(block.timestamp + DURATION + 9999);
        assertEq(router.balanceOf(streamId), expectedEarned, "capped at totalDeposited");
    }

    function test_balanceOf_reducedAfterWithdrawal() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned = router.balanceOf(streamId);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        assertEq(router.balanceOf(streamId), 0, "balance zero after full withdrawal");
    }

    function test_balanceOf_revert_streamDoesNotExist() public {
        vm.expectRevert(CronStreamRouter.StreamDoesNotExist.selector);
        router.balanceOf(keccak256("nonexistent"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. withdrawFromStream — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_withdraw_happy() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned          = router.balanceOf(streamId);
        uint256 expectedFee     = (earned * FEE_BPS) / 10000;
        uint256 expectedPayout  = earned - expectedFee;

        uint256 contractorBefore   = usdc.balanceOf(contractor);
        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        assertEq(usdc.balanceOf(contractor)   - contractorBefore,   expectedPayout, "contractor payout");
        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee,    "fee collected");
    }

    function test_withdraw_emitsEvent() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned         = router.balanceOf(streamId);
        uint256 expectedFee    = (earned * FEE_BPS) / 10000;
        uint256 expectedPayout = earned - expectedFee;

        vm.expectEmit(true, true, false, true);
        emit CronStreamRouter.WithdrawalExecuted(streamId, contractor, expectedPayout, expectedFee);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);
    }

    function test_withdraw_partial_multiple_times() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 10000);

        uint256 earned = router.balanceOf(streamId);
        uint256 chunk  = earned / 3;

        vm.startPrank(contractor);
        router.withdrawFromStream(streamId, chunk);
        router.withdrawFromStream(streamId, chunk);
        router.withdrawFromStream(streamId, chunk);
        vm.stopPrank();

        assertLe(router.balanceOf(streamId), earned - (chunk * 3) + 1);
    }

    function test_withdraw_afterStreamExpires() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION + 9999);

        uint256 earned = router.balanceOf(streamId);
        assertGt(earned, 0, "should have earned something");

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        assertEq(router.balanceOf(streamId), 0, "balance zero after withdrawal");
    }

    function test_withdraw_lockedStart_zeroBeforeExtension() public {
        bytes32 streamId = _createLockedStream(3);

        vm.warp(block.timestamp + DURATION);

        uint256 bal = router.balanceOf(streamId);
        assertEq(bal, 0, "locked: nothing to withdraw before first extension");

        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.UnderflowWithdrawalLimit.selector);
        router.withdrawFromStream(streamId, 1);
    }

    function test_withdraw_zeroFee_when_feeBpsZero() public {
        CronStreamRouter zeroFeeRouter = new CronStreamRouter(agentSigner, 0, feeRecipient, admin);
        usdc.mint(company, 1_000_000e6);
        vm.prank(company);
        usdc.approve(address(zeroFeeRouter), type(uint256).max);

        vm.prank(company);
        uint256 deposit = RATE * DURATION;
        bytes32 streamId = zeroFeeRouter.createStream(contractor, address(usdc), RATE, DURATION, deposit);

        vm.warp(block.timestamp + 1000);
        uint256 earned             = zeroFeeRouter.balanceOf(streamId);
        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        zeroFeeRouter.withdrawFromStream(streamId, earned);

        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, 0,      "no fee collected");
        assertEq(usdc.balanceOf(contractor),                         earned, "full amount to contractor");
    }

    function test_withdraw_revert_streamDoesNotExist() public {
        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.StreamDoesNotExist.selector);
        router.withdrawFromStream(keccak256("fake"), 1);
    }

    function test_withdraw_revert_notRecipient() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.NotRecipient.selector);
        router.withdrawFromStream(streamId, 100);
    }

    function test_withdraw_revert_overLimit() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned = router.balanceOf(streamId);

        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.UnderflowWithdrawalLimit.selector);
        router.withdrawFromStream(streamId, earned + 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. reclaimUnearned — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_reclaim_lockedStart_fullDepositReturned() public {
        // Locked-start stream, no extension ever — company reclaims everything
        bytes32 streamId = _createLockedStream(5);
        uint256 deposit  = RATE * DURATION * 5;

        vm.warp(block.timestamp + 1); // stream is immediately expired on creation

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.reclaimUnearned(streamId);

        assertEq(usdc.balanceOf(company) - companyBefore, deposit, "full deposit returned if never activated");
    }

    function test_reclaim_revert_nothingToReclaim_fullDuration() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(company);
        vm.expectRevert(CronStreamRouter.NothingToReclaim.selector);
        router.reclaimUnearned(streamId);
    }

    function test_reclaim_revert_notSender() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.NotSender.selector);
        router.reclaimUnearned(streamId);
    }

    function test_reclaim_revert_streamStillActive() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION / 2);

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.StreamStillActive.selector);
        router.reclaimUnearned(streamId);
    }

    // ── cancelStream (early termination) ─────────────────────────────────────

    function test_cancel_fullRefund_zeroWorkDone() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        assertEq(usdc.balanceOf(company) - companyBefore, deposit, "full refund on instant cancel");
    }

    function test_cancel_partialRefund() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        vm.warp(block.timestamp + DURATION / 2);
        uint256 earned = router.balanceOf(streamId);

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        assertEq(usdc.balanceOf(company) - companyBefore, deposit - earned, "partial refund");
    }

    function test_cancel_afterContractorWithdraws() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        vm.warp(block.timestamp + DURATION / 2);
        uint256 earned = router.balanceOf(streamId);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        assertEq(usdc.balanceOf(company) - companyBefore, deposit - earned, "unearned returned");
    }

    function test_cancel_contractorCanStillWithdrawEarned() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION / 2);
        uint256 earnedBeforeCancel = router.balanceOf(streamId);

        vm.prank(company);
        router.cancelStream(streamId);

        assertEq(router.balanceOf(streamId), earnedBeforeCancel, "earned balance preserved");

        uint256 contractorBefore = usdc.balanceOf(contractor);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earnedBeforeCancel);

        assertGt(usdc.balanceOf(contractor) - contractorBefore, 0, "contractor paid out");
    }

    function test_cancel_revert_notSender() public {
        bytes32 streamId = _createStream();

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.NotSender.selector);
        router.cancelStream(streamId);
    }

    function test_cancel_revert_streamExpired() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.SafetyWindowExpired.selector);
        router.cancelStream(streamId);
    }

    function test_cancel_cannotCancelTwice() public {
        bytes32 streamId = _createStream();

        vm.prank(company);
        router.cancelStream(streamId);

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.SafetyWindowExpired.selector);
        router.cancelStream(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Admin Functions — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_setAgentSigner_happy() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(admin);
        router.setAgentSigner(newSigner);
        assertEq(router.agentSigner(), newSigner);
    }

    function test_setAgentSigner_emitsEvent() public {
        address newSigner = makeAddr("newSigner");
        vm.expectEmit(false, false, false, true);
        emit CronStreamRouter.AgentSignerUpdated(agentSigner, newSigner);
        vm.prank(admin);
        router.setAgentSigner(newSigner);
    }

    function test_setAgentSigner_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.ZeroAddress.selector);
        router.setAgentSigner(address(0));
    }

    function test_setAgentSigner_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setAgentSigner(makeAddr("x"));
    }

    function test_setFeeBps_happy() public {
        vm.prank(admin);
        router.setFeeBps(100);
        assertEq(router.feeBps(), 100);
    }

    function test_setFeeBps_revert_exceedsMax() public {
        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.FeeBpsExceedsMax.selector);
        router.setFeeBps(501);
    }

    function test_setFeeBps_boundary_exactMax() public {
        vm.prank(admin);
        router.setFeeBps(500);
        assertEq(router.feeBps(), 500);
    }

    function test_setFeeBps_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setFeeBps(10);
    }

    function test_setFeeRecipient_happy() public {
        address newRecipient = makeAddr("newRecipient");
        vm.prank(admin);
        router.setFeeRecipient(newRecipient);
        assertEq(router.feeRecipient(), newRecipient);
    }

    function test_setFeeRecipient_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.ZeroAddress.selector);
        router.setFeeRecipient(address(0));
    }

    function test_setFeeRecipient_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setFeeRecipient(makeAddr("x"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Edge Cases
    // ─────────────────────────────────────────────────────────────────────────

    function test_edge_agentRotation_invalidatesOldVoucher() public {
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        uint256 newPrivKey = 0xB0B;
        address newSigner  = vm.addr(newPrivKey);
        vm.prank(admin);
        router.setAgentSigner(newSigner);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_edge_agentRotation_newVoucherWorks() public {
        bytes32 streamId = _createStream();

        uint256 newPrivKey = 0xB0B;
        address newSigner  = vm.addr(newPrivKey);
        vm.prank(admin);
        router.setAgentSigner(newSigner);

        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, newPrivKey);

        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);

        (, , , , , , , , uint256 newNonce, ,) = router.streams(streamId);
        assertEq(newNonce, 1, "extension succeeded with new signer");
    }

    function test_edge_feeChange_affectsNextWithdrawal() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 500);

        vm.prank(admin);
        router.setFeeBps(200);

        uint256 amount = router.balanceOf(streamId);
        uint256 newFee = (amount * 200) / 10000;

        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, amount);

        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, newFee, "new fee rate applied");
    }

    function test_edge_contractorEqualsCompany() public {
        usdc.mint(company, 1_000_000e6);
        vm.prank(company);
        usdc.approve(address(router), type(uint256).max);

        uint256 deposit = RATE * DURATION;
        vm.prank(company);
        bytes32 streamId = router.createStream(company, address(usdc), RATE, DURATION, deposit);

        vm.warp(block.timestamp + 1000);
        uint256 bal = router.balanceOf(streamId);

        vm.prank(company);
        router.withdrawFromStream(streamId, bal);
    }

    function test_edge_multipleCompanies_independentStreams() public {
        address company2 = makeAddr("company2");
        usdc.mint(company2, 1_000_000e6);
        vm.prank(company2);
        usdc.approve(address(router), type(uint256).max);

        bytes32 id1 = _createStream();

        uint256 deposit2 = RATE * 2 * DURATION;
        vm.prank(company2);
        bytes32 id2 = router.createStream(contractor, address(usdc), RATE * 2, DURATION, deposit2);

        assertTrue(id1 != id2, "different stream IDs");

        vm.warp(block.timestamp + 1000);
        assertEq(router.balanceOf(id1), RATE * 1000,     "stream 1 balance");
        assertEq(router.balanceOf(id2), RATE * 2 * 1000, "stream 2 balance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Fuzz Tests
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_createStream_depositAlwaysCorrect(
        uint256 rate,
        uint256 duration
    ) public {
        rate     = bound(rate,     1,    1e18);
        duration = bound(duration, 1,    365 days);

        uint256 expectedDeposit = rate * duration;
        if (expectedDeposit / rate != duration) return;
        if (expectedDeposit > usdc.balanceOf(company)) return;

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(usdc), rate, duration, expectedDeposit);

        (, , , , , , uint256 totalDeposited, , , ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedDeposit, "deposit always = rate * duration");
    }

    function testFuzz_balanceOf_neverExceedsDeposit(uint256 timeElapsed) public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        timeElapsed = bound(timeElapsed, 0, 10 * 365 days);
        vm.warp(block.timestamp + timeElapsed);

        assertLe(router.balanceOf(streamId), deposit, "balance never exceeds deposit");
    }

    function testFuzz_balanceOf_linearBeforeExpiry(uint256 elapsed) public {
        bytes32 streamId = _createStream();

        elapsed = bound(elapsed, 0, DURATION - 1);
        vm.warp(block.timestamp + elapsed);

        assertEq(router.balanceOf(streamId), RATE * elapsed, "linear accrual");
    }

    function testFuzz_withdraw_feeAlwaysCorrect(uint256 elapsed) public {
        bytes32 streamId = _createStream();

        elapsed = bound(elapsed, 1, DURATION);
        vm.warp(block.timestamp + elapsed);

        uint256 amount         = router.balanceOf(streamId);
        uint256 expectedFee    = (amount * FEE_BPS) / 10000;
        uint256 expectedPayout = amount - expectedFee;

        uint256 contractorBefore   = usdc.balanceOf(contractor);
        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, amount);

        assertEq(usdc.balanceOf(contractor)   - contractorBefore,   expectedPayout, "payout correct");
        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee,    "fee correct");
    }

    function testFuzz_withdraw_cannotExceedEarned(uint256 excess) public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned = router.balanceOf(streamId);
        excess = bound(excess, 1, type(uint128).max);

        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.UnderflowWithdrawalLimit.selector);
        router.withdrawFromStream(streamId, earned + excess);
    }

    function testFuzz_setFeeBps_maxEnforced(uint256 newBps) public {
        newBps = bound(newBps, 501, type(uint256).max);

        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.FeeBpsExceedsMax.selector);
        router.setFeeBps(newBps);
    }

    function testFuzz_extend_noncePreventsReplay(uint256 extensionDuration) public {
        bytes32 streamId = _createStream();

        extensionDuration = bound(extensionDuration, 1, 365 days);
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 7200;

        bytes memory sig = _signVoucher(streamId, extensionDuration, nonce, expiry, AGENT_PRIV_KEY);

        router.extendStreamWindowWithSignature(streamId, extensionDuration, expiry, sig);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, extensionDuration, expiry, sig);
    }

    function testFuzz_cancelStream_conservesTokens(uint256 workSeconds) public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        workSeconds = bound(workSeconds, 0, DURATION - 1);
        vm.warp(block.timestamp + workSeconds);

        uint256 earned = router.balanceOf(streamId);

        uint256 contractorBefore = usdc.balanceOf(contractor);
        uint256 companyBefore    = usdc.balanceOf(company);

        if (earned > 0) {
            vm.prank(contractor);
            router.withdrawFromStream(streamId, earned);
        }

        vm.prank(company);
        router.cancelStream(streamId);

        uint256 contractorReceived = usdc.balanceOf(contractor) - contractorBefore;
        uint256 companyReceived    = usdc.balanceOf(company)    - companyBefore;

        uint256 contractorFee = (earned * FEE_BPS) / 10000;
        assertEq(
            contractorReceived + companyReceived + contractorFee,
            deposit,
            "token conservation: contractor + company + fee = deposit"
        );
    }

    function testFuzz_lockedStart_gapNeverCounted(uint256 gapSeconds) public {
        // Whatever gap exists before the first extension, contractor earns nothing during it
        bytes32 streamId = _createLockedStream(1);

        gapSeconds = bound(gapSeconds, 1, 365 days);
        vm.warp(block.timestamp + gapSeconds);

        assertEq(router.balanceOf(streamId), 0, "no earnings during any gap length");

        // After extension, only counts from extension time
        uint256 extendAt = block.timestamp;
        _extend(streamId);

        vm.warp(extendAt + 1000);
        assertEq(router.balanceOf(streamId), RATE * 1000, "only seconds since extension counted");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. Integration Tests — Full Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    function test_integration_lockedStart_fullLifecycle() public {
        // 3-period contract: company locks 3 × 24h worth upfront
        // Period 1: contractor delivers → agent extends → contractor earns
        // Period 2: contractor delivers → agent extends → contractor earns
        // Period 3: contractor disappears → stream expires → company reclaims
        uint256 periods     = 3;
        uint256 fullDeposit = RATE * DURATION * periods;
        bytes32 streamId    = _createLockedStream(periods);

        assertEq(usdc.balanceOf(address(router)), fullDeposit, "full deposit locked on creation");
        assertEq(router.balanceOf(streamId), 0,                "zero earned before period 1 opens");

        // ── Period 1: agent verifies, opens window ────────────────────────────
        uint256 p1Start = block.timestamp + 100; // agent extends shortly after creation
        vm.warp(p1Start);
        _extend(streamId);

        vm.warp(p1Start + DURATION / 2);
        uint256 mid1 = router.balanceOf(streamId);
        assertEq(mid1, RATE * (DURATION / 2), "halfway through period 1");

        vm.warp(p1Start + DURATION); // end of period 1
        uint256 earned1 = router.balanceOf(streamId);
        assertEq(earned1, RATE * DURATION, "full period 1 earned");

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned1);

        // ── Gap between period 1 and period 2 ────────────────────────────────
        vm.warp(p1Start + DURATION + 5000); // 5000s of dead time
        assertEq(router.balanceOf(streamId), 0, "nothing earned in gap");

        // ── Period 2: agent verifies ──────────────────────────────────────────
        uint256 p2Start = block.timestamp;
        _extend(streamId);

        vm.warp(p2Start + DURATION);
        uint256 earned2 = router.balanceOf(streamId);
        assertEq(earned2, RATE * DURATION, "full period 2 earned");

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned2);

        // ── Period 3: contractor disappears — no extension ────────────────────
        vm.warp(p2Start + DURATION + 1); // period 2 window expires, no extension
        assertEq(router.balanceOf(streamId), 0, "period 3 never opened: zero earned");

        // Company reclaims remaining deposit (period 3 + any dust)
        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.reclaimUnearned(streamId);

        uint256 reclaimed = usdc.balanceOf(company) - companyBefore;
        // Should get back exactly 1 period worth (period 3 was never opened)
        assertEq(reclaimed, RATE * DURATION, "company reclaims period 3 deposit");

        console.log("Period 1 earned:", earned1);
        console.log("Period 2 earned:", earned2);
        console.log("Company reclaimed:", reclaimed);
        console.log("Total accounted:", earned1 + earned2 + reclaimed);
        assertEq(earned1 + earned2 + reclaimed, fullDeposit, "full deposit conserved (fees aside)");
    }

    function test_integration_legacySingleWindow_backwardsCompatible() public {
        // Legacy mode (initialDuration > 0) still works exactly as before
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        assertEq(usdc.balanceOf(address(router)), deposit, "deposit locked");

        vm.warp(block.timestamp + DURATION / 3);
        uint256 earned = router.balanceOf(streamId);
        assertEq(earned, RATE * (DURATION / 3), "linear accrual");

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        vm.warp(block.timestamp + DURATION); // past expiry
        vm.prank(company);
        vm.expectRevert(CronStreamRouter.SafetyWindowExpired.selector);
        router.cancelStream(streamId); // reverts — expired stream must use reclaimUnearned
    }

    function test_integration_continuousExtensions_contractorEarnsAll() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + DURATION - 1);
            _extend(streamId);
        }

        vm.warp(block.timestamp + DURATION);

        uint256 earned = router.balanceOf(streamId);
        assertEq(earned, deposit, "balance capped at totalDeposited across all windows");
    }

    function test_integration_companySenderProtected_cantWithdraw() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.NotRecipient.selector);
        router.withdrawFromStream(streamId, 100);
    }

    function test_integration_contractorProtected_cantReclaim() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.NotSender.selector);
        router.reclaimUnearned(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Pausable — Circuit Breaker Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_pause_happy() public {
        vm.prank(admin);
        router.pause();
        assertTrue(router.paused());
    }

    function test_unpause_happy() public {
        vm.prank(admin);
        router.pause();
        vm.prank(admin);
        router.unpause();
        assertFalse(router.paused());
    }

    function test_pause_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.pause();
    }

    function test_pause_blocks_createStream() public {
        vm.prank(admin);
        router.pause();

        vm.prank(company);
        vm.expectRevert();
        router.createStream(contractor, address(usdc), RATE, DURATION, RATE * DURATION);
    }

    function test_pause_blocks_withdrawFromStream() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(admin);
        router.pause();

        vm.prank(contractor);
        vm.expectRevert();
        router.withdrawFromStream(streamId, RATE * 1000);
    }

    function test_pause_blocks_extendStreamWindowWithSignature() public {
        bytes32 streamId = _createStream();

        vm.prank(admin);
        router.pause();

        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.expectRevert();
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_pause_allows_cancelStream() public {
        bytes32 streamId = _createStream();

        vm.prank(admin);
        router.pause();

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        assertGt(usdc.balanceOf(company) - companyBefore, 0, "cancel works while paused");
    }

    function test_pause_allows_reclaimUnearned() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(admin);
        router.pause();

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.NothingToReclaim.selector);
        router.reclaimUnearned(streamId);
    }

    function test_unpause_resumes_createStream() public {
        vm.prank(admin);
        router.pause();
        vm.prank(admin);
        router.unpause();

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(usdc), RATE, DURATION, RATE * DURATION);
        assertTrue(streamId != bytes32(0));
    }

    function test_unpause_resumes_withdrawFromStream() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(admin);
        router.pause();
        vm.prank(admin);
        router.unpause();

        uint256 bal = router.balanceOf(streamId);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, bal);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. Balance Delta Pattern — Fee-on-Transfer Token Tests
    // ─────────────────────────────────────────────────────────────────────────

    function _deployFeeToken(uint256 taxBps) internal returns (MockFeeToken feeToken) {
        feeToken = new MockFeeToken(taxBps);
        feeToken.mint(company, 100_000_000e18);
        vm.prank(company);
        feeToken.approve(address(router), type(uint256).max);
    }

    function test_balanceDelta_2pctTax_totalDepositedIsActualReceived() public {
        MockFeeToken feeToken = _deployFeeToken(200);

        uint256 intendedDeposit = RATE * DURATION;
        uint256 expectedActual  = intendedDeposit - (intendedDeposit * 200 / 10_000);

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION, intendedDeposit);

        (, , , , , , uint256 totalDeposited, , , ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedActual, "totalDeposited reflects actual received (98%)");
    }

    function test_balanceDelta_10pctTax_totalDepositedIsActualReceived() public {
        MockFeeToken feeToken = _deployFeeToken(1000);

        uint256 intendedDeposit = RATE * DURATION;
        uint256 expectedActual  = intendedDeposit - (intendedDeposit * 1000 / 10_000);

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION, intendedDeposit);

        (, , , , , , uint256 totalDeposited, , , ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedActual, "totalDeposited reflects actual received (90%)");
    }

    function test_balanceDelta_withdrawal_cappedAtActualDeposited() public {
        MockFeeToken feeToken = _deployFeeToken(200);

        uint256 intendedDeposit = RATE * DURATION;
        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION, intendedDeposit);

        (, , , , , , uint256 totalDeposited, , , ,) = router.streams(streamId);

        vm.warp(block.timestamp + DURATION + 9999);

        uint256 bal = router.balanceOf(streamId);
        assertEq(bal, totalDeposited, "balance capped at actual deposit");

        vm.prank(contractor);
        router.withdrawFromStream(streamId, bal);

        assertEq(router.balanceOf(streamId), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. Multi-period timing — 3rd / 4th extension accuracy
    // ─────────────────────────────────────────────────────────────────────────

    // Contractor earns 3 full periods, withdraws after each, earnings accumulate correctly.
    function test_extend_thirdExtension_earningsCorrect() public {
        bytes32 streamId = _createLockedStream(4);
        uint256 perPeriod = RATE * DURATION;

        // Period 1
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);
        assertEq(router.balanceOf(streamId), perPeriod, "p1 earned");
        vm.prank(contractor);
        router.withdrawFromStream(streamId, perPeriod);

        // Period 2
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);
        assertEq(router.balanceOf(streamId), perPeriod, "p2 earned");
        vm.prank(contractor);
        router.withdrawFromStream(streamId, perPeriod);

        // Period 3
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);
        assertEq(router.balanceOf(streamId), perPeriod, "p3 earned");
        vm.prank(contractor);
        router.withdrawFromStream(streamId, perPeriod);

        // Period 4 still locked — nothing earned yet
        assertEq(router.balanceOf(streamId), 0, "p4 locked until extension");
    }

    // After 3 verified periods the contractor stops. A gap of 2× the window elapses.
    // Agent eventually extends period 4 — gap time must NOT be counted.
    function test_extend_fourthPeriod_longGapAfterThird_gapNotCounted() public {
        bytes32 streamId = _createLockedStream(4);
        uint256 perPeriod = RATE * DURATION;

        // Periods 1-3: agent extends each, contractor withdraws each
        for (uint256 i = 0; i < 3; i++) {
            _extend(streamId);
            vm.warp(block.timestamp + DURATION);
            vm.prank(contractor);
            router.withdrawFromStream(streamId, perPeriod);
        }

        // Contractor stops working. 2 full windows of dead time elapse.
        vm.warp(block.timestamp + DURATION * 2);

        // Agent verifies period 4 eventually and extends
        _extend(streamId);

        // Only the new window's earnings count — not the dead gap
        vm.warp(block.timestamp + DURATION / 2);
        uint256 earned = router.balanceOf(streamId);
        assertEq(earned, RATE * (DURATION / 2), "only active window earns");
        assertLt(earned, perPeriod, "dead gap excluded");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Voucher security — contractor self-sign & stolen-key attacks
    // ─────────────────────────────────────────────────────────────────────────

    uint256 constant CONTRACTOR_PRIV_KEY = 0xC04C; // contractor's own key

    // Contractor tries to extend their own stream by signing with their own key.
    function test_extend_revert_contractorSelfSign() public {
        address contractorWithKey = vm.addr(CONTRACTOR_PRIV_KEY);
        usdc.mint(contractorWithKey, 0); // just register the address
        uint256 deposit = RATE * DURATION * 3;
        vm.prank(company);
        bytes32 streamId = router.createStream(contractorWithKey, address(usdc), RATE, 0, deposit);

        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;

        // Contractor signs with their OWN private key — not the agent's
        bytes memory badSig = _signVoucher(streamId, DURATION, nonce, expiry, CONTRACTOR_PRIV_KEY);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, badSig);
    }

    // Random attacker signs a voucher — rejected regardless of who calls it.
    function test_extend_revert_attackerSigns() public {
        bytes32 streamId = _createLockedStream(3);
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;

        uint256 ATTACKER_KEY = 0xDEADBEEF;
        bytes memory badSig = _signVoucher(streamId, DURATION, nonce, expiry, ATTACKER_KEY);

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, badSig);
    }

    // Contractor earned 3 milestones then stopped. Tries to replay a voucher
    // from an earlier period (nonce is now stale) — must fail.
    function test_extend_revert_staleVoucherAfterAbandonment() public {
        bytes32 streamId = _createLockedStream(4);

        // Periods 1-3 legitimately extended
        for (uint256 i = 0; i < 3; i++) {
            (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
            uint256 expiry = block.timestamp + 3600;
            bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);
            router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
            vm.warp(block.timestamp + DURATION);
        }

        // Capture a fresh nonce-3 voucher before contractor "abandons"
        (, , , , , , , , uint256 currentNonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 7200;
        bytes memory cachedSig = _signVoucher(streamId, DURATION, currentNonce, expiry, AGENT_PRIV_KEY);

        // Contractor stops. Agent legitimately extends period 4 — nonce bumps to 4.
        _extend(streamId);

        // Now contractor tries to replay the cached nonce-3 voucher
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, cachedSig);
    }

    // Worst case: contractor social-engineers the agent's private key.
    // They CAN extend once. But admin rotates the key — all future
    // vouchers signed with the stolen key are invalid.
    function test_extend_stolenAgentKey_rotationInvalidates() public {
        bytes32 streamId = _createLockedStream(4);

        // Periods 1-3 legit
        for (uint256 i = 0; i < 3; i++) {
            _extend(streamId);
            vm.warp(block.timestamp + DURATION);
            vm.prank(contractor);
            router.withdrawFromStream(streamId, RATE * DURATION);
        }

        // Contractor stops working, stream expires. They now have the stolen key
        // and attempt to self-extend period 4.
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;
        bytes memory stolenSig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        // Extension with stolen key succeeds — contract can't detect social engineering
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, stolenSig);

        // Admin detects the compromise and rotates the agent key immediately
        address newAgent    = makeAddr("newAgent");
        uint256 NEW_KEY     = 0xFEED;
        address newAgentAddr = vm.addr(NEW_KEY);
        vm.prank(admin);
        router.setAgentSigner(newAgentAddr);

        // Contractor tries to extend again with stolen old key — rejected
        (, , , , , , , , uint256 nonce2, ,) = router.streams(streamId);
        uint256 expiry2 = block.timestamp + 3600;
        bytes memory stolenSig2 = _signVoucher(streamId, DURATION, nonce2, expiry2, AGENT_PRIV_KEY);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry2, stolenSig2);

        // Legitimate new agent can still extend just fine
        bytes memory goodSig = _signVoucher(streamId, DURATION, nonce2, expiry2, NEW_KEY);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry2, goodSig);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. Revert atomicity — failed extension leaves state fully intact so agent
    //     can retry without re-deriving anything except possibly a fresh expiry
    // ─────────────────────────────────────────────────────────────────────────

    // Bad signature → revert. Stream state (nonce, validUntil, snapshot) unchanged.
    // Agent retries with correct signature using the SAME nonce — succeeds.
    function test_extend_revert_badSig_stateUnchanged_retrySucceeds() public {
        bytes32 streamId = _createLockedStream(2);

        (, , , , , uint256 validUntilBefore, , , uint256 nonceBefore, uint256 snapshotBefore,) = router.streams(streamId);

        // Bad sig attempt
        uint256 expiry  = block.timestamp + 3600;
        bytes memory badSig = _signVoucher(streamId, DURATION, nonceBefore, expiry, 0xBAD1);
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, badSig);

        // State must be completely unchanged
        (, , , , , uint256 validUntilAfter, , , uint256 nonceAfter, uint256 snapshotAfter,) = router.streams(streamId);
        assertEq(nonceAfter,    nonceBefore,    "nonce unchanged after revert");
        assertEq(validUntilAfter, validUntilBefore, "validUntil unchanged after revert");
        assertEq(snapshotAfter, snapshotBefore, "earnedSnapshot unchanged after revert");

        // Agent retries with correct sig, same nonce — must succeed
        bytes memory goodSig = _signVoucher(streamId, DURATION, nonceBefore, expiry, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, goodSig);
        (, , , , , , , , uint256 nonceSuccess, ,) = router.streams(streamId);
        assertEq(nonceSuccess, nonceBefore + 1, "nonce incremented only on success");
    }

    // Voucher expiry passes before the tx is mined. Agent re-signs with a fresh
    // expiry but the SAME nonce (nonce did not increment on the failed attempt).
    function test_extend_revert_expiredVoucher_agentResignsWithSameNonce() public {
        bytes32 streamId = _createLockedStream(2);
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        // Agent signs with tight expiry
        uint256 tightExpiry = block.timestamp + 10;
        bytes memory staleSig = _signVoucher(streamId, DURATION, nonce, tightExpiry, AGENT_PRIV_KEY);

        // Time passes — voucher expires before tx is included
        vm.warp(block.timestamp + 11);
        vm.expectRevert(CronStreamRouter.VoucherExpired.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, tightExpiry, staleSig);

        // Nonce still the same — agent re-signs with fresh expiry, same nonce
        (, , , , , , , , uint256 nonceAfterFail, ,) = router.streams(streamId);
        assertEq(nonceAfterFail, nonce, "nonce unchanged after expired voucher revert");

        uint256 freshExpiry = block.timestamp + 3600;
        bytes memory freshSig = _signVoucher(streamId, DURATION, nonce, freshExpiry, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, DURATION, freshExpiry, freshSig);

        (, , , , , , , , uint256 nonceAfterSuccess, ,) = router.streams(streamId);
        assertEq(nonceAfterSuccess, nonce + 1, "nonce incremented after successful retry");
    }

    // Replay attack mid-lifecycle: agent successfully extends period 1, an attacker
    // replays the period-1 voucher on period 2. Nonce mismatch → revert.
    // Agent's period-2 voucher (correct nonce) still works after the replay attempt.
    function test_extend_revert_replay_doesNotBlockLegitimateRetry() public {
        bytes32 streamId = _createLockedStream(3);
        (, , , , , , , , uint256 nonce0, ,) = router.streams(streamId);

        // Agent extends period 1 legitimately
        uint256 expiry1 = block.timestamp + 3600;
        bytes memory sig1 = _signVoucher(streamId, DURATION, nonce0, expiry1, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry1, sig1);

        // Attacker replays period-1 voucher — now nonce is 1, sig was for nonce 0
        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry1, sig1);

        // Stream state unchanged by replay attempt — agent extends period 2 normally
        vm.warp(block.timestamp + DURATION);
        (, , , , , , , , uint256 nonce1, ,) = router.streams(streamId);
        uint256 expiry2 = block.timestamp + 3600;
        bytes memory sig2 = _signVoucher(streamId, DURATION, nonce1, expiry2, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry2, sig2);

        (, , , , , , , , uint256 nonce2, ,) = router.streams(streamId);
        assertEq(nonce2, nonce0 + 2, "both legitimate extensions counted, replay ignored");
    }

    // Cross-chain scenario: same voucher bytes submitted on a different chain would
    // have a mismatched domain separator → signature fails. Simulated by using a
    // domain separator with a different chainId.
    function test_extend_revert_crossChainVoucher_domainMismatch() public {
        bytes32 streamId = _createLockedStream(2);
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;

        // Build a voucher signed for a different chainId
        bytes32 wrongDomain = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("CronStream")),
            keccak256(bytes("1")),
            block.chainid + 1,          // wrong chain
            address(router)
        ));
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, streamId, DURATION, nonce, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", wrongDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PRIV_KEY, digest);
        bytes memory wrongChainSig = abi.encodePacked(r, s, v);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, wrongChainSig);

        // Correct domain sig still works — state intact after bad attempt
        bytes memory goodSig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, goodSig);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 12. Cross-stream voucher — voucher for stream A cannot extend stream B
    // ─────────────────────────────────────────────────────────────────────────

    function test_extend_revert_voucherForWrongStream() public {
        bytes32 streamA = _createLockedStream(2);
        bytes32 streamB = _createLockedStream(2);

        // Sign a valid voucher for stream A
        (, , , , , , , , uint256 nonceA, ,) = router.streams(streamA);
        uint256 expiry = block.timestamp + 3600;
        bytes memory sigForA = _signVoucher(streamA, DURATION, nonceA, expiry, AGENT_PRIV_KEY);

        // Attempt to use it on stream B — streamId in the payload doesn't match
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamB, DURATION, expiry, sigForA);

        // Stream A still extends fine with its own voucher
        router.extendStreamWindowWithSignature(streamA, DURATION, expiry, sigForA);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 12. Mid-window partial withdrawal then extension — no double-counting
    // ─────────────────────────────────────────────────────────────────────────

    function test_extend_afterPartialWithdrawMidWindow_snapshotCorrect() public {
        bytes32 streamId = _createLockedStream(3);
        uint256 halfPeriod = RATE * (DURATION / 2);

        // Unlock period 1
        _extend(streamId);

        // Contractor withdraws halfway through the window
        vm.warp(block.timestamp + DURATION / 2);
        assertEq(router.balanceOf(streamId), halfPeriod, "half earned mid-window");
        vm.prank(contractor);
        router.withdrawFromStream(streamId, halfPeriod);

        // Period 1 fully elapses, then agent extends to period 2
        vm.warp(block.timestamp + DURATION / 2); // now at full DURATION since extension
        _extend(streamId);

        // Snapshot captured full period 1 (DURATION*RATE). totalWithdrawn = halfPeriod.
        // balanceOf = earnedSnapshot - totalWithdrawn = DURATION*RATE - halfPeriod = halfPeriod
        assertEq(router.balanceOf(streamId), halfPeriod, "undrawn p1 remainder still owed");

        // Period 2 runs fully — p1 remainder + full p2 available
        vm.warp(block.timestamp + DURATION);
        assertEq(router.balanceOf(streamId), halfPeriod + RATE * DURATION, "p1 remainder + full p2 earned");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 13. Deposit exhaustion — earned caps at totalDeposited
    // ─────────────────────────────────────────────────────────────────────────

    // Agent extends for a window far longer than remaining deposit covers.
    // Earnings must cap at totalDeposited, nothing more.
    function test_extend_depositExhausted_earningsCappedAtDeposit() public {
        bytes32 streamId = _createLockedStream(2); // 2 periods of deposit
        uint256 totalDeposit = RATE * DURATION * 2;

        // Extend for 100× the deposit capacity — way over budget
        _extendBy(streamId, DURATION * 100);
        vm.warp(block.timestamp + DURATION * 100);

        assertEq(router.balanceOf(streamId), totalDeposit, "balance capped at totalDeposited");
    }

    // After deposit is fully earned, a further extension earns zero.
    function test_extend_afterDepositExhausted_furtherExtensionEarnsZero() public {
        bytes32 streamId = _createLockedStream(2);

        // Earn both periods
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);

        uint256 earnedBeforeExtra = router.balanceOf(streamId);

        // Extend again — deposit is already fully earned
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);

        // earnedSnapshot should have been capped; no additional earnings
        assertEq(router.balanceOf(streamId), earnedBeforeExtra, "no new earnings after deposit exhausted");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 14. Reclaim after partial work — company recovers unearned exactly
    // ─────────────────────────────────────────────────────────────────────────

    function test_reclaimUnearned_afterTwoOfFourPeriods() public {
        bytes32 streamId = _createLockedStream(4);
        uint256 perPeriod = RATE * DURATION;

        // Agent verifies and contractor earns 2 periods
        _extend(streamId);
        vm.warp(block.timestamp + DURATION);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, perPeriod);

        _extend(streamId);
        vm.warp(block.timestamp + DURATION);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, perPeriod);

        // Contractor ghosts — stream expires, agent stops extending
        vm.warp(block.timestamp + 1); // ensure expired

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.reclaimUnearned(streamId);

        // Company gets back exactly 2 periods (the 2 unearned ones)
        assertEq(usdc.balanceOf(company) - companyBefore, perPeriod * 2, "2 unearned periods returned");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 15. Cancel locked stream before first extension — full refund
    // ─────────────────────────────────────────────────────────────────────────

    function test_cancel_lockedStream_beforeFirstExtension() public {
        bytes32 streamId = _createLockedStream(3);
        uint256 deposit = RATE * DURATION * 3;

        uint256 companyBefore = usdc.balanceOf(company);

        // Stream is locked (expired at start) — company cancels before agent ever acts
        // cancelStream requires stream to be active; locked stream is immediately expired, so reclaim instead
        vm.prank(company);
        router.reclaimUnearned(streamId);

        assertEq(usdc.balanceOf(company) - companyBefore, deposit, "full deposit returned before any work");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 16. Fee routing — fee actually lands at feeRecipient
    // ─────────────────────────────────────────────────────────────────────────

    function test_withdraw_feeTransferredToFeeRecipient() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION);

        uint256 withdrawAmount = RATE * DURATION;
        uint256 expectedFee    = (withdrawAmount * FEE_BPS) / 10_000;

        uint256 recipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, withdrawAmount);

        assertEq(usdc.balanceOf(feeRecipient) - recipientBefore, expectedFee, "fee at feeRecipient");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 17. Exact expiry boundary — block.timestamp == streamValidUntil
    // ─────────────────────────────────────────────────────────────────────────

    // At the exact boundary the expired branch must fire (condition is >=).
    function test_extend_atExactExpiryBoundary_takesExpiredBranch() public {
        bytes32 streamId = _createLockedStream(2);

        _extend(streamId); // opens period 1: streamValidUntil = T + DURATION

        // Warp to exactly streamValidUntil
        (, , , , , uint256 validUntil, , , , ,) = router.streams(streamId);
        vm.warp(validUntil); // block.timestamp == streamValidUntil

        // Extending now must snapshot period 1 (expired branch) and open period 2
        _extend(streamId);

        (, , , , , uint256 newValidUntil, , , , , uint256 newLastWindowStart) = router.streams(streamId);
        assertEq(newLastWindowStart, validUntil, "lastWindowStart = old expiry boundary");
        assertEq(newValidUntil, validUntil + DURATION, "new window starts from boundary");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 18. Voucher expiry boundary — expiry == block.timestamp passes; expiry < fails
    // ─────────────────────────────────────────────────────────────────────────

    function test_extend_voucherExpiryExactBoundary_passes() public {
        bytes32 streamId = _createLockedStream(2);
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry = block.timestamp; // exactly now
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        // expiry == block.timestamp — contract allows this (boundary is inclusive)
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_voucherExpiredOnePastBoundary() public {
        bytes32 streamId = _createLockedStream(2);
        (, , , , , , , , uint256 nonce, ,) = router.streams(streamId);

        uint256 expiry = block.timestamp - 1; // one second in the past
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.expectRevert(CronStreamRouter.VoucherExpired.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz tests
    // ─────────────────────────────────────────────────────────────────────────

    // Invariant: earnedSnapshot never exceeds totalDeposited under any sequence
    // of extensions and partial withdrawals.
    function testFuzz_multiPeriod_earnedSnapshotNeverExceedsDeposit(
        uint8 numPeriods,
        uint256 withdrawFraction
    ) public {
        numPeriods     = uint8(bound(numPeriods, 1, 8));
        withdrawFraction = bound(withdrawFraction, 0, 1e18);

        bytes32 streamId = _createLockedStream(numPeriods);

        for (uint256 i = 0; i < numPeriods; i++) {
            _extend(streamId);
            vm.warp(block.timestamp + DURATION);

            uint256 bal = router.balanceOf(streamId);
            if (bal > 0) {
                // Withdraw a random fraction of current balance
                uint256 withdrawAmt = (bal * withdrawFraction) / 1e18;
                if (withdrawAmt > 0) {
                    vm.prank(contractor);
                    router.withdrawFromStream(streamId, withdrawAmt);
                }
            }

            (, , , , , , uint256 totalDeposited, , , uint256 earnedSnapshot,) = router.streams(streamId);
            assertLe(earnedSnapshot, totalDeposited, "earnedSnapshot <= totalDeposited");
        }
    }

    function testFuzz_balanceDelta_taxBps(uint256 taxBps) public {
        taxBps = bound(taxBps, 0, 5000);

        MockFeeToken feeToken = _deployFeeToken(taxBps);

        uint256 intendedDeposit = RATE * DURATION;
        uint256 tax             = (intendedDeposit * taxBps) / 10_000;
        uint256 expectedActual  = intendedDeposit - tax;

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION, intendedDeposit);

        (, , , , , , uint256 totalDeposited, , , ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedActual);

        vm.warp(block.timestamp + DURATION + 1);
        assertLe(router.balanceOf(streamId), totalDeposited);
    }
}
