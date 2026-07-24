/**
 * TASKMASTER API ROUTES
 * ====================
 * 
 * This module provides API endpoints for TaskMaster integration including:
 * - .taskmaster folder detection in project directories
 * - MCP server configuration detection
 * - TaskMaster state and metadata management
 */

import fs, { promises as fsPromises } from 'fs';
import path from 'path';

import express from 'express';
// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution — required
// here since task-master/npx are .cmd shims on Windows.
import rawSpawn from 'cross-spawn';

import { projectsDb } from '../modules/database/index.js';
import { callTool as mcpCallTool } from '../modules/taskmaster-mcp/client.js';
import { parseFrontMatter } from '../shared/frontmatter.js';
import { detectTaskMasterMCPServer } from '../utils/mcp-detector.js';
import { findAppRoot, getModuleDir } from '../utils/runtime-paths.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';

// Every task-master invocation in this module goes through this wrapped spawn.
// It injects a NODE_OPTIONS preload that sets AI SDK 5's
// `globalThis.AI_SDK_LOG_WARNINGS=false` inside the spawned process, silencing
// the harmless "System messages in the prompt..." warning. The SDK only reads
// that global (not an env var), so it must be set in task-master's own runtime;
// NODE_OPTIONS carries the `--import data:` across the npx -> node hop with no
// preload file. Harmless for non-AI calls (which/--version) — they ignore it.
function spawn(command: string, args: string[], options: Record<string, unknown> = {}) {
  const preload = '--import data:text/javascript,globalThis.AI_SDK_LOG_WARNINGS=false';
  const baseEnv = (options.env as NodeJS.ProcessEnv | undefined) ?? process.env;
  const env = {
    ...baseEnv,
    NODE_OPTIONS: [baseEnv.NODE_OPTIONS, preload].filter(Boolean).join(' '),
  };
  return rawSpawn(command, args, { ...options, env });
}

/**
 * Resolve the absolute project directory from a DB-assigned `projectId`.
 *
 * TaskMaster routes used to accept a Claude-encoded folder name (`projectName`)
 * and derive the path from JSONL history. After the projectId migration the
 * only identifier we accept is the primary key of the `projects` table, so
 * every handler calls this helper and 404s when the id is unknown.
 */
async function resolveProjectPathFromId(projectId: string): Promise<string | null> {
  if (!projectId) {
    return null;
  }
  return projectsDb.getProjectPathById(projectId);
}

/** Narrow an unknown catch binding to its message string. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Narrow an unknown catch binding to its Node error code, if any. */
function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

// PRD templates live as .md files (frontmatter = metadata, body = content)
// under this dir. findAppRoot() hops out of dist-server so the path resolves
// the same in dev (tsx) and prod (node dist-server); the source tree ships in
// the image. Single source of truth — the list and apply-template endpoints
// both read from here, so they can't drift.
const PRD_TEMPLATES_DIR = path.join(findAppRoot(getModuleDir(import.meta.url)), 'server', 'routes', 'prd-templates');

type PrdTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
};

/**
 * Load all PRD templates from disk. `[DATE]` in a template body is filled with
 * today's date, preserving the previous behavior where the date was inlined at
 * request time. Returns [] if the directory is missing rather than throwing.
 */
