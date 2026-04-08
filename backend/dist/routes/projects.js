"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const projectService = __importStar(require("../services/project"));
const claude_1 = require("../services/claude");
const router = (0, express_1.Router)();
// GET /api/projects
router.get('/', (_req, res) => {
    const projects = projectService.getAllProjects();
    const withSessions = projects.map(p => ({
        ...p,
        activeSessionId: claude_1.claudeService.getActiveSessionForProject(p.id)
    }));
    res.json(withSessions);
});
// GET /api/projects/:id
router.get('/:id', (req, res) => {
    const project = projectService.getProject(req.params.id);
    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }
    const activeSessionId = claude_1.claudeService.getActiveSessionForProject(project.id);
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
exports.default = router;
//# sourceMappingURL=projects.js.map