import { Router } from 'express';
import * as projectService from '../services/project';
import { claudeService } from '../services/claude';

const router = Router();

// GET /api/projects
router.get('/', (_req, res) => {
  const projects = projectService.getAllProjects();
  const withSessions = projects.map(p => ({
    ...p,
    activeSessionId: claudeService.getActiveSessionForProject(p.id)
  }));
  res.json(withSessions);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const project = projectService.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const activeSessionId = claudeService.getActiveSessionForProject(project.id);
  res.json({ ...project, activeSessionId });
});

// POST /api/projects
router.post('/', (req, res) => {
  const { name, path, description } = req.body;
  if (!name || !path) {
    return res.status(400).json({ error: 'Name and path are required' });
  }
  const project = projectService.createProject({ name, path, description });
  res.status(201).json(project);
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const { name, path, description } = req.body;
  const project = projectService.updateProject(req.params.id, { name, path, description });
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(project);
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const success = projectService.deleteProject(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.status(204).send();
});

export default router;
