import { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, Download, EyeOff, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { api } from '../../../../utils/api';
import Settings from '../../../settings/view/Settings';
import VersionUpgradeModal from '../../../version-upgrade/view';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { InstallMode } from '../../../../hooks/useVersionCheck';
import { normalizeProjectForSettings } from '../../utils/utils';
import type { DeleteProjectConfirmation, SessionDeleteConfirmation, SettingsProject } from '../../types/types';
import ProjectCreationWizard from '../../../project-creation-wizard';

type SidebarModalsProps = {
  projects: Project[];
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  showNewProject: boolean;
  onCloseNewProject: () => void;
  onProjectCreated: () => void;
  deleteConfirmation: DeleteProjectConfirmation | null;
  onCancelDeleteProject: () => void;
  onConfirmDeleteProject: (deleteData?: boolean) => void;
  sessionDeleteConfirmation: SessionDeleteConfirmation | null;
  onCancelDeleteSession: () => void;
  onConfirmDeleteSession: (hardDelete?: boolean) => void;
  showVersionModal: boolean;
  onCloseVersionModal: () => void;
  releaseInfo: ReleaseInfo | null;
  currentVersion: string;
  latestVersion: string | null;
  installMode: InstallMode;
  t: TFunction;
};

type TypedSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: SettingsProject[];
  initialTab: string;
};

const SettingsComponent = Settings as (props: TypedSettingsProps) => JSX.Element;

function TypedSettings(props: TypedSettingsProps) {
  return <SettingsComponent {...props} />;
}

// Own component so the "type the name to confirm" input resets on each open
// (state is scoped to the mount, which is gated by `deleteConfirmation`).
function DeleteProjectModal({
  confirmation,
  onCancel,
  onConfirm,
  t,
}: {
  confirmation: DeleteProjectConfirmation;
  onCancel: () => void;
  onConfirm: (deleteData?: boolean) => void;
  t: TFunction;
}) {
  const [typedName, setTypedName] = useState('');
  const projectName = confirmation.project.displayName || confirmation.project.projectId;
  // AWS-style guard: hard delete is irreversible and frees disk, so require an
  // exact name match before enabling it. Archiving stays one click.
  const canHardDelete = typedName.trim() === projectName;

  const handleDownload = () => {
    // Browser navigation to the token-carrying URL triggers the .tar.gz download.
    window.location.href = api.downloadProjectUrl(confirmation.project.projectId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
              <AlertTriangle className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {t('deleteConfirmation.deleteProject')}
              </h3>
              <p className="mb-1 text-sm text-muted-foreground">
                {t('deleteConfirmation.confirmDelete')}{' '}
                <span className="font-medium text-foreground">{projectName}</span>?
              </p>
              {confirmation.sessionCount > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('deleteConfirmation.sessionCount', { count: confirmation.sessionCount })}
                </p>
              )}

              <button
                type="button"
                onClick={handleDownload}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                <Download className="h-4 w-4" />
                {t('deleteConfirmation.downloadBeforeDelete', 'Download a copy first')}
              </button>

              <div className="mt-4">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('deleteConfirmation.typeToConfirm', 'To permanently delete, type the project name:')}{' '}
                  <span className="font-mono font-medium text-foreground">{projectName}</span>
                </label>
                <Input
                  type="text"
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  placeholder={projectName}
                  className="w-full"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4">
          <Button variant="outline" className="w-full justify-start" onClick={() => onConfirm(false)}>
            <EyeOff className="mr-2 h-4 w-4" />
            {t('deleteConfirmation.archiveProject', 'Archive project')}
          </Button>
          <Button
            variant="destructive"
            className="w-full justify-start bg-red-600 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canHardDelete}
            onClick={() => onConfirm(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('deleteConfirmation.deleteAllData')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SidebarModals({
  projects,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  showNewProject,
  onCloseNewProject,
  onProjectCreated,
  deleteConfirmation,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  sessionDeleteConfirmation,
  onCancelDeleteSession,
  onConfirmDeleteSession,
  showVersionModal,
  onCloseVersionModal,
  releaseInfo,
  currentVersion,
  latestVersion,
  installMode,
  t,
}: SidebarModalsProps) {
  // Settings expects project identity/path fields to be present for dropdown labels and local-scope MCP config.
  const settingsProjects = useMemo(
    () => projects.map(normalizeProjectForSettings),
    [projects],
  );

  return (
    <>
      {showNewProject &&
        ReactDOM.createPortal(
          <ProjectCreationWizard
            onClose={onCloseNewProject}
            onProjectCreated={onProjectCreated}
          />,
          document.body,
        )}

      {showSettings &&
        ReactDOM.createPortal(
          <TypedSettings
            isOpen={showSettings}
            onClose={onCloseSettings}
            projects={settingsProjects}
            initialTab={settingsInitialTab}
          />,
          document.body,
        )}

      {deleteConfirmation &&
        ReactDOM.createPortal(
          <DeleteProjectModal
            confirmation={deleteConfirmation}
            onCancel={onCancelDeleteProject}
            onConfirm={onConfirmDeleteProject}
            t={t}
          />,
          document.body,
        )}

      {sessionDeleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                      {t('deleteConfirmation.deleteSession')}
                    </h3>
                    <p className="mb-1 text-sm text-muted-foreground">
                      {t('deleteConfirmation.confirmDelete')}{' '}
                      <span className="font-medium text-foreground">
                        {sessionDeleteConfirmation.sessionTitle || t('sessions.unnamed')}
                      </span>
                      ?
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {sessionDeleteConfirmation.isArchived
                        ? t('deleteConfirmation.archivedSessionNotice', 'This session is already archived. You can keep it hidden or delete it permanently.')
                        : t('deleteConfirmation.archiveSessionNotice', 'Archive keeps the session out of the active list while preserving its history.')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4">
                {!sessionDeleteConfirmation.isArchived && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onConfirmDeleteSession(false)}
                  >
                    <EyeOff className="mr-2 h-4 w-4" />
                    {t('deleteConfirmation.archiveSession', 'Archive session')}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="w-full justify-start bg-red-600 text-white hover:bg-red-700"
                  onClick={() => onConfirmDeleteSession(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('deleteConfirmation.deleteSessionPermanently', 'Delete permanently')}
                </Button>
                <Button variant="ghost" className="w-full" onClick={onCancelDeleteSession}>
                  {t('actions.cancel')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <VersionUpgradeModal
        isOpen={showVersionModal}
        onClose={onCloseVersionModal}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
      />
    </>
  );
}