async function loadPrdTemplates(): Promise<PrdTemplate[]> {
  const today = new Date().toISOString().split('T')[0];
  let files: string[];
  try {
    files = (await fsPromises.readdir(PRD_TEMPLATES_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const templates = await Promise.all(files.map(async (file) => {
    const raw = await fsPromises.readFile(path.join(PRD_TEMPLATES_DIR, file), 'utf8');
    const { data, content } = parseFrontMatter(raw);
    const meta = data as Partial<PrdTemplate>;
    return {
      id: meta.id ?? path.basename(file, '.md'),
      name: meta.name ?? meta.id ?? path.basename(file, '.md'),
      description: meta.description ?? '',
      category: meta.category ?? '',
      content: content.replace(/\[DATE\]/g, today).trimStart(),
    };
  }));

  // Stable ordering so the picker list doesn't shuffle between reads.
  return templates.sort((a, b) => a.id.localeCompare(b.id));
}

const router = express.Router();

/**
 * Check if TaskMaster CLI is installed globally
 * @returns {Promise<Object>} Installation status result
 */
type TaskMasterInstallation = {
    isInstalled: boolean;
    installPath: string | null;
    version: string | null;
    reason: string | null;
};

async function checkTaskMasterInstallation(): Promise<TaskMasterInstallation> {
    return new Promise<TaskMasterInstallation>((resolve) => {
        // Check if task-master command is available
        const child = spawn('which', ['task-master'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true
        });

        let output = '';
        let errorOutput = '';

        child.stdout?.on('data', (data) => {
            output += data.toString();
        });

        child.stderr?.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0 && output.trim()) {
                // TaskMaster is installed, get version
                const versionChild = spawn('task-master', ['--version'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    shell: true
                });

                let versionOutput = '';

                versionChild.stdout?.on('data', (data) => {
                    versionOutput += data.toString();
                });

                versionChild.on('close', (versionCode) => {
                    resolve({
                        isInstalled: true,
                        installPath: output.trim(),
                        version: versionCode === 0 ? versionOutput.trim() : 'unknown',
                        reason: null
                    });
                });
                
                versionChild.on('error', () => {
                    resolve({
                        isInstalled: true,
                        installPath: output.trim(),
                        version: 'unknown',
                        reason: null
                    });
                });
            } else {
                resolve({
                    isInstalled: false,
                    installPath: null,
                    version: null,
                    reason: 'TaskMaster CLI not found in PATH'
                });
            }
        });
        
        child.on('error', (error) => {
            resolve({
                isInstalled: false,
                installPath: null,
                version: null,
                reason: `Error checking installation: ${errorMessage(error)}`
            });
        });
    });
}

// API Routes

/**
 * GET /api/taskmaster/installation-status
 * Check if TaskMaster CLI is installed on the system
 */
router.get('/installation-status', async (req, res) => {
    try {
        const installationStatus = await checkTaskMasterInstallation();
        
        // Also check for MCP server configuration
        const mcpStatus = await detectTaskMasterMCPServer() as { hasMCPServer?: boolean };

        res.json({
            success: true,
            installation: installationStatus,
            mcpServer: mcpStatus,
            isReady: installationStatus.isInstalled && mcpStatus.hasMCPServer
        });
    } catch (error) {
        console.error('Error checking TaskMaster installation:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check TaskMaster installation status',
            installation: {
                isInstalled: false,
                reason: `Server error: ${errorMessage(error)}`
            },
            mcpServer: {
                hasMCPServer: false,
                reason: `Server error: ${errorMessage(error)}`
            },
            isReady: false
        });
    }
});

/**
 * GET /api/taskmaster/tasks/:projectId
 * Load actual tasks from .taskmaster/tasks/tasks.json
 *
 * `projectId` is the DB primary key of the project; the folder is resolved via
 * the projects table rather than extracted from Claude JSONL history.
 */
