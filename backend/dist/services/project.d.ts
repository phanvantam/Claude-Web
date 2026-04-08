import type { Project } from '../types';
export declare function getAllProjects(): Project[];
export declare function getProject(id: string): Project | undefined;
export declare function createProject(data: {
    name: string;
    path: string;
    description?: string;
}): Project;
export declare function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'description' | 'activeSessionId'>>): Project | null;
export declare function deleteProject(id: string): boolean;
//# sourceMappingURL=project.d.ts.map