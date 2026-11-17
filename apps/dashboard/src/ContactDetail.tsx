import { useCallback, useEffect, useState } from 'react';
import { ContactForm, draftOf } from './ContactForm.js';
import { api, newOperationId, type Contact, type Draft, type HistoryEntry } from './lib/api.js';
import { displayName } from './lib/window.js';

interface Props {
  id: string;
  onChanged: () => void;
  onDeleted: (undo: () => void) => void;
  notify: (message: string, undo?: () => void) => void;
}

export function ContactDetail({ id, onChanged, onDeleted, notify }: Props) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Draft | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const load = useCallback(async () => {
    const res = await api.get(id);
    if (res.ok) {
      setContact(res.value);
      setMissing(false);
    } else {
      setContact(null);
      setMissing(true);
    }
    const h = await api.history(id);
    setHistory(h.ok ? h.value.history : []);
  }, [id]);

  useEffect(() => {
    setEditing(false);
    setConflictVersion(null);
    setPending(null);
    void load();
  }, [load]);

  const save = async (draft: Draft, version: number) => {
    if (!contact) return;
    setSaving(true);
    const operationId = newOperationId();
    const res = await api.update(contact.id, draft, version, operationId);
    setSaving(false);
    if (res.ok) {
      setContact(res.value);
      setEditing(false);
      setConflictVersion(null);
      setPending(null);
      notify('Contact saved.', () => {
        void undo(operationId);
      });
      onChanged();
      void load();
    } else if (res.status === 412) {
      setPending(draft);
      setConflictVersion(res.currentVersion ?? null);
    } else {
      notify('Could not save the contact.');
    }
  };

  const undo = async (operationId: string) => {
    const res = await api.undo(operationId);
    if (res.ok) {
      notify('Change undone.');
      onChanged();
      void load();
    } else if (res.status === 409) {
      notify(`Cannot undo: the contact changed since (${(res.fields ?? []).join(', ')}).`);
    } else {
      notify('Could not undo that change.');
    }
  };

  const remove = async () => {
    if (!contact || !window.confirm(`Delete ${displayName(contact)}?`)) return;
    const operationId = newOperationId();
    const res = await api.remove(contact.id, contact.version, operationId);
    if (res.ok) {
      onDeleted(() => {
        void undo(operationId);
      });
      onChanged();
    } else if (res.status === 412) {
      notify('The contact changed meanwhile. Review it and try again.');
      void load();
    } else {
      notify('Could not delete the contact.');
    }
  };

  if (missing) return <p>This contact no longer exists.</p>;
  if (!contact) return <p>Loading…</p>;

  if (editing) {
    return (
      <section aria-label="Edit contact">
        <h2>Edit {displayName(contact)}</h2>
        {conflictVersion !== null && (
          <div role="alert" className="warning" data-testid="conflict-warning">
            <p>
              Someone changed this contact while you were editing (now version{' '}
              {String(conflictVersion)}, you started from {String(contact.version)}).
            </p>
            <button
              type="button"
              onClick={() => {
                void load().then(() => {
                  setEditing(false);
                  setConflictVersion(null);
                });
              }}
            >
              Load latest and discard my changes
            </button>
            <button
              type="button"
              onClick={() => {
                if (pending) void save(pending, conflictVersion);
              }}
            >
              Overwrite with my changes
            </button>
          </div>
        )}
        <ContactForm
          key={`${contact.id}-${String(contact.version)}`}
          initial={pending ?? draftOf(contact)}
          saving={saving}
          submitLabel="Save"
          onSubmit={(d) => void save(d, contact.version)}
          onCancel={() => {
            setEditing(false);
            setConflictVersion(null);
          }}
        />
      </section>
    );
  }

  return (
    <section aria-label="Contact">
      <h2 data-testid="contact-name">{displayName(contact)}</h2>
      <p className="muted">
        {[contact.jobTitle, contact.company].filter(Boolean).join(' · ')} · version{' '}
        {String(contact.version)}
      </p>
      <div className="inline">
        <button
          type="button"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button type="button" onClick={() => void remove()}>
          Delete
        </button>
      </div>
      <dl>
        {contact.birthday && (
          <>
            <dt>Birthday</dt>
            <dd>{contact.birthday}</dd>
          </>
        )}
        {contact.fields.map((f) => (
          <div key={f.id}>
            <dt>
              {f.kind} · {f.label}
            </dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        {contact.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{contact.tags.join(', ')}</dd>
          </>
        )}
        {Object.entries(contact.custom).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {contact.noteMd && <pre className="note">{contact.noteMd}</pre>}

      <h3>History</h3>
      <ul className="history" data-testid="history">
        {history.map((h) => (
          <li key={h.operationId}>
            <span>
              {new Date(h.ts).toLocaleString()} · {h.actor} · {h.fields.join(', ')}
            </span>
            <button
              type="button"
              onClick={() => {
                void undo(h.operationId);
              }}
            >
              Undo
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
