import { IS_PLATFORM } from "../constants/config";

// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
export const isValidRefreshedToken = (token: unknown): token is string =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

// Utility function for authenticated API calls
export const authenticatedFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = localStorage.getItem('auth-token');

  const defaultHeaders: Record<string, string> = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }).then((response) => {
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (isValidRefreshedToken(refreshedToken)) {
      localStorage.setItem('auth-token', refreshedToken);
    }
    return response;
  });
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username: string, password: string) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username: string, password: string) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => authenticatedFetch('/api/projects'),
  archivedProjects: () => authenticatedFetch('/api/projects/archived'),
  projectSessions: (projectId: string, { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/sessions?${params.toString()}`);
  },
  projectTaskmaster: (projectId: string) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/taskmaster`),
  // Unified endpoint for persisted session messages.
  // Provider/project metadata are resolved by the backend from sessionId.
  unifiedSessionMessages: (sessionId: string, _provider = 'claude', { limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', String(limit));
      params.append('offset', String(offset));
    }
    const queryString = params.toString();
    return authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages${queryString ? `?${queryString}` : ''}`);
  },
  renameProject: (projectId: string, displayName: string) =>
    authenticatedFetch(`/api/projects/${projectId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  restoreProject: (projectId: string) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/restore`, {
      method: 'POST',
    }),
  // Session deletion now mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete = false) => {
    const params = new URLSearchParams();
    if (hardDelete) {
      params.set('force', 'true');
    }
    const qs = params.toString();
    return authenticatedFetch(`/api/providers/sessions/${sessionId}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  getArchivedSessions: () =>
    authenticatedFetch('/api/providers/sessions/archived'),
  runningSessions: () =>
    authenticatedFetch('/api/providers/sessions/running'),
  restoreSession: (sessionId: string) =>
    authenticatedFetch(`/api/providers/sessions/${sessionId}/restore`, {
      method: 'POST',
    }),
  renameSession: (sessionId: string, summary: string) =>
    authenticatedFetch(`/api/providers/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ summary }),
    }),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete = false) => {
    const params = new URLSearchParams();
    if (hardDelete) params.set('force', 'true');
    const qs = params.toString();
    return authenticatedFetch(`/api/projects/${projectId}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  // Browser-navigable download URL (token in query, since <a>/window.open can't
  // set an auth header) — used to export a project as .tar.gz before deleting.
  downloadProjectUrl: (projectId: string) => {
    const token = localStorage.getItem('auth-token');
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const qs = params.toString();
    return `/api/projects/${encodeURIComponent(projectId)}/download${qs ? `?${qs}` : ''}`;
  },
  searchConversationsUrl: (query: string, limit = 50) => {
    const token = localStorage.getItem('auth-token');
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (token) params.set('token', token);
    return `/api/providers/search/sessions?${params.toString()}`;
  },
  createProject: (projectData: unknown) =>
    authenticatedFetch('/api/projects/create-project', {
      method: 'POST',
      body: JSON.stringify(projectData),
    }),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    authenticatedFetch('/api/projects/migrate-legacy-stars', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    }),
  toggleProjectStar: (projectId: string) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`, {
      method: 'POST',
    }),
  readFile: (projectId: string, filePath: string) =>
    authenticatedFetch(`/api/projects/${projectId}/file?filePath=${encodeURIComponent(filePath)}`),
  readFileBlob: (projectId: string, filePath: string) =>
    authenticatedFetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`),
  downloadFolder: (projectId: string, folderPath: string) =>
    authenticatedFetch(`/api/projects/${projectId}/files/download-folder?path=${encodeURIComponent(folderPath)}`),
  searchProject: (projectId: string, query: string, scopePath = '') =>
    authenticatedFetch(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}${scopePath ? `&path=${encodeURIComponent(scopePath)}` : ''}`),
  saveFile: (projectId: string, filePath: string, content: string) =>
    authenticatedFetch(`/api/projects/${projectId}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectId: string, options: RequestInit = {}) =>
    authenticatedFetch(`/api/projects/${projectId}/files`, options),
  getDirChildren: (projectId: string, dirPath: string) =>
    authenticatedFetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(dirPath)}`),

  // File operations
  createFile: (projectId: string, { path, type, name }: { path: string; type: string; name: string }) =>
    authenticatedFetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path, type, name }),
    }),

  renameFile: (projectId: string, { oldPath, newName }: { oldPath: string; newName: string }) =>
    authenticatedFetch(`/api/projects/${projectId}/files/rename`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newName }),
    }),

  deleteFile: (projectId: string, { path, type }: { path: string; type: string }) =>
    authenticatedFetch(`/api/projects/${projectId}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path, type }),
    }),

  uploadFiles: (projectId: string, formData: FormData) =>
    authenticatedFetch(`/api/projects/${projectId}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints — all addressed by DB projectId post-migration.
  taskmaster: {
    // Initialize TaskMaster in a project
    init: (projectId: string) =>
      authenticatedFetch(`/api/taskmaster/init/${projectId}`, {
        method: 'POST',
      }),

    // Add a new task. `tag` targets a per-PRD task set; omit for the default set.
    addTask: (projectId: string, { prompt, title, description, priority, dependencies, tag }: { prompt?: string; title?: string; description?: string; priority?: string; dependencies?: string; tag?: string }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${projectId}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies, tag }),
      }),

    // Parse PRD to generate tasks. `tag` scopes the generated tasks to a
    // per-PRD task set (see prdNameToTag); omit for the default (master) set.
    parsePRD: (projectId: string, { fileName, numTasks, append, tag }: { fileName?: string; numTasks?: number; append?: boolean; tag?: string }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${projectId}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append, tag }),
      }),

    // Stream parse-prd progress over SSE. Generating tasks takes tens of seconds
    // to minutes (one AI call per task), so the UI shows live progress instead
    // of a single request that appears to hang. Returns an EventSource; caller
    // handles onProgress/onComplete/onError. token in query (EventSource can't
    // set headers). `append` adds to the tag; otherwise the server force-writes
    // (skips the interactive overwrite prompt) — scoped to this tag only.
    parsePRDProgress: (projectId: string, { fileName, numTasks, tag, append }: { fileName?: string; numTasks?: number; tag?: string; append?: boolean } = {}) => {
      const token = localStorage.getItem('auth-token');
      const params = new URLSearchParams();
      if (fileName) params.set('fileName', fileName);
      if (tag) params.set('tag', tag);
      if (numTasks) params.set('numTasks', String(numTasks));
      if (append) params.set('append', 'true');
      if (token) params.set('token', token);
      return new EventSource(
        `/api/taskmaster/parse-prd-progress/${encodeURIComponent(projectId)}?${params.toString()}`,
      );
    },

    // Delete a PRD file and drop its generated task set (`tag`). master is never
    // removed server-side even if passed.
    deletePRD: (projectId: string, fileName: string, tag?: string) => {
      const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
      return authenticatedFetch(
        `/api/taskmaster/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}${qs}`,
        { method: 'DELETE' },
      );
    },

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectId: string, { templateId, fileName, customizations }: { templateId?: string; fileName?: string; customizations?: unknown }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${projectId}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    // Update a task
    updateTask: (projectId: string, taskId: string | number, updates: unknown) =>
      authenticatedFetch(`/api/taskmaster/update-task/${projectId}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),

    // Remove a task (or subtask). tag targets the task's own PRD set.
    removeTask: (projectId: string, taskId: string | number, tag?: string) => {
      const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
      return authenticatedFetch(
        `/api/taskmaster/task/${encodeURIComponent(projectId)}/${encodeURIComponent(taskId)}${qs}`,
        { method: 'DELETE' },
      );
    },
  },


  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName: string, gitEmail: string) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
    // Model Preference (two axes: provider + model, each with global fallback +
    // per-feature override). Keeps features model-id agnostic.
    getModels: (refresh = false) => authenticatedFetch(`/api/user/models${refresh ? '?refresh=1' : ''}`),
    // Single resolver: "what model should this feature/session use?" (session
    // model wins → preference default). Mirrors the backend resolveModel.
    effectiveModel: (opts: { feature?: string; provider?: string; sessionId?: string } = {}) => {
      const qs = new URLSearchParams({ feature: opts.feature || 'chat' });
      if (opts.provider) qs.set('provider', opts.provider);
      if (opts.sessionId) qs.set('sessionId', opts.sessionId);
      return authenticatedFetch(`/api/user/effective-model?${qs.toString()}`);
    },
    // body is one of: {globalProvider} | {provider, model} | {feature, provider}
    // | {feature, provider, model}
    updateModel: (body: unknown) =>
      authenticatedFetch('/api/user/models', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    // Routed to /api/auth (the auth-gateway) — it owns the shared user DB; the
    // per-user backend containers don't hold credentials.
    changePassword: (currentPassword: string, newPassword: string) =>
      authenticatedFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint: string) => authenticatedFetch(`/api${endpoint}`),

  // Generic POST method for any endpoint
  post: (endpoint: string, body?: unknown) => authenticatedFetch(`/api${endpoint}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body) }),
  }),

  // Generic PUT method for any endpoint
  put: (endpoint: string, body?: unknown) => authenticatedFetch(`/api${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  // Generic DELETE method for any endpoint
  delete: (endpoint: string, options: RequestInit = {}) => authenticatedFetch(`/api${endpoint}`, {
    method: 'DELETE',
    ...options,
  }),
};
