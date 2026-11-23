import { Link, Outlet } from '@tanstack/react-router';
import logo64 from '../assets/logo-64.png';
import logo128 from '../assets/logo-128.png';
import { api } from '../lib/api.js';

const nav = 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground';
const navActive = { className: 'bg-accent text-foreground' };

export function Shell() {
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
        <nav className="flex flex-1 items-center gap-1" aria-label="Main">
          <Link to="/contacts" className={nav} activeProps={navActive}>
            Contacts
          </Link>
          <Link to="/sync" className={nav} activeProps={navActive}>
            Sync
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
