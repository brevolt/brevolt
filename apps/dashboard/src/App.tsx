import { useCallback, useEffect, useRef, useState } from 'react';
import { ContactDetail } from './ContactDetail.js';
import { ContactForm, emptyDraft } from './ContactForm.js';
import { ContactList } from './ContactList.js';
import { api, newOperationId, type Draft } from './lib/api.js';

interface Toast {
  message: string;
  undo?: (() => void) | undefined;
}

const idFromPath = (): string | null =>
  /^\/contacts\/([\w-]+)$/.exec(window.location.pathname)?.[1] ?? null;
const isNewPath = (): boolean => window.location.pathname === '/contacts/new';

export function App() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<string | null>(isNewPath() ? null : idFromPath());
  const [creating, setCreating] = useState(isNewPath());
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const onPop = () => {
      setCreating(isNewPath());
      setSelected(isNewPath() ? null : idFromPath());
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const go = (path: string, id: string | null, create = false) => {
    window.history.pushState(null, '', path);
    setSelected(id);
    setCreating(create);
  };

  const notify = useCallback((message: string, undo?: () => void) => {
    setToast({ message, undo });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setToast(null);
    }, 10_000);
  }, []);

  const changed = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const create = async (draft: Draft) => {
    const operationId = newOperationId();
    const res = await api.create(draft, operationId);
    if (!res.ok) {
      notify('Could not create the contact. Check the values and try again.');
      return;
    }
    go(`/contacts/${res.value.id}`, res.value.id);
    changed();
    notify('Contact created.', () => {
      void api.undo(operationId).then((r) => {
        notify(r.ok ? 'Creation undone.' : 'Could not undo the creation.');
        if (r.ok) {
          go('/', null);
          changed();
        }
      });
    });
  };

  return (
    <div className="app">
      <header>
        <h1>Brevolt</h1>
        <nav className="inline">
          <a href="/v1/export?format=vcf" download>
            Export vCard
          </a>
          <a href="/v1/export?format=json" download>
            Export JSON
          </a>
          <form method="post" action="/logout">
            <input type="hidden" name="_csrf" value={api.csrf()} />
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      <main>
        <aside>
          <div className="inline">
            <input
              type="search"
              aria-label="Search contacts"
              placeholder="Search contacts"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
            <button
              type="button"
              onClick={() => {
                go('/contacts/new', null, true);
              }}
            >
              New contact
            </button>
          </div>
          <ContactList
            query={debounced}
            selectedId={selected}
            refreshKey={refreshKey}
            onSelect={(id) => {
              go(`/contacts/${id}`, id);
            }}
          />
        </aside>
        <article>
          {creating ? (
            <section aria-label="New contact">
              <h2>New contact</h2>
              <ContactForm
                initial={emptyDraft()}
                saving={false}
                submitLabel="Create"
                onSubmit={(d) => void create(d)}
                onCancel={() => {
                  go('/', null);
                }}
              />
            </section>
          ) : selected ? (
            <ContactDetail
              id={selected}
              onChanged={changed}
              notify={notify}
              onDeleted={(undo) => {
                go('/', null);
                notify('Contact deleted.', undo);
              }}
            />
          ) : (
            <p className="muted">Select a contact or create a new one.</p>
          )}
        </article>
      </main>
      {toast && (
        <div role="status" className="toast" data-testid="toast">
          {toast.message}
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
