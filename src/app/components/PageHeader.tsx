import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}

export function PageHeader({ icon: Icon, title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="dashboard-card p-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-black/[0.06] dark:bg-white/[0.08] flex items-center justify-center">
          <Icon size={20} className="text-coda-text-secondary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-coda-text leading-tight">{title}</h2>
          <p className="text-xs text-coda-text-muted">{subtitle}</p>
        </div>
      </div>
      {children && (
        <div className="flex items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}