"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllProjects = getAllProjects;
exports.getProject = getProject;
exports.createProject = createProject;
exports.updateProject = updateProject;
exports.deleteProject = deleteProject;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const PROJECTS_FILE = path_1.default.join(DATA_DIR, 'projects.json');
function ensureDataDir() {
    if (!fs_1.default.existsSync(DATA_DIR)) {
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs_1.default.existsSync(PROJECTS_FILE)) {
        fs_1.default.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2));
    }
}
function readProjects() {
    ensureDataDir();
    const data = fs_1.default.readFileSync(PROJECTS_FILE, 'utf-8');
    return JSON.parse(data);
}
function writeProjects(projects) {
    ensureDataDir();
    fs_1.default.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}
function getAllProjects() {
    return readProjects();
}
function getProject(id) {
    return readProjects().find(p => p.id === id);
}
function createProject(data) {
    const projects = readProjects();
    const now = new Date().toISOString();
    const project = {
        id: (0, uuid_1.v4)(),
        name: data.name,
        path: data.path,
        description: data.description,
        createdAt: now,
        updatedAt: now,
    };
    projects.push(project);
    writeProjects(projects);
    return project;
}
function updateProject(id, data) {
    const projects = readProjects();
    const index = projects.findIndex(p => p.id === id);
    if (index === -1)
        return null;
    projects[index] = {
        ...projects[index],
        ...data,
        updatedAt: new Date().toISOString(),
    };
    writeProjects(projects);
    return projects[index];
}
function deleteProject(id) {
    const projects = readProjects();
    const filtered = projects.filter(p => p.id !== id);
    if (filtered.length === projects.length)
        return false;
    writeProjects(filtered);
    return true;
}
//# sourceMappingURL=project.js.map