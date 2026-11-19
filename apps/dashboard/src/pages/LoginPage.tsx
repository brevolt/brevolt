import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import logo128 from '../assets/logo-128.png';
import logo256 from '../assets/logo-256.png';
import { api, setCsrf } from '../lib/api.js';

export function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loginCsrf, setLoginCsrf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.loginCsrf().then((r) => {
      if (r.ok) setLoginCsrf(r.value.csrfToken);
      else setError('Could not reach the server.');
    });
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await api.login(password, loginCsrf);
    setBusy(false);
    if (res.ok) {
      setCsrf(res.value.csrfToken);
      await navigate({ to: '/contacts' });
      return;
    }
    setPassword('');
    if (res.status === 429) setError('Too many attempts. Wait a few minutes and try again.');
    else if (res.status === 401) setError('Incorrect password.');
    else setError('Could not sign in. Reload the page and try again.');
    // A failed attempt (or a stale token) needs a fresh pre-login token.
    void api.loginCsrf().then((r) => {
      if (r.ok) setLoginCsrf(r.value.csrfToken);
    });
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <img
            src={logo128}
            srcSet={`${logo128} 1x, ${logo256} 2x`}
            alt="Brevolt"
            width={64}
            height={64}
            className="h-16 w-16"
          />
          <h1 className="font-mono text-2xl font-medium text-primary">brevolt</h1>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <label className="block">
          <span className="label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        <button type="submit" className="btn btn-primary w-full" disabled={busy || !loginCsrf}>
          Sign in
        </button>
      </form>
    </div>
  );
}
