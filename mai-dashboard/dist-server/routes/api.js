const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';
const PROJECT_MCP_URL = process.env.PROJECT_MCP_URL ?? 'http://mai-project-mcp:3456';
const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';
async function fetchJson(url) {
    try {
        const res = await fetch(url);
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
}
async function fetchAllProjects() {
    const projects = await fetchJson(`${REGISTRY_URL}/projects`);
    return projects ?? [];
}
async function fetchProjectTasks(projectId) {
    const tasks = await fetchJson(`${PROJECT_MCP_URL}/projects/${projectId}/tasks`);
    return tasks ?? [];
}
export const apiRoutes = async (app) => {
    app.get('/overview', async () => {
        const projects = await fetchAllProjects();
        const results = await Promise.all(projects.map(async (p) => {
            const tasks = await fetchProjectTasks(p.id);
            const open = tasks.filter(t => t.status === 'OPEN').length;
            const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;
            const blocked = tasks.filter(t => t.status === 'BLOCKED').length;
            const done = tasks.filter(t => t.status === 'DONE').length;
            const escalations = tasks.filter(t => t.status === 'BLOCKED' && ['DECISION', 'CLARIFICATION', 'RISK'].includes(t.blocker_type ?? '')).length;
            return { id: p.id, name: p.name, open, inProgress, blocked, done, escalations };
        }));
        return results;
    });
    app.get('/escalations', async () => {
        const projects = await fetchAllProjects();
        const allEscalations = [];
        for (const p of projects) {
            const tasks = await fetchProjectTasks(p.id);
            for (const t of tasks) {
                if (t.status !== 'BLOCKED')
                    continue;
                if (!['DECISION', 'CLARIFICATION', 'RISK'].includes(t.blocker_type ?? ''))
                    continue;
                let bp = {};
                try {
                    bp = JSON.parse(t.blocker_payload);
                }
                catch { /* ignore */ }
                allEscalations.push({
                    task_id: t.id,
                    task_title: t.title,
                    project_id: p.id,
                    project_name: p.name,
                    blocker_type: t.blocker_type,
                    question: bp.question,
                    options: bp.options,
                    description: bp.description,
                    severity: bp.severity,
                    created_at: t.created_at,
                    updated_at: t.updated_at,
                });
            }
        }
        allEscalations.sort((a, b) => {
            const ae = a;
            const be = b;
            const severityOrder = (s) => s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
            if (ae.blocker_type === 'RISK' && be.blocker_type !== 'RISK')
                return -1;
            if (ae.blocker_type !== 'RISK' && be.blocker_type === 'RISK')
                return 1;
            if (ae.blocker_type === 'RISK' && be.blocker_type === 'RISK') {
                const sd = severityOrder(ae.severity) - severityOrder(be.severity);
                if (sd !== 0)
                    return sd;
            }
            return new Date(ae.created_at).getTime() - new Date(be.created_at).getTime();
        });
        return allEscalations;
    });
    app.get('/agents', async () => {
        const profiles = await fetchJson(`${DISPATCHER_URL}/agents`) ?? [];
        const results = await Promise.all(profiles.map(async (p) => {
            const budget = await fetchJson(`${DISPATCHER_URL}/agents/${p.id}/budget`);
            return { ...p, ...(budget ?? { state: 'UNKNOWN', spent_usd: 0, pct: 0, active_tasks: 0 }) };
        }));
        return results;
    });
    app.get('/projects/:id/tasks', async (req, reply) => {
        const { id } = req.params;
        const tasks = await fetchProjectTasks(id);
        if (tasks.length === 0) {
            const check = await fetchJson(`${PROJECT_MCP_URL}/projects/${id}`);
            if (!check)
                return reply.status(404).send({ error: 'Not found' });
        }
        return tasks;
    });
    app.post('/tasks/:taskId/resolve/:type', async (req, reply) => {
        const { taskId, type } = req.params;
        try {
            const res = await fetch(`${PROJECT_MCP_URL}/tasks/${taskId}/resolve/${type}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            });
            const data = await res.json();
            return reply.status(res.status).send(data);
        }
        catch (err) {
            return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
        }
    });
    app.post('/projects/:projectId/bulk-close-blocked', async (req, reply) => {
        const { projectId } = req.params;
        try {
            const res = await fetch(`${PROJECT_MCP_URL}/projects/${projectId}/bulk-close-blocked`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body ?? {}),
            });
            const data = await res.json();
            return reply.status(res.status).send(data);
        }
        catch (err) {
            return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
        }
    });
    app.post('/agents/:agentId/resume', async (req, reply) => {
        const { agentId } = req.params;
        try {
            const res = await fetch(`${DISPATCHER_URL}/agents/${agentId}/resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            return reply.status(res.status).send(data);
        }
        catch (err) {
            return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
        }
    });
    app.post('/projects', async (req, reply) => {
        const body = req.body;
        if (!body.id?.trim() || !body.name?.trim() || !body.workspace_path?.trim()) {
            return reply.status(400).send({ error: 'id, name, and workspace_path are required' });
        }
        const payload = {
            id: body.id.trim(),
            name: body.name.trim(),
            workspace_path: body.workspace_path.trim(),
        };
        try {
            const registryRes = await fetch(`${REGISTRY_URL}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const registryData = await registryRes.json();
            if (!registryRes.ok)
                return reply.status(registryRes.status).send(registryData);
            const mcpRes = await fetch(`${PROJECT_MCP_URL}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: payload.id,
                    name: payload.name,
                    description: body.description?.trim() || undefined,
                }),
            });
            const mcpData = await mcpRes.json();
            if (!mcpRes.ok) {
                await fetch(`${REGISTRY_URL}/projects/${payload.id}`, { method: 'DELETE' });
                return reply.status(mcpRes.status).send(mcpData);
            }
            return reply.status(201).send(registryData);
        }
        catch (err) {
            return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
        }
    });
    app.post('/projects/:projectId/tasks', async (req, reply) => {
        const { projectId } = req.params;
        try {
            const res = await fetch(`${PROJECT_MCP_URL}/projects/${projectId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            });
            const data = await res.json();
            return reply.status(res.status).send(data);
        }
        catch (err) {
            return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
        }
    });
};
