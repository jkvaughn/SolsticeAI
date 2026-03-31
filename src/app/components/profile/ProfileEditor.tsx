import { useState, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';

// ============================================================
// ProfileEditor — XD-style form fields matching Rimark reference
// Two-column First/Last name, email with verified badge,
// title/department, institution, phone/timezone
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
  email?: string;
}

function FormField({
  label,
  value,
  field,
  placeholder,
  onSave,
  readOnly,
}: {
  label: string;
  value: string | null;
  field: string;
  placeholder?: string;
  onSave: (field: string, value: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const [localValue, setLocalValue] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setLocalValue(value || ''); }, [value]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

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
    if (e.key === 'Escape') { setLocalValue(value || ''); (e.target as HTMLInputElement).blur(); }
  };

  return (
    <div className="flex-1 min-w-0">
      <label className="block text-[11px] font-medium text-coda-text-muted mb-1.5">{label}</label>
      <div className="relative">
        <input
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={saving || readOnly}
          readOnly={readOnly}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
          className={`w-full px-3 py-2.5 text-sm font-sans text-coda-text border border-black/[0.06] dark:border-white/[0.08] rounded-xl outline-none transition-colors placeholder:text-coda-text-muted/50 ${
            readOnly
              ? 'bg-black/[0.02] dark:bg-white/[0.03] cursor-default'
              : 'bg-black/[0.03] dark:bg-white/[0.05] focus:border-coda-brand/40 focus:bg-transparent'
          }`}
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

export function ProfileEditor({ profile, onUpdate, email }: ProfileEditorProps) {
  const handleSave = async (field: string, value: string) => {
    await onUpdate({ [field]: value });
  };

  // Split full_name into first/last for the XD two-column layout
  const nameParts = (profile.full_name || '').split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  // When first or last name changes, save as combined full_name
  const handleNameSave = async (field: string, value: string) => {
    const newFirst = field === 'first_name' ? value : firstName;
    const newLast = field === 'last_name' ? value : lastName;
    const combined = [newFirst, newLast].filter(Boolean).join(' ');
    await onUpdate({ full_name: combined });
  };

  return (
    <div className="space-y-4">
      {/* First Name / Last Name */}
      <div className="flex gap-4">
        <FormField label="First Name" value={firstName} field="first_name" placeholder="First name" onSave={handleNameSave} />
        <FormField label="Last Name" value={lastName} field="last_name" placeholder="Last name" onSave={handleNameSave} />
      </div>

      {/* Email with verified badge */}
      {email && (
        <div>
          <label className="block text-[11px] font-medium text-coda-text-muted mb-1.5">Email</label>
          <div className="flex items-center gap-3">
            <div className="flex-1 px-3 py-2.5 text-sm text-coda-text bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.08] rounded-xl">
              {email}
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500 whitespace-nowrap">
              <Check size={10} /> Verified
            </span>
          </div>
        </div>
      )}

      {/* Title / Department */}
      <div className="flex gap-4">
        <FormField label="Title" value={profile.title} field="title" placeholder="e.g. Compliance Officer" onSave={handleSave} />
        <FormField label="Department" value={profile.department} field="department" placeholder="e.g. Digital Assets" onSave={handleSave} />
      </div>

      {/* Institution */}
      <FormField label="Institution" value={profile.institution} field="institution" placeholder="e.g. JPMorgan Chase" onSave={handleSave} />

      {/* Phone / Timezone */}
      <div className="flex gap-4">
        <FormField label="Phone" value={profile.phone} field="phone" placeholder="+1 (555) 123-4567" onSave={handleSave} />
        <FormField label="Timezone" value={profile.timezone} field="timezone" placeholder="America/New_York" onSave={handleSave} />
      </div>
    </div>
  );
}
