import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ContactForm, draftOf } from '../components/ContactForm.js';
import { useNotify } from '../components/Toast.js';
import { api, newOperationId, type Contact, type Draft } from '../lib/api.js';
import { contactQuery, historyQuery } from '../lib/queries.js';
import { displayName } from '../lib/window.js';

export function ContactDetailPage() {
  const { id } = useParams({ from: '/app/contacts/$id' });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useNotify();
  const contactQ = useQuery(contactQuery(id));
  const historyQ = useQuery(historyQuery(id));
  const contact = contactQ.data;
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Draft | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);

  useEffect(() => {
    setEditing(false);
    setPending(null);
    setConflictVersion(null);
  }, [id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['contacts'] });

  const undo = async (operationId: string) => {
    const res = await api.undo(operationId);
    if (res.ok) {
      notify('Change undone.');
      await refresh();
    } else if (res.status === 409) {
      notify(`Cannot undo: the contact changed since (${(res.fields ?? []).join(', ')}).`);
    } else {
      notify('Could not undo that change.');
    }
  };

  const save = useMutation({
    mutationFn: async ({ draft, version }: { draft: Draft; version: number }) => {
      const operationId = newOperationId();
      const res = await api.update(id, draft, version, operationId);
      return { res, draft, operationId };
    },
    onSuccess: async ({ res, draft, operationId }) => {
      if (res.ok) {
        setEditing(false);
        setConflictVersion(null);
        setPending(null);
        notify('Contact saved.', () => {
          void undo(operationId);
        });
        await refresh();
      } else if (res.status === 412) {
        setPending(draft);
        setConflictVersion(res.currentVersion ?? null);
      } else {
        notify('Could not save the contact.');
      }
    },
  });

  const remove = async (c: Contact) => {
    if (!window.confirm(`Delete ${displayName(c)}?`)) return;
    const operationId = newOperationId();
    const res = await api.remove(c.id, c.version, operationId);
    if (res.ok) {
      await refresh();
      await navigate({ to: '/contacts', search: (p) => p });
      notify('Contact deleted.', () => {
        void undo(operationId);
      });
    } else if (res.status === 412) {
      notify('The contact changed meanwhile. Review it and try again.');
      await refresh();
    } else {
      notify('Could not delete the contact.');
    }
  };

  if (contactQ.isPending) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!contact) return <p className="p-6">This contact no longer exists.</p>;

  if (editing) {
    return (
      <section aria-label="Edit contact" className="mx-auto max-w-3xl p-4 md:p-6">
        <h2 className="mb-4 text-xl font-semibold">Edit {displayName(contact)}</h2>
        {conflictVersion !== null && (
          <div
            role="alert"
            data-testid="conflict-warning"
            className="mb-4 space-y-2 rounded-lg border border-warn bg-warn/10 p-3 text-sm"
          >
            <p>
              Someone changed this contact while you were editing (now version{' '}
              {String(conflictVersion)}, you started from {String(contact.version)}).
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void contactQ.refetch().then(() => {
                    setEditing(false);
                    setConflictVersion(null);
                    setPending(null);
                  });
                }}
              >
                Load latest and discard my changes
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (pending) save.mutate({ draft: pending, version: conflictVersion });
                }}
              >
                Overwrite with my changes
              </button>
            </div>
          </div>
        )}
        <ContactForm
          key={`${contact.id}-${String(contact.version)}`}
          initial={pending ?? draftOf(contact)}
          saving={save.isPending}
          submitLabel="Save"
          onSubmit={(d) => {
            save.mutate({ draft: d, version: contact.version });
          }}
          onCancel={() => {
            setEditing(false);
            setConflictVersion(null);
            setPending(null);
          }}
        />
      </section>
    );
  }

  const byKind = (k: string) => contact.fields.filter((f) => f.kind === k);
  const groups = [
    ['Phones', byKind('phone')],
    ['Emails', byKind('email')],
    ['Addresses', byKind('address')],
    ['Links', byKind('url')],
  ] as const;

  return (
    <section aria-label="Contact" className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <Link to="/contacts" search={(p) => p} className="text-sm text-muted-foreground md:hidden">
        ← Contacts
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold" data-testid="contact-name">
            {displayName(contact)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[contact.jobTitle, contact.company].filter(Boolean).join(' · ')} · version{' '}
            {String(contact.version)}
          </p>
          {contact.tags.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-2" data-testid="contact-tags">
              {contact.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-primary"
                >
                  #{t}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void remove(contact)}>
            Delete
          </button>
        </div>
      </div>

      <dl className="space-y-4">
        {contact.birthday && (
          <div>
            <dt className="label">Birthday</dt>
            <dd className="text-sm">{contact.birthday}</dd>
          </div>
        )}
        {groups.map(([title, list]) =>
          list.length ? (
            <div key={title}>
              <dt className="label">{title}</dt>
              {list.map((f) => (
                <dd key={f.id} className="text-sm">
                  {f.value} <span className="text-xs text-muted-foreground">{f.label}</span>
                </dd>
              ))}
            </div>
          ) : null,
        )}
        {Object.entries(contact.custom).map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="text-sm">{v}</dd>
          </div>
        ))}
      </dl>
      {contact.noteMd && (
        <pre className="whitespace-pre-wrap rounded-lg border border-border bg-card p-3 font-mono text-sm">
          {contact.noteMd}
        </pre>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">History</h3>
        <ul
          data-testid="history"
          className="divide-y divide-border rounded-lg border border-border"
        >
          {(historyQ.data ?? []).map((h) => (
            <li
              key={h.operationId}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">
                {new Date(h.ts).toLocaleString()} · {h.actor} · {h.fields.join(', ')}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void undo(h.operationId);
                }}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
