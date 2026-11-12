import React from 'react';
import {
  ArrowRight,
  Check,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

interface LandingOverviewProps {
  onOpenConsole: (initialPresetId?: string) => void;
}

export const LandingOverview: React.FC<LandingOverviewProps> = ({
  onOpenConsole,
}) => {
  return (
    <div className="space-y-16 sm:space-y-24 pb-10">
      {/* Pure Apple/iOS Centered Editorial Hero (no embedded console/widget) */}
      <section className="max-w-3xl mx-auto text-center pt-6 sm:pt-12 pb-2 space-y-6">
        <div className="inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-medium text-[#59595e] dark:text-[#98989d]">
          <ShieldCheck className="w-4 h-4 text-[#146c32] dark:text-[#30d158] shrink-0" />
          <span>NEAR Chain Signatures · Rust Policy Firewall</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] leading-[1.05]">
          Autonomous AI agents.
          <span className="block text-[#59595e] dark:text-[#98989d] mt-1">
            Hard-capped in Rust.
          </span>
        </h1>

        <p className="text-base sm:text-xl text-[#59595e] dark:text-[#98989d] leading-relaxed max-w-2xl mx-auto">
          Walp sits between your AI agent and NEAR MPC. Every cross-chain EVM transaction is deterministically RLP-decoded, screened, and capped onchain before a signature is ever produced.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onOpenConsole()}
            className="min-h-[48px] px-7 py-3 rounded-full bg-[#1d1d1f] hover:bg-black text-white dark:bg-[#f5f5f7] dark:hover:bg-white dark:text-[#1d1d1f] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-all active:scale-[0.99] shadow-sm"
          >
            <span>Open Firewall App</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onOpenConsole('atk-overmax')}
            className="min-h-[48px] px-7 py-3 rounded-full bg-white/90 hover:bg-white dark:bg-[#1c1c1e] dark:hover:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] border border-black/[0.08] dark:border-white/[0.1] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
          >
            <ShieldAlert className="w-4 h-4 text-[#ff3b30] dark:text-[#ff453a]" />
            <span>Try Red-Team Attack</span>
          </button>
        </div>
      </section>

      {/* 3-Step Bento */}
      <section id="how-it-works" className="space-y-6 scroll-mt-24">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-[#1d1d1f] dark:text-white">
            How every transaction is verified.
          </h2>
          <p className="text-sm sm:text-base text-[#59595e] dark:text-[#98989d]">
            Even if an AI prompt is completely hijacked, raw transaction bytes cannot bypass the Rust contract.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <div className="rounded-[26px] bg-white dark:bg-[#1c1c1e] border border-black/[0.06] dark:border-white/[0.08] p-6 sm:p-7 space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#005bb8] dark:text-[#0a84ff]" />
            </div>
            <div className="text-xs font-mono text-[#59595e] dark:text-[#98989d]">STEP 01</div>
            <h3 className="text-lg font-semibold text-[#1d1d1f] dark:text-white">
              Untrusted AI Intent
            </h3>
            <p className="text-sm text-[#59595e] dark:text-[#98989d] leading-relaxed">
              NEAR AI Cloud TEE turns natural language into unsigned EIP-1559 bytes. The agent holds only a scoped{' '}
              <code className="font-mono text-xs text-[#1d1d1f] dark:text-white">FunctionCall</code> key with zero Full-Access keys.
            </p>
          </div>

          <div className="rounded-[26px] bg-white dark:bg-[#1c1c1e] border border-black/[0.06] dark:border-white/[0.08] p-6 sm:p-7 space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#146c32] dark:text-[#30d158]" />
            </div>
            <div className="text-xs font-mono text-[#59595e] dark:text-[#98989d]">STEP 02</div>
            <h3 className="text-lg font-semibold text-[#1d1d1f] dark:text-white">
              Onchain RLP Firewall
            </h3>
            <p className="text-sm text-[#59595e] dark:text-[#98989d] leading-relaxed">
              The vault ignores text summaries, decodes raw RLP bytes in Rust, blocks unlimited{' '}
              <code className="font-mono text-xs text-[#1d1d1f] dark:text-white">approve</code> calls, and checks the shared threat registry.
            </p>
          </div>

          <div className="rounded-[26px] bg-white dark:bg-[#1c1c1e] border border-black/[0.06] dark:border-white/[0.08] p-6 sm:p-7 space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-[#1d1d1f] dark:text-white" />
            </div>
            <div className="text-xs font-mono text-[#59595e] dark:text-[#98989d]">STEP 03</div>
            <h3 className="text-lg font-semibold text-[#1d1d1f] dark:text-white">
              Threshold MPC Co-Sign
            </h3>
            <p className="text-sm text-[#59595e] dark:text-[#98989d] leading-relaxed">
              Only policy-compliant transactions reach{' '}
              <code className="font-mono text-xs text-[#1d1d1f] dark:text-white">v1.signer-prod.testnet</code>. Over-threshold transfers wait in the Owner queue.
            </p>
          </div>
        </div>
      </section>

      {/* Security Boundaries Comparison */}
      <section
        id="security"
        className="rounded-[28px] bg-white dark:bg-[#1c1c1e] border border-black/[0.06] dark:border-white/[0.08] p-6 sm:p-8 space-y-5 scroll-mt-24"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-white">
              Security Boundaries
            </h2>
            <p className="text-sm text-[#59595e] dark:text-[#98989d] mt-1">
              Standard agent hot wallets vs. Walp onchain enforcement.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenConsole()}
            className="self-start sm:self-auto text-sm font-semibold text-[#005bb8] dark:text-[#0a84ff] hover:underline inline-flex items-center gap-1"
          >
            <span>Open Firewall App</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
          {[
            {
              label: 'Spoofed prompt claims vs. actual value',
              standard: 'Relies on off-chain LLM / JSON guardrails',
              walp: 'Decodes canonical RLP bytes onchain',
            },
            {
              label: 'Compromised agent private key',
              standard: 'Full wallet drain possible immediately',
              walp: 'Zero Full-Access keys; FunctionCall(request_intent) only',
            },
            {
              label: 'Unlimited ERC-20 approve(MaxUint256)',
              standard: 'Signed blindly by EOA or MPC proxy',
              walp: 'Rejected with WALP_CALLDATA_BLOCKED before MPC',
            },
            {
              label: 'Cross-chain wrong chainId bypass',
              standard: 'Executes on unintended EVM networks',
              walp: 'Blocked by onchain allowed_chain_ids check',
            },
          ].map((row) => (
            <div
              key={row.label}
              className="py-4 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-start md:items-center text-sm"
            >
              <div className="md:col-span-4 font-semibold text-[#1d1d1f] dark:text-white">
                {row.label}
              </div>
              <div className="md:col-span-4 flex items-center gap-2 text-[#59595e] dark:text-[#98989d]">
                <X className="w-4 h-4 text-[#ff3b30] dark:text-[#ff453a] shrink-0" />
                <span>{row.standard}</span>
              </div>
              <div className="md:col-span-4 flex items-center gap-2 text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
                <Check className="w-4 h-4 text-[#146c32] dark:text-[#30d158] shrink-0" />
                <span>{row.walp}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