router.get('/tasks/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        // Get project path via the DB; the legacy JSONL-based resolver is gone.
        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        const taskMasterPath = path.join(projectPath, '.taskmaster');
        const tasksFilePath = path.join(taskMasterPath, 'tasks', 'tasks.json');

        // Check if tasks file exists
        try {
            await fsPromises.access(tasksFilePath);
        } catch (error) {
            return res.json({
                projectId,
                tasks: [],
                message: 'No tasks.json file found'
            });
        }

        // Read and parse tasks file
        try {
            const tasksContent = await fsPromises.readFile(tasksFilePath, 'utf8');
            const tasksData = JSON.parse(tasksContent);
            
            // Each PRD parses into its own tag, so a project holds multiple
            // separate backlogs. Selection:
            //   ?tags=a,b,c  -> merged view of several sets (checkbox multi-select)
            //   ?tag=a       -> single set (kept for back-compat / single-select)
            // A task's id is only unique within its tag, so on a merged view we
            // stamp `sourceTag` on each task; the client keys by sourceTag+id and
            // interprets dependencies within the same sourceTag.
            const requestedTag = typeof req.query.tag === 'string' ? req.query.tag : null;
            const requestedTags = typeof req.query.tags === 'string'
                ? req.query.tags.split(',').map(s => s.trim()).filter(Boolean)
                : (requestedTag ? [requestedTag] : []);

            // tasksData is parsed from untrusted JSON on disk; treat task rows as
            // loose records (TaskMaster owns the real schema).
            type RawTask = Record<string, unknown>;
            let availableTags: string[] = [];
            let selectedTags: string[] = [];
            // Collected as {task, sourceTag} so we can stamp the source on merge.
            let sourceTasks: { task: RawTask; sourceTag: string }[] = [];

            // Handle both tagged and legacy formats
            if (Array.isArray(tasksData)) {
                // Legacy format
                selectedTags = ['master'];
                sourceTasks = tasksData.map((task: RawTask) => ({ task, sourceTag: 'master' }));
            } else if (tasksData.tasks) {
                // Simple format with tasks array
                selectedTags = ['master'];
                sourceTasks = tasksData.tasks.map((task: RawTask) => ({ task, sourceTag: 'master' }));
            } else {
                // Tagged format: { <tag>: { tasks: [...] }, ... }
                availableTags = Object.keys(tasksData).filter(key =>
                    tasksData[key] && Array.isArray(tasksData[key].tasks)
                );

                // Keep only requested tags that actually exist; if none valid,
                // pick a sensible default. Prefer a NON-EMPTY tag over master —
                // once a project's work moves into per-PRD tags, master is often
                // empty, and defaulting to it would blank the board ("Getting
                // Started") even though tasks exist under another tag.
                selectedTags = requestedTags.filter(tagName => availableTags.includes(tagName));
                if (selectedTags.length === 0) {
                    const hasTasks = (tagName: string) => (tasksData[tagName]?.tasks?.length ?? 0) > 0;
                    if (availableTags.includes('master') && hasTasks('master')) {
                        selectedTags = ['master'];
                    } else {
                        const firstNonEmpty = availableTags.find(hasTasks);
                        selectedTags = firstNonEmpty
                            ? [firstNonEmpty]
                            : (availableTags.includes('master') ? ['master'] : availableTags.slice(0, 1));
                    }
                }

                sourceTasks = selectedTags.flatMap(tagName =>
                    (tasksData[tagName]?.tasks ?? []).map((task: RawTask) => ({ task, sourceTag: tagName }))
                );
            }

            // Transform tasks to ensure all have required fields (+ sourceTag).
            const transformedTasks = sourceTasks.map(({ task, sourceTag }) => ({
                id: task.id,
                sourceTag,
                title: task.title || 'Untitled Task',
                description: task.description || '',
                status: task.status || 'pending',
                priority: task.priority || 'medium',
                dependencies: task.dependencies || [],
                createdAt: task.createdAt || task.created || new Date().toISOString(),
                updatedAt: task.updatedAt || task.updated || new Date().toISOString(),
                details: task.details || '',
                testStrategy: task.testStrategy || task.test_strategy || '',
                subtasks: task.subtasks || []
            }));

            // Sync the container's active tag to what the UI is viewing. Our own
            // routes always pass tag explicitly and don't need this, but the
            // coding agent in the container is a SEPARATE MCP client — its
            // next_task/get_tasks read the active tag from state.json, which would
            // otherwise sit on an empty master while the user works in a PRD tag.
            // Only for a concrete single-select view; skip merged/empty selections.
            // Best-effort: a sync failure must not break the task read.
            if (selectedTags.length === 1) {
                try {
                    await mcpCallTool('use_tag', { name: selectedTags[0], projectRoot: projectPath });
                } catch (syncError) {
                    console.error('Failed to sync active tag for agent:', errorMessage(syncError));
                }
            }

            res.json({
                projectId,
                projectPath,
                tasks: transformedTasks,
                selectedTags,
                availableTags,
                totalTasks: transformedTasks.length,
                tasksByStatus: {
                    pending: transformedTasks.filter(t => t.status === 'pending').length,
                    'in-progress': transformedTasks.filter(t => t.status === 'in-progress').length,
                    done: transformedTasks.filter(t => t.status === 'done').length,
                    review: transformedTasks.filter(t => t.status === 'review').length,
                    deferred: transformedTasks.filter(t => t.status === 'deferred').length,
                    cancelled: transformedTasks.filter(t => t.status === 'cancelled').length
                },
                timestamp: new Date().toISOString()
            });

        } catch (parseError) {
            console.error('Failed to parse tasks.json:', parseError);
            return res.status(500).json({
                error: 'Failed to parse tasks file',
                message: errorMessage(parseError)
            });
        }

    } catch (error) {
        console.error('TaskMaster tasks loading error:', error);
        res.status(500).json({
            error: 'Failed to load TaskMaster tasks',
            message: errorMessage(error)
        });
    }
});

