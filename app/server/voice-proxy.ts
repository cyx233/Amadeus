// Optional voice proxy — forwards STT/TTS to an OpenAI-compatible audio backend.
//
// The backend is whatever the user points at: OpenAI, Groq, or a local server
// (LocalAI / Speaches / Kokoro-FastAPI / openedai-speech / etc.). It must expose the
// standard OpenAI audio endpoints:
//     POST {base}/audio/transcriptions   (multipart 'file' + 'model')      -> { text }
//     POST {base}/audio/speech           ({ model, voice, input })         -> audio bytes
//
// Config is resolved per-request from headers (set by the client's voice settings),
// falling back to server env defaults. Mounted at /api/voice behind authenticateToken.
import { Readable } from 'node:stream';

import express, { type Request, type Response as ExpressResponse } from 'express';
import type multer from 'multer';

const ENV = {
  baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
  apiKey: process.env.VOICE_API_KEY || '',
  sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
  ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
  ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
};

type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
};

/**
 * Resolve the voice backend config for a request. Client headers (set from the
 * user's in-app voice settings) take precedence over the server env defaults.
 */
function resolveConfig(req: Request): VoiceConfig {
  const h = req.headers;
  return {
    // Security: do not allow clients to control the outbound backend host.
    // Always use the server-side configured base URL.
    baseUrl: ENV.baseUrl,
    apiKey: String(h['x-voice-api-key'] || '') || ENV.apiKey,
    sttModel: String(h['x-voice-stt-model'] || '') || ENV.sttModel,
    ttsModel: String(h['x-voice-tts-model'] || '') || ENV.ttsModel,
    ttsVoice: String(h['x-voice-tts-voice'] || '') || ENV.ttsVoice,
    ttsFormat: String(h['x-voice-tts-format'] || '').trim(),
  };
}

const router = express.Router();

// Generous by default — local TTS can synthesize long messages at ~real-time on CPU.
// Guard against a non-numeric/zero override that would make setTimeout fire immediately.
const DEFAULT_VOICE_TIMEOUT_MS = 300000;
const _parsedTimeout = Number(process.env.VOICE_TIMEOUT_MS);
const VOICE_TIMEOUT_MS = Number.isFinite(_parsedTimeout) && _parsedTimeout > 0
  ? _parsedTimeout
  : DEFAULT_VOICE_TIMEOUT_MS;

/**
 * fetch() with an AbortController timeout so a stalled backend can't hold the
 * request open indefinitely. Aborts after VOICE_TIMEOUT_MS.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedBackendUrl(parsed.origin)) {
    throw new Error('Blocked outbound voice backend URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
  try {
    return await fetch(parsed.toString(), { redirect: 'manual', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a backend fetch failure into a clear, actionable client response:
 * 504 on timeout (AbortError), 502 otherwise.
 */
function backendError(res: ExpressResponse, e: unknown) {
  const err = e as { name?: string; message?: string };
  if (err && err.name === 'AbortError') {
    return res.status(504).json({
      error: `Voice backend timed out after ${Math.round(VOICE_TIMEOUT_MS / 1000)}s. Check your voice backend.`,
    });
  }
  return res.status(502).json({ error: `Voice backend unreachable: ${err.message}` });
}

/**
 * SSRF guard for the user-configurable backend URL: allow http/https only and
 * block the link-local / cloud-metadata range (169.254.x). localhost and private
 * ranges are allowed on purpose so users can point at a local voice server
 * (LocalAI, Speaches, Kokoro-FastAPI, etc.).
 */
function isAllowedBackendUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.hostname === '169.254.169.254' || u.hostname.startsWith('169.254.')) return false;
  return true;
}

/**
 * Relay an upstream (backend) error to the client without making an upstream
 * 401/403 look like the user's own app login failed.
 */
function upstreamError(res: ExpressResponse, status: number, text?: string) {
  if (status === 401 || status === 403) {
    return res.status(502).json({ error: 'Voice backend rejected the request (check the API key).' });
  }
  return res.status(status).json({ error: text || 'voice backend error' });
}

let _upload: multer.Multer | null = null;
/**
 * Lazily build a memory-storage multer instance (25 MB cap) for audio uploads,
 * so multer is only imported when the voice feature is actually used.
 */
async function getUpload(): Promise<multer.Multer> {
  if (!_upload) {
    const multerModule = (await import('multer')).default;
    _upload = multerModule({ storage: multerModule.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  }
  return _upload;
}

/**
 * Build the Authorization header for the backend, or an empty object when no
 * key is configured (e.g. a local server that needs none).
 */
function authHeader(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/**
 * GET /api/voice/health -> { configured } (true when a backend base URL is set).
 */
router.get('/health', (req, res) => {
  res.json({ configured: Boolean(resolveConfig(req).baseUrl) });
});

/**
 * POST /api/voice/transcribe (multipart 'audio') -> { text }.
 * Forwards the uploaded audio to the backend's /audio/transcriptions endpoint.
 */
router.post('/transcribe', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const upload = await getUpload();
  upload.single('audio')(req, res, async (err: unknown) => {
    if (err) return res.status(400).json({ error: (err as Error).message });
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    try {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
        req.file.originalname || 'recording.webm',
      );
      fd.append('model', cfg.sttModel);
      const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: authHeader(cfg.apiKey),
        body: fd,
      });
      const text = await r.text();
      if (!r.ok) return upstreamError(res, r.status, text);
      let data: { text?: unknown };
      try { data = JSON.parse(text); } catch { data = { text }; }
      res.json({ text: data.text ?? '' });
    } catch (e) {
      backendError(res, e);
    }
  });
});

/**
 * POST /api/voice/tts { text } -> audio bytes.
 * Forwards the text to the backend's /audio/speech endpoint and streams the audio back.
 */
router.post('/tts', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(cfg.apiKey) },
      body: JSON.stringify({
        model: cfg.ttsModel,
        voice: cfg.ttsVoice,
        input: text,
        ...(cfg.ttsFormat ? { response_format: cfg.ttsFormat } : {}),
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => 'tts failed');
      return upstreamError(res, r.status, errText);
    }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    if (!r.body) return res.end();
    Readable.fromWeb(r.body as import('node:stream/web').ReadableStream).on('error', (error) => res.destroy(error)).pipe(res);
  } catch (e) {
    backendError(res, e);
  }
});

export default router;
