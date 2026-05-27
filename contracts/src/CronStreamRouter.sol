// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {ICronStream}   from "./ICronStream.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable}       from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20}         from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}      from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA}          from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";


contract CronStreamRouter is ICronStream, AccessControl, Pausable {
    using SafeERC20 for IERC20;



    // Roles
    bytes32 public constant AGENT_MANAGER_ROLE = keccak256("AGENT_MGR");
    bytes32 public constant FEE_MANAGER_ROLE   = keccak256("FEE_MGR");
    bytes32 public constant PAUSER_ROLE        = keccak256("PAUSER");



  bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

  bytes32 private constant EXTENSION_VOUCHER_TYPEHASH = keccak256("ExtensionVoucher(bytes32 streamId,uint256 extensionDurationSeconds,uint256 nonce,uint256 expiry)");

   // EIP-712
  bytes32 private immutable DOMAIN_SEPARATOR;




     // Protocol params (mutable via roles)
    address public agentSigner;
    uint256 public feeBps;
    address public feeRecipient;
    uint256  public constant  MAX_FEE_BPS = 500 ;

    //streams
    mapping(bytes32 => Stream) public streams;
    mapping(address => uint256) public streamNonces;



 struct Stream {
        address sender;           // Corporate payroll wallet funding the stream
        address recipient;        // Target wallet address of the active contractor
        address token;            // Contract address of the ERC-20 stablecoin asset
        uint256 ratePerSecond;    // Token velocity amount allocated per elapsed second
        uint256 startTime;        // Initialization block timestamp
        uint256 streamValidUntil; // Safety time-lock validation ceiling timestamp
        uint256 totalDeposited;   // Gross stablecoin financing injected (all periods)
        uint256 totalWithdrawn;   // Cumulative assets claimed by the contractor
        uint256 nonce;            // Incremental index for EIP-712 transaction tracking
        // ── Locked-start / multi-period accounting ──────────────────────────────
        // earnedSnapshot: tokens earned across ALL completed windows so far.
        //   Updated on each re-extension (when the agent closes a dead gap and starts
        //   a new window). Prevents dead time between expiry and re-extension from
        //   being counted as earned time.
        uint256 earnedSnapshot;
        // lastWindowStart: timestamp when the current earning window began.
        //   Set to startTime on creation; reset to block.timestamp whenever the
        //   agent extends an already-expired stream (opens a fresh window).
        uint256 lastWindowStart;
    }


  constructor(address _agentSigner, uint256 _feeBps, address
  _feeRecipient, address _admin) {
      agentSigner  = _agentSigner;
      feeBps       = _feeBps;
      feeRecipient = _feeRecipient;

      _grantRole(DEFAULT_ADMIN_ROLE, _admin);
      _grantRole(AGENT_MANAGER_ROLE, _admin);
      _grantRole(FEE_MANAGER_ROLE,   _admin);
      _grantRole(PAUSER_ROLE,        _admin);

      DOMAIN_SEPARATOR = keccak256(abi.encode(
          DOMAIN_TYPEHASH,
          keccak256(bytes("CronStream")),
          keccak256(bytes("1")),
          block.chainid,
          address(this)
      ));
  }



modifier onlyAgentManager() {
    _onlyAgentManager();
    _;
}

function _onlyAgentManager() internal view {
    require(hasRole(AGENT_MANAGER_ROLE, msg.sender), "Caller is not an agent manager");
}

modifier onlyFeeManager() {
    _onlyFeeManager();
    _;
}

function _onlyFeeManager() internal view {
    require(hasRole(FEE_MANAGER_ROLE, msg.sender), "Caller is not a fee manager");
}



//events
    event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond);
    event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce);
    event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee);
    event AgentSignerUpdated(address oldSigner, address newSigner);
    event FeeBpsUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event UnspentFundsReclaimed(bytes32 indexed streamId, address indexed sender, uint256 amount);

