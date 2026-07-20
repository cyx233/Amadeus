/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

/**
 * For empty shell instances where no project is provided,
 * we use a default project object to ensure the shell can still function.
 * This prevents errors related to missing project data.
 *
 * `projectId` is set to a well-known sentinel ('default') because the empty
 * shell doesn't correspond to any real project row in the database; any API
 * call that routes through this placeholder must tolerate a missing match.
 */
// Empty string lets the server pick the cwd: shell-websocket.service resolves a
// real directory (WORKSPACES_ROOT, else HOME, else /tmp) when the requested path
// is missing. Hardcoding '/workspace' here was wrong — that path doesn't exist in
// our containers (workspace lives at $WORKSPACES_ROOT, e.g. ~/workspace).
export const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: '',
  path: '',
};