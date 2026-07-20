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
  </form>
<script>
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  let mode = 'login';

  // First run (no users yet) -> show register.
  fetch('/api/auth/status').then(r => r.json()).then(s => {
    if (s && s.needsSetup === true) {
      mode = 'register';
      document.getElementById('title').textContent = 'Create account';
      document.getElementById('sub').textContent = 'Set up the first Amadeus account';
      btn.textContent = 'Create account';
      document.getElementById('p').setAttribute('autocomplete', 'new-password');
    }
  }).catch(() => {});

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const username = document.getElementById('u').value.trim();
    const password = document.getElementById('p').value;
    if (!username || !password) { err.textContent = 'Username and password are required.'; return; }
    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/' + mode, {
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
