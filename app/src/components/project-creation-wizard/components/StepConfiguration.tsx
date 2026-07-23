import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/view/ui';
import { isCloneWorkflow, shouldShowGithubAuthentication } from '../utils/pathUtils';
import type { GithubTokenCredential, TokenMode } from '../types';

import GithubAuthenticationCard from './GithubAuthenticationCard';

type StepConfigurationProps = {
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  availableTokens: GithubTokenCredential[];
  loadingTokens: boolean;
  tokenLoadError: string | null;
  isCreating: boolean;
  onWorkspacePathChange: (workspacePath: string) => void;
  onGithubUrlChange: (githubUrl: string) => void;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
  onAdvanceToConfirm: () => void;
};

export default function StepConfiguration({
  workspacePath,
  githubUrl,
  tokenMode,
  selectedGithubToken,
  newGithubToken,
  availableTokens,
  loadingTokens,
  tokenLoadError,
  isCreating,
  onWorkspacePathChange,
  onGithubUrlChange,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
  onAdvanceToConfirm,
}: StepConfigurationProps) {
  const { t } = useTranslation();
  const showGithubAuth = shouldShowGithubAuthentication(githubUrl);
  const isCloning = isCloneWorkflow(githubUrl);

  return (
    <div className="space-y-4">
      {/* GitHub URL first: it determines whether the name field is required (empty
          project) or an optional override of the repo-derived folder name (clone). */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('projectWizard.step2.githubUrl')}
        </label>
        <Input
          type="text"
          value={githubUrl}
          onChange={(event) => onGithubUrlChange(event.target.value)}
          placeholder="https://github.com/username/repository"
          className="w-full"
          disabled={isCreating}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('projectWizard.step2.githubHelp')}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {isCloning ? t('projectWizard.step2.folderName') : t('projectWizard.step2.projectName')}
        </label>
        <Input
          type="text"
          value={workspacePath}
          onChange={(event) => onWorkspacePathChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && workspacePath.trim()) {
              onAdvanceToConfirm();
            }
          }}
          placeholder={isCloning ? t('projectWizard.step2.folderNamePlaceholder') : 'my-project'}
          className="w-full"
          disabled={isCreating}
          autoFocus
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {isCloning ? t('projectWizard.step2.folderNameHelp') : t('projectWizard.step2.projectNameHelp')}
        </p>
      </div>

      {showGithubAuth && (
        <GithubAuthenticationCard
          tokenMode={tokenMode}
          selectedGithubToken={selectedGithubToken}
          newGithubToken={newGithubToken}
          availableTokens={availableTokens}
          loadingTokens={loadingTokens}
          tokenLoadError={tokenLoadError}
          onTokenModeChange={onTokenModeChange}
          onSelectedGithubTokenChange={onSelectedGithubTokenChange}
          onNewGithubTokenChange={onNewGithubTokenChange}
        />
      )}
    </div>
  );
}
