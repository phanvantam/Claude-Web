import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Project } from '../types';

const DATA_DIR = path.join(__dirname, '../../data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2));
  }
}

function readProjects(): Project[] {
  ensureDataDir();
  const data = fs.readFileSync(PROJECTS_FILE, 'utf-8');
  return JSON.parse(data);
}

function writeProjects(projects: Project[]) {
  ensureDataDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function getAllProjects(): Project[] {
  return readProjects();
}

export function getProject(id: string): Project | undefined {
  return readProjects().find(p => p.id === id);
}

export function createProject(data: { name: string; path: string; description?: string }): Project {
  const projects = readProjects();
  const now = new Date().toISOString();
  const project: Project = {
    id: uuidv4(),
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

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'description' | 'activeSessionId'>>): Project | null {
  const projects = readProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) return null;

  projects[index] = {
    ...projects[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  writeProjects(projects);
  return projects[index];
}

export function deleteProject(id: string): boolean {
  const projects = readProjects();
  const filtered = projects.filter(p => p.id !== id);
  if (filtered.length === projects.length) return false;
  writeProjects(filtered);
  return true;
}
