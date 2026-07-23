import { useCallback, useMemo, useState } from 'react';
import type { Project } from '../../types/app';
import { useGenerateTasks } from '../task-master/hooks/useGenerateTasks';
import { prdNameToTag } from '../task-master/utils/prdTag';
import GenerateProgressModal from '../task-master/view/modals/GenerateProgressModal';
import { usePrdDocument } from './hooks/usePrdDocument';
import { usePrdKeyboardShortcuts } from './hooks/usePrdKeyboardShortcuts';
import { usePrdRegistry } from './hooks/usePrdRegistry';
import { usePrdSave } from './hooks/usePrdSave';
import type { PrdFile } from './types';
import { ensurePrdExtension, stripPrdExtension } from './utils/fileName';
import OverwriteConfirmModal from './view/OverwriteConfirmModal';
import PrdEditorLoadingState from './view/PrdEditorLoadingState';
import PrdEditorWorkspace from './view/PrdEditorWorkspace';

type PRDEditorProps = {
  file?: PrdFile | null;
  onClose: () => void;
  projectPath?: string;
  project?: Project | null;
  initialContent?: string;
  isNewFile?: boolean;
  onSave?: () => Promise<void> | void;
};

export default function PRDEditor({
  file,
  onClose,
  projectPath,
  project,
  initialContent = '',
  isNewFile = false,
  onSave,
}: PRDEditorProps) {
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState<boolean>(false);
  const [overwriteFileName, setOverwriteFileName] = useState<string>('');

  const { content, setContent, fileName, setFileName, loading, loadError } = usePrdDocument({
    file,
    isNewFile,
    initialContent,
    projectPath,
  });

  // PRD hooks are now addressed by DB `projectId`; the backend resolves the
  // `.taskmaster/docs` folder from the `projects` table.
  const { existingPrds, refreshExistingPrds } = usePrdRegistry({
    projectId: project?.projectId,
  });

  const isExistingFile = useMemo(() => !isNewFile || Boolean(file?.isExisting), [file?.isExisting, isNewFile]);

  const { savePrd, saving, saveSuccess } = usePrdSave({
    projectId: project?.projectId,
    existingPrds,
    isExistingFile,
    onAfterSave: async () => {
      await refreshExistingPrds();
      await onSave?.();
    },
  });

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const downloadedFileName = ensurePrdExtension(fileName || 'prd');

    anchor.href = url;
    anchor.download = downloadedFileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [content, fileName]);

  const handleSave = useCallback(
    async (allowOverwrite = false) => {
      const result = await savePrd({
        content,
        fileName,
        allowOverwrite,
      });

      if (result.status === 'needs-overwrite') {
        setOverwriteFileName(result.fileName);
        setShowOverwriteConfirm(true);
        return;
      }

      if (result.status === 'failed') {
        alert(result.message);
      }
    },
    [content, fileName, savePrd],
  );

  const confirmOverwrite = useCallback(async () => {
    setShowOverwriteConfirm(false);
    await handleSave(true);
  }, [handleSave]);

  // Existing PRDs can't be renamed in place (would orphan the task-set tag), so
  // "Copy to new" saves the current content under a fresh name instead.
  const handleCopyToNew = useCallback(async () => {
    const suggested = stripPrdExtension(fileName || 'prd');
    const input = window.prompt('Save a copy as a new PRD. New name:', `${suggested}-copy`);
    const newName = input?.trim();
    if (!newName) {
      return;
    }
    // savePrd skips its overwrite check when editing an existing PRD, so guard
    // collisions here to avoid silently clobbering another PRD.
    const finalName = ensurePrdExtension(newName);
    if (existingPrds.some((prd) => prd.name === finalName)) {
      alert(`A PRD named "${finalName}" already exists. Choose a different name.`);
      return;
    }
    const result = await savePrd({ content, fileName: newName });
    if (result.status === 'failed') {
      alert(result.message);
      return;
    }
    // Switch the editor to the freshly-created copy.
    setFileName(newName);
  }, [content, fileName, savePrd, setFileName]);

  // Generate tasks from this PRD (streams progress). Generation reads the saved
  // file on disk, so it targets the current fileName's tag.
  const generate = useGenerateTasks();
  const handleGenerate = useCallback(() => {
    if (!project?.projectId) return;
    const name = ensurePrdExtension(fileName || 'prd');
    generate.start({
      projectId: project.projectId,
      fileName: name,
      tag: prdNameToTag(name),
      onComplete: () => { void refreshExistingPrds(); },
    });
  }, [project?.projectId, fileName, generate, refreshExistingPrds]);

  usePrdKeyboardShortcuts({
    onSave: () => {
      void handleSave();
    },
    onClose,
  });

  if (loading) {
    return <PrdEditorLoadingState />;
  }

  return (
    <>
      <PrdEditorWorkspace
        content={content}
        onContentChange={setContent}
        fileName={fileName}
        onFileNameChange={setFileName}
        isNewFile={isNewFile}
        onCopyToNew={() => {
          void handleCopyToNew();
        }}
        saving={saving}
        saveSuccess={saveSuccess}
        onSave={() => {
          void handleSave();
        }}
        onDownload={handleDownload}
        onClose={onClose}
        loadError={loadError}
        onGenerate={handleGenerate}
        canGenerate={Boolean(project?.projectId) && existingPrds.some((prd) => prd.name === ensurePrdExtension(fileName || 'prd'))}
        generating={generate.isRunning}
      />

      {generate.progress && (
        <GenerateProgressModal progress={generate.progress} onStop={generate.stop} onClose={generate.dismiss} />
      )}

      <OverwriteConfirmModal
        isOpen={showOverwriteConfirm}
        fileName={overwriteFileName || ensurePrdExtension(fileName || 'prd')}
        saving={saving}
        onCancel={() => setShowOverwriteConfirm(false)}
        onConfirm={() => {
          void confirmOverwrite();
        }}
      />
    </>
  );
}
