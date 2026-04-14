import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getProject } from '../services/project';
import { logger } from '../services/logger';

const router = Router();

/**
 * Lấy đường dẫn thư mục plans của project.
 * Luôn là <projectPath>/.claude/plans/
 */
function getPlansDir(projectPath: string): string {
  return path.join(projectPath, '.claude', 'plans');
}

/**
 * Đảm bảo thư mục plans tồn tại — tạo recursive nếu chưa có.
 */
function ensurePlansDir(projectPath: string): string {
  const dir = getPlansDir(projectPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`[Plan] Tạo thư mục plans: ${dir}`);
  }
  return dir;
}

/**
 * GET /api/plan/list?projectId=xxx
 * Liệt kê tất cả file .md trong .claude/plans/.
 * Trả về danh sách { filename, updatedAt, sizeBytes }.
 */
router.get('/list', (req, res) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId là bắt buộc' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project không tồn tại' });
    }

    const plansDir = ensurePlansDir(project.path);
    const files = fs.readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(filename => {
        const fullPath = path.join(plansDir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          updatedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        };
      })
      // Sắp xếp mới nhất lên đầu
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return res.json({ plans: files, plansDir });
  } catch (err) {
    logger.error('[Plan] GET /list error:', err);
    return res.status(500).json({ error: 'Lỗi liệt kê file plan' });
  }
});

/**
 * GET /api/plan?projectId=xxx&filename=yyy.md
 * Đọc nội dung một file plan cụ thể từ .claude/plans/.
 * Nếu không truyền filename, tìm file đầu tiên theo thứ tự ưu tiên (backward compatible).
 */
router.get('/', (req, res) => {
  try {
    const projectId = req.query.projectId as string;
    const filename = req.query.filename as string;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId là bắt buộc' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project không tồn tại' });
    }

    const plansDir = ensurePlansDir(project.path);

    if (filename) {
      // Đọc file cụ thể — validate tên file để tránh path traversal
      const safeName = path.basename(filename);
      const fullPath = path.join(plansDir, safeName);

      if (!fs.existsSync(fullPath)) {
        return res.json({ found: false, filename: safeName });
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      return res.json({
        found: true,
        filename: safeName,
        filepath: fullPath,
        content,
      });
    }

    // Backward compatible: tìm file đầu tiên trong thư mục
    const files = fs.readdirSync(plansDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) {
      return res.json({ found: false });
    }

    const firstFile = files[0];
    const content = fs.readFileSync(path.join(plansDir, firstFile), 'utf-8');
    return res.json({
      found: true,
      filename: firstFile,
      filepath: path.join(plansDir, firstFile),
      content,
    });
  } catch (err) {
    logger.error('[Plan] GET error:', err);
    return res.status(500).json({ error: 'Lỗi đọc file plan' });
  }
});

/**
 * PUT /api/plan
 * Ghi nội dung file plan vào .claude/plans/.
 * Body: { projectId, content, filename? }
 * Nếu không truyền filename, dùng tên mặc định IMPLEMENTATION_PLAN.md.
 */
router.put('/', (req, res) => {
  try {
    const { projectId, content, filename } = req.body;
    if (!projectId || content === undefined) {
      return res.status(400).json({ error: 'projectId và content là bắt buộc' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project không tồn tại' });
    }

    const plansDir = ensurePlansDir(project.path);
    // Validate tên file — tránh path traversal
    const safeName = path.basename(filename || 'IMPLEMENTATION_PLAN.md');
    const planPath = path.join(plansDir, safeName);

    fs.writeFileSync(planPath, content, 'utf-8');
    logger.info(`[Plan] Saved plan to ${planPath}`);

    return res.json({
      success: true,
      filename: safeName,
      filepath: planPath,
    });
  } catch (err) {
    logger.error('[Plan] PUT error:', err);
    return res.status(500).json({ error: 'Lỗi ghi file plan' });
  }
});

/**
 * DELETE /api/plan?projectId=xxx&filename=yyy.md
 * Xóa file plan cụ thể.
 */
router.delete('/', (req, res) => {
  try {
    const projectId = req.query.projectId as string;
    const filename = req.query.filename as string;

    if (!projectId || !filename) {
      return res.status(400).json({ error: 'projectId và filename là bắt buộc' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project không tồn tại' });
    }

    const plansDir = getPlansDir(project.path);
    const safeName = path.basename(filename);
    const fullPath = path.join(plansDir, safeName);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File không tồn tại' });
    }

    fs.unlinkSync(fullPath);
    logger.info(`[Plan] Deleted plan: ${fullPath}`);

    return res.json({ success: true });
  } catch (err) {
    logger.error('[Plan] DELETE error:', err);
    return res.status(500).json({ error: 'Lỗi xóa file plan' });
  }
});

export default router;
