/**
 * Session watchdog — detects hung/dead Claude sessions and triggers recovery.
 *
 * Runs as a sidecar process inside the container. Polls the CloudCLI health
 * endpoint for active sessions and checks last-message timestamps. If a session
 * exceeds STALL_TIMEOUT_MS with no new messages while marked "running", it
 * aborts the session so the frontend can offer a --resume.
 *
 * ponytail: single polling loop, no framework. Upgrade to per-session timers
 * if concurrent session count exceeds ~20.
 */

const POLL_INTERVAL_MS = parseInt(process.env.WATCHDOG_POLL_MS || '15000', 10);
const STALL_TIMEOUT_MS = parseInt(process.env.WATCHDOG_STALL_MS || '300000', 10); // 5 min
const SERVER_URL = 'http://127.0.0.1:3001';

async function fetchJson(path) {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) return null;
  return res.json();
}

async function abortSession(sessionId) {
  try {
    await fetch(`${SERVER_URL}/api/session/${sessionId}/abort`, { method: 'POST' });
    console.log(`[watchdog] aborted stalled session ${sessionId}`);
  } catch (e) {
    console.error(`[watchdog] abort failed for ${sessionId}:`, e.message);
  }
}

// Track last-seen activity per session
const lastActivity = new Map();

async function tick() {
  const sessions = await fetchJson('/api/sessions/active');
  if (!sessions || !Array.isArray(sessions)) return;

  const now = Date.now();
  const activeSids = new Set();

  for (const s of sessions) {
    if (!s.sessionId || s.status !== 'running') continue;
    activeSids.add(s.sessionId);

    if (!lastActivity.has(s.sessionId)) {
      lastActivity.set(s.sessionId, now);
      continue;
    }

    // Update if the session reports a newer timestamp
    if (s.lastMessageAt && s.lastMessageAt > lastActivity.get(s.sessionId)) {
      lastActivity.set(s.sessionId, s.lastMessageAt);
    }

    const elapsed = now - lastActivity.get(s.sessionId);
    if (elapsed > STALL_TIMEOUT_MS) {
      await abortSession(s.sessionId);
      lastActivity.delete(s.sessionId);
    }
  }

  // Prune sessions that are no longer active
  for (const sid of lastActivity.keys()) {
    if (!activeSids.has(sid)) lastActivity.delete(sid);
  }
}

async function loop() {
  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    const health = await fetchJson('/api/health').catch(() => null);
    if (health) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('[watchdog] started, polling every', POLL_INTERVAL_MS, 'ms');

  while (true) {
    try { await tick(); } catch (e) { /* server might be restarting */ }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
