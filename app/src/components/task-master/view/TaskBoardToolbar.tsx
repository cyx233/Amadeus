import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Columns,
  FileText,
  Filter,
  Grid,
  HelpCircle,
  List,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import type { PrdFile, TaskBoardSortField, TaskBoardSortOrder, TaskBoardView } from '../types';
import { useTaskMaster } from '../context/TaskMasterContext';
import { prdNameToTag } from '../utils/prdTag';

import TaskFiltersPanel from './shared/TaskFiltersPanel';
import TaskQuickSortBar from './shared/TaskQuickSortBar';

type TaskBoardToolbarProps = {
  hasProject: boolean;
  hasTaskMasterConfigured: boolean;
  totalTaskCount: number;
  filteredTaskCount: number;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  viewMode: TaskBoardView;
  onViewModeChange: (viewMode: TaskBoardView) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  sortField: TaskBoardSortField;
  sortOrder: TaskBoardSortOrder;
  onSortChange: (field: TaskBoardSortField) => void;
  onSortConfigChange: (field: TaskBoardSortField, order: TaskBoardSortOrder) => void;
  statuses: string[];
  priorities: string[];
  onClearFilters: () => void;
  existingPrds: PrdFile[];
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
  onPrdDeleted?: () => void;
  onOpenHelp: () => void;
  onOpenCreateTask: () => void;
};