/**
 * GET /api/taskmaster/prd/:projectId
 * List all PRD files in the project's .taskmaster/docs directory
 */
router.get('/prd/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        // projectId → projectPath lookup through the DB (post-migration).
        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        const docsPath = path.join(projectPath, '.taskmaster', 'docs');
        
        // Check if docs directory exists
        try {
            await fsPromises.access(docsPath, fs.constants.R_OK);
        } catch (error) {
            return res.json({
                projectId,
                prdFiles: [],
                message: 'No .taskmaster/docs directory found'
            });
        }

        // Read directory and filter for PRD files
        try {
            const files = await fsPromises.readdir(docsPath);
            const prdFiles = [];

            for (const file of files) {
                const filePath = path.join(docsPath, file);
                const stats = await fsPromises.stat(filePath);
                
                if (stats.isFile() && (file.endsWith('.txt') || file.endsWith('.md'))) {
                    prdFiles.push({
                        name: file,
                        path: path.relative(projectPath, filePath),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        created: stats.birthtime.toISOString()
                    });
                }
            }

            res.json({
                projectId,
                projectPath,
                prdFiles: prdFiles.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Error reading docs directory:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD files',
                message: errorMessage(readError)
            });
        }

    } catch (error) {
        console.error('PRD list error:', error);
        res.status(500).json({
            error: 'Failed to list PRD files',
            message: errorMessage(error)
        });
    }
});

/**
 * POST /api/taskmaster/prd/:projectId
 * Create or update a PRD file in the project's .taskmaster/docs directory
 */
router.post('/prd/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { fileName, content } = req.body;

        if (!fileName || !content) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'fileName and content are required'
            });
        }

        // Validate filename
        if (!fileName.match(/^[\w\-. ]+\.(txt|md)$/)) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Filename must end with .txt or .md and contain only alphanumeric characters, spaces, dots, and dashes'
            });
        }

        // Resolve the project folder through the DB using the projectId param.
        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        const docsPath = path.join(projectPath, '.taskmaster', 'docs');
        const filePath = path.join(docsPath, fileName);

        // Ensure docs directory exists
        try {
            await fsPromises.mkdir(docsPath, { recursive: true });
        } catch (error) {
            console.error('Failed to create docs directory:', error);
            return res.status(500).json({
                error: 'Failed to create directory',
                message: errorMessage(error)
            });
        }

        // Write the PRD file
        try {
            await fsPromises.writeFile(filePath, content, 'utf8');
            
            // Get file stats
            const stats = await fsPromises.stat(filePath);

            res.json({
                projectId,
                projectPath,
                fileName,
                filePath: path.relative(projectPath, filePath),
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                message: 'PRD file saved successfully',
                timestamp: new Date().toISOString()
            });

        } catch (writeError) {
            console.error('Failed to write PRD file:', writeError);
            return res.status(500).json({
                error: 'Failed to write PRD file',
                message: errorMessage(writeError)
            });
        }

    } catch (error) {
        console.error('PRD create/update error:', error);
        res.status(500).json({
            error: 'Failed to create/update PRD file',
            message: errorMessage(error)
        });
    }
});

/**
 * GET /api/taskmaster/prd/:projectId/:fileName
 * Get content of a specific PRD file
 */
router.get('/prd/:projectId/:fileName', async (req, res) => {
    try {
        const { projectId, fileName } = req.params;

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        const filePath = path.join(projectPath, '.taskmaster', 'docs', fileName);
        
        // Check if file exists
        try {
            await fsPromises.access(filePath, fs.constants.R_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'PRD file not found',
                message: `File "${fileName}" does not exist`
            });
        }

        // Read file content
        try {
            const content = await fsPromises.readFile(filePath, 'utf8');
            const stats = await fsPromises.stat(filePath);

            res.json({
                projectId,
                projectPath,
                fileName,
                filePath: path.relative(projectPath, filePath),
                content,
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Failed to read PRD file:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD file',
                message: errorMessage(readError)
            });
        }

    } catch (error) {
        console.error('PRD read error:', error);
        res.status(500).json({
            error: 'Failed to read PRD file',
            message: errorMessage(error)
        });
    }
});

