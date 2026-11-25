import { Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import logo64 from '../assets/logo-64.png';
import logo128 from '../assets/logo-128.png';
import { api } from '../lib/api.js';
import { decisionsQuery } from '../lib/queries.js';

const nav = 'rounded-md px-2 py-1.5 sm:px-3 text-sm text-muted-foreground hover:text-foreground';
const navActive = { className: 'bg-accent text-foreground' };

export function Shell() {
  const decisions = useQuery(decisionsQuery());
  const pending = decisions.data
    ? decisions.data.conflicts.length + decisions.data.proposals.length
    : 0;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Link
          to="/contacts"
          className="mr-2 flex items-center gap-2 font-mono text-lg font-medium text-primary"
        >
          <img
            src={logo64}
            srcSet={`${logo64} 1x, ${logo128} 2x`}
            alt="Brevolt"
            width={28}
            height={28}
            className="h-7 w-7 shrink-0"
          />
          <span className="hidden sm:inline">brevolt</span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center sm:gap-1" aria-label="Main">
          <Link to="/contacts" className={nav} activeProps={navActive}>
            Contacts
          </Link>
          <Link to="/inbox" className={nav} activeProps={navActive}>
            Inbox
            {pending > 0 && (
              <span
                data-testid="inbox-count"
                aria-label={`${String(pending)} pending decisions`}
                className="ml-1.5 rounded-full bg-warn px-1.5 py-0.5 text-xs font-medium text-warn-foreground"
              >
                {pending}
              </span>
            )}
          </Link>
          <Link to="/settings" className={nav} activeProps={navActive}>
            Settings
          </Link>
        </nav>
        <a
          className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
          href="/v1/export?format=vcf"
          download
        >
          Export vCard
        </a>
        <a
          className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
          href="/v1/export?format=json"
          download
        >
          Export JSON
        </a>
        <form
          method="post"
          action="/logout"
          onSubmit={(e) => {
            // The token rotates when the password changes; read the current one at submit time.
            const field = e.currentTarget.elements.namedItem('_csrf');
            if (field instanceof HTMLInputElement) field.value = api.csrf();
          }}
        >
          <input type="hidden" name="_csrf" defaultValue={api.csrf()} />
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
