import { useState, useRef, useEffect } from 'react';
import { Pencil, Check, X, Building2, Phone, Briefcase, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ============================================================
// ProfileEditor — Inline-editable profile fields
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

interface EditableFieldProps {
  icon: LucideIcon;
  label: string;
  value: string | null;
  field: string;
  onSave: (field: string, value: string) => Promise<void>;
}

function EditableField({ icon: Icon, label, value, field, onSave }: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const handleSave = async () => {
    const trimmed = editValue.trim();
    if (trimmed === (value || '')) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(field, trimmed);
      setIsEditing(false);
    } catch {
      // Keep editing on error
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value || '');
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-3 group">
      <Icon size={16} className="text-coda-text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-coda-text-muted">{label}</p>
        {isEditing ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancel();
              }}
              disabled={saving}
              className="flex-1 text-sm font-sans text-coda-text bg-transparent border-b border-coda-brand outline-none px-0 py-0.5"
              placeholder={`Enter ${label.toLowerCase()}`}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="p-0.5 cursor-pointer"
            >
              <Check size={14} className="text-coda-brand" />
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="p-0.5 cursor-pointer"
            >
              <X size={14} className="text-coda-text-muted" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setEditValue(value || ''); setIsEditing(true); }}
            className="group/edit relative cursor-pointer bg-transparent border-none p-0 text-left w-full"
          >
            <p className="text-sm font-sans text-coda-text">
              {value || <span className="text-coda-text-muted italic">Not set</span>}
            </p>
            <Pencil
              size={10}
              className="absolute -right-4 top-1/2 -translate-y-1/2 text-coda-text-muted opacity-0 group-hover/edit:opacity-100 transition-opacity"
            />
          </button>
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
    <div className="space-y-3">
      <EditableField
        icon={Building2}
        label="Institution"
        value={profile.institution}
        field="institution"
        onSave={handleSave}
      />
      <EditableField
        icon={Briefcase}
        label="Title"
        value={profile.title}
        field="title"
        onSave={handleSave}
      />
      <EditableField
        icon={Briefcase}
        label="Department"
        value={profile.department}
        field="department"
        onSave={handleSave}
      />
      <EditableField
        icon={Phone}
        label="Phone"
        value={profile.phone}
        field="phone"
        onSave={handleSave}
      />
      <EditableField
        icon={Clock}
        label="Timezone"
        value={profile.timezone}
        field="timezone"
        onSave={handleSave}
      />
    </div>
  );
}
