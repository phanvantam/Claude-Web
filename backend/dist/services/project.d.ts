import type { Project } from '../types';
/**
 * Lấy toàn bộ danh sách projects, sắp xếp theo thời gian tạo giảm dần.
 */
export declare function getAllProjects(): Project[];
/**
 * Lấy project theo ID.
 */
export declare function getProject(id: string): Project | undefined;
/**
 * Tạo project mới.
 */
export declare function createProject(data: {
    name: string;
    path: string;
    description?: string;
}): Project;
/**
 * Cập nhật project. Chỉ cập nhật các trường được truyền vào.
 */
export declare function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'description' | 'activeSessionId'>>): Project | null;
/**
 * Xoá project theo ID. Cascade sẽ tự xoá sessions + messages liên quan.
 */
export declare function deleteProject(id: string): boolean;
//# sourceMappingURL=project.d.ts.map