export default function TaskBoardToolbar({
  hasProject,
  hasTaskMasterConfigured,
  totalTaskCount,
  filteredTaskCount,
  searchTerm,
  onSearchTermChange,
  viewMode,
  onViewModeChange,
  showFilters,
  onToggleFilters,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  sortField,
  sortOrder,
  onSortChange,
  onSortConfigChange,
  statuses,
  priorities,
  onClearFilters,
  existingPrds,
  onCreatePrd,
  onOpenPrd,
  onPrdDeleted,
  onOpenHelp,
  onOpenCreateTask,
}: TaskBoardToolbarProps) {
  const { t } = useTranslation('tasks');
  const { availableTags, selectedTags, selectTag, selectTags, toggleTag, currentProject, refreshTasks } = useTaskMaster();
  const [isPrdDropdownOpen, setIsPrdDropdownOpen] = useState(false);
  const [generatingTag, setGeneratingTag] = useState<string | null>(null);
  const [deletingPrd, setDeletingPrd] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // A tag only appears in availableTags once it has tasks in tasks.json, so this
  // set answers "does this PRD have a generated task set yet?".
  const tagsWithTasks = new Set(availableTags);
  // Tags that have tasks but no matching PRD file (e.g. PRD deleted, or the
  // default 'master' set). Surfaced in the selector so their tasks stay reachable.
  const prdTagSet = new Set(existingPrds.map((prd) => prdNameToTag(prd.name)));
  const orphanTags = availableTags.filter((tagName) => !prdTagSet.has(tagName));

  const handleGenerateTasks = async (prd: PrdFile) => {
    if (!currentProject?.projectId) return;
    const slug = prdNameToTag(prd.name);
    try {
      setGeneratingTag(slug);
      await api.taskmaster.parsePRD(currentProject.projectId, {
        fileName: prd.name,
        tag: slug,
        numTasks: undefined,
        append: undefined,
      });
      selectTag(slug); // jump the board to the freshly-generated set
      await refreshTasks();
    } finally {
      setGeneratingTag(null);
    }
  };

  const handleDeletePrd = async (prd: PrdFile) => {
    if (!currentProject?.projectId) return;
    const slug = prdNameToTag(prd.name);
    if (!window.confirm(t('tags.confirmDelete', { name: prd.name, defaultValue: `Delete "${prd.name}" and its tasks?` }))) {
      return;
    }
    try {
      setDeletingPrd(prd.name);
      await api.taskmaster.deletePRD(currentProject.projectId, prd.name, slug);
      // If the deleted set was selected, drop it from the selection.
      if (selectedTags.includes(slug)) {
        selectTags(selectedTags.filter((tagName) => tagName !== slug));
      }
      await refreshTasks();
      onPrdDeleted?.();
    } finally {
      setDeletingPrd(null);
    }
  };

  // "Select all" reflects/【toggles】every selectable tag (master + all with tasks).
  const allSelectableTags = availableTags;
  const allSelected = allSelectableTags.length > 0 && allSelectableTags.every((tagName) => selectedTags.includes(tagName));
  const toggleSelectAll = () => {
    selectTags(allSelected ? (availableTags.includes('master') ? ['master'] : availableTags.slice(0, 1)) : allSelectableTags);
  };

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPrdDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              onClick={() => onViewModeChange('kanban')}
              className={cn(
                'p-2 rounded-md',
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
              title={t('views.kanban')}
            >
              <Columns className="h-4 w-4" />
            </button>

            <button
              onClick={() => onViewModeChange('list')}
              className={cn(
                'p-2 rounded-md',
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
              title={t('views.list')}
            >
              <List className="h-4 w-4" />
            </button>

            <button
              onClick={() => onViewModeChange('grid')}
              className={cn(
                'p-2 rounded-md',
                viewMode === 'grid'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
              title={t('views.grid')}
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={onToggleFilters}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
              showFilters
                ? 'bg-blue-50 dark:bg-blue-900 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
            )}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">{t('filters.button')}</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
          </button>

          {hasProject && (
            <>
              <button
                onClick={onOpenHelp}
                className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
                title={t('buttons.help')}
              >
                <HelpCircle className="h-4 w-4" />
              </button>

              <div ref={dropdownRef} className="relative">
                {existingPrds.length > 0 ? (
                  <>
                    <button
                      onClick={() => setIsPrdDropdownOpen((current) => !current)}
                      className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 font-medium text-white hover:bg-purple-700"
                      title={t('buttons.prdsAvailable', { count: existingPrds.length })}
                    >
                      <FileText className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('buttons.prds')}</span>
                      <span className="min-w-5 rounded-full bg-purple-500 px-1.5 py-0.5 text-center text-xs">
                        {existingPrds.length}
                      </span>
                      <ChevronDown className={cn('w-3 h-3 transition-transform hidden sm:block', isPrdDropdownOpen && 'rotate-180')} />
                    </button>

                    {isPrdDropdownOpen && (
                      <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                        <div className="p-2">
                          <button
                            onClick={() => {
                              onCreatePrd();
                              setIsPrdDropdownOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-900/30"
                          >
                            <Plus className="h-4 w-4" />
                            {t('buttons.createNewPRD')}
                          </button>

                          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                          {/* Each row: a checkbox (add/remove from the merged view)
                              and a label (click = view just that set). Selection is
                              explicit — any set, including Default, can be unchecked. */}
                          {(() => {
                            const isChecked = (tag: string) => selectedTags.includes(tag);
                            const Checkbox = ({ tag, disabled = false }: { tag: string; disabled?: boolean }) => (
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={(e) => { e.stopPropagation(); if (!disabled) toggleTag(tag); }}
                                title={disabled
                                  ? t('tags.noTasksYet', 'Generate tasks first')
                                  : t('tags.toggle', 'Show alongside others')}
                                className={cn(
                                  'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                                  disabled && 'cursor-not-allowed opacity-40',
                                  isChecked(tag)
                                    ? 'border-purple-600 bg-purple-600 text-white'
                                    : 'border-gray-300 dark:border-gray-500'
                                )}
                              >
                                {isChecked(tag) && <Check className="h-3 w-3" />}
                              </button>
                            );

                            return (
                              <>
                                {/* Select all — bulk toggle every task set into the merged view. */}
                                <div className="group flex items-center gap-2 rounded px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); toggleSelectAll(); }}
                                    title={t('tags.selectAll', 'Select all')}
                                    className={cn(
                                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                                      allSelected
                                        ? 'border-purple-600 bg-purple-600 text-white'
                                        : 'border-gray-300 dark:border-gray-500'
                                    )}
                                  >
                                    {allSelected && <Check className="h-3 w-3" />}
                                  </button>
                                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {t('tags.selectAll', 'Select all')}
                                  </span>
                                </div>

                                <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                                {/* Default (master) — manual/unassigned tasks. */}
                                <div className="group flex items-center gap-2 rounded px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                                  <Checkbox tag="master" />
                                  <button
                                    onClick={() => { selectTag('master'); setIsPrdDropdownOpen(false); }}
                                    className="min-w-0 flex-1 truncate text-left text-sm text-gray-700 dark:text-gray-300"
                                  >
                                    {t('tags.default', 'Default')}
                                  </button>
                                </div>

                                {/* One row per PRD: checkbox = add to merged view;
                                    label = view just this; ✨ = generate; 📄 = edit; 🗑 = delete. */}
                                {existingPrds.map((prd) => {
                                  const slug = prdNameToTag(prd.name);
                                  const isGenerating = generatingTag === slug;
                                  const isDeleting = deletingPrd === prd.name;
                                  const hasTasks = tagsWithTasks.has(slug);
                                  return (
                                    <div
                                      key={prd.name}
                                      className={cn(
                                        'group flex items-center gap-2 rounded px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700',
                                        isChecked(slug) && 'bg-purple-50 dark:bg-purple-900/20'
                                      )}
                                    >
                                      {/* No task set yet → checkbox disabled (nothing to merge). */}
                                      <Checkbox tag={slug} disabled={!hasTasks} />
                                      <button
                                        onClick={() => { if (hasTasks) { selectTag(slug); setIsPrdDropdownOpen(false); } }}
                                        disabled={!hasTasks}
                                        className={cn(
                                          'min-w-0 flex-1 truncate text-left text-sm text-gray-700 dark:text-gray-300',
                                          !hasTasks && 'cursor-default text-gray-400 dark:text-gray-500'
                                        )}
                                      >
                                        {prd.name}
                                      </button>
                                      <button
                                        onClick={() => { void handleGenerateTasks(prd); }}
                                        disabled={isGenerating || isDeleting}
                                        title={t('tags.generateTasks', 'Generate tasks from this PRD')}
                                        className={cn(
                                          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded disabled:opacity-50',
                                          // Highlight when this PRD has no task set yet — that's the next action.
                                          hasTasks
                                            ? 'text-gray-500 hover:bg-purple-100 hover:text-purple-700 dark:hover:bg-purple-900/40'
                                            : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300'
                                        )}
                                      >
                                        {isGenerating
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <Sparkles className="h-3.5 w-3.5" />}
                                      </button>
                                      <button
                                        onClick={() => { onOpenPrd(prd); setIsPrdDropdownOpen(false); }}
                                        title={t('tags.openEditor', 'Open PRD')}
                                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                                      >
                                        <FileText className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={() => { void handleDeletePrd(prd); }}
                                        disabled={isDeleting || isGenerating}
                                        title={t('tags.delete', 'Delete PRD and its tasks')}
                                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-900/40"
                                      >
                                        {isDeleting
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <Trash2 className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  );
                                })}

                                {/* Orphan tags: task sets whose PRD file is gone. */}
                                {orphanTags.length > 0 && (
                                  <>
                                    <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                                    {orphanTags.filter((tagName) => tagName !== 'master').map((tagName) => (
                                      <div
                                        key={tagName}
                                        className="group flex items-center gap-2 rounded px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                                      >
                                        <Checkbox tag={tagName} />
                                        <button
                                          onClick={() => { selectTag(tagName); setIsPrdDropdownOpen(false); }}
                                          className="min-w-0 flex-1 truncate text-left text-sm italic text-gray-500"
                                        >
                                          {tagName}
                                        </button>
                                      </div>
                                    ))}
                                  </>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    onClick={onCreatePrd}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 font-medium text-white hover:bg-purple-700"
                    title={t('buttons.addPRD')}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('buttons.addPRD')}</span>
                  </button>
                )}
              </div>

              {(hasTaskMasterConfigured || totalTaskCount > 0) && (
                <button
                  onClick={onOpenCreateTask}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
                  title={t('buttons.addTask')}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('buttons.addTask')}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <TaskFiltersPanel
        showFilters={showFilters}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={onPriorityFilterChange}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortConfigChange={onSortConfigChange}
        statuses={statuses}
        priorities={priorities}
        filteredTaskCount={filteredTaskCount}
        totalTaskCount={totalTaskCount}
        onClearFilters={onClearFilters}
      />

      <TaskQuickSortBar sortField={sortField} sortOrder={sortOrder} onSortChange={onSortChange} />
    </>
  );
}
