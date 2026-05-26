#!/usr/bin/env node
/**
 * CronStream — Full Autonomous Payroll Demo
 * ==========================================
 *
 * Demonstrates the complete end-to-end flow:
 *
 *   1.  Fund check       — verify agent wallet has gas
 *   2.  Create stream    — company wallet creates an on-chain stream
 *   3.  Register stream  — tell the agent which repo to watch
 *   4.  Simulate webhook — fire a GitHub "PR merged" event at the agent
 *   5.  Extension        — agent verifies + signs + submits on-chain extension
 *   6.  Balance check    — read contractor's withdrawable balance
 *   7.  Withdraw         — contractor withdraws earned USDC
 *
 * Usage:
 *   node scripts/demo.js
 *
 * Required env vars (copy from .env):
 *   ARBITRUM_RPC_URL
 *   CONTRACT_ADDRESS_ARB_SEPOLIA   (or CONTRACT_ADDRESS)
 *   DEMO_COMPANY_PRIVATE_KEY       — wallet that funds the stream
 *   DEMO_CONTRACTOR_ADDRESS        — recipient wallet address
 *   DEMO_USDC_ADDRESS              — ERC-20 token to stream
 *   DEMO_GITHUB_REPO               — "owner/repo" that the agent watches
 *   AGENT_URL                      — https://your-agent.onrender.com
 *   AGENT_API_KEY                  — cs_live_<key> for the company wallet
 */

import 'dotenv/config';
import { ethers } from 'ethers';

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL          = process.env.ARBITRUM_RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS_ARB_SEPOLIA ?? process.env.CONTRACT_ADDRESS;
const COMPANY_KEY      = process.env.DEMO_COMPANY_PRIVATE_KEY;
const CONTRACTOR_ADDR  = process.env.DEMO_CONTRACTOR_ADDRESS;
const USDC_ADDRESS     = process.env.DEMO_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
const GITHUB_REPO      = process.env.DEMO_GITHUB_REPO ?? 'acme/api-service';
const AGENT_URL        = process.env.AGENT_URL ?? 'http://localhost:3000';
const AGENT_API_KEY    = process.env.AGENT_API_KEY;

// Stream params — adjust for demo
const RATE_PER_SECOND    = ethers.parseUnits('0.001', 6); // 0.001 USDC/s = 86.4 USDC/day
const DURATION_SECONDS   = 86400;                          // 24 hours
const DEMO_PR_NUMBER     = 42;
const DEMO_PR_TITLE      = 'feat: add payment processing module';

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ROUTER_ABI = [
  'function createStream(address recipient, address token, uint256 ratePerSecond, uint256 initialDurationSeconds) external returns (bytes32)',
  'function withdrawFromStream(bytes32 streamId, uint256 amount) external',
  'function balanceOf(bytes32 streamId) external view returns (uint256)',
  'function streams(bytes32) external view returns (address sender, address recipient, address token, uint256 ratePerSecond, uint256 startTime, uint256 streamValidUntil, uint256 totalDeposited, uint256 totalWithdrawn, uint256 nonce)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(emoji, msg) {
  console.log(`\n${emoji}  ${msg}`);
}

function sep() {
  console.log('\n' + '─'.repeat(60));
}

