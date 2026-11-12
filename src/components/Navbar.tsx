import React from 'react';
import { ArrowRight, Moon, Settings2, ShieldAlert, ShieldCheck, Sun } from 'lucide-react';

export type AppView = 'overview' | 'console';
export type ThemeMode = 'light' | 'dark';

interface NavbarProps {
  vaultContractId: string;
  paused: boolean;
  nearAiConfigured: boolean;
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenConfigModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  vaultContractId,
  paused,
  activeView,
  onChangeView,
  theme,
  onToggleTheme,
  onOpenConfigModal,
}) => {
  const scrollToSection = (id: string) => {
    if (activeView !== 'overview') {
      onChangeView('overview');
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.06] dark:border-white/[0.08] bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3">
        {/* Brand */}
        <button
          type="button"
          onClick={() => onChangeView('overview')}
          className="flex items-center gap-2.5 min-w-0 text-left"
        >
          <div className="w-8 h-8 rounded-xl bg-[#0A1E3F] border border-[#163466] flex items-center justify-center shrink-0 overflow-hidden">
            <svg viewBox="0 0 32 32" fill="none" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#0A1E3F" />
              <path d="M7.5 14.25L12.75 8.5H19.75L14.5 14.25H7.5Z" fill="#FFFFFF" />
              <path d="M12.25 23.5L17.5 17.75H24.5L19.25 23.5H12.25Z" fill="#7EB6FF" />
              <circle cx="22.25" cy="11.35" r="2.15" fill="#FF3B30" />
            </svg>
          </div>
          <span className="font-bold tracking-tight text-base text-[#1d1d1f] dark:text-white">
            Walp
          </span>
        </button>

        {/* Clean Apple-style Text Navigation */}
        <nav
          aria-label="Primary navigation"
          className="hidden sm:flex items-center gap-7 text-xs font-medium text-[#59595e] dark:text-[#98989d]"
        >
          <button
            type="button"
            onClick={() => onChangeView('overview')}
            className={`transition-colors ${
              activeView === 'overview'
                ? 'text-[#1d1d1f] dark:text-white font-semibold'
                : 'hover:text-[#1d1d1f] dark:hover:text-white'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('how-it-works')}
            className="hover:text-[#1d1d1f] dark:hover:text-white transition-colors"
          >
            How It Works
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('security')}
            className="hover:text-[#1d1d1f] dark:hover:text-white transition-colors"
          >
            Security
          </button>
        </nav>

        {/* Right Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {activeView === 'console' && (
            <>
              <span
                className={`hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full ${
                  paused
                    ? 'bg-[#ff3b30]/10 text-[#ff3b30] dark:bg-[#ff453a]/15 dark:text-[#ff453a]'
                    : 'bg-[#34c759]/12 text-[#146c32] dark:bg-[#30d158]/15 dark:text-[#30d158]'
                }`}
              >
                {paused ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>{paused ? 'Paused' : 'Active'}</span>
              </span>

              <button
                type="button"
                onClick={onOpenConfigModal}
                className="h-8 px-3 rounded-full bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/[0.08] dark:hover:bg-white/[0.14] flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] dark:text-white transition-colors max-w-[130px] sm:max-w-[180px]"
                title={vaultContractId || 'Vault Configuration'}
              >
                <Settings2 className="w-3.5 h-3.5 text-[#146c32] dark:text-[#30d158] shrink-0" />
                <span className="truncate font-mono text-[11px]">
                  {vaultContractId || 'Vault'}
                </span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="w-8 h-8 rounded-full bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/[0.08] dark:hover:bg-white/[0.14] flex items-center justify-center text-[#1d1d1f] dark:text-white transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {activeView === 'overview' ? (
            <button
              type="button"
              onClick={() => onChangeView('console')}
              className="h-8 px-3.5 rounded-full bg-[#1d1d1f] hover:bg-black dark:bg-[#f5f5f7] dark:hover:bg-white text-white dark:text-[#1d1d1f] text-xs font-semibold inline-flex items-center gap-1 transition-colors"
            >
              <span>Open App</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChangeView('overview')}
              className="h-8 px-3 rounded-full bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-xs font-semibold text-[#1d1d1f] dark:text-white sm:hidden"
            >
              Overview
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
