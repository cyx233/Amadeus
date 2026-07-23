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
import { detectTaskMasterMCPServer } from '../utils/mcp-detector.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';

// Every task-master invocation in this module goes through this wrapped spawn.
// It injects a NODE_OPTIONS preload that sets AI SDK 5's
// `globalThis.AI_SDK_LOG_WARNINGS=false` inside the spawned process, silencing
// the harmless "System messages in the prompt..." warning. The SDK only reads
// that global (not an env var), so it must be set in task-master's own runtime;
// NODE_OPTIONS carries the `--import data:` across the npx -> node hop with no
// preload file. Harmless for non-AI calls (which/--version) — they ignore it.
function spawn(command, args, options = {}) {
  const preload = '--import data:text/javascript,globalThis.AI_SDK_LOG_WARNINGS=false';
  const env = {
    ...(options.env ?? process.env),
    NODE_OPTIONS: [(options.env ?? process.env).NODE_OPTIONS, preload].filter(Boolean).join(' '),
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
async function resolveProjectPathFromId(projectId) {
  if (!projectId) {
    return null;
  }
  return projectsDb.getProjectPathById(projectId);
}

const router = express.Router();

/**
 * Check if TaskMaster CLI is installed globally
 * @returns {Promise<Object>} Installation status result
 */
async function checkTaskMasterInstallation() {
    return new Promise((resolve) => {
        // Check if task-master command is available
        const child = spawn('which', ['task-master'], { 
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true 
        });
        
        let output = '';
        let errorOutput = '';
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
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
                
                versionChild.stdout.on('data', (data) => {
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
                reason: `Error checking installation: ${error.message}`
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
        const mcpStatus = await detectTaskMasterMCPServer();
        
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
                reason: `Server error: ${error.message}`
            },
            mcpServer: {
                hasMCPServer: false,
                reason: `Server error: ${error.message}`
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

            let availableTags = [];
            let selectedTags = [];
            // Collected as {task, sourceTag} so we can stamp the source on merge.
            let sourceTasks = [];

            // Handle both tagged and legacy formats
            if (Array.isArray(tasksData)) {
                // Legacy format
                selectedTags = ['master'];
                sourceTasks = tasksData.map(task => ({ task, sourceTag: 'master' }));
            } else if (tasksData.tasks) {
                // Simple format with tasks array
                selectedTags = ['master'];
                sourceTasks = tasksData.tasks.map(task => ({ task, sourceTag: 'master' }));
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
                    const hasTasks = (tagName) => (tasksData[tagName]?.tasks?.length ?? 0) > 0;
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
                    (tasksData[tagName]?.tasks ?? []).map(task => ({ task, sourceTag: tagName }))
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

            // currentTag kept for single-select callers (first selected).
            const currentTag = selectedTags[0] || 'master';

            res.json({
                projectId,
                projectPath,
                tasks: transformedTasks,
                currentTag,
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
                message: parseError.message
            });
        }

    } catch (error) {
        console.error('TaskMaster tasks loading error:', error);
        res.status(500).json({
            error: 'Failed to load TaskMaster tasks',
            message: error.message
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
                prdFiles: prdFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified)),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Error reading docs directory:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD files',
                message: readError.message
            });
        }

    } catch (error) {
        console.error('PRD list error:', error);
        res.status(500).json({
            error: 'Failed to list PRD files',
            message: error.message
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
                message: error.message
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
                message: writeError.message
            });
        }

    } catch (error) {
        console.error('PRD create/update error:', error);
        res.status(500).json({
            error: 'Failed to create/update PRD file',
            message: error.message
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
                message: readError.message
            });
        }

    } catch (error) {
        console.error('PRD read error:', error);
        res.status(500).json({
            error: 'Failed to read PRD file',
            message: error.message
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
            if (unlinkError.code !== 'ENOENT') {
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
                if (tagError.code !== 'ENOENT') {
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
            message: error.message
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

        initProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        initProcess.stderr.on('data', (data) => {
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
        initProcess.stdin.write('yes\n');
        initProcess.stdin.end();

    } catch (error) {
        console.error('TaskMaster init error:', error);
        res.status(500).json({
            error: 'Failed to initialize TaskMaster',
            message: error.message
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

        // Build the task-master add-task command.
        // NOTE: use the `task-master` bin (the CLI). `task-master-ai` resolves to
        // the MCP server bin, so spawning it here never actually ran the command.
        const args = ['task-master', 'add-task'];
        
        if (prompt) {
            args.push('--prompt', prompt);
            // --research forces the Perplexity provider; only opt in when asked,
            // otherwise it fails for users configured with Bedrock/Anthropic/etc.
            if (research) {
                args.push('--research');
            }
        } else {
            args.push('--prompt', `Create a task titled "${title}" with description: ${description}`);
        }
        
        if (priority) {
            args.push('--priority', priority);
        }

        if (dependencies) {
            args.push('--dependencies', dependencies);
        }

        // Target a specific task set (per-PRD tag). Omitting it writes to the
        // default (master) tag, matching TaskMaster's own default.
        if (tag) {
            args.push('--tag', String(tag));
        }

        // Run task-master add-task command
        const addTaskProcess = spawn('npx', args, {
            cwd: projectPath,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        addTaskProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        addTaskProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        addTaskProcess.on('close', (code) => {
            console.log('Add task process completed with code:', code);
            console.log('Stdout:', stdout);
            console.log('Stderr:', stderr);
            
            if (code === 0) {
                // Broadcast task update via WebSocket using the projectId so
                // clients subscribed to this project get notified immediately.
                if (req.app.locals.wss) {
                    broadcastTaskMasterTasksUpdate(
                        req.app.locals.wss,
                        projectId
                    );
                }

                res.json({
                    projectId,
                    projectPath,
                    message: 'Task added successfully',
                    output: stdout,
                    timestamp: new Date().toISOString()
                });
            } else {
                console.error('Add task failed:', stderr);
                res.status(500).json({
                    error: 'Failed to add task',
                    message: stderr || stdout,
                    code
                });
            }
        });

        addTaskProcess.stdin.end();

    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({
            error: 'Failed to add task',
            message: error.message
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

        // Tasks live inside a tag (per-PRD set), so tag-aware sub-commands must
        // target the same tag or they'd touch the wrong set. add/remove-dependency
        // and update-task accept --tag; set-status and `tags use` do NOT, so pass
        // tagged=false for those (see the status branch).
        const tagArgs = tag && tag !== 'master' ? ['--tag', String(tag)] : [];

        // Promisified spawn so we can run several structured sub-commands (status,
        // deps, prompt) in sequence and fail fast on the first error.
        const run = (args, tagged = true) => new Promise((resolve, reject) => {
            const cmdArgs = tagged ? [...args, ...tagArgs] : args;
            const child = spawn('npx', ['task-master', ...cmdArgs], {
                cwd: projectPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) resolve(stdout);
                else reject(new Error(stderr || stdout || `command failed: task-master ${args[0]}`));
            });
        });

        // Status → `set-status`. The CLI's set-status (v0.43.1) has no --tag flag:
        // it acts on the tag marked active in state.json. The UI is single-select
        // (one PRD = one active tag at a time), so we make the active tag match the
        // task's tag via `tags use` before setting status — the board is already
        // showing exactly this tag, so this aligns the active tag with the view
        // rather than causing a hidden side effect. Neither command accepts --tag,
        // hence tagged=false.
        if (typeof status === 'string' && status) {
            if (tag) await run(['tags', 'use', String(tag)], false);
            await run(['set-status', `--id=${taskId}`, `--status=${status}`], false);
        }

        // Dependencies → diff the requested list against the current one and add/
        // remove individually via TaskMaster's structured dependency commands.
        if (Array.isArray(dependencies)) {
            const tasksFilePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
            let currentDeps = [];
            try {
                const data = JSON.parse(await fsPromises.readFile(tasksFilePath, 'utf8'));
                const tagKey = tag || 'master';
                const list = data[tagKey]?.tasks ?? data.tasks ?? [];
                const found = list.find((tk) => String(tk.id) === String(taskId));
                currentDeps = Array.isArray(found?.dependencies) ? found.dependencies.map(String) : [];
            } catch (readError) {
                console.error('Failed to read current dependencies:', readError);
            }
            const wanted = dependencies.map(String);
            const toAdd = wanted.filter((d) => !currentDeps.includes(d));
            const toRemove = currentDeps.filter((d) => !wanted.includes(d));
            for (const dep of toAdd) {
                await run(['add-dependency', `--id=${taskId}`, `--depends-on=${dep}`]);
            }
            for (const dep of toRemove) {
                await run(['remove-dependency', `--id=${taskId}`, `--depends-on=${dep}`]);
            }
        }

        // Title / description / details / priority are applied via one AI-prompt
        // update-task — TaskMaster's update-task has no structured flags for these
        // (only --prompt), so we describe the change and let it rewrite the task.
        const textUpdates = [];
        if (title) textUpdates.push(`title: "${title}"`);
        if (description) textUpdates.push(`description: "${description}"`);
        if (details) textUpdates.push(`details: "${details}"`);
        if (priority) textUpdates.push(`priority: "${priority}"`);
        if (textUpdates.length > 0) {
            const prompt = `Update task with the following changes: ${textUpdates.join(', ')}`;
            await run(['update-task', `--id=${taskId}`, `--prompt=${prompt}`]);
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
            message: error.message
        });
    }
});

/**
 * DELETE /api/taskmaster/task/:projectId/:taskId
 * Remove a task (or subtask, id like "5.2") from a tag via `remove-task`.
 */
router.delete('/task/:projectId/:taskId', async (req, res) => {
    try {
        const { projectId, taskId } = req.params;
        const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';

        const projectPath = await resolveProjectPathFromId(projectId);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found', message: `Project "${projectId}" does not exist` });
        }

        // remove-task accepts --tag; -y skips the confirmation prompt (otherwise it
        // blocks on stdin, which we've closed).
        const args = ['task-master', 'remove-task', `--id=${taskId}`, '-y'];
        if (tag && tag !== 'master') args.push('--tag', tag);

        const child = spawn('npx', args, { cwd: projectPath, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'Failed to remove task', message: stderr || stdout || `remove-task exited with code ${code}` });
            }
            if (req.app.locals.wss) {
                broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectId);
            }
            res.json({ projectId, taskId, message: 'Task removed successfully', timestamp: new Date().toISOString() });
        });
        child.on('error', (err) => {
            res.status(500).json({ error: 'Failed to remove task', message: err.message });
        });
    } catch (error) {
        console.error('Remove task error:', error);
        res.status(500).json({ error: 'Failed to remove task', message: error.message });
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

        parsePRDProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        parsePRDProcess.stderr.on('data', (data) => {
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

        parsePRDProcess.stdin.end();

    } catch (error) {
        console.error('Parse PRD error:', error);
        res.status(500).json({
            error: 'Failed to parse PRD',
            message: error.message
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

    const sendEvent = (type, data) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
    };

    let child = null;
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

        const streamLines = (buf) => {
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
        child.stdout.on('data', streamLines);
        child.stderr.on('data', streamLines);

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
            sendEvent('error', { message: err.message });
            res.end();
        });
    } catch (error) {
        console.error('Parse PRD (SSE) error:', error);
        sendEvent('error', { message: error instanceof Error ? error.message : 'Failed to parse PRD' });
        res.end();
    }
});

/**
 * GET /api/taskmaster/prd-templates
 * Get available PRD templates
 */
router.get('/prd-templates', async (req, res) => {
    try {
        // Return built-in templates
        const templates = [
            {
                id: 'web-app',
                name: 'Web Application',
                description: 'Template for web application projects with frontend and backend components',
                category: 'web',
                content: `# Product Requirements Document - Web Application

## Overview
**Product Name:** [Your App Name]
**Version:** 1.0
**Date:** ${new Date().toISOString().split('T')[0]}
**Author:** [Your Name]

## Executive Summary
Brief description of what this web application will do and why it's needed.

## Product Goals
- Goal 1: [Specific measurable goal]
- Goal 2: [Specific measurable goal]
- Goal 3: [Specific measurable goal]

## User Stories
### Core Features
1. **User Registration & Authentication**
   - As a user, I want to create an account so I can access personalized features
   - As a user, I want to log in securely so my data is protected
   - As a user, I want to reset my password if I forget it

2. **Main Application Features**
   - As a user, I want to [core feature 1] so I can [benefit]
   - As a user, I want to [core feature 2] so I can [benefit]
   - As a user, I want to [core feature 3] so I can [benefit]

3. **User Interface**
   - As a user, I want a responsive design so I can use the app on any device
   - As a user, I want intuitive navigation so I can easily find features

## Technical Requirements
### Frontend
- Framework: React/Vue/Angular or vanilla JavaScript
- Styling: CSS framework (Tailwind, Bootstrap, etc.)
- State Management: Redux/Vuex/Context API
- Build Tools: Webpack/Vite
- Testing: Jest/Vitest for unit tests

### Backend
- Runtime: Node.js/Python/Java
- Database: PostgreSQL/MySQL/MongoDB
- API: RESTful API or GraphQL
- Authentication: JWT tokens
- Testing: Integration and unit tests

### Infrastructure
- Hosting: Cloud provider (AWS, Azure, GCP)
- CI/CD: GitHub Actions/GitLab CI
- Monitoring: Application monitoring tools
- Security: HTTPS, input validation, rate limiting

## Success Metrics
- User engagement metrics
- Performance benchmarks (load time < 2s)
- Error rates < 1%
- User satisfaction scores

## Timeline
- Phase 1: Core functionality (4-6 weeks)
- Phase 2: Advanced features (2-4 weeks)  
- Phase 3: Polish and launch (2 weeks)

## Constraints & Assumptions
- Budget constraints
- Technical limitations
- Team size and expertise
- Timeline constraints`
            },
            {
                id: 'api',
                name: 'REST API',
                description: 'Template for REST API development projects',
                category: 'backend',
                content: `# Product Requirements Document - REST API

## Overview
**API Name:** [Your API Name]
**Version:** v1.0
**Date:** ${new Date().toISOString().split('T')[0]}
**Author:** [Your Name]

## Executive Summary
Description of the API's purpose, target users, and primary use cases.

## API Goals
- Goal 1: Provide secure data access
- Goal 2: Ensure scalable architecture
- Goal 3: Maintain high availability (99.9% uptime)

## Functional Requirements
### Core Endpoints
1. **Authentication Endpoints**
   - POST /api/auth/login - User authentication
   - POST /api/auth/logout - User logout
   - POST /api/auth/refresh - Token refresh
   - POST /api/auth/register - User registration

2. **Data Management Endpoints**
   - GET /api/resources - List resources with pagination
   - GET /api/resources/{id} - Get specific resource
   - POST /api/resources - Create new resource
   - PUT /api/resources/{id} - Update existing resource
   - DELETE /api/resources/{id} - Delete resource

3. **Administrative Endpoints**
   - GET /api/admin/users - Manage users (admin only)
   - GET /api/admin/analytics - System analytics
   - POST /api/admin/backup - Trigger system backup

## Technical Requirements
### API Design
- RESTful architecture following OpenAPI 3.0 specification
- JSON request/response format
- Consistent error response format
- API versioning strategy

### Authentication & Security
- JWT token-based authentication
- Role-based access control (RBAC)
- Rate limiting (100 requests/minute per user)
- Input validation and sanitization
- HTTPS enforcement

### Database
- Database type: [PostgreSQL/MongoDB/MySQL]
- Connection pooling
- Database migrations
- Backup and recovery procedures

### Performance Requirements
- Response time: < 200ms for 95% of requests
- Throughput: 1000+ requests/second
- Concurrent users: 10,000+
- Database query optimization

### Documentation
- Auto-generated API documentation (Swagger/OpenAPI)
- Code examples for common use cases
- SDK development for major languages
- Postman collection for testing

## Error Handling
- Standardized error codes and messages
- Proper HTTP status codes
- Detailed error logging
- Graceful degradation strategies

## Testing Strategy
- Unit tests (80%+ coverage)
- Integration tests for all endpoints
- Load testing and performance testing
- Security testing (OWASP compliance)

## Monitoring & Logging
- Application performance monitoring
- Error tracking and alerting
- Access logs and audit trails
- Health check endpoints

## Deployment
- Containerized deployment (Docker)
- CI/CD pipeline setup
- Environment management (dev, staging, prod)
- Blue-green deployment strategy

## Success Metrics
- API uptime > 99.9%
- Average response time < 200ms
- Zero critical security vulnerabilities
- Developer adoption metrics`
            },
            {
                id: 'mobile-app',
                name: 'Mobile Application',
                description: 'Template for mobile app development projects (iOS/Android)',
                category: 'mobile',
                content: `# Product Requirements Document - Mobile Application

## Overview
**App Name:** [Your App Name]
**Platform:** iOS / Android / Cross-platform
**Version:** 1.0
**Date:** ${new Date().toISOString().split('T')[0]}
**Author:** [Your Name]

## Executive Summary
Brief description of the mobile app's purpose, target audience, and key value proposition.

## Product Goals
- Goal 1: [Specific user engagement goal]
- Goal 2: [Specific functionality goal]
- Goal 3: [Specific performance goal]

## User Stories
### Core Features
1. **Onboarding & Authentication**
   - As a new user, I want a simple onboarding process
   - As a user, I want to sign up with email or social media
   - As a user, I want biometric authentication for security

2. **Main App Features**
   - As a user, I want [core feature 1] accessible from home screen
   - As a user, I want [core feature 2] to work offline
   - As a user, I want to sync data across devices

3. **User Experience**
   - As a user, I want intuitive navigation patterns
   - As a user, I want fast loading times
   - As a user, I want accessibility features

## Technical Requirements
### Mobile Development
- **Cross-platform:** React Native / Flutter / Xamarin
- **Native:** Swift (iOS) / Kotlin (Android)
- **State Management:** Redux / MobX / Provider
- **Navigation:** React Navigation / Flutter Navigation

### Backend Integration
- REST API or GraphQL integration
- Real-time features (WebSockets/Push notifications)
- Offline data synchronization
- Background processing

### Device Features
- Camera and photo library access
- GPS location services
- Push notifications
- Biometric authentication
- Device storage

### Performance Requirements
- App launch time < 3 seconds
- Screen transition animations < 300ms
- Memory usage optimization
- Battery usage optimization

## Platform-Specific Considerations
### iOS Requirements
- iOS 13.0+ minimum version
- App Store guidelines compliance
- iOS design guidelines (Human Interface Guidelines)
- TestFlight beta testing

### Android Requirements
- Android 8.0+ (API level 26) minimum
- Google Play Store guidelines
- Material Design guidelines
- Google Play Console testing

## User Interface Design
- Responsive design for different screen sizes
- Dark mode support
- Accessibility compliance (WCAG 2.1)
- Consistent design system

## Security & Privacy
- Secure data storage (Keychain/Keystore)
- API communication encryption
- Privacy policy compliance (GDPR/CCPA)
- App security best practices

## Testing Strategy
- Unit testing (80%+ coverage)
- UI/E2E testing (Detox/Appium)
- Device testing on multiple screen sizes
- Performance testing
- Security testing

## App Store Deployment
- App store optimization (ASO)
- App icons and screenshots
- Store listing content
- Release management strategy

## Analytics & Monitoring
- User analytics (Firebase/Analytics)
- Crash reporting (Crashlytics/Sentry)
- Performance monitoring
- User feedback collection

## Success Metrics
- App store ratings > 4.0
- User retention rates
- Daily/Monthly active users
- App performance metrics
- Conversion rates`
            },
            {
                id: 'data-analysis',
                name: 'Data Analysis Project',
                description: 'Template for data analysis and visualization projects',
                category: 'data',
                content: `# Product Requirements Document - Data Analysis Project

## Overview
**Project Name:** [Your Analysis Project]
**Analysis Type:** [Descriptive/Predictive/Prescriptive]
**Date:** ${new Date().toISOString().split('T')[0]}
**Author:** [Your Name]

## Executive Summary
Description of the business problem, data sources, and expected insights.

## Project Goals
- Goal 1: [Specific business question to answer]
- Goal 2: [Specific prediction to make]
- Goal 3: [Specific recommendation to provide]

## Business Requirements
### Key Questions
1. What patterns exist in the current data?
2. What factors influence [target variable]?
3. What predictions can be made for [future outcome]?
4. What recommendations can improve [business metric]?

### Success Criteria
- Actionable insights for stakeholders
- Statistical significance in findings
- Reproducible analysis pipeline
- Clear visualization and reporting

## Data Requirements
### Data Sources
1. **Primary Data**
   - Source: [Database/API/Files]
   - Format: [CSV/JSON/SQL]
   - Size: [Volume estimate]
   - Update frequency: [Real-time/Daily/Monthly]

2. **External Data**
   - Third-party APIs
   - Public datasets
   - Market research data

### Data Quality Requirements
- Data completeness (< 5% missing values)
- Data accuracy validation
- Data consistency checks
- Historical data availability

## Technical Requirements
### Data Pipeline
- Data extraction and ingestion
- Data cleaning and preprocessing
- Data transformation and feature engineering
- Data validation and quality checks

### Analysis Tools
- **Programming:** Python/R/SQL
- **Libraries:** pandas, numpy, scikit-learn, matplotlib
- **Visualization:** Tableau, PowerBI, or custom dashboards
- **Version Control:** Git for code and DVC for data

### Computing Resources
- Local development environment
- Cloud computing (AWS/GCP/Azure) if needed
- Database access and permissions
- Storage requirements

## Analysis Methodology
### Data Exploration
1. Descriptive statistics and data profiling
2. Data visualization and pattern identification
3. Correlation analysis
4. Outlier detection and handling

### Statistical Analysis
1. Hypothesis formulation
2. Statistical testing
3. Confidence intervals
4. Effect size calculations

### Machine Learning (if applicable)
1. Feature selection and engineering
2. Model selection and training
3. Cross-validation and evaluation
4. Model interpretation and explainability

## Deliverables
### Reports
- Executive summary for stakeholders
- Technical analysis report
- Data quality report
- Methodology documentation

### Visualizations
- Interactive dashboards
- Static charts and graphs
- Data story presentations
- Key findings infographics

### Code & Documentation
- Reproducible analysis scripts
- Data pipeline code
- Documentation and comments
- Testing and validation code

## Timeline
- Phase 1: Data collection and exploration (2 weeks)
- Phase 2: Analysis and modeling (3 weeks)
- Phase 3: Reporting and visualization (1 week)
- Phase 4: Stakeholder presentation (1 week)

## Risks & Assumptions
- Data availability and quality risks
- Technical complexity assumptions
- Resource and timeline constraints
- Stakeholder engagement assumptions

## Success Metrics
- Stakeholder satisfaction with insights
- Accuracy of predictions (if applicable)
- Business impact of recommendations
- Reproducibility of results`
            }
        ];

        res.json({
            templates,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('PRD templates error:', error);
        res.status(500).json({
            error: 'Failed to get PRD templates',
            message: error.message
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
        const templates = await getAvailableTemplates();
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
            content = content.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'g'), value);
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
                message: writeError.message
            });
        }

    } catch (error) {
        console.error('Apply template error:', error);
        res.status(500).json({
            error: 'Failed to apply PRD template',
            message: error.message
        });
    }
});

// Helper function to get available templates
async function getAvailableTemplates() {
    // This could be extended to read from files or database
    return [
        {
            id: 'web-app',
            name: 'Web Application',
            description: 'Template for web application projects',
            category: 'web',
            content: `# Product Requirements Document - Web Application

## Overview
**Product Name:** [Your App Name]
**Version:** 1.0
**Date:** ${new Date().toISOString().split('T')[0]}
**Author:** [Your Name]

## Executive Summary
Brief description of what this web application will do and why it's needed.

## User Stories
1. As a user, I want [feature] so I can [benefit]
2. As a user, I want [feature] so I can [benefit]
3. As a user, I want [feature] so I can [benefit]

## Technical Requirements
- Frontend framework
- Backend services
- Database requirements
- Security considerations

## Success Metrics
- User engagement metrics
- Performance benchmarks
- Business objectives`
        },
        // Add other templates here if needed
    ];
}

export default router;
