import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNotify } from '../components/Toast.js';
import { api, type CreatedToken, type TokenRow } from '../lib/api.js';
import { settingsQuery } from '../lib/queries.js';

const KINDS: { value: TokenRow['kind']; label: string }[] = [
  { value: 'bridge-macos', label: 'macOS bridge' },
  { value: 'obsidian', label: 'Obsidian plugin' },
];

function NewToken({ token, onDismiss }: { token: CreatedToken; onDismiss: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copy = () => {
    navigator.clipboard.writeText(token.token).then(
      () => {
        setCopied('ok');
      },
      () => {
        setCopied('failed');
      },
    );
  };
  return (
    <section
      id="new-token"
      role="status"
      className="space-y-2 rounded-lg border border-primary bg-card p-4"
    >
      <h2 className="font-semibold">Token created: {token.name}</h2>
      <p className="text-sm text-muted-foreground">Copy it now. It will not be shown again.</p>
      <div className="flex gap-2">
        <input
          className="input font-mono"
          aria-label="Token value"
          readOnly
          value={token.token}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
        <button type="button" className="btn btn-primary" onClick={copy}>
          Copy
        </button>
        <button type="button" className="btn" onClick={onDismiss}>
          Done
        </button>
      </div>
      <p aria-live="polite" className="text-sm text-ok">
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : ''}
      </p>
    </section>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const notify = useNotify();
  const settings = useQuery(settingsQuery());
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TokenRow['kind']>('bridge-macos');
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [region, setRegion] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['settings'] });

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.createToken({ name: name.trim(), kind });
      if (!res.ok) throw new Error('create failed');
      return res.value;
    },
    onSuccess: async (t) => {
      setCreated(t);
      setName('');
      await refresh();
    },
    onError: () => {
      notify('Enter a name and a client.');
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.revokeToken(id);
      if (!res.ok) throw new Error('revoke failed');
    },
    onSuccess: refresh,
    onError: () => {
      notify('Could not revoke the token.');
    },
  });

  const saveRegion = useMutation({
    mutationFn: async (value: string) => {
      const res = await api.saveRegion(value);
      if (!res.ok) throw new Error('invalid');
      return res.value.region;
    },
    onSuccess: async (r) => {
      setRegion(null);
      notify(`Default region saved: ${r}.`);
      await refresh();
    },
    onError: () => {
      notify('Enter a valid two-letter region code.');
    },
  });

  if (settings.isPending) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!settings.data) return <p className="p-6">Could not load the settings.</p>;
  const data = settings.data;
  const systems = Object.entries(data.systems);

  return (
    <div className="mx-auto h-full max-w-3xl space-y-8 overflow-y-auto p-4 md:p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {created && (
        <NewToken
          token={created}
          onDismiss={() => {
            setCreated(null);
          }}
        />
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Client tokens</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.tokens.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2">{t.name}</td>
                  <td className="px-3 py-2">{t.scope}</td>
                  <td className="px-3 py-2">{t.lastSeen ?? 'never'}</td>
                  <td className="px-3 py-2">{t.revokedAt ? 'revoked' : 'active'}</td>
                  <td className="px-3 py-2 text-right">
                    {!t.revokedAt && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        aria-label={`Revoke ${t.name}`}
                        onClick={() => {
                          revoke.mutate(t.id);
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="block min-w-48 flex-1">
            <span className="label">Name</span>
            <input
              className="input"
              maxLength={100}
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <label className="block">
            <span className="label">Client</span>
            <select
              className="input"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as TokenRow['kind']);
              }}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            Create token
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Default phone region</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveRegion.mutate(region ?? data.region);
          }}
        >
          <label className="block">
            <span className="label">Region (ISO 3166-1, e.g. ES)</span>
            <input
              className="input w-28 uppercase"
              maxLength={2}
              pattern="[A-Za-z]{2}"
              required
              value={region ?? data.region}
              onChange={(e) => {
                setRegion(e.target.value);
              }}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={saveRegion.isPending}>
            Save
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Connected systems</h2>
        {systems.length ? (
          <ul className="text-sm">
            {systems.map(([n, st]) => (
              <li key={n}>
                {n}: {st}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No systems connected yet.</p>
        )}
      </section>
    </div>
  );
}
