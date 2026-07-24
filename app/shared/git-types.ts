/**
 * Git API response contracts — shared between the backend git routes (which
 * produce them) and the frontend git panel (which consumes them). Keeping the
 * shapes here lets the compiler enforce that both sides agree, instead of the
 * two hand-maintaining parallel type definitions that drift apart.
 *
 * Only the request/response DTOs live here. UI-only types (panel props,
 * controller shape, view enums) stay in the frontend — the backend never sees
 * them.
 */

/** Common error envelope every git endpoint may return instead of its payload. */
export type GitApiErrorResponse = {
  error?: string;
  details?: string;
};

/** `GET /api/git/status` — bucketed working-tree state. */
export type GitStatusResponse = GitApiErrorResponse & {
  branch?: string;
  hasCommits?: boolean;
  modified?: string[];
  added?: string[];
  deleted?: string[];
  untracked?: string[];
  /** Paths with index-side changes — mirrors the real git index. */
  staged?: string[];
};

/** The five buckets `parseGitStatusOutput` produces from `status --porcelain -z`. */
export type GitStatusBuckets = {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  staged: string[];
};

/** `GET /api/git/remote-status` — ahead/behind vs the tracking branch. */
export type GitRemoteStatus = GitApiErrorResponse & {
  hasRemote?: boolean;
  hasUpstream?: boolean;
  branch?: string;
  remoteBranch?: string;
  remoteName?: string | null;
  ahead?: number;
  behind?: number;
  isUpToDate?: boolean;
  message?: string;
};

/** One commit row for the History view (also the parsed shape of git log). */
export type GitCommitSummary = {
  hash: string;
  author: string;
  email?: string;
  date: string;
  message: string;
  stats?: string;
  /** Parent commit hashes — drives the History view commit graph. */
  parents?: string[];
  /** Ref decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0". */
  refs?: string[];
};

/** One discovered git repo inside a project (VSCode-style multi-root). */
export type GitRepo = {
  /** Absolute path to the git repo; threaded to the backend as the `repo` param. */
  path: string;
  /** Relative subdir path, or '' for the project root. */
  name: string;
  isRoot: boolean;
  branch: string | null;
};

/** `GET /api/git/repos` */
export type GitReposResponse = GitApiErrorResponse & {
  repos?: GitRepo[];
};

/** `GET /api/git/diff` — raw unified diff text for one file. */
export type GitDiffResponse = GitApiErrorResponse & {
  diff?: string;
};

/** `GET /api/git/commit-diff` — `git show <commit>`, possibly truncated. */
export type GitCommitDiffResponse = GitApiErrorResponse & {
  diff?: string;
  isTruncated?: boolean;
};

/** `GET /api/git/branches` */
export type GitBranchesResponse = GitApiErrorResponse & {
  branches?: string[];
  localBranches?: string[];
  remoteBranches?: string[];
};

/** `GET /api/git/commits` */
export type GitCommitsResponse = GitApiErrorResponse & {
  commits?: GitCommitSummary[];
};

/** Shared shape for the mutating endpoints (commit/stage/checkout/push/…). */
export type GitOperationResponse = GitApiErrorResponse & {
  success?: boolean;
  output?: string;
  message?: string;
  remoteName?: string | null;
  remoteBranch?: string;
  branch?: string;
};

/** `POST /api/git/generate-commit-message` */
export type GitGenerateMessageResponse = GitApiErrorResponse & {
  message?: string;
};

/** `GET /api/git/file-with-diff` — content pair for the editor's diff view. */
export type GitFileWithDiffResponse = GitApiErrorResponse & {
  oldContent?: string;
  currentContent?: string;
  isDeleted?: boolean;
  isUntracked?: boolean;
};