/**
 * DELETE /api/taskmaster/prd/:projectId/:fileName
 * Removes a PRD file and (per the caller's `tag` query) drops the task set it
 * generated, so no orphan tag is left behind. `master` is never removed — it's
 * the reserved default tag.
 */
router.delete('/prd/:projectId/:fileName', async (req, res) => {
    try {
        const { projectId, fileName } = req.params;
        const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        // path.basename strips any traversal in the filename param before we join.
        const safeName = path.basename(fileName);
        const filePath = path.join(projectPath, '.taskmaster', 'docs', safeName);

        try {
            await fsPromises.unlink(filePath);
        } catch (unlinkError) {
            if (errorCode(unlinkError) !== 'ENOENT') {
                throw unlinkError;
            }
            // File already gone — fall through so we still clean up the tag.
        }

        // Drop the generated task set (tag) unless it's the reserved default.
        let removedTag = false;
        if (tag && tag !== 'master') {
            const tasksFilePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
            try {
                const raw = await fsPromises.readFile(tasksFilePath, 'utf8');
                const data = JSON.parse(raw);
                if (Object.prototype.hasOwnProperty.call(data, tag)) {
                    delete data[tag];
                    await fsPromises.writeFile(tasksFilePath, JSON.stringify(data, null, 2), 'utf8');
                    removedTag = true;
                }
            } catch (tagError) {
                if (errorCode(tagError) !== 'ENOENT') {
                    console.error('Failed to remove tag from tasks.json:', tagError);
                }
            }
        }

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectId);
        }
        res.json({
            projectId,
            fileName: safeName,
            removedTag,
            message: 'PRD file deleted successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('PRD delete error:', error);
        res.status(500).json({
            error: 'Failed to delete PRD file',
            message: errorMessage(error)
        });
    }
});

/**
 * POST /api/taskmaster/init/:projectId
 * Initialize TaskMaster in a project
 */
router.post('/init/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        // Check if TaskMaster is already initialized
        const taskMasterPath = path.join(projectPath, '.taskmaster');
        try {
            await fsPromises.access(taskMasterPath, fs.constants.F_OK);
            return res.status(400).json({
                error: 'TaskMaster already initialized',
                message: 'TaskMaster is already configured for this project'
            });
        } catch (error) {
            // Directory doesn't exist, we can proceed
        }

        // Run taskmaster init command
        const initProcess = spawn('npx', ['task-master', 'init'], {
            cwd: projectPath,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        initProcess.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        initProcess.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        initProcess.on('close', (code) => {
            if (code === 0) {
                // Broadcast TaskMaster project update via WebSocket. The
                // WebSocket payload keeps using `projectId` so the frontend
                // can match notifications against the current selection.
                if (req.app.locals.wss) {
                    broadcastTaskMasterProjectUpdate(
                        req.app.locals.wss,
                        projectId,
                        { hasTaskmaster: true, status: 'initialized' }
                    );
                }

                res.json({
                    projectId,
                    projectPath,
                    message: 'TaskMaster initialized successfully',
                    output: stdout,
                    timestamp: new Date().toISOString()
                });
            } else {
                console.error('TaskMaster init failed:', stderr);
                res.status(500).json({
                    error: 'Failed to initialize TaskMaster',
                    message: stderr || stdout,
                    code
                });
            }
        });

        // Send 'yes' responses to automated prompts
        initProcess.stdin?.write('yes\n');
        initProcess.stdin?.end();

    } catch (error) {
        console.error('TaskMaster init error:', error);
        res.status(500).json({
            error: 'Failed to initialize TaskMaster',
            message: errorMessage(error)
        });
    }
});

/**
 * POST /api/taskmaster/add-task/:projectId
 * Add a new task to the project
 */
