import webPush from 'web-push';

import { notificationPreferencesDb, pushSubscriptionsDb, sessionsDb } from '@/modules/database/index.js';
import { sendDesktopNotification as sendDesktopNotificationToClients } from '@/modules/notifications/services/desktop-notification-clients.service.js';

/**
 * Notification provider label — 'system' covers app-level events with no
 * specific agent (e.g. push.enabled). PROVIDER_LABELS below has no
 * 'opencode' entry (a pre-existing gap, not introduced by this migration —
 * the original .js object was missing it too), so opencode notifications
 * fall through to buildNotificationPayload's `|| 'Assistant'` label.
 */
type NotificationProvider = 'claude' | 'cursor' | 'codex' | 'opencode' | 'system';
type NotificationKind = 'action_required' | 'stop' | 'error' | 'info';
type NotificationSeverity = 'info' | 'warning' | 'error';
type NotificationCode =
  | 'permission.required'
  | 'run.stopped'
  | 'run.failed'
  | 'agent.notification'
  | 'push.enabled';

type NotificationEvent = {
  provider: NotificationProvider;
  sessionId: string | null;
  kind: NotificationKind;
  code: NotificationCode;
  meta: Record<string, unknown>;
  severity: NotificationSeverity;
  requiresUserAction: boolean;
  dedupeKey: string | null;
  createdAt: string;
};

type NotificationPreferencesLike = {
  // Keyed by the mapped pref-key strings (KIND_TO_PREF_KEY's values, e.g.
  // 'actionRequired'), not by NotificationKind directly — 'action_required'
  // maps to the camelCase 'actionRequired' preference field.
  events?: Partial<Record<string, boolean>>;
  channels?: Partial<Record<string, boolean>>;
};

const KIND_TO_PREF_KEY: Partial<Record<NotificationKind, string>> = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error'
};

const PROVIDER_LABELS: Partial<Record<NotificationProvider, string>> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  system: 'System'
};

const recentEventKeys = new Map<string, number>();
const DEDUPE_WINDOW_MS = 20000;

const cleanupOldEventKeys = (): void => {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
};

function isNotificationEventEnabled(preferences: NotificationPreferencesLike | undefined, event: NotificationEvent): boolean {
  const prefEventKey = KIND_TO_PREF_KEY[event.kind];
  const eventEnabled = prefEventKey ? Boolean(preferences?.events?.[prefEventKey]) : true;

  return eventEnabled;
}

function isDuplicate(event: NotificationEvent): boolean {
  cleanupOldEventKeys();
  const key = event.dedupeKey || `${event.provider}:${event.kind || 'info'}:${event.code || 'generic'}:${event.sessionId || 'none'}`;
  if (recentEventKeys.has(key)) {
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info' as NotificationCode,
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false
}: {
  provider: NotificationProvider;
  sessionId?: string | null;
  kind?: NotificationKind;
  code?: NotificationCode;
  meta?: Record<string, unknown>;
  severity?: NotificationSeverity;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
}): NotificationEvent {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString()
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }

  if (error == null) {
    return 'Unknown error';
  }

  return String(error);
}

