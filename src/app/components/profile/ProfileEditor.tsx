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
      <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">{label}</label>
      <div className="relative">
        <input
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={saving || readOnly}
          readOnly={readOnly}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
          className={`w-full px-4 py-3 text-[14px] font-sans text-black/70 dark:text-white/70 border-none rounded-lg outline-none transition-colors placeholder:text-black/30 dark:placeholder:text-white/30 ${
            readOnly
              ? 'bg-black/[0.03] dark:bg-white/[0.04] cursor-default'
              : 'bg-black/[0.03] dark:bg-white/[0.04] focus:bg-black/[0.05] dark:focus:bg-white/[0.06] focus:ring-1 focus:ring-black/10 dark:focus:ring-white/10'
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

// ── Phone formatting ──

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // US format: +1 (XXX) XXX-XXXX
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits[0]} (${digits.slice(1)}`;
  if (digits.length <= 7) return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 11) return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
}

function PhoneField({ label, value, field, onSave }: {
  label: string; value: string | null; field: string; onSave: (field: string, value: string) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(value ? formatPhone(value) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setLocalValue(value ? formatPhone(value) : ''); }, [value]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setLocalValue(formatted);
  };

  const handleBlur = async () => {
    const digits = localValue.replace(/\D/g, '');
    const raw = digits ? `+${digits}` : '';
    if (raw === (value || '')) return;
    setSaving(true);
    try {
      await onSave(field, raw);
      setSaved(true);
      timerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch {
      setLocalValue(value ? formatPhone(value) : '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 min-w-0">
      <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">{label}</label>
      <div className="relative">
        <input
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          disabled={saving}
          placeholder="+1 (555) 123-4567"
          type="tel"
          className="w-full px-4 py-3 text-[14px] font-sans text-black/70 dark:text-white/70 border-none rounded-lg outline-none transition-colors placeholder:text-black/30 dark:placeholder:text-white/30 bg-black/[0.03] dark:bg-white/[0.04] focus:bg-black/[0.05] dark:focus:bg-white/[0.06] focus:ring-1 focus:ring-black/10 dark:focus:ring-white/10"
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

// ── Timezone selector ──

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function TimezoneField({ value, onSave }: {
  value: string; onSave: (field: string, value: string) => Promise<void>;
}) {
  const displayValue = value || BROWSER_TZ;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTz = e.target.value;
    if (newTz === value) return;
    setSaving(true);
    try {
      await onSave('timezone', newTz);
      setSaved(true);
      timerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch {} finally {
      setSaving(false);
    }
  };

  // Common timezones for financial institutions
  const timezones = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'Pacific/Honolulu',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Zurich',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Dubai',
    'Australia/Sydney',
  ];

  // Ensure browser TZ and current value are in the list
  const allTzs = [...new Set([displayValue, BROWSER_TZ, ...timezones])].sort();

  return (
    <div className="flex-1 min-w-0">
      <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Timezone</label>
      <div className="relative">
        <select
          value={displayValue}
          onChange={handleChange}
          disabled={saving}
          className="w-full px-4 py-3 text-[14px] font-sans text-black/70 dark:text-white/70 border-none rounded-lg outline-none transition-colors appearance-none cursor-pointer bg-black/[0.03] dark:bg-white/[0.04] focus:bg-black/[0.05] dark:focus:bg-white/[0.06] focus:ring-1 focus:ring-black/10 dark:focus:ring-white/10"
        >
          {allTzs.map(tz => (
            <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
          ))}
        </select>
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
    <div className="space-y-5">
      {/* First Name / Last Name */}
      <div className="flex gap-4">
        <FormField label="First Name" value={firstName} field="first_name" placeholder="First name" onSave={handleNameSave} />
        <FormField label="Last Name" value={lastName} field="last_name" placeholder="Last name" onSave={handleNameSave} />
      </div>

      {/* Email with verified badge */}
      {email && (
        <div>
          <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Email</label>
          <div className="flex items-center gap-3">
            <div className="flex-1 px-4 py-3 text-[14px] text-black/70 dark:text-white/70 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">
              {email}
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-medium border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              <span className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center"><Check size={10} className="text-emerald-500" /></span>
              Email verified
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
        <PhoneField label="Phone" value={profile.phone} field="phone" onSave={handleSave} />
        <TimezoneField value={profile.timezone} onSave={handleSave} />
      </div>
    </div>
  );
}