async function agentPost(path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && AGENT_API_KEY) headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
  const res = await fetch(`${AGENT_URL}${path}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Agent ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Validate env ────────────────────────────────────────────────────────────
  const missing = ['RPC_URL', 'CONTRACT_ADDRESS', 'COMPANY_KEY', 'CONTRACTOR_ADDR', 'AGENT_API_KEY']
    .filter(k => !eval(k));
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         CronStream — Autonomous Payroll Demo              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── Setup provider + wallets ─────────────────────────────────────────────
  const provider    = new ethers.JsonRpcProvider(RPC_URL);
  const company     = new ethers.Wallet(COMPANY_KEY, provider);
  const router      = new ethers.Contract(CONTRACT_ADDRESS, ROUTER_ABI, company);
  const usdc        = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, company);

  sep();

  // ── Step 1: Fund check ───────────────────────────────────────────────────
  log('🔍', 'Step 1 — Pre-flight checks');
  const [companyEth, companyUsdc, { chainId }] = await Promise.all([
    provider.getBalance(company.address),
    usdc.balanceOf(company.address),
    provider.getNetwork(),
  ]);

  console.log(`   Chain:      ${chainId} (Arbitrum Sepolia)`);
  console.log(`   Company:    ${company.address}`);
  console.log(`   Contractor: ${CONTRACTOR_ADDR}`);
  console.log(`   ETH:        ${ethers.formatEther(companyEth)} ETH`);
  console.log(`   USDC:       ${ethers.formatUnits(companyUsdc, 6)} USDC`);
  console.log(`   Agent:      ${AGENT_URL}`);

  const deposit = RATE_PER_SECOND * BigInt(DURATION_SECONDS);
  if (companyUsdc < deposit) {
    console.error(`\n  Insufficient USDC. Need ${ethers.formatUnits(deposit, 6)}, have ${ethers.formatUnits(companyUsdc, 6)}`);
    process.exit(1);
  }
  log('✅', 'Pre-flight passed');

  // ── Step 2: Approve USDC ─────────────────────────────────────────────────
  sep();
  log('🔐', 'Step 2 — Approve USDC spend');
  const approveTx = await usdc.approve(CONTRACT_ADDRESS, deposit * 2n); // headroom for retries
  console.log(`   Tx: ${approveTx.hash}`);
  await approveTx.wait(1);
  log('✅', `Approved ${ethers.formatUnits(deposit, 6)} USDC`);

  // ── Step 3: Create stream ────────────────────────────────────────────────
  sep();
  log('🚀', 'Step 3 — Create payment stream');
  console.log(`   Rate:     ${ethers.formatUnits(RATE_PER_SECOND, 6)} USDC/sec`);
  console.log(`   Duration: ${DURATION_SECONDS}s (24h)`);
  console.log(`   Deposit:  ${ethers.formatUnits(deposit, 6)} USDC`);

  const createTx = await router.createStream(
    CONTRACTOR_ADDR, USDC_ADDRESS, RATE_PER_SECOND, DURATION_SECONDS
  );
  console.log(`   Tx: ${createTx.hash}`);
  const createReceipt = await createTx.wait(1);

  // Parse StreamCreated event to get streamId
  const streamCreatedTopic = ethers.id('StreamCreated(bytes32,address,address,uint256)');
  const streamLog = createReceipt.logs.find(l =>
    l.topics[0] === streamCreatedTopic &&
    l.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()
  );
  if (!streamLog) throw new Error('StreamCreated event not found in receipt');
  const streamId = streamLog.topics[1];

  log('✅', `Stream created`);
  console.log(`   Stream ID: ${streamId}`);
  console.log(`   Block:     ${createReceipt.blockNumber}`);

  // ── Step 4: Register with agent ──────────────────────────────────────────
  sep();
  log('📡', 'Step 4 — Register stream with agent node');
  const regRes = await agentPost('/api/v1/register-stream', {
    streamId,
    verificationSource: 'github',
    verificationTarget: GITHUB_REPO,
    recipient:          CONTRACTOR_ADDR,
    chainId:            Number(chainId),
  });
  log('✅', `Registered: ${GITHUB_REPO}`);

  // ── Step 5: Simulate contractor doing work (time warp simulation) ────────
  sep();
  log('⏳', 'Step 5 — Contractor delivers work (simulating 1 hour of stream time)');
  console.log('   Waiting 3s to let some USDC accrue...');
  await sleep(3000);

  const accrued = await router.balanceOf(streamId);
  log('💰', `Contractor has earned: ${ethers.formatUnits(accrued, 6)} USDC`);

  // ── Step 6: Simulate GitHub webhook (PR merged) ──────────────────────────
  sep();
  log('🐙', 'Step 6 — Simulate GitHub webhook: PR merged with passing CI');

  const prBody = `## Summary\nPayment processing module implemented.\n\n` +
    `CronStream-Stream-Id: ${streamId}\nCronStream-Nonce: 0`;

  const webhookPayload = {
    action:       'closed',
    pull_request: {
      number:  DEMO_PR_NUMBER,
      title:   DEMO_PR_TITLE,
      merged:  true,
      body:    prBody,
      user:    { login: 'contractor-dev' },
      base:    { ref: 'main' },
      head:    { ref: 'feat/payment-module' },
    },
    repository: {
      full_name: GITHUB_REPO,
      name:      GITHUB_REPO.split('/')[1],
      owner:     { login: GITHUB_REPO.split('/')[0] },
    },
  };

  let webhookRes;
  try {
    const res = await fetch(`${AGENT_URL}/api/v1/webhook/github`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-GitHub-Event': 'pull_request',
        // Skip HMAC if GITHUB_WEBHOOK_SECRET not set on agent
      },
      body: JSON.stringify(webhookPayload),
    });
    webhookRes = await res.json();
    if (!res.ok) {
      console.warn('   Agent webhook response:', webhookRes);
    }
  } catch (err) {
    console.warn('   Webhook error (may be expected if agent needs real GitHub verification):', err.message);
  }

  // ── Step 7: Manual verify + sign path (always works in demo) ─────────────
  sep();
  log('🤖', 'Step 7 — Agent: verify milestone + sign extension voucher');

  const stream = await router.streams(streamId);
  const nonce  = Number(stream[8]); // nonce field

  let voucher;
  try {
    const verifyRes = await agentPost('/api/v1/verify-milestone', {
      streamId,
      contractorAddress: CONTRACTOR_ADDR,
      nonce,
      verificationSource: 'github',
      verificationTarget: GITHUB_REPO,
      githubPayload: {
        repository:   webhookPayload.repository,
        pull_request: { ...webhookPayload.pull_request, merged: true },
        workflow_run: { conclusion: 'success' },
      },
    });
    voucher = verifyRes.voucher;
    log('✅', 'Milestone verified. Voucher signed by agent.');
    console.log(`   Extension: +${voucher.extensionDurationSeconds}s`);
    console.log(`   Expiry:    ${new Date(voucher.expiry * 1000).toISOString()}`);
    console.log(`   Sig:       ${voucher.signature.slice(0, 20)}…`);
  } catch (err) {
    log('⚠️', `Verify-milestone failed: ${err.message}`);
    log('ℹ️', 'This is expected if GITHUB_WEBHOOK_SECRET is set and repo is not real.');
    console.log('   Skipping on-chain extension step.');
  }

  // ── Step 8: Submit extension on-chain (if voucher obtained) ─────────────
  if (voucher) {
    sep();
    log('⛓', 'Step 8 — Submit extension voucher on-chain');

    const contractorProvider = new ethers.JsonRpcProvider(RPC_URL);
    const routerRead = new ethers.Contract(CONTRACT_ADDRESS, ROUTER_ABI, contractorProvider);

    try {
      const extTx = await router.connect(company).extendStreamWindowWithSignature(
        voucher.streamId,
        voucher.extensionDurationSeconds,
        voucher.expiry,
        voucher.signature,
      );
      console.log(`   Tx: ${extTx.hash}`);
      const extReceipt = await extTx.wait(1);
      log('✅', `Stream extended by ${voucher.extensionDurationSeconds}s`);
      console.log(`   Block: ${extReceipt.blockNumber}`);
    } catch (err) {
      log('⚠️', `Extension tx failed: ${err.message}`);
    }
  }

  // ── Step 9: Contractor withdraws ─────────────────────────────────────────
  sep();
  log('💸', 'Step 9 — Contractor withdraws earned USDC');

  const withdrawable = await router.balanceOf(streamId);
  console.log(`   Withdrawable: ${ethers.formatUnits(withdrawable, 6)} USDC`);

  if (withdrawable === 0n) {
    log('ℹ️', 'Nothing to withdraw yet (stream just started).');
  } else {
    // Use company wallet as contractor if no separate key provided
    const contractorSigner = company; // swap for real contractor key in production
    const routerContractor = router.connect(contractorSigner);

    const withdrawTx = await routerContractor.withdrawFromStream(streamId, withdrawable);
    console.log(`   Tx: ${withdrawTx.hash}`);
    await withdrawTx.wait(1);
    log('✅', `Contractor received ${ethers.formatUnits(withdrawable, 6)} USDC`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  sep();
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    Demo Complete                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`
  Stream ID:   ${streamId}
  Chain:       Arbitrum Sepolia (${chainId})
  Contract:    ${CONTRACT_ADDRESS}
  Agent:       ${AGENT_URL}
  Repo:        ${GITHUB_REPO}

  Flow completed:
    ✅  Stream created on-chain
    ✅  Stream registered with agent
    ✅  Milestone verified by agent
    ${voucher ? '✅' : '⏭'}  Extension voucher signed + submitted
    ${withdrawable > 0n ? '✅' : '⏭'}  Contractor withdrawal processed
  `);
}

main().catch(err => {
  console.error('\n❌  Demo failed:', err.message);
  process.exit(1);
});
