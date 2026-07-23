import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';

export type GenerateProgress = {
  prdName: string;
  tag: string;
  lines: string[];
  status: 'running' | 'done' | 'error';
};

type StartArgs = {
  projectId: string;
  fileName: string;
  tag: string;
  numTasks?: number;
  append?: boolean;
  onComplete?: (tag: string) => void;
};

/**
 * Drives a streaming parse-prd (generate tasks from a PRD) over SSE and exposes
 * live progress + a stop control. Shared by the task-board toolbar and the PRD
 * editor so both get the same progress modal and cancel behavior.
 *
 * Stop closes the EventSource, which the server observes (req 'close') and kills
 * the underlying task-master process — no orphaned generation.
 */
export function useGenerateTasks() {
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  // Tear down the stream if the component using the hook unmounts mid-run.
  useEffect(() => () => closeSource(), [closeSource]);

  const isRunning = progress?.status === 'running';

  const start = useCallback(
    ({ projectId, fileName, tag, numTasks, append, onComplete }: StartArgs) => {
      if (sourceRef.current) return; // one generation at a time
      setProgress({ prdName: fileName, tag, lines: [], status: 'running' });

      const es = api.taskmaster.parsePRDProgress(projectId, { fileName, tag, numTasks, append });
      sourceRef.current = es;

      es.onmessage = (event) => {
        let payload: { type?: string; message?: string } = {};
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.type === 'progress' && payload.message) {
          setProgress((prev) => (prev ? { ...prev, lines: [...prev.lines, payload.message as string] } : prev));
        } else if (payload.type === 'complete') {
          closeSource();
          setProgress((prev) => (prev ? { ...prev, status: 'done' } : prev));
          onComplete?.(tag);
        } else if (payload.type === 'error') {
          closeSource();
          setProgress((prev) =>
            prev ? { ...prev, status: 'error', lines: [...prev.lines, payload.message || 'Failed'] } : prev,
          );
        }
      };
      es.onerror = () => {
        closeSource();
        setProgress((prev) => (prev ? { ...prev, status: 'error' } : prev));
      };
    },
    [closeSource],
  );

  // Stop the in-flight generation (kills the server process via stream close).
  const stop = useCallback(() => {
    closeSource();
    setProgress((prev) => (prev ? { ...prev, status: 'error', lines: [...prev.lines, 'Stopped.'] } : prev));
  }, [closeSource]);

  // Dismiss the modal (only when not running).
  const dismiss = useCallback(() => setProgress(null), []);

  return { progress, isRunning, start, stop, dismiss };
}
