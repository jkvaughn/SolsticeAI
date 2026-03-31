import { useState, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';

// ============================================================
// ProfileEditor — XD-style form fields with labels
// Matches Rimark XD "User - Profile" reference layout
// ============================================================

interface ProfileEditorProps {
  profile: {
    full_name: string | null;
    title: string | null;
    department: string | null;
    phone: string | null;
    institution: string | null;
    timezone: string;
  };
  onUpdate: (fields: Record<string, string>) => Promise<unknown>;
}

function FormField({
  label,
  value,
  field,
  placeholder,
  onSave,
  half,
}: {
  label: string;
  value: string | null;
  field: string;
  placeholder?: string;
  onSave: (field: string, value: string) => Promise<void>;
  half?: boolean;
}) {
  const [localValue, setLocalValue] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external changes
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleBlur = async () => {
    const trimmed = localValue.trim();
    if (trimmed === (value || '')) return;
    setSaving(true);
    try {
      await onSave(field, trimmed);
      setSaved(true);
      timerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch {
      setLocalValue(value || '');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setLocalValue(value || '');
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className={half ? 'flex-1 min-w-0' : 'w-full'}>
      <label className="block text-[11px] font-medium text-coda-text-muted mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
          className="w-full px-3 py-2.5 text-sm font-sans text-coda-text bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] rounded-xl outline-none focus:border-coda-brand/40 focus:bg-transparent transition-colors placeholder:text-coda-text-muted/50"
        />
        {saved && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Check size={14} className="text-emerald-500" />
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileEditor({ profile, onUpdate }: ProfileEditorProps) {
  const handleSave = async (field: string, value: string) => {
    await onUpdate({ [field]: value });
  };

  return (
    <div className="space-y-5 pt-2">
      {/* Personal Information */}
      <div>
        <h4 className="text-[13px] font-medium text-coda-text mb-4">Personal Information</h4>
        <div className="space-y-4">
          <FormField label="Full Name" value={profile.full_name} field="full_name" placeholder="Your full name" onSave={handleSave} />
          <div className="flex gap-4">
            <FormField label="Title" value={profile.title} field="title" placeholder="e.g. Compliance Officer" onSave={handleSave} half />
            <FormField label="Department" value={profile.department} field="department" placeholder="e.g. Digital Assets" onSave={handleSave} half />
          </div>
        </div>
      </div>

      {/* Organization */}
      <div>
        <h4 className="text-[13px] font-medium text-coda-text mb-4">Organization</h4>
        <div className="space-y-4">
          <FormField label="Institution" value={profile.institution} field="institution" placeholder="e.g. JPMorgan Chase" onSave={handleSave} />
          <div className="flex gap-4">
            <FormField label="Phone" value={profile.phone} field="phone" placeholder="+1 (555) 123-4567" onSave={handleSave} half />
            <FormField label="Timezone" value={profile.timezone} field="timezone" placeholder="America/New_York" onSave={handleSave} half />
          </div>
        </div>
      </div>
    </div>
  );
}