//errors
  error StreamDoesNotExist();
  error StreamAlreadyExists();
  error SafetyWindowExpired();
  error InvalidCryptographicSignature();
  error UnderflowWithdrawalLimit();
  error VoucherExpired();
  error FeeBpsExceedsMax();
  error ZeroAddress();
  error NotRecipient();
  error NotSender();
  error StreamStillActive();
  error NothingToReclaim();
  error InsufficientDeposit();


    /// @notice Create a new payment stream from the caller (company) to a contractor.
    /// @dev    Locked-start model: pass initialDurationSeconds = 0 to create a stream that
    ///         earns nothing until the agent issues the first extension voucher. The full
    ///         multi-period budget is deposited upfront via depositAmount.
    ///
    ///         Legacy single-window: pass initialDurationSeconds > 0 and
    ///         depositAmount = ratePerSecond * initialDurationSeconds for the original behaviour.
    ///
    /// @param recipient               Contractor wallet.
    /// @param token                   ERC-20 token to stream (e.g. USDC).
    /// @param ratePerSecond           Token units released per second.
    /// @param initialDurationSeconds  First window length in seconds. Pass 0 for locked start
    ///                                (stream earns nothing until first agent extension).
    /// @param depositAmount           Total tokens to lock in the contract. Must be ≥
    ///                                ratePerSecond × initialDurationSeconds.
    ///                                For a locked-start multi-period stream this is
    ///                                ratePerSecond × windowSeconds × numberOfPeriods.
    /// @return streamId               Unique bytes32 identifier for this stream.

    function createStream(
        address recipient,
        address token,
        uint256 ratePerSecond,
        uint256 initialDurationSeconds,
        uint256 depositAmount
    ) external override whenNotPaused returns (bytes32 streamId) {
        require(recipient   != address(0), "Recipient cannot be zero address");
        require(token       != address(0), "Token cannot be zero address");
        require(ratePerSecond > 0,         "Rate per second must be greater than zero");
        require(depositAmount > 0,         "Deposit amount must be greater than zero");
        // depositAmount must cover at least the initial window so the balance cap holds
        require(
            depositAmount >= ratePerSecond * initialDurationSeconds,
            "Deposit must cover initial window"
        );

        uint256 nonce = streamNonces[msg.sender];
        streamId = keccak256(abi.encodePacked(
            msg.sender,
            recipient,
            token,
            nonce
        ));
        streamNonces[msg.sender]++;

        if (streams[streamId].sender != address(0)) revert StreamAlreadyExists();

        uint256 startTime        = block.timestamp;
        uint256 streamValidUntil = startTime + initialDurationSeconds;

        // Balance-delta pattern — credit what physically arrived, not what was requested.
        uint256 balanceBefore  = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), depositAmount);
        uint256 actualDeposited = IERC20(token).balanceOf(address(this)) - balanceBefore;

        streams[streamId] = Stream({
            sender:          msg.sender,
            recipient:       recipient,
            token:           token,
            ratePerSecond:   ratePerSecond,
            startTime:       startTime,
            streamValidUntil: streamValidUntil,
            totalDeposited:  actualDeposited,
            totalWithdrawn:  0,
            nonce:           0,
            earnedSnapshot:  0,
            lastWindowStart: startTime
        });

        emit StreamCreated(streamId, msg.sender, recipient, ratePerSecond);
        return streamId;
    }



    /// @notice Extend (or reactivate) a stream using an agent-signed EIP-712 voucher.
    /// @dev    Two modes depending on whether the stream is currently active or expired:
    ///
    ///         ACTIVE  (block.timestamp < streamValidUntil):
    ///           Standard extension — adds extensionDurationSeconds to streamValidUntil.
    ///           The earning window continues uninterrupted; no snapshot update needed.
    ///
    ///         EXPIRED (block.timestamp ≥ streamValidUntil) — locked-start / next period:
    ///           1. Snapshot the tokens earned in the just-closed window:
    ///                earnedSnapshot += (streamValidUntil - lastWindowStart) × ratePerSecond
    ///           2. Reset lastWindowStart = block.timestamp  (new window begins NOW)
    ///           3. Set streamValidUntil  = block.timestamp + extensionDurationSeconds
    ///           This ensures dead time between expiry and re-extension is never counted
    ///           as earned — the contractor only earns during verified-open windows.
    ///
    ///         Nonce replay protection: each successful extension increments s.nonce, so
    ///         previously used vouchers are permanently invalidated.
    ///
    /// @param streamId                  Stream to extend or reactivate.
    /// @param extensionDurationSeconds  Seconds to add to the current (or new) window.
    /// @param expiry                    Unix timestamp after which the voucher is stale.
    /// @param signature                 65-byte EIP-712 signature from agentSigner.

    function extendStreamWindowWithSignature(
        bytes32 streamId,
        uint256 extensionDurationSeconds,
        uint256 expiry,
        bytes calldata signature
    ) external whenNotPaused {
        Stream storage s = streams[streamId];
        if (s.sender == address(0)) revert StreamDoesNotExist();
        if (block.timestamp > expiry) revert VoucherExpired();

        // Verify EIP-712 signature — nonce is stream-specific to prevent cross-stream replay
        bytes32 structHash = keccak256(abi.encode(
            EXTENSION_VOUCHER_TYPEHASH,
            streamId,
            extensionDurationSeconds,
            s.nonce,
            expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ECDSA.recover(digest, signature);
        if (signer != agentSigner) revert InvalidCryptographicSignature();

        if (block.timestamp >= s.streamValidUntil) {
            // ── Expired / locked-start: snapshot closed window, open fresh one ──────
            // Tokens earned during the window that just closed (or zero for locked start).
            uint256 windowEarned = (s.streamValidUntil - s.lastWindowStart) * s.ratePerSecond;
            // Cap so earnedSnapshot never exceeds totalDeposited.
            // Cannot use (totalDeposited - totalWithdrawn - earnedSnapshot) here because
            // totalWithdrawn can exceed earnedSnapshot when the contractor withdrew from
            // an active window (those earnings haven't been snapshotted yet).
            uint256 maxEarnable = s.totalDeposited - s.earnedSnapshot;
            if (windowEarned > maxEarnable) windowEarned = maxEarnable;

            s.earnedSnapshot  += windowEarned;
            s.lastWindowStart  = block.timestamp;           // new window starts now
            s.streamValidUntil = block.timestamp + extensionDurationSeconds;
        } else {
            // ── Active: straightforward extension, window is continuous ─────────────
            s.streamValidUntil += extensionDurationSeconds;
        }

        s.nonce++;
        emit StreamExtended(streamId, s.streamValidUntil, s.nonce);
    }


    /// @notice Contractor withdraws accrued tokens from an active or expired stream.
    /// @dev Only the stream recipient may call this. A protocol fee (feeBps) is deducted
    ///      and sent to feeRecipient before the remainder reaches the contractor.
    ///      Uses CEI: totalWithdrawn updated before any external token transfers.
    /// @param streamId  The stream to withdraw from.
    /// @param amount    Token amount to withdraw (must not exceed available balance).

    function withdrawFromStream(bytes32 streamId, uint256 amount) external whenNotPaused {
        Stream storage s = streams[streamId];
        if (s.sender == address(0)) revert StreamDoesNotExist();
        if (msg.sender != s.recipient) revert NotRecipient();
        uint256 availableToWithdraw = _balanceOf(streamId);
        if (amount > availableToWithdraw) revert UnderflowWithdrawalLimit();

        uint256 protocolFee  = (amount * feeBps) / 10000;
        uint256 amountAfterFee = amount - protocolFee;

        // CEI — state before transfers
        s.totalWithdrawn += amount;

        if (protocolFee > 0) {
            IERC20(s.token).safeTransfer(feeRecipient, protocolFee);
        }
        IERC20(s.token).safeTransfer(s.recipient, amountAfterFee);

        emit WithdrawalExecuted(streamId, s.recipient, amountAfterFee, protocolFee);
    }



    /// @notice Company reclaims unearned tokens after a stream has naturally expired.
    /// @param streamId  The expired stream to reclaim funds from.

    function reclaimUnearned(bytes32 streamId) external {
      Stream storage s = streams[streamId];

      if (msg.sender != s.sender) revert NotSender();
      if (block.timestamp < s.streamValidUntil) revert StreamStillActive();

      uint256 earned   = _balanceOf(streamId) + s.totalWithdrawn;
      uint256 unearned = s.totalDeposited - earned;
      if (unearned == 0) revert NothingToReclaim();
      s.totalDeposited -= unearned;

      IERC20(s.token).safeTransfer(s.sender, unearned);
      emit UnspentFundsReclaimed(streamId, s.sender, unearned);
  }

    /// @notice Company cancels an active stream early, recovering unearned budget.
    /// @dev Freezes the stream at the current block by setting streamValidUntil = now.
    ///      The contractor retains the right to withdraw whatever was earned up to
    ///      this point via withdrawFromStream.
    /// @param streamId  The active stream to cancel.

    function cancelStream(bytes32 streamId) external {
      Stream storage s = streams[streamId];

      if (msg.sender != s.sender) revert NotSender();
      if (block.timestamp >= s.streamValidUntil) revert SafetyWindowExpired();

      s.streamValidUntil = block.timestamp;

      uint256 earned   = _balanceOf(streamId) + s.totalWithdrawn;
      uint256 unearned = s.totalDeposited - earned;

      s.totalDeposited -= unearned;

      IERC20(s.token).safeTransfer(s.sender, unearned);
      emit UnspentFundsReclaimed(streamId, s.sender, unearned);
  }


  /// @notice Compute the withdrawable token balance for a stream at the current block.
  /// @dev    Uses earnedSnapshot + current-window accrual so gaps between periods are
  ///         never counted as earned time. Result is capped at (totalDeposited - totalWithdrawn).
  /// @param streamId  Stream to query.
  /// @return  Token units currently available for withdrawal.

  function _balanceOf(bytes32 streamId) internal view returns (uint256) {
      Stream storage s = streams[streamId];

      // Clamp to window ceiling — earnings stop at streamValidUntil
      uint256 effectiveNow = block.timestamp < s.streamValidUntil
          ? block.timestamp
          : s.streamValidUntil;

      // Tokens earned in the CURRENT window only (since last window reset)
      uint256 windowEarned = (effectiveNow - s.lastWindowStart) * s.ratePerSecond;

      // Total earned = all closed windows + current window
      uint256 totalEarned = s.earnedSnapshot + windowEarned;

      // Cap at what was actually deposited
      uint256 deposited = s.totalDeposited;
      if (totalEarned > deposited) totalEarned = deposited;

      return totalEarned - s.totalWithdrawn;
  }



  /// @notice Returns the withdrawable balance for a stream (public view).
  function balanceOf(bytes32 streamId) external view returns (uint256) {
      if (streams[streamId].sender == address(0)) revert StreamDoesNotExist();
      return _balanceOf(streamId);
  }




//utility
  function setAgentSigner(address newSigner) onlyAgentManager external {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = agentSigner;
        agentSigner = newSigner;
        emit AgentSignerUpdated(oldSigner, newSigner);
  }

    function setFeeRecipient(address newRecipient) onlyFeeManager external {
      if (newRecipient == address(0)) revert ZeroAddress();
      address oldRecipient = feeRecipient;
      feeRecipient = newRecipient;
      emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    function setFeeBps(uint256 newFeeBps) onlyFeeManager external {
      if (newFeeBps > MAX_FEE_BPS) revert FeeBpsExceedsMax();
      uint256 oldFeeBps = feeBps;
      feeBps = newFeeBps;
      emit FeeBpsUpdated(oldFeeBps, newFeeBps);
    }


    // ─── Circuit breaker ──────────────────────────────────────────────────────

    /// @notice Pause createStream, extendStreamWindowWithSignature, and withdrawFromStream.
    /// @dev cancelStream and reclaimUnearned remain active so companies can always
    ///      reclaim unspent funds during an emergency.
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }

    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
}
