// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EuthynaVault
/// @notice Holds a business's USDC. An AI agent can pay allowlisted payees and park idle cash in an
///         internal reserve, but only within an autonomous limit that moves with its settled track record.
///         Hits add to the score linearly; a miss halves it.
/// @dev All amounts are USDC ERC-20 units (6 decimals). Never reads address(this).balance.
contract EuthynaVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum Source { OWNER, AGENT }
    enum OStatus { PENDING, ESCALATED, PAID, CANCELLED }

    struct Payee {
        bool allowed;
        uint64 activeAt;
        uint128 maxPerInvoice;
        uint128 maxPerMonth;
        uint128 monthSpent;
        uint64 monthStart;
    }

    struct Obligation {
        address payee;
        uint128 amount;
        uint64 dueAt;
        uint64 paidAt;
        bytes32 ref;
        Source source;
        OStatus status;
        bool escalated; // ever escalated: excluded from scoring unless failedForLiquidity
        bool failedForLiquidity;
    }

    struct Commitment {
        uint128 amount;
        uint128 remaining;
        uint64 openedAt;
        uint64 T;
        uint64 lastUpdate;
        uint32 coverTo;
        uint128 limitAtOpen;
        uint256 capitalSeconds;
        bytes32 decisionHash;
        bool settled;
        bool hit;
        uint128 credit;
    }

    struct Recurring {
        address payee;
        uint128 amount;
        uint64 everySeconds;
        uint64 nextDueAt;
        bool active;
    }

    struct Params {
        uint128 baseLimit; // autonomous limit at score 0
        uint32 rateBps; // limit added per unit of score, in bps (20000 = 2x)
        uint128 ownerCeiling;
        uint128 ownerDailyCeiling;
        uint128 minLiquid; // floor sweeps must leave liquid
        uint64 grace; // seconds after dueAt that still count as on time
        uint64 payeeDelay; // seconds before a new payee goes live
    }

    // -------------------------------------------------------------- constants

    uint64 public constant MIN_HORIZON = 1 hours;
    uint64 public constant MAX_HORIZON = 14 days;
    uint64 public constant MIN_PAYEE_DELAY = 10 minutes;
    uint64 public constant MISS_COOLDOWN = 24 hours;
    uint64 public constant CREDIT_PERIOD = 30 days;
    uint64 public constant MONTH = 30 days;
    uint64 public constant RECURRING_LOOKAHEAD = 7 days;
    uint64 public constant MIN_RECURRING_PERIOD = 1 hours;
    uint256 public constant MAX_OPEN_COMMITMENTS = 5;
    uint256 public constant MAX_SETTLE_IN_RANGE = 200;

    // ---------------------------------------------------------------- storage

    IERC20 public immutable usdc;
    address public owner;
    address public agent;
    bool public paused;

    uint128 public baseLimit;
    uint32 public rateBps;
    uint128 public ownerCeiling;
    uint128 public ownerDailyCeiling;
    uint128 public minLiquid;
    uint64 public grace;
    uint64 public payeeDelay;

    uint256 public score; // USDC units
    uint64 public cooldownUntil;
    uint128 public reserve; // internal reserve bucket (Plan B)
    uint128 public dailySpent;
    uint64 public dayStart;

    mapping(address => Payee) internal _payees;
    mapping(uint32 => Obligation) internal _obligations; // ids start at 1
    uint32 public obligationCount;
    mapping(bytes32 => bool) public refUsed;

    mapping(uint32 => Commitment) internal _commitments; // ids start at 1
    uint32 public commitmentCount;
    uint32[] internal _openCids; // unsettled, oldest first

    mapping(uint32 => Recurring) internal _recurring; // ids start at 1
    uint32 public recurringCount;

    // ----------------------------------------------------------------- events

    event PayeeAdded(address indexed payee, uint128 maxPerInvoice, uint128 maxPerMonth, uint64 activeAt);
    event PayeeRemoved(address indexed payee);
    event CeilingsSet(uint128 ownerCeiling, uint128 ownerDailyCeiling);
    event FloorSet(uint128 minLiquid);
    event PayeeDelaySet(uint64 payeeDelay);
    event AgentChanged(address indexed previous, address indexed agent);
    event Paused(bool paused);
    event RecurringAdded(uint32 indexed rid, address indexed payee, uint128 amount, uint64 everySeconds, uint64 firstDueAt);
    event RecurringStopped(uint32 indexed rid);
    event ObligationRegistered(
        uint32 indexed id, address indexed payee, uint128 amount, uint64 dueAt, bytes32 ref, Source source, bytes32 decisionHash
    );
    event ObligationCancelled(uint32 indexed id);
    event Paid(uint32 indexed id, address indexed payee, uint128 amount, address by, bytes32 decisionHash);
    event Escalated(uint32 indexed id, bytes32 decisionHash);
    event EscalationApproved(uint32 indexed id, bool paid, bool failedForLiquidity);
    event Swept(uint32 indexed cid, uint128 amount, uint64 T, uint32 coverTo, uint128 limitAtOpen, bytes32 decisionHash);
    event Redeemed(uint128 amount, address by, bytes32 decisionHash);
    event Settled(uint32 indexed cid, bool hit, uint256 credit, uint256 newScore, uint256 newLimit);
    event Withdrawn(uint128 amount);

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotAgent();
    error NotOwnerOrAgent();
    error IsPaused();
    error ZeroAddress();
    error ZeroAmount();
    error PayeeNotAllowed();
    error PayeeNotActive();
    error OverInvoiceCap();
    error OverMonthCap();
    error RefUsed();
    error DueInPast();
    error BadObligation();
    error BadStatus();
    error OverLimit();
    error OverDailyCap();
    error InsufficientLiquid();
    error NotEscalatable();
    error InCooldown();
    error TooManyOpen();
    error BelowFloor();
    error BadHorizon();
    error OverReserve();
    error NotMatured();
    error AlreadySettled();
    error BadCommitment();
    error ScanTooLarge();
    error BadRecurring();
    error NotDueYet();
    error BadParam();

    // -------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent || agent == address(0)) revert NotAgent();
        _;
    }

    modifier onlyOwnerOrAgent() {
        if (msg.sender != owner && (msg.sender != agent || agent == address(0))) revert NotOwnerOrAgent();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ------------------------------------------------------------ constructor

    constructor(IERC20 usdc_, address owner_, address agent_, Params memory p) {
        if (address(usdc_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (p.payeeDelay < MIN_PAYEE_DELAY) revert BadParam();
        usdc = usdc_;
        owner = owner_;
        agent = agent_;
        baseLimit = p.baseLimit;
        rateBps = p.rateBps;
        ownerCeiling = p.ownerCeiling;
        ownerDailyCeiling = p.ownerDailyCeiling;
        minLiquid = p.minLiquid;
        grace = p.grace;
        payeeDelay = p.payeeDelay;
        dayStart = uint64(block.timestamp);
        emit AgentChanged(address(0), agent_);
    }

    // ================================================================== owner

    function addPayee(address p, uint128 maxPerInvoice, uint128 maxPerMonth) external onlyOwner {
        if (p == address(0) || p == address(this)) revert ZeroAddress();
        Payee storage py = _payees[p];
        uint64 activeAt = uint64(block.timestamp) + payeeDelay;
        // Re-adding an already-live payee only changes its caps; it does not restart the delay.
        if (!py.allowed || py.activeAt > activeAt) py.activeAt = activeAt;
        py.allowed = true;
        py.maxPerInvoice = maxPerInvoice;
        py.maxPerMonth = maxPerMonth;
        if (py.monthStart == 0) py.monthStart = uint64(block.timestamp);
        emit PayeeAdded(p, maxPerInvoice, maxPerMonth, py.activeAt);
    }

    function removePayee(address p) external onlyOwner {
        _payees[p].allowed = false;
        emit PayeeRemoved(p);
    }

    function setCeilings(uint128 ownerCeiling_, uint128 ownerDailyCeiling_) external onlyOwner {
        ownerCeiling = ownerCeiling_;
        ownerDailyCeiling = ownerDailyCeiling_;
        emit CeilingsSet(ownerCeiling_, ownerDailyCeiling_);
    }

    function setFloor(uint128 minLiquid_) external onlyOwner {
        minLiquid = minLiquid_;
        emit FloorSet(minLiquid_);
    }

    function setPayeeDelay(uint64 payeeDelay_) external onlyOwner {
        if (payeeDelay_ < MIN_PAYEE_DELAY) revert BadParam();
        payeeDelay = payeeDelay_;
        emit PayeeDelaySet(payeeDelay_);
    }

    /// @notice address(0) revokes the agent.
    function setAgent(address agent_) external onlyOwner {
        emit AgentChanged(agent, agent_);
        agent = agent_;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    function addRecurring(address payee, uint128 amount, uint64 everySeconds, uint64 firstDueAt)
        external
        onlyOwner
        returns (uint32 rid)
    {
        if (!_payees[payee].allowed) revert PayeeNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (everySeconds < MIN_RECURRING_PERIOD) revert BadParam();
        if (firstDueAt <= block.timestamp) revert DueInPast();
        rid = ++recurringCount;
        _recurring[rid] = Recurring(payee, amount, everySeconds, firstDueAt, true);
        emit RecurringAdded(rid, payee, amount, everySeconds, firstDueAt);
    }

    function stopRecurring(uint32 rid) external onlyOwner {
        _recurring[rid].active = false;
        emit RecurringStopped(rid);
    }

    /// @notice Owner-set bill. Counts toward the agent's credit.
    function registerObligation(address payee, uint128 amount, uint64 dueAt, bytes32 ref)
        external
        onlyOwner
        returns (uint32 id)
    {
        if (!_payees[payee].allowed) revert PayeeNotAllowed();
        id = _register(payee, amount, dueAt, ref, Source.OWNER, bytes32(0));
    }

    /// @notice Owner withdraws a bill (wrong amount, blocklisted payee, ...). Cancelled bills are never scored.
    function cancelObligation(uint32 id) external onlyOwner {
        Obligation storage o = _obl(id);
        if (o.status != OStatus.PENDING && o.status != OStatus.ESCALATED) revert BadStatus();
        o.status = OStatus.CANCELLED;
        emit ObligationCancelled(id);
    }

    /// @notice Owner co-signs a bill the agent escalated. Never reverts for lack of cash: that is recorded
    ///         as failedForLiquidity, which counts as a miss against the agent.
    function approveEscalation(uint32 id) external onlyOwner nonReentrant {
        Obligation storage o = _obl(id);
        if (o.status != OStatus.ESCALATED) revert BadStatus();
        if (liquid() < o.amount) {
            o.failedForLiquidity = true;
            emit EscalationApproved(id, false, true);
            return;
        }
        o.status = OStatus.PAID;
        o.paidAt = uint64(block.timestamp);
        usdc.safeTransfer(o.payee, o.amount);
        emit EscalationApproved(id, true, false);
        emit Paid(id, o.payee, o.amount, msg.sender, bytes32(0));
    }

    /// @notice Always sends to the owner.
    function withdraw(uint128 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (liquid() < amount) revert InsufficientLiquid();
        usdc.safeTransfer(owner, amount);
        emit Withdrawn(amount);
    }

    // ================================================================== agent

    /// @notice Agent-registered bill (e.g. from an invoice). Can be paid, never earns credit.
    function agentRegisterObligation(address payee, uint128 amount, uint64 dueAt, bytes32 ref, bytes32 decisionHash)
        external
        onlyAgent
        whenNotPaused
        returns (uint32 id)
    {
        Payee storage py = _payees[payee];
        if (!py.allowed) revert PayeeNotAllowed();
        if (block.timestamp < py.activeAt) revert PayeeNotActive();
        if (amount > py.maxPerInvoice) revert OverInvoiceCap();
        _rollMonth(py);
        if (uint256(py.monthSpent) + amount > py.maxPerMonth) revert OverMonthCap();
        py.monthSpent += amount;
        id = _register(payee, amount, dueAt, ref, Source.AGENT, decisionHash);
    }

    /// @notice Pays an obligation to its own payee. The agent is bound by the autonomous limit and daily cap;
    ///         the owner is not.
    function pay(uint32 id, bytes32 decisionHash) external onlyOwnerOrAgent nonReentrant {
        Obligation storage o = _obl(id);
        if (o.status != OStatus.PENDING) revert BadStatus();
        Payee storage py = _payees[o.payee];
        if (!py.allowed) revert PayeeNotAllowed();
        if (block.timestamp < py.activeAt) revert PayeeNotActive();
        if (liquid() < o.amount) revert InsufficientLiquid();

        if (msg.sender != owner) {
            if (paused) revert IsPaused();
            if (o.amount > autonomousLimit()) revert OverLimit();
            _rollDay();
            if (uint256(dailySpent) + o.amount > dailyCap()) revert OverDailyCap();
            dailySpent += o.amount;
        }

        o.status = OStatus.PAID;
        o.paidAt = uint64(block.timestamp);
        usdc.safeTransfer(o.payee, o.amount);
        emit Paid(id, o.payee, o.amount, msg.sender, decisionHash);
    }

    /// @notice Hands a bill to the owner. Only allowed when the agent genuinely cannot pay it itself,
    ///         otherwise escalating would be a way to dodge scoring.
    function escalate(uint32 id, bytes32 decisionHash) external onlyAgent {
        Obligation storage o = _obl(id);
        if (o.status != OStatus.PENDING) revert BadStatus();
        _rollDay();
        bool overLimit = o.amount > autonomousLimit();
        bool overDaily = uint256(dailySpent) + o.amount > dailyCap();
        if (!overLimit && !overDaily) revert NotEscalatable();
        o.status = OStatus.ESCALATED;
        o.escalated = true;
        emit Escalated(id, decisionHash);
    }

    /// @notice Moves idle cash into the reserve and opens a commitment: every eligible owner bill due in
    ///         (now, now + horizon] will be paid on time from liquid cash.
    function sweep(uint128 amount, uint64 horizon, bytes32 decisionHash)
        external
        onlyAgent
        whenNotPaused
        returns (uint32 cid)
    {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < cooldownUntil) revert InCooldown();
        if (_openCids.length >= MAX_OPEN_COMMITMENTS) revert TooManyOpen();
        if (horizon < MIN_HORIZON || horizon > MAX_HORIZON) revert BadHorizon();
        uint256 liq = liquid();
        if (liq < amount || liq - amount < minLiquid) revert BelowFloor();

        reserve += amount;
        cid = ++commitmentCount;
        uint64 nowTs = uint64(block.timestamp);
        uint128 limit = uint128(autonomousLimit());
        Commitment storage c = _commitments[cid];
        c.amount = amount;
        c.remaining = amount;
        c.openedAt = nowTs;
        c.T = nowTs + horizon;
        c.lastUpdate = nowTs;
        c.coverTo = obligationCount;
        c.limitAtOpen = limit;
        c.decisionHash = decisionHash;
        _openCids.push(cid);
        emit Swept(cid, amount, c.T, c.coverTo, limit, decisionHash);
    }

    // ========================================================= owner or agent

    /// @notice Pulls cash back from the reserve, newest open commitment first. Never a failure; the
    ///         drawn commitment just stops accruing capital-seconds on what was drawn.
    function redeem(uint128 amount, bytes32 decisionHash) external onlyOwnerOrAgent {
        if (amount == 0) revert ZeroAmount();
        if (amount > reserve) revert OverReserve();
        uint128 left = amount;
        for (uint256 i = _openCids.length; i > 0 && left > 0; i--) {
            Commitment storage c = _commitments[_openCids[i - 1]];
            if (c.remaining == 0) continue;
            _accrue(c);
            uint128 take = c.remaining < left ? c.remaining : left;
            c.remaining -= take;
            left -= take;
        }
        // Every reserved unit belongs to an open commitment, so left is always 0 here.
        reserve -= amount;
        emit Redeemed(amount, msg.sender, decisionHash);
    }

    // ================================================================= anyone

    /// @notice Turns the next occurrence of an owner recurring schedule into an OWNER obligation once it is
    ///         due within 7 days. Occurrences already in the past are skipped, never created as instant misses.
    function materializeRecurring(uint32 rid) external returns (uint32 id) {
        Recurring storage r = _recurring[rid];
        if (!r.active) revert BadRecurring();
        uint64 nowTs = uint64(block.timestamp);
        for (uint256 i = 0; r.nextDueAt <= nowTs; i++) {
            if (i >= 100) revert BadRecurring();
            r.nextDueAt += r.everySeconds;
        }
        if (r.nextDueAt > nowTs + RECURRING_LOOKAHEAD) revert NotDueYet();
        if (!_payees[r.payee].allowed) revert PayeeNotAllowed();
        uint64 dueAt = r.nextDueAt;
        r.nextDueAt += r.everySeconds;
        id = _register(r.payee, r.amount, dueAt, keccak256(abi.encode(address(this), rid, dueAt)), Source.OWNER, bytes32(0));
    }

    /// @notice Grades a matured commitment from contract state alone. Permissionless.
    function settle(uint32 cid) external {
        Commitment storage c = _commitments[cid];
        if (c.openedAt == 0) revert BadCommitment();
        if (c.settled) revert AlreadySettled();
        // Wait out the grace period so bills due right at T can still be judged fairly.
        if (block.timestamp < uint256(c.T) + grace) revert NotMatured();

        _accrue(c);

        bool miss;
        uint256 paidInWindow;
        uint256 inRange;
        for (uint32 id = 1; id <= c.coverTo; id++) {
            Obligation storage o = _obligations[id];
            if (o.dueAt <= c.openedAt || o.dueAt > c.T) continue;
            if (++inRange > MAX_SETTLE_IN_RANGE) revert ScanTooLarge();
            if (o.source != Source.OWNER || o.status == OStatus.CANCELLED) continue;
            if (o.failedForLiquidity) {
                miss = true;
                continue;
            }
            // Bills above the limit, or handed to the owner, waited on the owner: not the agent's fault.
            if (o.amount > c.limitAtOpen || o.escalated) continue;
            if (o.status == OStatus.PAID && o.paidAt <= uint256(o.dueAt) + grace) {
                paidInWindow += o.amount;
            } else {
                miss = true;
            }
        }

        uint256 credit;
        if (miss) {
            score = score / 2;
            cooldownUntil = uint64(block.timestamp) + MISS_COOLDOWN;
        } else {
            uint256 duration = c.T - c.openedAt;
            uint256 avgHeld = c.capitalSeconds / duration;
            uint256 base = avgHeld < paidInWindow ? avgHeld : paidInWindow;
            credit = (base * duration) / CREDIT_PERIOD;
            score += credit;
        }

        c.settled = true;
        c.hit = !miss;
        c.credit = uint128(credit);
        // The commitment is over: release what is still parked back to liquid.
        reserve -= c.remaining;
        c.remaining = 0;
        _removeOpen(cid);

        emit Settled(cid, !miss, credit, score, autonomousLimit());
    }

    // ================================================================== views

    function liquid() public view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        return bal > reserve ? bal - reserve : 0;
    }

    function autonomousLimit() public view returns (uint256) {
        uint256 earned = uint256(baseLimit) + (score * rateBps) / 10_000;
        return earned < ownerCeiling ? earned : ownerCeiling;
    }

    function dailyCap() public view returns (uint256) {
        uint256 three = 3 * autonomousLimit();
        return three < ownerDailyCeiling ? three : ownerDailyCeiling;
    }

    /// @notice dailySpent as it would be after a day roll-over.
    function currentDailySpent() external view returns (uint256) {
        return block.timestamp >= uint256(dayStart) + 1 days ? 0 : dailySpent;
    }

    function getPayee(address p) external view returns (Payee memory) {
        return _payees[p];
    }

    function getObligation(uint32 id) external view returns (Obligation memory) {
        return _obligations[id];
    }

    function getCommitment(uint32 cid) external view returns (Commitment memory) {
        return _commitments[cid];
    }

    function getRecurring(uint32 rid) external view returns (Recurring memory) {
        return _recurring[rid];
    }

    function openCommitmentIds() external view returns (uint32[] memory) {
        return _openCids;
    }

    /// @notice Capital-seconds a commitment would have if accrued now (capped at T).
    function pendingCapitalSeconds(uint32 cid) external view returns (uint256) {
        Commitment storage c = _commitments[cid];
        uint256 t = block.timestamp < c.T ? block.timestamp : c.T;
        if (t <= c.lastUpdate) return c.capitalSeconds;
        return c.capitalSeconds + uint256(c.remaining) * (t - c.lastUpdate);
    }

    // =============================================================== internal

    function _register(address payee, uint128 amount, uint64 dueAt, bytes32 ref, Source source, bytes32 decisionHash)
        internal
        returns (uint32 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (dueAt <= block.timestamp) revert DueInPast();
        if (refUsed[ref]) revert RefUsed();
        refUsed[ref] = true;
        id = ++obligationCount;
        Obligation storage o = _obligations[id];
        o.payee = payee;
        o.amount = amount;
        o.dueAt = dueAt;
        o.ref = ref;
        o.source = source;
        emit ObligationRegistered(id, payee, amount, dueAt, ref, source, decisionHash);
    }

    function _obl(uint32 id) internal view returns (Obligation storage o) {
        if (id == 0 || id > obligationCount) revert BadObligation();
        o = _obligations[id];
    }

    function _accrue(Commitment storage c) internal {
        uint64 t = block.timestamp < c.T ? uint64(block.timestamp) : c.T;
        if (t > c.lastUpdate) {
            c.capitalSeconds += uint256(c.remaining) * (t - c.lastUpdate);
            c.lastUpdate = t;
        }
    }

    function _rollDay() internal {
        if (block.timestamp >= uint256(dayStart) + 1 days) {
            dayStart = uint64(block.timestamp);
            dailySpent = 0;
        }
    }

    function _rollMonth(Payee storage py) internal {
        if (block.timestamp >= uint256(py.monthStart) + MONTH) {
            py.monthStart = uint64(block.timestamp);
            py.monthSpent = 0;
        }
    }

    function _removeOpen(uint32 cid) internal {
        uint256 n = _openCids.length;
        for (uint256 i = 0; i < n; i++) {
            if (_openCids[i] == cid) {
                for (uint256 j = i; j + 1 < n; j++) {
                    _openCids[j] = _openCids[j + 1];
                }
                _openCids.pop();
                return;
            }
        }
    }
}
