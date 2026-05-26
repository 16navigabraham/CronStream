/**
 * publicApi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CronStream Public API — pay-per-call via the x402 Payment Protocol.
 *
 * External callers (AI agents, scripts, other dApps) pay a small USDC amount
 * on Base for each request. No API key needed — any wallet can pay and call.
 * Payments go directly to the agent's signing wallet.
 *
 * Streams are registered automatically when created on-chain (see streamListener.js).
 * This API lets external parties query and interact with those streams.
 *
 * Endpoints:
 *   GET  /api/public/info                — free  — pricing + usage instructions
 *   POST /api/public/verify-milestone    — $0.10 — verify work + signed voucher
 *   GET  /api/public/stream/:id          — $0.01 — read stream registry entry
 *
 * Env vars:
 *   AGENT_PRIVATE_KEY   — already required for signing; payment address is derived from it
 *   X402_NETWORK        — 'base-sepolia' (default) | 'base' for mainnet
 *
 * x402 spec: https://x402.org
 */

import { Router }                       from 'express';
import { paymentMiddleware }            from 'x402-express';
import { verifyMilestone }              from './verifyMilestone.js';
import { signExtensionVoucher,
         getSignerAddress }             from './agentSigner.js';
import { getStream }                    from './db.js';

const router = Router();

// ─── Payment address + network ────────────────────────────────────────────────
// Payments go to the same wallet the agent uses for EIP-712 signing.
// No extra env var needed — derived from AGENT_PRIVATE_KEY at startup.

let PAY_TO;
try {
  PAY_TO = getSignerAddress();
} catch {
  console.warn('[publicApi] ⚠ AGENT_PRIVATE_KEY not set — x402 payments disabled (dev mode)');
}

const NETWORK = process.env.X402_NETWORK ?? 'base-sepolia';

// ─── x402 middleware ──────────────────────────────────────────────────────────
// Returns HTTP 402 with full payment instructions when no valid X-PAYMENT header
// is present. The client pays on-chain and retries with the proof header.

router.use(
  PAY_TO
    ? paymentMiddleware(PAY_TO, {
        'POST /api/public/verify-milestone': {
          price:   '$0.10',
          network: NETWORK,
          config:  {
            description: 'Verify a work milestone and get a signed stream-extension voucher',
          },
        },
        'GET /api/public/stream/*': {
          price:   '$0.01',
          network: NETWORK,
          config:  { description: 'Read a stream entry from the CronStream registry' },
        },
      })
    : (_req, _res, next) => next(), // no-op in dev when private key not set
);

// ─── GET /api/public/info ─────────────────────────────────────────────────────
// Free — no payment required. Describes the API so callers know what to expect.

router.get('/info', (_req, res) => {
  res.json({
    name:        'CronStream Public API',
    version:     '1.0.0',
    protocol:    'x402',
    network:     NETWORK,
    payTo:       PAY_TO ?? 'not configured',
    pricing: {
      'POST /api/public/verify-milestone':  '$0.10 USDC per call',
      'GET  /api/public/stream/:id':        '$0.01 USDC per call',
    },
    usage:
      'Include a valid X-PAYMENT header with each paid request. ' +
      'Hit any paid endpoint without one to receive a 402 with full payment instructions. ' +
      'Streams are registered automatically when created on-chain — no manual registration needed.',
    spec: 'https://x402.org',
  });
});

// ─── POST /api/public/verify-milestone ───────────────────────────────────────
// Verify that a contractor completed a milestone and return a signed EIP-712
// extension voucher the stream owner can submit on-chain to extend the stream.
//
// Body:
//   streamId            string  — 0x-prefixed bytes32
//   contractorAddress   string  — 0x-prefixed 20-byte wallet
//   nonce               number  — current on-chain stream nonce
//   verificationSource  string  — 'github' | 'jira' | 'bitbucket' | 'figma'
//   verificationTarget  string  — repo path, Jira key, Figma URL, etc.
//   githubPayload       object  — (optional) raw GitHub PR/workflow event body
//
// Returns:
//   { success: true, voucher: { streamId, extensionDurationSeconds, expiry, signature } }

router.post('/verify-milestone', async (req, res) => {
  const {
    streamId, contractorAddress, nonce,
    verificationSource, verificationTarget, githubPayload,
  } = req.body;

  if (!streamId || !/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId — must be 0x-prefixed 32-byte hex' });
  }
  if (!contractorAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractorAddress)) {
    return res.status(400).json({ error: 'Invalid contractorAddress' });
  }
  if (typeof nonce !== 'number' || nonce < 0) {
    return res.status(400).json({ error: 'nonce must be a non-negative integer' });
  }

  try {
    // Fall back to registry values if caller doesn't supply source/target
    const streamRecord = await getStream(streamId);
    const source = verificationSource ?? streamRecord?.verification_source ?? 'github';
    const target = verificationTarget ?? streamRecord?.verification_target;

    // Public callers verify against public repos/boards only.
    // Stored integration credentials (Jira token, Figma token, etc.) are not
    // accessible here — those are private to the stream owner's agent session.
    const verifyResult = await verifyMilestone({
      streamId, contractorAddress, nonce,
      verificationSource: source,
      verificationTarget: target,
      githubPayload,
    });

    if (!verifyResult.verified) {
      return res.status(422).json({
        success: false,
        error:   verifyResult.reason ?? 'Milestone verification failed',
      });
    }

    const voucher = await signExtensionVoucher({ streamId, nonce });
    return res.json({ success: true, voucher });
  } catch (err) {
    console.error('[publicApi:verify-milestone]', err);
    return res.status(500).json({ error: 'Verification error', detail: err.message });
  }
});

// ─── GET /api/public/stream/:id ───────────────────────────────────────────────
// Read a stream's public registry entry. Returns chain, sender, recipient,
// token, and verification config. Never returns integration credentials.

router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }
  try {
    const stream = await getStream(id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });

    const {
      stream_id, chain_id, verification_source, verification_target,
      sender, recipient, token, created_at,
    } = stream;

    return res.json({
      streamId:           stream_id,
      chainId:            chain_id,
      verificationSource: verification_source,
      verificationTarget: verification_target,
      sender,
      recipient,
      token,
      createdAt:          created_at,
    });
  } catch (err) {
    console.error('[publicApi:stream]', err);
    return res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

export default router;
