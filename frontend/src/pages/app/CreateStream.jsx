import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, parseAbiItem } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../../lib/wagmi';
import { registerStreamWithAgent } from '../../hooks/useAgentStatus';

const USDC_SEPOLIA    = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
const SECONDS_PER_DAY = 86400;

const TOKENS = [
  { label: 'USDC (Arb Sepolia)',   address: USDC_SEPOLIA,                               decimals: 6  },
  { label: 'TSLA (Robinhood)',     address: '0x0000000000000000000000000000000000000001', decimals: 18 },
  { label: 'AMZN (Robinhood)',     address: '0x0000000000000000000000000000000000000002', decimals: 18 },
];

export default function CreateStream() {
  const navigate = useNavigate();
  const { address } = useAccount();

  const [form, setForm] = useState({
    recipient:        '',
    token:            USDC_SEPOLIA,
    ratePerDay:       '',
    durationDays:     '',
    githubRepo:       '',
  });

  const publicClient = usePublicClient();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  // After tx confirms, extract the streamId from logs and register with agent
  useEffect(() => {
    if (!isSuccess || !receipt || !form.githubRepo) return;

    async function registerStream() {
      try {
        // Parse StreamCreated event from the receipt logs
        const event = parseAbiItem(
          'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)'
        );
        const log = receipt.logs.find(l =>
          l.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()
        );
        if (!log) return;

        const decoded = publicClient.decodeEventLog({
          abi:    [event],
          data:   log.data,
          topics: log.topics,
        });

        await registerStreamWithAgent({
          streamId:     decoded.streamId,
          repo:         form.githubRepo,
          recipient:    form.recipient,
          ratePerSecond: ratePerSecond.toString(),
        });
      } catch (err) {
        console.warn('Stream registration with agent failed (non-fatal):', err);
      }
    }

    registerStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  const selectedToken = TOKENS.find(t => t.address === form.token) ?? TOKENS[0];

  const ratePerSecond = form.ratePerDay
    ? parseUnits(form.ratePerDay, selectedToken.decimals) / BigInt(SECONDS_PER_DAY)
    : 0n;

  const totalCost = form.ratePerDay && form.durationDays
    ? (parseFloat(form.ratePerDay) * parseInt(form.durationDays)).toFixed(2)
    : null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.recipient || !form.ratePerDay || !form.durationDays) return;

    writeContract({
      address: CONTRACT_ADDRESS,
      abi:     ROUTER_ABI,
      functionName: 'createStream',
      args: [
        form.recipient,
        form.token,
        ratePerSecond,
        BigInt(parseInt(form.durationDays) * SECONDS_PER_DAY),
      ],
    });
  }

  if (isSuccess) {
    return (
      <div className="p-8 max-w-lg flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-5xl mb-4">✓</div>
        <h2 className="text-2xl font-bold mb-2">Stream created!</h2>
        <p className="text-muted text-sm mb-6">
          Tokens are flowing. The agent will verify milestones and extend the window automatically.
        </p>
        <div className="font-mono text-xs text-muted bg-surface border border-border rounded-lg px-4 py-2 mb-6 break-all">
          {txHash}
        </div>
        <button className="btn-primary" onClick={() => navigate('/app/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <button onClick={() => navigate(-1)} className="text-muted text-sm hover:text-white mb-6 flex items-center gap-2">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Create Stream</h1>
      <p className="text-muted text-sm mb-8">Fund a contractor stream. Budget is deposited upfront.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">

        <div className="card flex flex-col gap-5">
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted">Stream details</h2>

          <div>
            <label className="label">Contractor wallet address</label>
            <input
              name="recipient"
              value={form.recipient}
              onChange={handleChange}
              placeholder="0x..."
              className="input"
              required
            />
          </div>

          <div>
            <label className="label">Payment token</label>
            <select
              name="token"
              value={form.token}
              onChange={handleChange}
              className="input"
            >
              {TOKENS.map(t => (
                <option key={t.address} value={t.address}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Rate per day ({selectedToken.label.split(' ')[0]})</label>
              <input
                name="ratePerDay"
                type="number"
                min="0"
                step="any"
                value={form.ratePerDay}
                onChange={handleChange}
                placeholder="100"
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Duration (days)</label>
              <input
                name="durationDays"
                type="number"
                min="1"
                value={form.durationDays}
                onChange={handleChange}
                placeholder="30"
                className="input"
                required
              />
            </div>
          </div>

          <div>
            <label className="label">GitHub repo (for agent verification)</label>
            <input
              name="githubRepo"
              value={form.githubRepo}
              onChange={handleChange}
              placeholder="owner/repo"
              className="input"
            />
          </div>
        </div>

        {/* Summary */}
        {totalCost && (
          <div className="card bg-accent/5 border-accent/20">
            <h3 className="text-xs font-medium text-muted uppercase tracking-widest mb-3">Summary</h3>
            <div className="flex flex-col gap-2 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-muted">Rate</span>
                <span>{form.ratePerDay} {selectedToken.label.split(' ')[0]}/day</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Duration</span>
                <span>{form.durationDays} days</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 mt-1">
                <span className="text-muted">Total deposit</span>
                <span className="text-accent font-semibold">
                  {totalCost} {selectedToken.label.split(' ')[0]}
                </span>
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending || isConfirming}
          className="btn-primary w-full text-center disabled:opacity-50"
        >
          {isPending       ? 'Confirm in wallet...' :
           isConfirming    ? 'Creating stream...' :
           'Create Stream & Deposit'}
        </button>
      </form>
    </div>
  );
}
