import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../../lib/wagmi';

export default function Withdraw() {
  const { address } = useAccount();
  const [streamId, setStreamId] = useState('');
  const [amount,   setAmount]   = useState('');

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess }     = useWaitForTransactionReceipt({ hash: txHash });

  async function handleWithdraw(e) {
    e.preventDefault();
    if (!streamId || !amount) return;

    writeContract({
      address:      CONTRACT_ADDRESS,
      abi:          ROUTER_ABI,
      functionName: 'withdrawFromStream',
      args:         [streamId, parseUnits(amount, 6)],
    });
  }

  if (isSuccess) {
    return (
      <div className="p-8 max-w-lg flex flex-col items-center min-h-[60vh] justify-center text-center">
        <div className="text-5xl mb-4">✓</div>
        <h2 className="text-2xl font-bold mb-2">Withdrawal successful</h2>
        <p className="text-muted text-sm mb-6">Tokens have been sent to your wallet.</p>
        <div className="font-mono text-xs text-muted bg-surface border border-border rounded-lg px-4 py-2 mb-6 break-all">
          {txHash}
        </div>
        <button className="btn-primary" onClick={() => { setStreamId(''); setAmount(''); }}>
          Withdraw again
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Withdraw</h1>
      <p className="text-muted text-sm mb-8">Claim your earned tokens from a stream.</p>

      <form onSubmit={handleWithdraw} className="card flex flex-col gap-5">
        <div>
          <label className="label">Stream ID</label>
          <input
            value={streamId}
            onChange={e => setStreamId(e.target.value)}
            placeholder="0x..."
            className="input"
            required
          />
        </div>

        <div>
          <label className="label">Amount (USDC)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="any"
            className="input"
            required
          />
        </div>

        <div className="bg-dark border border-border rounded-lg px-4 py-3 text-xs text-muted">
          A 0.5% protocol fee is deducted from each withdrawal.
        </div>

        <button
          type="submit"
          disabled={isPending || isConfirming}
          className="btn-primary w-full text-center disabled:opacity-50"
        >
          {isPending    ? 'Confirm in wallet...' :
           isConfirming ? 'Processing...' :
           'Withdraw Tokens'}
        </button>
      </form>
    </div>
  );
}
