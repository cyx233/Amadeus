import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

import { api } from '../utils/api';

interface TaskMasterInstallationStatus {
  installation?: { isInstalled?: boolean };
  isReady?: boolean;
}

interface TasksSettingsContextValue {
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
  installationStatus: TaskMasterInstallationStatus | null;
  isCheckingInstallation: boolean;
}

const TasksSettingsContext = createContext<TasksSettingsContextValue>({
  isTaskMasterInstalled: null,
  isTaskMasterReady: null,
  installationStatus: null,
  isCheckingInstallation: true
});

export const useTasksSettings = (): TasksSettingsContextValue => {
  const context = useContext(TasksSettingsContext);
  if (!context) {
    throw new Error('useTasksSettings must be used within a TasksSettingsProvider');
  }
  return context;
};

export const TasksSettingsProvider = ({ children }: { children: ReactNode }) => {
  // TaskMaster is a core feature (always on) — no enable/disable flag. Consumers
  // gate on installation readiness only.
  const [isTaskMasterInstalled, setIsTaskMasterInstalled] = useState<boolean | null>(null);
  const [isTaskMasterReady, setIsTaskMasterReady] = useState<boolean | null>(null);
  const [installationStatus, setInstallationStatus] = useState<TaskMasterInstallationStatus | null>(null);
  const [isCheckingInstallation, setIsCheckingInstallation] = useState(true);

  // Check TaskMaster installation status asynchronously on component mount.
  useEffect(() => {
    const checkInstallation = async () => {
      try {
        const response = await api.get('/taskmaster/installation-status');
        if (response.ok) {
          const data: TaskMasterInstallationStatus = await response.json();
          setInstallationStatus(data);
          setIsTaskMasterInstalled(data.installation?.isInstalled || false);
          setIsTaskMasterReady(data.isReady || false);
        } else {
          console.error('Failed to check TaskMaster installation status');
          setIsTaskMasterInstalled(false);
          setIsTaskMasterReady(false);
        }
      } catch (error) {
        console.error('Error checking TaskMaster installation:', error);
        setIsTaskMasterInstalled(false);
        setIsTaskMasterReady(false);
      } finally {
        setIsCheckingInstallation(false);
      }
    };

    // Run check asynchronously without blocking initial render
    setTimeout(checkInstallation, 0);
  }, []);

  const contextValue = {
    isTaskMasterInstalled,
    isTaskMasterReady,
    installationStatus,
    isCheckingInstallation
  };

  return (
    <TasksSettingsContext.Provider value={contextValue}>
      {children}
    </TasksSettingsContext.Provider>
  );
};

export default TasksSettingsContext;