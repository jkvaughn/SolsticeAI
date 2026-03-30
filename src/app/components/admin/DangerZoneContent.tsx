import { useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../ThemeProvider';
import { adminCallServer } from '../../lib/adminClient';
import { useReAuthAction } from '../../hooks/useReAuthAction';
import { ReAuthDialog } from './ReAuthDialog';
// PasskeyRegistration moved to Settings > Security (Task 150)
import { RotateCcw, Trash2 } from 'lucide-react';

// ============================================================
// DangerAction — single danger-zone action row
// ============================================================

function DangerAction({
  icon: Icon,
  label,
  desc,
  buttonLabel,
  disabled,
  onClick,
  isDark,
}: {
  icon: React.ElementType;
  label: string;
  desc: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
  isDark: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
      isDark
        ? 'bg-red-500/[0.03] border-red-500/10'
        : 'bg-red-50/50 border-red-200/30'
    }`}>
      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 text-red-500 dark:text-red-400">
        <Icon size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-coda-text">{label}</p>
        <p className="text-[10px] text-coda-text-muted mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`liquid-button flex-shrink-0 flex items-center px-3.5 py-1.5 text-[12px] font-medium cursor-pointer ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : ''
        } ${
          isDark
            ? 'text-coda-text'
            : 'text-coda-text'
        }`}
      >
        <Icon size={14} />
        <span>{buttonLabel}</span>
      </button>
    </div>
  );
}

// ============================================================
// DangerZoneContent — Reset Tokens + Reset Network actions
// ============================================================

export function DangerZoneContent() {
  const { userEmail } = useAuth();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const { executeWithReAuth, dialogOpen, setDialogOpen, onAuthenticated, actionDescription } = useReAuthAction();

  const [resettingTokens, setResettingTokens] = useState(false);
  const [resettingNetwork, setResettingNetwork] = useState(false);

  const handleResetTokens = useCallback(() => {
    executeWithReAuth('Reset Tokens', async (token) => {
      if (!window.confirm('Reset all tokens? This will clear cached token metadata and balances. This action cannot be undone.')) return;
      setResettingTokens(true);
      try {
        await adminCallServer('/reset-tokens', undefined, 3, userEmail, { 'X-Reauth-Token': token });
      } catch (err) {
        console.error('[DangerZone] Failed to reset tokens:', err);
      } finally {
        setResettingTokens(false);
      }
    });
  }, [userEmail, executeWithReAuth]);

  const handleResetNetwork = useCallback(() => {
    executeWithReAuth('Reset Network', async (token) => {
      if (!window.confirm('Reset network configuration? This will restore default Devnet settings and clear all cached RPC state. This action cannot be undone.')) return;
      setResettingNetwork(true);
      try {
        await adminCallServer('/reset-network', undefined, 3, userEmail, { 'X-Reauth-Token': token });
      } catch (err) {
        console.error('[DangerZone] Failed to reset network:', err);
      } finally {
        setResettingNetwork(false);
      }
    });
  }, [userEmail, executeWithReAuth]);

  return (
    <div className="space-y-3">
      <DangerAction
        icon={RotateCcw}
        label="Reset Tokens"
        desc="Clear all cached token metadata, balances, and mint associations."
        buttonLabel={resettingTokens ? 'Resetting...' : 'Reset Tokens'}
        disabled={resettingTokens}
        onClick={handleResetTokens}
        isDark={isDark}
      />
      <DangerAction
        icon={Trash2}
        label="Reset Network"
        desc="Restore default Devnet settings and clear cached RPC state."
        buttonLabel={resettingNetwork ? 'Resetting...' : 'Reset Network'}
        disabled={resettingNetwork}
        onClick={handleResetNetwork}
        isDark={isDark}
      />
      <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
        These actions are irreversible. Cached data will be rebuilt on next agent cycle.
      </p>
      <ReAuthDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAuthenticated={onAuthenticated}
        actionDescription={actionDescription}
      />
    </div>
  );
}

export default DangerZoneContent;
