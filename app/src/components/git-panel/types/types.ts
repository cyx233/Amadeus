import type { Project } from '../../../types/app';
// Git API response contracts are shared with the backend (see
// app/shared/git-types.ts) so both sides can't drift. Imported for use below
// and re-exported so the panel's many consumers keep importing from one place.
import type {
  GitApiErrorResponse,
  GitStatusResponse,
  GitRemoteStatus,
  GitCommitSummary,
  GitRepo,
  GitDiffResponse,
  GitBranchesResponse,
  GitCommitsResponse,
  GitOperationResponse,
  GitGenerateMessageResponse,
  GitFileWithDiffResponse,
} from '../../../../shared/git-types';

export type {
  GitApiErrorResponse,
  GitStatusResponse,
  GitRemoteStatus,
  GitCommitSummary,
  GitRepo,
  GitDiffResponse,
  GitBranchesResponse,
  GitCommitsResponse,
  GitOperationResponse,
  GitGenerateMessageResponse,
  GitFileWithDiffResponse,
};

export type GitPanelView = 'changes' | 'history' | 'branches';
export type FileStatusCode = 'M' | 'A' | 'D' | 'U';
export type GitStatusFileGroup = 'modified' | 'added' | 'deleted' | 'untracked';
export type ConfirmActionType = 'discard' | 'delete' | 'commit' | 'pull' | 'push' | 'publish' | 'revertLocalCommit' | 'deleteBranch';

export type FileDiffInfo = {
  old_string: string;
  new_string: string;
};

export type FileOpenHandler = (filePath: string, diffInfo?: FileDiffInfo) => void;

export type GitPanelProps = {
  selectedProject: Project | null;
  compact?: boolean;
  onFileOpen?: FileOpenHandler;
};

export type GitDiffMap = Record<string, string>;

export type GitStatusGroupEntry = {
  key: GitStatusFileGroup;
  status: FileStatusCode;
};

export type ConfirmationRequest = {
  type: ConfirmActionType;
  message: string;
  onConfirm: () => Promise<void> | void;
};

export type UseGitPanelControllerOptions = {
  selectedProject: Project | null;
  activeView: GitPanelView;
  onFileOpen?: FileOpenHandler;
  /** Absolute path of the active repo; omitted from requests when null. */
  selectedRepoPath?: string | null;
};

export type GitPanelController = {
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  isLoading: boolean;
  currentBranch: string;
  branches: string[];
  localBranches: string[];
  remoteBranches: string[];
  recentCommits: GitCommitSummary[];
  commitDiffs: GitDiffMap;
  remoteStatus: GitRemoteStatus | null;
  isCreatingBranch: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isPublishing: boolean;
  isCreatingInitialCommit: boolean;
  operationError: string | null;
  clearOperationError: () => void;
  refreshAll: () => void;
  switchBranch: (branchName: string) => Promise<boolean>;
  createBranch: (branchName: string) => Promise<boolean>;
  deleteBranch: (branchName: string) => Promise<boolean>;
  handleFetch: () => Promise<void>;
  handlePull: () => Promise<void>;
  handlePush: () => Promise<void>;
  handlePublish: () => Promise<void>;
  discardChanges: (filePath: string) => Promise<void>;
  deleteUntrackedFile: (filePath: string) => Promise<void>;
  stageFiles: (files: string[]) => Promise<boolean>;
  unstageFiles: (files: string[]) => Promise<boolean>;
  fetchCommitDiff: (commitHash: string) => Promise<void>;
  generateCommitMessage: (files: string[]) => Promise<string | null>;
  commitChanges: (message: string, files: string[]) => Promise<boolean>;
  createInitialCommit: () => Promise<boolean>;
  openFile: (filePath: string) => Promise<void>;
};