router.post('/add-task/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { prompt, title, description, priority = 'medium', dependencies, research = false, tag } = req.body;

        if (!prompt && (!title || !description)) {
            return res.status(400).json({
                error: 'Missing required parameters',
                message: 'Either "prompt" or both "title" and "description" are required'
            });
        }

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        // add_task takes either a free-form prompt (AI generates the task) or
        // explicit title/description. research forces the Perplexity provider, so
        // only pass it when asked (otherwise it fails for Bedrock/Anthropic users).
        const args = {
            projectRoot: projectPath,
            priority,
            ...(prompt ? { prompt, ...(research ? { research: true } : {}) } : { title, description }),
            ...(dependencies ? { dependencies: String(dependencies) } : {}),
            ...(tag ? { tag: String(tag) } : {}),
        };

        const result = await mcpCallTool('add_task', args);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectId);
        }

        res.json({
            projectId,
            projectPath,
            message: 'Task added successfully',
            output: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({
            error: 'Failed to add task',
            message: errorMessage(error)
        });
    }
});

/**
 * PUT /api/taskmaster/update-task/:projectId/:taskId
 * Update a specific task using TaskMaster CLI
 */
router.put('/update-task/:projectId/:taskId', async (req, res) => {
    try {
        const { projectId, taskId } = req.params;
        const { title, description, status, priority, details, dependencies, tag } = req.body;

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        // All sub-operations go through the resident MCP server, whose tools take
        // `tag` natively (no active-tag switching) and `projectRoot` per call. tag
        // is only meaningful when non-default; omit it for master.
        const tagArg = tag && tag !== 'master' ? { tag: String(tag) } : {};

        // Status → set_task_status. Calls tmCore.tasks.updateStatus(id,status,tag)
        // directly — no side effect. ~ms vs ~7s for the old two-spawn path.
        if (typeof status === 'string' && status) {
            await mcpCallTool('set_task_status', {
                id: String(taskId),
                status,
                projectRoot: projectPath,
                ...tagArg,
            });
        }

        // Dependencies → diff the requested list against the current one and add/
        // remove individually via TaskMaster's structured dependency tools.
        if (Array.isArray(dependencies)) {
            const tasksFilePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
            let currentDeps: string[] = [];
            try {
                const data = JSON.parse(await fsPromises.readFile(tasksFilePath, 'utf8'));
                const tagKey = tag || 'master';
                const list: Array<{ id?: unknown; dependencies?: unknown }> = data[tagKey]?.tasks ?? data.tasks ?? [];
                const found = list.find((tk) => String(tk.id) === String(taskId));
                currentDeps = Array.isArray(found?.dependencies) ? found.dependencies.map(String) : [];
            } catch (readError) {
                console.error('Failed to read current dependencies:', readError);
            }
            const wanted = dependencies.map(String);
            const toAdd = wanted.filter((d: string) => !currentDeps.includes(d));
            const toRemove = currentDeps.filter((d) => !wanted.includes(d));
            for (const dep of toAdd) {
                await mcpCallTool('add_dependency', { id: String(taskId), dependsOn: dep, projectRoot: projectPath, ...tagArg });
            }
            for (const dep of toRemove) {
                await mcpCallTool('remove_dependency', { id: String(taskId), dependsOn: dep, projectRoot: projectPath, ...tagArg });
            }
        }

        // Title / description / details / priority are applied via one AI-prompt
        // update_task — TaskMaster has no structured flags for these (only a
        // prompt), so we describe the change and let it rewrite the task.
        const textUpdates = [];
        if (title) textUpdates.push(`title: "${title}"`);
        if (description) textUpdates.push(`description: "${description}"`);
        if (details) textUpdates.push(`details: "${details}"`);
        if (priority) textUpdates.push(`priority: "${priority}"`);
        if (textUpdates.length > 0) {
            const prompt = `Update task with the following changes: ${textUpdates.join(', ')}`;
            await mcpCallTool('update_task', { id: String(taskId), prompt, projectRoot: projectPath, ...tagArg });
        }

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectId);
        }
        res.json({
            projectId,
            projectPath,
            taskId,
            message: 'Task updated successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            error: 'Failed to update task',
            message: errorMessage(error)
        });
    }
});

/**
 * DELETE /api/taskmaster/task/:projectId/:taskId
 * Remove a task (or subtask, id like "5.2") from a tag via the MCP remove_task
 * tool (tag-native, no interactive prompt).
 */
router.delete('/task/:projectId/:taskId', async (req, res) => {
    try {
        const { projectId, taskId } = req.params;
        const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found', message: `Project "${projectId}" does not exist` });
        }

        await mcpCallTool('remove_task', {
            id: String(taskId),
            projectRoot: projectPath,
            ...(tag && tag !== 'master' ? { tag } : {}),
        });

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectId);
        }
        res.json({ projectId, taskId, message: 'Task removed successfully', timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('Remove task error:', error);
        res.status(500).json({ error: 'Failed to remove task', message: errorMessage(error) });
    }
});

