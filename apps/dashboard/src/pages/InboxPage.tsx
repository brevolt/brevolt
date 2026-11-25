import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNotify } from '../components/Toast.js';
import {
  api,
  type ApiResult,
  type ConflictRow,
  type ContactRef,
  type ProposalRow,
  type SnapshotView,
} from '../lib/api.js';
import { decisionsQuery } from '../lib/queries.js';

const SYSTEMS = { icloud: 'iCloud', google: 'Google', obsidian: 'Obsidian' } as const;

export function contactName(c: ContactRef): string {
  const name = [c.givenName, c.familyNames].filter(Boolean).join(' ');
  return name || c.company || 'Unnamed contact';
}

interface EntryValue {
  kind?: string;
  label?: string;
  value?: string;
}

/** Splits `fields:<kind>:<normalized>`; scalar fields come back as `null`. */
export function entryKind(field: string): string | null {
  return /^fields:(phone|email|address|url):/.exec(field)?.[1] ?? null;
}

export function fieldTitle(field: string): string {
  const kind = entryKind(field);
  return kind ? `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}` : field;
}

/** Human text for one side of a conflict: a scalar, a list entry, or nothing. */
export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const e = value as EntryValue;
    if (typeof e.value === 'string') return e.label ? `${e.label}: ${e.value}` : e.value;
  }
  return JSON.stringify(value);
}

function Value({ label, value, testId }: { label: string; value: string | null; testId: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-3">
      <div className="label">{label}</div>
      <div
        data-testid={testId}
        className={`break-words text-sm ${value ? '' : 'text-muted-foreground'}`}
      >
        {value ?? '(empty)'}
      </div>
    </div>
  );
}

function Card({
  testId,
  title,
  badge,
  children,
}: {
  testId: string;
  title: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <li data-testid={testId} className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {badge}
        </span>
      </div>
      {children}
    </li>
  );
}

/** Runs a decision, refreshes the inbox and keeps the user on the page. */
function useDecision(success: string) {
  const qc = useQueryClient();
  const notify = useNotify();
  return useMutation({
    mutationFn: async (run: () => Promise<ApiResult<unknown>>) => {
      const res = await run();
      if (!res.ok) throw new Error(res.error ?? String(res.status));
    },
    onSuccess: async () => {
      notify(success);
      await qc.invalidateQueries({ queryKey: ['decisions'] });
      await qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: async (e: Error) => {
      notify(
        e.message === 'already_resolved'
          ? 'Already resolved elsewhere.'
          : 'Could not apply the decision.',
      );
      await qc.invalidateQueries({ queryKey: ['decisions'] });
    },
  });
}

function ConflictCard({ row }: { row: ConflictRow }) {
  const decide = useDecision('Conflict resolved');
  const [manual, setManual] = useState(false);
  const kind = entryKind(row.field);
  const hubEntry = (row.hubValue ?? row.externalValue) as EntryValue | null;
  const [label, setLabel] = useState(kind ? (hubEntry?.label ?? '') : '');
  const [text, setText] = useState('');
  const busy = decide.isPending;

  const manualValue = (): unknown => {
    if (!kind) return text.trim() === '' ? null : text;
    return text.trim() === '' ? null : { label, value: text };
  };

  return (
    <Card
      testId="conflict-card"
      title={`${contactName(row.contact)} · ${fieldTitle(row.field)}`}
      badge={`Conflict · ${SYSTEMS[row.system]}`}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Value label="Base (last synced)" value={formatValue(row.base)} testId="value-base" />
        <Value label="Hub" value={formatValue(row.hubValue)} testId="value-hub" />
        <Value
          label={SYSTEMS[row.system]}
          value={formatValue(row.externalValue)}
          testId="value-external"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            decide.mutate(() => api.resolveConflict(row.id, { resolution: 'hub' }));
          }}
        >
          Keep hub
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            decide.mutate(() => api.resolveConflict(row.id, { resolution: 'external' }));
          }}
        >
          Use {SYSTEMS[row.system]}
        </button>
        {!manual && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setManual(true);
            }}
          >
            Enter a value…
          </button>
        )}
      </div>
      {manual && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate(() =>
              api.resolveConflict(row.id, { resolution: 'manual', value: manualValue() }),
            );
          }}
        >
          {kind && (
            <div>
              <label className="label" htmlFor={`label-${row.id}`}>
                Label
              </label>
              <input
                id={`label-${row.id}`}
                className="input"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
              />
            </div>
          )}
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor={`manual-${row.id}`}>
              Custom value
            </label>
            <input
              id={`manual-${row.id}`}
              className="input"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save value
          </button>
        </form>
      )}
    </Card>
  );
}

function summarize(s: SnapshotView | null): string | null {
  if (!s) return null;
  const lines = [
    [s.givenName, s.familyNames].filter(Boolean).join(' '),
    s.company ?? '',
    ...s.fields.map((f) => `${f.label}: ${f.value}`),
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

function ProposalCard({ row }: { row: ProposalRow }) {
  const decide = useDecision('Decision saved');
  const busy = decide.isPending;
  const merge = row.type === 'merge';
  const system = SYSTEMS[row.system];
  return (
    <Card
      testId="proposal-card"
      title={contactName(row.contact)}
      badge={merge ? `Merge proposal · ${system}` : `Deleted in ${system}`}
    >
      {merge ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Value label="Base" value={null} testId="value-base" />
            <div className="whitespace-pre-line">
              <Value label="Hub" value={summarize(row.hub)} testId="value-hub" />
            </div>
            <div className="whitespace-pre-line">
              <Value label={system} value={summarize(row.external)} testId="value-external" />
            </div>
          </div>
          {row.reason && (
            <p className="mt-2 text-xs text-muted-foreground">Matched on {row.reason}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This contact no longer exists in {system}. Accepting deletes it from the hub and every
          other system; rejecting keeps it and recreates it in {system}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={merge ? 'btn btn-primary' : 'btn btn-danger'}
          disabled={busy}
          onClick={() => {
            decide.mutate(() => api.acceptProposal(row.id));
          }}
        >
          {merge ? 'Merge into this contact' : 'Delete everywhere'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            decide.mutate(() => api.rejectProposal(row.id));
          }}
        >
          {merge ? 'Keep separate' : 'Keep contact'}
        </button>
      </div>
    </Card>
  );
}

export function InboxPage() {
  const { data, isPending, isError } = useQuery(decisionsQuery());
  const total = data ? data.conflicts.length + data.proposals.length : 0;
  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-4">
      <h1 className="mb-4 text-lg font-medium">
        Inbox{' '}
        <span data-testid="inbox-total" className="text-sm text-muted-foreground">
          {total} pending
        </span>
      </h1>
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the decisions.
        </p>
      )}
      {data && total === 0 && (
        <p data-testid="inbox-empty" className="text-sm text-muted-foreground">
          Nothing needs your decision.
        </p>
      )}
      {data && total > 0 && (
        <ul className="space-y-3">
          {data.conflicts.map((c) => (
            <ConflictCard key={c.id} row={c} />
          ))}
          {data.proposals.map((p) => (
            <ProposalCard key={p.id} row={p} />
          ))}
        </ul>
      )}
    </div>
  );
}
