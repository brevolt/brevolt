import { Link, Outlet } from '@tanstack/react-router';
import { api } from '../lib/api.js';

const nav = 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground';
const navActive = { className: 'bg-accent text-foreground' };

export function Shell() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Link to="/contacts" className="mr-2 font-mono text-lg font-medium text-primary">
          brevolt
        </Link>
        <nav className="flex flex-1 items-center gap-1" aria-label="Main">
          <Link to="/contacts" className={nav} activeProps={navActive}>
            Contacts
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
        <form method="post" action="/logout">
          <input type="hidden" name="_csrf" value={api.csrf()} />
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
