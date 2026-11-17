import { useState } from 'react';
import type { Contact, Draft, Field } from './lib/api.js';

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
  out.tags = [...new Set(d.tags.map((t) => t.trim()).filter(Boolean))];
  out.custom = Object.fromEntries(
    Object.entries(d.custom)
      .filter(([k]) => k.trim())
      .map(([k, v]) => [k.trim(), v]),
  );
  return out;
}

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
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          clean({
            ...d,
            tags: tagText.split(','),
            custom: Object.fromEntries(customRows),
          }),
        );
      }}
    >
      <div className="grid">
        {SCALARS.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={d[key] ?? ''}
              onChange={(e) => {
                setD((prev) => ({ ...prev, [key]: e.target.value }));
              }}
            />
          </label>
        ))}
      </div>

      <fieldset>
        <legend>Phones, emails, addresses and links</legend>
        {d.fields.map((f, i) => (
          <div className="inline" key={i}>
            <select
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
              aria-label="Label"
              placeholder="label"
              value={f.label}
              onChange={(e) => {
                setField(i, { label: e.target.value });
              }}
            />
            <input
              aria-label="Value"
              placeholder="value"
              value={f.value}
              onChange={(e) => {
                setField(i, { value: e.target.value });
              }}
            />
            <button
              type="button"
              aria-label="Remove field"
              onClick={() => {
                setD((prev) => ({ ...prev, fields: prev.fields.filter((_, j) => j !== i) }));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setD((prev) => ({
              ...prev,
              fields: [...prev.fields, { kind: 'phone', label: 'mobile', value: '' }],
            }));
          }}
        >
          Add field
        </button>
      </fieldset>

      <label>
        Tags (comma separated)
        <input
          value={tagText}
          onChange={(e) => {
            setTagText(e.target.value);
          }}
        />
      </label>

      <fieldset>
        <legend>Custom fields</legend>
        {customRows.map(([k, v], i) => (
          <div className="inline" key={i}>
            <input
              aria-label="Custom key"
              placeholder="key"
              value={k}
              onChange={(e) => {
                setCustomRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)));
              }}
            />
            <input
              aria-label="Custom value"
              placeholder="value"
              value={v}
              onChange={(e) => {
                setCustomRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)));
              }}
            />
            <button
              type="button"
              aria-label="Remove custom field"
              onClick={() => {
                setCustomRows((rows) => rows.filter((_, j) => j !== i));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustomRows((rows) => [...rows, ['', '']]);
          }}
        >
          Add custom field
        </button>
      </fieldset>

      <label>
        Note (Markdown)
        <textarea
          rows={8}
          value={d.noteMd}
          onChange={(e) => {
            setD((prev) => ({ ...prev, noteMd: e.target.value }));
          }}
        />
      </label>

      <div className="inline">
        <button type="submit" disabled={saving}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
