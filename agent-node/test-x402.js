/**
 * test-x402.js
 * Quick smoke-test for the x402 public API.
 * Run against local agent (npm run dev) or production.
 *
 * Usage:
 *   node test-x402.js                          # test local (port 3000)
 *   BASE_URL=https://api.cronstream.xyz node test-x402.js
 *   STREAM_ID=0x<64hex> node test-x402.js
 */

const BASE_URL  = process.env.BASE_URL  ?? 'http://localhost:3000';
const STREAM_ID = process.env.STREAM_ID ?? null;

async function get(path) {
  const r = await fetch(`${BASE_URL}${path}`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function run() {
  console.log(`\nTesting CronStream x402 API at ${BASE_URL}\n${'─'.repeat(50)}`);

  // 1. Free info endpoint — should always 200
  const info = await get('/api/public/info');
  console.log(`[GET /api/public/info]         ${info.status === 200 ? '✓ 200' : `✗ ${info.status}`}`);
  if (info.status === 200) {
    console.log(`  payTo:   ${info.body.payTo}`);
    console.log(`  network: ${info.body.network}`);
  }

  // 2. Paid endpoints without X-PAYMENT header — should return 402
  const endpoints = [
    STREAM_ID ? `/api/public/stream/${STREAM_ID}` : '/api/public/stream/0x' + '0'.repeat(64),
    STREAM_ID ? `/api/public/balance/${STREAM_ID}` : '/api/public/balance/0x' + '0'.repeat(64),
    '/api/public/streams/company/0x' + '0'.repeat(40),
    '/api/public/streams/contractor/0x' + '0'.repeat(40),
  ];

  for (const path of endpoints) {
    const r = await get(path);
    const label = path.replace(STREAM_ID ?? '', '<streamId>').replace('0x' + '0'.repeat(64), '<streamId>').replace('0x' + '0'.repeat(40), '<addr>');
    if (r.status === 402) {
      const pays = r.body?.accepts?.[0];
      console.log(`[GET ${label.padEnd(45)}] ✓ 402 Payment Required`);
      if (pays) console.log(`  pay $${pays.maxAmountRequired / 1e6} USDC → ${pays.payTo?.slice(0, 10)}…`);
    } else if (r.status === 200) {
      console.log(`[GET ${label.padEnd(45)}] ✗ Got 200 — payment middleware not active`);
    } else {
      console.log(`[GET ${label.padEnd(45)}] ? ${r.status}`);
    }
  }

  // 3. POST verify-milestone without payment — should 402
  const vm = await fetch(`${BASE_URL}/api/public/verify-milestone`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamId: '0x' + '0'.repeat(64), prNumber: 1 }),
  });
  const vmBody = await vm.json().catch(() => ({}));
  console.log(`[POST /api/public/verify-milestone]            ${vm.status === 402 ? '✓ 402 Payment Required' : `✗ ${vm.status} — payment middleware not active`}`);

  console.log('\n' + '─'.repeat(50));
  console.log('To test a paid call: get Base Sepolia USDC from https://faucet.circle.com');
  console.log('Then use x402-fetch: https://github.com/coinbase/x402\n');
}

run().catch(console.error);