function normalizeSessionName(sessionName: unknown): string | null {
  if (typeof sessionName !== 'string') {
    return null;
  }

  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

function rowMatchesProvider(row: SessionRow | null, provider: string | undefined): row is SessionRow {
  return Boolean(row) && (!provider || row?.provider === provider);
}

function resolveSessionRow(sessionId: string | null | undefined, provider: string | undefined): SessionRow | null {
  if (!sessionId) {
    return null;
  }

  const appSessionRow = sessionsDb.getSessionById(sessionId);
  if (rowMatchesProvider(appSessionRow, provider)) {
    return appSessionRow;
  }

  const providerSessionRow = sessionsDb.getSessionByProviderSessionId(sessionId);
  if (rowMatchesProvider(providerSessionRow, provider)) {
    return providerSessionRow;
  }

  return null;
}

function normalizeNotificationSession(event: NotificationEvent): NotificationEvent {
  if (!event?.sessionId || !event.provider || event.provider === 'system') {
    return event;
  }

  const row = resolveSessionRow(event.sessionId, event.provider);
  if (!row || row.session_id === event.sessionId) {
    return event;
  }

  return {
    ...event,
    sessionId: row.session_id
  };
}

function resolveSessionName(event: NotificationEvent): string | null {
  const explicitSessionName = normalizeSessionName((event.meta as { sessionName?: unknown } | undefined)?.sessionName);
  if (explicitSessionName) {
    return explicitSessionName;
  }

  if (!event.sessionId || !event.provider) {
    return null;
  }

  return normalizeSessionName(sessionsDb.getSessionName(event.sessionId, event.provider));
}

function buildNotificationPayload(event: NotificationEvent) {
  const normalizedEvent = normalizeNotificationSession(event);
  const meta = normalizedEvent.meta as { toolName?: unknown; stopReason?: unknown; error?: unknown; message?: unknown };
  const CODE_MAP: Partial<Record<NotificationCode, string>> = {
    'permission.required': meta?.toolName
      ? `Action Required: Tool "${meta.toolName}" needs approval`
      : 'Action Required: A tool needs your approval',
    'run.stopped': meta?.stopReason ? String(meta.stopReason) : 'Run Stopped: The run has stopped',
    'run.failed': meta?.error ? `Run Failed: ${meta.error}` : 'Run Failed: The run encountered an error',
    'agent.notification': meta?.message ? String(meta.message) : 'You have a new notification',
    'push.enabled': 'Push notifications are now enabled!'
  };
  const providerLabel = PROVIDER_LABELS[normalizedEvent.provider] || 'Assistant';
  const sessionName = resolveSessionName(normalizedEvent);
  const message = CODE_MAP[normalizedEvent.code] || 'You have a new notification';

  return {
    title: sessionName || 'CloudCLI',
    body: `${providerLabel}: ${message}`,
    data: {
      sessionId: normalizedEvent.sessionId || null,
      code: normalizedEvent.code,
      provider: normalizedEvent.provider || null,
      sessionName,
      tag: `${normalizedEvent.provider || 'assistant'}:${normalizedEvent.sessionId || 'none'}:${normalizedEvent.code}`
    }
  };
}

type NotificationPushPayload = ReturnType<typeof buildNotificationPayload>;

function sendWebPushPayload(userId: number, payload: NotificationPushPayload): Promise<void> {
  const subscriptions = pushSubscriptionsDb.getSubscriptions(userId);
  if (!subscriptions.length) return Promise.resolve();

  const serializedPayload = JSON.stringify(payload);
  return Promise.allSettled(
    subscriptions.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        },
        serializedPayload
      )
    )
  ).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          pushSubscriptionsDb.removeSubscription(subscriptions[index].endpoint);
        }
      }
    });
  });
}

type NotificationChannel = {
  id: string;
  isEnabled: (preferences: NotificationPreferencesLike | undefined) => boolean;
  send: (args: { userId: number; payload: NotificationPushPayload }) => Promise<unknown>;
};

const notificationChannels: NotificationChannel[] = [
  {
    id: 'webPush',
    // TODO: Web push still uses push_subscriptions. Do not remove that table until
    // browser push subscriptions are migrated into notification_channel_endpoints.
    isEnabled: (preferences) => Boolean(preferences?.channels?.webPush),
    send: ({ userId, payload }) => sendWebPushPayload(userId, payload)
  },
  {
    id: 'desktop',
    isEnabled: (preferences) => Boolean(preferences?.channels?.desktop),
    send: ({ userId, payload }) => Promise.resolve(sendDesktopNotificationToClients(userId, payload))
  }
];

function notifyUserIfEnabled({ userId, event }: { userId: number | string | null | undefined; event: NotificationEvent | null | undefined }): void {
  if (!userId || !event) {
    return;
  }

  const numericUserId = Number(userId);
  const normalizedEvent = normalizeNotificationSession(event);
  const preferences = notificationPreferencesDb.getPreferences(numericUserId);
  if (!isNotificationEventEnabled(preferences, normalizedEvent)) {
    return;
  }
  if (isDuplicate(normalizedEvent)) {
    return;
  }

  const payload = buildNotificationPayload(normalizedEvent);
  for (const channel of notificationChannels) {
    if (!channel.isEnabled(preferences)) {
      continue;
    }
    Promise.resolve(channel.send({ userId: numericUserId, payload })).catch((err) => {
      console.error(`Notification channel "${channel.id}" send error:`, err);
    });
  }
}

function notifyRunStopped({
  userId,
  provider,
  sessionId = null,
  stopReason = 'completed',
  sessionName = null
}: {
  userId: number | string | null;
  provider: NotificationProvider;
  sessionId?: string | null;
  stopReason?: string;
  sessionName?: string | null;
}): void {
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      severity: 'info',
      dedupeKey: `${provider}:run:stop:${sessionId || 'none'}:${stopReason}`
    })
  });
}

function notifyRunFailed({
  userId,
  provider,
  sessionId = null,
  error,
  sessionName = null
}: {
  userId: number | string | null;
  provider: NotificationProvider;
  sessionId?: string | null;
  error?: unknown;
  sessionName?: string | null;
}): void {
  const errorMessage = normalizeErrorMessage(error);

  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'error',
      code: 'run.failed',
      meta: { error: errorMessage, sessionName },
      severity: 'error',
      dedupeKey: `${provider}:run:error:${sessionId || 'none'}:${errorMessage}`
    })
  });
}

export {
  buildNotificationPayload,
  createNotificationEvent,
  notifyUserIfEnabled,
  notifyRunStopped,
  notifyRunFailed
};
