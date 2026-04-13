import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle2, MinusCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';

// ============================================================
// PermissionsMatrix — Read-only role authority table
//
// Displays which roles can perform which config actions, and
// whether a maker/checker approval workflow is required.
// ============================================================

interface Permission {
  id: string;
  resource: string;
  action: string;
  allowed_roles: string[];
  requires_approval: boolean;
  approval_role: string | null;
}

function formatAction(action: string): string {
  return action
    .replace(/^update_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatResource(resource: string): string {
  return resource
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROLE_DISPLAY: Record<string, string> = {
  admin: 'Admin',
  compliance: 'Compliance',
  bsa_officer: 'BSA Officer',
  treasury: 'Treasury',
  executive: 'Executive',
};

export function PermissionsMatrix() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('config_permissions')
          .select('*')
          .order('resource');
        setPermissions(data ?? []);
      } catch (err) {
        console.error('[PermissionsMatrix] fetch error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="text-xs text-coda-text-muted text-center py-4">
        Loading permissions...
      </div>
    );
  }

  if (permissions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-4 text-coda-text-muted">
        <Shield size={16} />
        <span className="text-xs">No permissions configured.</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-coda-border">
            <th className="text-left py-1.5 px-2 font-medium text-coda-text-muted uppercase tracking-wider text-[9px]">
              Resource
            </th>
            <th className="text-left py-1.5 px-2 font-medium text-coda-text-muted uppercase tracking-wider text-[9px]">
              Action
            </th>
            <th className="text-left py-1.5 px-2 font-medium text-coda-text-muted uppercase tracking-wider text-[9px]">
              Allowed Roles
            </th>
            <th className="text-center py-1.5 px-2 font-medium text-coda-text-muted uppercase tracking-wider text-[9px]">
              Approval
            </th>
            <th className="text-left py-1.5 px-2 font-medium text-coda-text-muted uppercase tracking-wider text-[9px]">
              Approver
            </th>
          </tr>
        </thead>
        <tbody>
          {permissions.map((perm) => (
            <tr
              key={perm.id}
              className="border-b border-coda-border/50 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-1.5 px-2 text-coda-text-secondary font-mono">
                {formatResource(perm.resource)}
              </td>
              <td className="py-1.5 px-2 text-coda-text">
                {formatAction(perm.action)}
              </td>
              <td className="py-1.5 px-2">
                <div className="flex flex-wrap gap-1">
                  {perm.allowed_roles.map((role) => (
                    <span
                      key={role}
                      className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-secondary"
                    >
                      {ROLE_DISPLAY[role] ?? role}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-1.5 px-2 text-center">
                {perm.requires_approval ? (
                  <CheckCircle2 size={12} className="inline text-amber-500" />
                ) : (
                  <MinusCircle size={12} className="inline text-coda-text-muted/40" />
                )}
              </td>
              <td className="py-1.5 px-2 text-coda-text-secondary">
                {perm.approval_role ? (ROLE_DISPLAY[perm.approval_role] ?? perm.approval_role) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
