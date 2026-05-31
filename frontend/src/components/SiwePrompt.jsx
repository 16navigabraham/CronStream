/**
 * SiwePrompt
 *
 * No modal - the wallet pops automatically on connect (AuthContext).
 * This component only renders a slim retry banner if the user rejected
 * the signature and is stuck without a session.
 */

import { useAuth } from '../context/AuthContext';
import { useAccount } from 'wagmi';

export default function SiwePrompt() {
  const { isAuthed, signing, signIn, signError } = useAuth();
  const { isConnected } = useAccount();

  if (isAuthed || !isConnected) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
                    bg-surface border border-border rounded-xl px-4 py-2.5 shadow-lg
                    text-xs text-muted font-mono whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${signError ? 'bg-red-400' : 'bg-yellow-400'}`} />
      {signError ? signError : 'Wallet signature needed'}
      <button
        onClick={signIn}
        disabled={signing}
        className="text-accent hover:underline ml-1 disabled:opacity-40"
      >
        {signing ? 'Signing…' : 'Sign now'}
      </button>
    </div>
  );
}
