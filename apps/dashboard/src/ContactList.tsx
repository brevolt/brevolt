import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Contact } from './lib/api.js';
import { PAGE_SIZE, ROW_HEIGHT, displayName, pagesFor, visibleRange } from './lib/window.js';

interface Props {
  query: string;
  selectedId: string | null;
  /** Bumped after any write so the list reloads. */
  refreshKey: number;
  onSelect: (id: string) => void;
}

/** Windowed list: only visible rows are in the DOM and pages are fetched as they are scrolled to. */
export function ContactList({ query, selectedId, refreshKey, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [rows, setRows] = useState<Map<number, Contact>>(new Map());
  const [range, setRange] = useState({ start: 0, end: 30 });
  const requested = useRef(new Set<number>());
  const generation = useRef(0);

  const measure = useCallback((totalRows: number) => {
    const el = box.current;
    if (el) setRange(visibleRange(el.scrollTop, el.clientHeight, totalRows));
  }, []);

  const loadPage = useCallback((page: number, gen: number) => {
    if (requested.current.has(page)) return;
    requested.current.add(page);
    void api.list(queryRef.current, page * PAGE_SIZE, PAGE_SIZE).then((res) => {
      if (!res || gen !== generation.current) return;
      setTotal(res.total);
      setRows((prev) => {
        const next = new Map(prev);
        res.contacts.forEach((c, i) => next.set(page * PAGE_SIZE + i, c));
        return next;
      });
    });
  }, []);

  const queryRef = useRef(query);
  queryRef.current = query;

  // New query or a write elsewhere: start over from the top.
  useEffect(() => {
    generation.current += 1;
    requested.current = new Set();
    setRows(new Map());
    setTotal(null);
    if (box.current) box.current.scrollTop = 0;
    loadPage(0, generation.current);
  }, [query, refreshKey, loadPage]);

  useEffect(() => {
    if (total === null) return;
    for (const p of pagesFor(range.start, range.end)) loadPage(p, generation.current);
  }, [range, total, loadPage]);

  const count = total ?? 0;
  const items = [];
  for (let i = range.start; i < Math.min(range.end, count); i++) {
    const c = rows.get(i);
    items.push(
      <li
        key={c?.id ?? `loading-${String(i)}`}
        style={{ position: 'absolute', top: i * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}
      >
        {c ? (
          <button
            type="button"
            className={`row${c.id === selectedId ? ' selected' : ''}`}
            onClick={() => {
              onSelect(c.id);
            }}
          >
            <strong>{displayName(c)}</strong>
            <span>{c.company ?? c.fields[0]?.value ?? ''}</span>
          </button>
        ) : (
          <div className="row loading">…</div>
        )}
      </li>,
    );
  }

  return (
    <div
      ref={box}
      className="list"
      data-testid="contact-list"
      onScroll={() => {
        measure(count);
      }}
    >
      <p className="count" data-testid="contact-count">
        {total === null ? 'Loading…' : `${String(total)} contacts`}
      </p>
      <ul style={{ position: 'relative', height: count * ROW_HEIGHT, margin: 0, padding: 0 }}>
        {items}
      </ul>
    </div>
  );
}
