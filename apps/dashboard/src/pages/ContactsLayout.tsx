import { useQueries } from '@tanstack/react-query';
import { Link, Outlet, useMatch, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { contactPageQuery } from '../lib/queries.js';
import { PAGE_SIZE, ROW_HEIGHT, displayName, pagesFor } from '../lib/window.js';

export function ContactsIndex() {
  return (
    <div className="hidden h-full items-center justify-center p-6 text-sm text-muted-foreground md:flex">
      Select a contact or create a new one.
    </div>
  );
}

export function ContactsLayout() {
  const { q = '' } = useSearch({ from: '/app/contacts' });
  const navigate = useNavigate();
  const atIndex = useMatch({ from: '/app/contacts/', shouldThrow: false }) !== undefined;
  const [text, setText] = useState(q);

  // Debounce typing into the URL search param; the list queries follow the URL.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => {
      void navigate({
        to: '.',
        search: text ? { q: text } : {},
        replace: true,
      });
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [text, q, navigate]);

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[22rem_1fr]">
      <aside
        className={`${atIndex ? 'flex' : 'hidden md:flex'} min-h-0 flex-col border-r border-border`}
      >
        <div className="flex gap-2 p-3">
          <input
            type="search"
            className="input"
            aria-label="Search contacts"
            placeholder="Search contacts"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <Link to="/contacts/new" search={(p) => p} className="btn btn-primary whitespace-nowrap">
            New contact
          </Link>
        </div>
        <VirtualList q={q} />
      </aside>
      <section className={`${atIndex ? 'hidden md:block' : 'block'} min-h-0 overflow-y-auto`}>
        <Outlet />
      </section>
    </div>
  );
}

function VirtualList({ q }: { q: string }) {
  const box = useRef<HTMLDivElement>(null);
  const params = useParams({ strict: false });
  const [pages, setPages] = useState<number[]>([0]);

  const results = useQueries({ queries: pages.map((p) => contactPageQuery(q, p)) });
  const total = results[pages.indexOf(0)]?.data?.total;
  const rows = new Map<number, NonNullable<(typeof results)[number]['data']>['contacts'][number]>();
  results.forEach((r, i) => {
    const page = pages[i] ?? 0;
    r.data?.contacts.forEach((c, j) => rows.set(page * PAGE_SIZE + j, c));
  });

  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => box.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const items = virtualizer.getVirtualItems();

  // A new search starts over from the top with only the first page.
  useEffect(() => {
    setPages([0]);
    box.current?.scrollTo({ top: 0 });
  }, [q]);

  const first = items[0]?.index ?? 0;
  const last = (items[items.length - 1]?.index ?? 0) + 1;
  const needed = pagesFor(first, last).join(',');
  useEffect(() => {
    const want = needed ? needed.split(',').map(Number) : [];
    setPages((prev) => {
      const next = [...new Set([0, ...want])].sort((a, b) => a - b);
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [needed]);

  return (
    <>
      <p className="px-4 pb-2 text-xs text-muted-foreground" data-testid="contact-count">
        {total === undefined ? 'Loading…' : `${String(total)} contacts`}
      </p>
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto" data-testid="contact-list">
        <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((v) => {
            const c = rows.get(v.index);
            return (
              <li
                key={v.key}
                className="absolute inset-x-0 top-0"
                style={{ height: v.size, transform: `translateY(${String(v.start)}px)` }}
              >
                {c ? (
                  <Link
                    to="/contacts/$id"
                    params={{ id: c.id }}
                    search={(p) => p}
                    aria-current={params.id === c.id ? 'true' : undefined}
                    className={`flex h-full flex-col justify-center gap-0.5 border-b border-border px-4 hover:bg-accent ${params.id === c.id ? 'bg-accent' : ''}`}
                  >
                    <span className="truncate text-sm font-medium">{displayName(c)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.company ?? c.fields[0]?.value ?? ''}
                      {c.tags.map((t) => (
                        <span key={t} className="ml-2 font-mono text-primary">
                          #{t}
                        </span>
                      ))}
                    </span>
                  </Link>
                ) : (
                  <div className="px-4 py-4 text-sm text-muted-foreground">…</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