/**
 * POST /api/taskmaster/parse-prd/:projectId
 * Parse a PRD file to generate tasks
 */
router.post('/parse-prd/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { fileName = 'prd.txt', numTasks, append = false, tag, research = false } = req.body;

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        const prdPath = path.join(projectPath, '.taskmaster', 'docs', fileName);
        
        // Check if PRD file exists
        try {
            await fsPromises.access(prdPath, fs.constants.F_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'PRD file not found',
                message: `File "${fileName}" does not exist in .taskmaster/docs/`
            });
        }

        // Build the command args. Use the `task-master` CLI bin (not
        // `task-master-ai`, which is the MCP server bin).
        const args = ['task-master', 'parse-prd', prdPath];

        if (numTasks) {
            args.push('--num-tasks', numTasks.toString());
        }

        if (append) {
            args.push('--append');
        }

        // Per-PRD task sets: parse each doc into its own tag so multiple design
        // docs in one project don't merge into a single backlog. Falls back to
        // the default (master) tag when no tag is given.
        if (tag) {
            args.push('--tag', String(tag));
        }

        // --research forces the Perplexity provider; only opt in when asked, so
        // parse works for users on Bedrock/Anthropic/etc. without a Perplexity key.
        if (research) {
            args.push('--research');
        }

        // Run task-master parse-prd command
        const parsePRDProcess = spawn('npx', args, {
            cwd: projectPath,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        parsePRDProcess.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        parsePRDProcess.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        parsePRDProcess.on('close', (code) => {
            if (code === 0) {
                // Broadcast task update via WebSocket
                if (req.app.locals.wss) {
                    broadcastTaskMasterTasksUpdate(
                        req.app.locals.wss,
                        projectId
                    );
                }

                res.json({
                    projectId,
                    projectPath,
                    prdFile: fileName,
                    message: 'PRD parsed and tasks generated successfully',
                    output: stdout,
                    timestamp: new Date().toISOString()
                });
            } else {
                console.error('Parse PRD failed:', stderr);
                res.status(500).json({
                    error: 'Failed to parse PRD',
                    message: stderr || stdout,
                    code
                });
            }
        });

        parsePRDProcess.stdin?.end();

    } catch (error) {
        console.error('Parse PRD error:', error);
        res.status(500).json({
            error: 'Failed to parse PRD',
            message: errorMessage(error)
        });
    }
});

/**
 * GET /api/taskmaster/parse-prd-progress/:projectId
 * Streaming variant of parse-prd. Generating tasks from a PRD takes tens of
 * seconds to minutes (each task is an AI call), so instead of a single request
 * that appears to hang, this streams task-master's stdout line-by-line over SSE
 * so the UI can show live progress. Params come via query (EventSource can't
 * send a POST body); auth token via ?token= (EventSource can't set headers).
 */
