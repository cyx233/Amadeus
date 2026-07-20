// Static login/register page for the auth entrypoint. No React/build — it
// mirrors the look of src/components/auth (dark card, primary button) with
// inline styles so the thin auth server has zero frontend dependencies.
// On success the server has set the amadeus_token cookie; we reload to '/',
// and the gateway routes the now-authenticated request to the user's backend.
export function renderLoginPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Amadeus — Sign in</title>
<!-- Same tab icon as the app. Inlined as a data URI because the thin auth
     server doesn't serve static files. Keep in sync with public/favicon.svg. -->
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='64' height='64'%3E%3Crect x='0' y='0' width='64' height='64' fill='hsl(240 5.9%25 10%25)'/%3E%3Cg transform='translate(32,32) scale(1.333) translate(-12,-12)' stroke='white' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/g%3E%3C/svg%3E" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1e293b, #0b0f19); color: #e2e8f0;
  }
  .card {
    width: 100%; max-width: 380px; margin: 16px; padding: 28px 26px;
    background: #0f172a; border: 1px solid #1e293b; border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,.45);
  }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 20px; font-size: 13px; color: #94a3b8; }
  label { display: block; font-size: 12px; color: #cbd5e1; margin: 14px 0 6px; }
  input {
    width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #334155;
    background: #0b1220; color: #e2e8f0; font-size: 14px; outline: none;
  }
  input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.25); }
  button {
    width: 100%; margin-top: 20px; padding: 11px; border: 0; border-radius: 10px;
    background: #6366f1; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  button:hover { filter: brightness(1.08); }
  button:disabled { opacity: .6; cursor: not-allowed; }
  .err { margin-top: 14px; font-size: 13px; color: #f87171; min-height: 18px; }
  .foot { margin-top: 18px; font-size: 13px; color: #94a3b8; text-align: center; }
  .foot a { color: #818cf8; text-decoration: none; cursor: pointer; }
  .foot a:hover { text-decoration: underline; }
  .note { margin-top: 10px; font-size: 13px; color: #cbd5e1; text-align: center; min-height: 18px; }
</style>
</head>
<body>
  <form class="card" id="f">
    <h1 id="title">Sign in</h1>
    <p class="sub" id="sub">Enter your credentials to access Amadeus</p>
    <label for="u">Username</label>
    <input id="u" name="username" autocomplete="username" autofocus />
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" />
    <button type="submit" id="btn">Sign in</button>
    <div class="err" id="err"></div>
    <div class="note" id="note"></div>
    <div class="foot">Need an account? <a id="register">Register</a></div>
  </form>
<script>
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  const note = document.getElementById('note');

  // Registration is admin-managed (scripts/user.sh) — the link just tells the
  // visitor how to get an account, it does not submit anything.
  document.getElementById('register').addEventListener('click', () => {
    err.textContent = '';
    note.textContent = 'Registration is managed by an administrator — please contact them for an account.';
  });

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const username = document.getElementById('u').value.trim();
    const password = document.getElementById('p').value;
    if (!username || !password) { err.textContent = 'Username and password are required.'; return; }
    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { err.textContent = data.error || 'Sign in failed.'; btn.disabled = false; return; }
      // Cookie is set by the server; go to the app (gateway routes by identity).
      window.location.href = '/';
    } catch (_e) {
      err.textContent = 'Network error.';
      btn.disabled = false;
    }
  });
</script>
</body>
</html>`;
}
