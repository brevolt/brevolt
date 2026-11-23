import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNotify } from '../components/Toast.js';
import { api, type SyncDiffEntry } from '../lib/api.js';
import { syncQuery } from '../lib/queries.js';

const ACTION_LABEL: Record<SyncDiffEntry['action'], string> = {
  create: 'Would create',
  update: 'Would update',
  delete: 'Would delete',
};

function DiffEntry({ entry }: { entry: SyncDiffEntry }) {
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">
        {ACTION_LABEL[entry.action]}: {entry.name}
      </p>
      {entry.changes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {entry.changes.map((c, i) => (
            <li key={`${c.field}-${String(i)}`}>
              {c.field}: {c.before ?? '—'} → {c.after ?? '—'}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SyncPage() {
  const notify = useNotify();
  const client = useQueryClient();
  const sync = useQuery(syncQuery());
  const [confirming, setConfirming] = useState(false);

  const toggle = useMutation({
    mutationFn: async (v: { enabled: boolean; confirm?: boolean }) => {
      const res = await api.setDryRun(v.enabled, v.confirm);
      if (!res.ok) throw new Error('toggle failed');
      return res.value;
    },
    onSuccess: (state) => {
      client.setQueryData(syncQuery().queryKey, state);
      setConfirming(false);
      notify(state.dryRun ? 'Dry-run turned on' : 'Sync enabled');
    },
    onError: () => {
      notify('Could not change the sync mode');
    },
  });

  if (sync.isPending) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!sync.data) return <p className="p-6">Could not load the sync state.</p>;
  const { dryRun, diff } = sync.data;

  return (
    <div className="mx-auto h-full max-w-3xl space-y-6 overflow-y-auto p-4 md:p-6">
      <h1 className="text-xl font-semibold">iCloud sync</h1>

      {dryRun ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-semibold">Dry-run is on</h2>
          <p className="text-sm text-muted-foreground">
            Nothing is written to iCloud. Review what would change, then enable sync.
          </p>
          {confirming ? (
            <div className="space-y-2" role="alertdialog" aria-label="Confirm enabling sync">
              <p className="text-sm">
                Enabling sync lets the bridge write {String(diff.length)} change
                {diff.length === 1 ? '' : 's'} to your real address book. Continue?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={toggle.isPending}
                  onClick={() => {
                    toggle.mutate({ enabled: false, confirm: true });
                  }}
                >
                  Yes, enable sync
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Enable sync
            </button>
          )}
        </section>
      ) : (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-semibold">Sync is on</h2>
          <button
            type="button"
            className="btn"
            disabled={toggle.isPending}
            onClick={() => {
              toggle.mutate({ enabled: true });
            }}
          >
            Turn dry-run back on
          </button>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">{dryRun ? 'Pending diff' : 'Changes not yet sent'}</h2>
        {diff.length ? (
          <ul className="space-y-2" aria-label="Sync diff">
            {diff.map((e) => (
              <DiffEntry key={e.contact_id} entry={e} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing to write.</p>
        )}
      </section>
    </div>
  );
}
