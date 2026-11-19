import { useState } from 'react';
import type { Contact, Draft, Field } from '../lib/api.js';

export const emptyDraft = (): Draft => ({
  prefix: null,
  givenName: null,
  middleName: null,
  familyNames: null,
  suffix: null,
  nickname: null,
  company: null,
  jobTitle: null,
  birthday: null,
  noteMd: '',
  fields: [],
  tags: [],
  custom: {},
});

export function draftOf(c: Contact): Draft {
  return {
    prefix: c.prefix,
    givenName: c.givenName,
    middleName: c.middleName,
    familyNames: c.familyNames,
    suffix: c.suffix,
    nickname: c.nickname,
    company: c.company,
    jobTitle: c.jobTitle,
    birthday: c.birthday,
    noteMd: c.noteMd,
    fields: c.fields.map(({ kind, label, value }) => ({ kind, label, value })),
    tags: [...c.tags],
    custom: { ...c.custom },
  };
}

const SCALARS = [
  ['prefix', 'Prefix'],
  ['givenName', 'Given name'],
  ['middleName', 'Middle name'],
  ['familyNames', 'Family names'],
  ['suffix', 'Suffix'],
  ['nickname', 'Nickname'],
  ['company', 'Company'],
  ['jobTitle', 'Job title'],
  ['birthday', 'Birthday (YYYY-MM-DD or --MM-DD)'],
] as const;

interface Props {
  initial: Draft;
  saving: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}

/** Empty strings become null so cleared fields are removed rather than stored blank. */
function clean(d: Draft): Draft {
  const out = { ...d };
  for (const [k] of SCALARS) out[k] = out[k]?.trim() ? out[k].trim() : null;
  out.fields = d.fields
    .map((f) => ({ ...f, label: f.label.trim() || 'other', value: f.value.trim() }))
    .filter((f) => f.value);
  out.tags = [...new Set(d.tags.map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];
  out.custom = Object.fromEntries(
    Object.entries(d.custom)
      .filter(([k]) => k.trim())
      .map(([k, v]) => [k.trim(), v]),
  );
  return out;
}

const removeBtn = 'btn px-2 text-muted-foreground hover:text-destructive';

export function ContactForm({ initial, saving, submitLabel, onSubmit, onCancel }: Props) {
  const [d, setD] = useState<Draft>(initial);
  const [tagText, setTagText] = useState(initial.tags.join(', '));
  const [customRows, setCustomRows] = useState<[string, string][]>(Object.entries(initial.custom));

  const setField = (i: number, patch: Partial<Field>) => {
    setD((prev) => ({
      ...prev,
      fields: prev.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    }));
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(clean({ ...d, tags: tagText.split(','), custom: Object.fromEntries(customRows) }));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {SCALARS.map(([key, label]) => (
          <label key={key} className="block">
            <span className="label">{label}</span>
            <input
              className="input"
              value={d[key] ?? ''}
              onChange={(e) => {
                setD((prev) => ({ ...prev, [key]: e.target.value }));
              }}
            />
          </label>
        ))}
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Phones, emails, addresses and links</legend>
        {d.fields.map((f, i) => (
          <div className="flex flex-wrap gap-2" key={i}>
            <select
              className="input w-auto"
              aria-label="Kind"
              value={f.kind}
              onChange={(e) => {
                setField(i, { kind: e.target.value as Field['kind'] });
              }}
            >
              <option value="phone">phone</option>
              <option value="email">email</option>
              <option value="address">address</option>
              <option value="url">url</option>
            </select>
            <input
              className="input w-28"
              aria-label="Label"
              placeholder="label"
              value={f.label}
              onChange={(e) => {
                setField(i, { label: e.target.value });
              }}
            />
            <input
              className="input min-w-0 flex-1"
              aria-label="Value"
              placeholder="value"
              value={f.value}
              onChange={(e) => {
                setField(i, { value: e.target.value });
              }}
            />
            <button
              type="button"
              className={removeBtn}
              aria-label="Remove field"
              onClick={() => {
                setD((prev) => ({ ...prev, fields: prev.fields.filter((_, j) => j !== i) }));
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setD((prev) => ({
              ...prev,
              fields: [...prev.fields, { kind: 'phone', label: 'mobile', value: '' }],
            }));
          }}
        >
          + Add field
        </button>
      </fieldset>

      <label className="block">
        <span className="label">Tags (comma separated)</span>
        <input
          className="input"
          value={tagText}
          onChange={(e) => {
            setTagText(e.target.value);
          }}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="label">Custom fields</legend>
        {customRows.map(([k, v], i) => (
          <div className="flex flex-wrap gap-2" key={i}>
            <input
              className="input w-40"
              aria-label="Custom key"
              placeholder="key"
              value={k}
              onChange={(e) => {
                setCustomRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)));
              }}
            />
            <input
              className="input min-w-0 flex-1"
              aria-label="Custom value"
              placeholder="value"
              value={v}
              onChange={(e) => {
                setCustomRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)));
              }}
            />
            <button
              type="button"
              className={removeBtn}
              aria-label="Remove custom field"
              onClick={() => {
                setCustomRows((rows) => rows.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setCustomRows((rows) => [...rows, ['', '']]);
          }}
        >
          + Add custom field
        </button>
      </fieldset>

      <label className="block">
        <span className="label">Note (Markdown)</span>
        <textarea
          className="input font-mono"
          rows={8}
          value={d.noteMd}
          onChange={(e) => {
            setD((prev) => ({ ...prev, noteMd: e.target.value }));
          }}
        />
      </label>

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