router.get('/parse-prd-progress/:projectId', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
    };

    let child: ReturnType<typeof spawn> | null = null;
    req.on('close', () => { child?.kill(); });

    try {
        const { projectId } = req.params;
        const fileName = typeof req.query.fileName === 'string' ? req.query.fileName : 'prd.txt';
        const tag = typeof req.query.tag === 'string' ? req.query.tag : '';
        // Bound generation: without a limit task-master generates open-endedly and
        // can run for many minutes. Default to 10; honor an explicit numTasks.
        const numTasks = Number.parseInt(String(req.query.numTasks ?? ''), 10);
        const append = req.query.append === 'true';
        // parse-prd's ONLY interactive prompt is the "overwrite existing tasks?"
        // confirmation. With stdin closed (below) that prompt would hang forever,
        // so we must pass a non-interactive intent: append (add to the set) or
        // force (replace it). Default to force so a fresh generate never stalls;
        // the UI decides append vs overwrite for a tag that already has tasks.
        const force = req.query.force === 'true';

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            sendEvent('error', { message: `Project "${projectId}" does not exist` });
            return res.end();
        }

        const prdPath = path.join(projectPath, '.taskmaster', 'docs', fileName);
        try {
            await fsPromises.access(prdPath, fs.constants.F_OK);
        } catch {
            sendEvent('error', { message: `File "${fileName}" does not exist in .taskmaster/docs/` });
            return res.end();
        }

        const args = ['task-master', 'parse-prd', prdPath,
            '--num-tasks', String(Number.isFinite(numTasks) && numTasks > 0 ? numTasks : 10)];
        if (tag) args.push('--tag', String(tag));
        // Non-interactive intent (see above). append wins if both set; otherwise
        // force to skip the overwrite confirmation. `stdio: ['ignore', ...]` keeps
        // stdin closed so a stray prompt fails fast instead of hanging.
        if (append) args.push('--append');
        else args.push('--force');
        void force; // force is the default path; kept as an explicit query knob

        sendEvent('progress', { message: `Generating tasks from ${fileName}...` });

        child = spawn('npx', args, { cwd: projectPath, stdio: ['ignore', 'pipe', 'pipe'] });
        let tail = '';

        const streamLines = (buf: Buffer) => {
            const text = buf.toString();
            tail += text;
            // Emit on newlines; strip ANSI so the UI shows clean lines.
            let idx;
            while ((idx = tail.indexOf('\n')) !== -1) {
                const line = tail.slice(0, idx).replace(/\x1b\[[0-9;]*m/g, '').trim();
                tail = tail.slice(idx + 1);
                if (line) sendEvent('progress', { message: line });
            }
        };
        child.stdout?.on('data', streamLines);
        child.stderr?.on('data', streamLines);

        child.on('close', (code) => {
            if (code === 0) {
                if (req.app.locals.wss) {
                    broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectId);
                }
                sendEvent('complete', { message: 'Tasks generated successfully', tag });
            } else {
                sendEvent('error', { message: `parse-prd exited with code ${code}` });
            }
            res.end();
        });

        child.on('error', (err) => {
            sendEvent('error', { message: errorMessage(err) });
            res.end();
        });
    } catch (error) {
        console.error('Parse PRD (SSE) error:', error);
        sendEvent('error', { message: error instanceof Error ? errorMessage(error) : 'Failed to parse PRD' });
        res.end();
    }
});

/**
 * GET /api/taskmaster/prd-templates
 * Get available PRD templates
 */
router.get('/prd-templates', async (req, res) => {
    try {
        const templates = await loadPrdTemplates();

        res.json({
            templates,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('PRD templates error:', error);
        res.status(500).json({
            error: 'Failed to get PRD templates',
            message: errorMessage(error)
        });
    }
});

/**
 * POST /api/taskmaster/apply-template/:projectId
 * Apply a PRD template to create a new PRD file
 */
router.post('/apply-template/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { templateId, fileName = 'prd.txt', customizations = {} } = req.body;

        if (!templateId) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'templateId is required'
            });
        }

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`
            });
        }

        // Get the template content (this would normally fetch from the templates list)
        const templates = await loadPrdTemplates();
        const template = templates.find(t => t.id === templateId);

        if (!template) {
            return res.status(404).json({
                error: 'Template not found',
                message: `Template "${templateId}" does not exist`
            });
        }

        // Apply customizations to template content
        let content = template.content;
        
        // Replace placeholders with customizations
        for (const [key, value] of Object.entries(customizations)) {
            const placeholder = `[${key}]`;
            content = content.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'g'), String(value));
        }

        // Ensure .taskmaster/docs directory exists
        const docsDir = path.join(projectPath, '.taskmaster', 'docs');
        try {
            await fsPromises.mkdir(docsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create docs directory:', error);
        }

        const filePath = path.join(docsDir, fileName);

        // Write the template content to the file
        try {
            await fsPromises.writeFile(filePath, content, 'utf8');

            res.json({
                projectId,
                projectPath,
                templateId,
                templateName: template.name,
                fileName,
                filePath: filePath,
                message: 'PRD template applied successfully',
                timestamp: new Date().toISOString()
            });

        } catch (writeError) {
            console.error('Failed to write PRD template:', writeError);
            return res.status(500).json({
                error: 'Failed to write PRD template',
                message: errorMessage(writeError)
            });
        }

    } catch (error) {
        console.error('Apply template error:', error);
        res.status(500).json({
            error: 'Failed to apply PRD template',
            message: errorMessage(error)
        });
    }
});

export default router;
