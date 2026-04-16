import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getProject } from '../services/project';
import { logger } from '../services/logger';

const router = Router();

// ============================================================================
// Helpers — plan frontmatter
// ============================================================================

type ExecutionStatus = 'not_executed' | 'in_progress' | 'completed';

/**
 * Đọc executionStatus từ frontmatter của một plan file.
 * Mặc định là 'not_executed' nếu file chưa có frontmatter.
 */
function readPlanExecutionStatus(filePath: string): ExecutionStatus {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return 'not_executed';
    const lines = match[1].split('\n');
    for (const line of lines) {
      const kv = line.match(/^executionStatus:\s*(.*)$/);
      if (kv) {
        const val = kv[1].trim();
        if (val === 'in_progress' || val === 'completed') return val;
        return 'not_executed';
      }
    }
    return 'not_executed';
  } catch {
    return 'not_executed';
  }
}

/**
 * Đọc toàn bộ frontmatter từ content string, trả về raw YAML.
 * Trả về '' nếu không có frontmatter.
 */
function getFrontmatterRaw(content: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

/**
 * Cập nhật hoặc thêm executionStatus vào frontmatter của content string.
 */
function setExecutionStatusInContent(
  content: string,
  status: ExecutionStatus,
): string {
  const frontmatterMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
  if (!frontmatterMatch) {
    // Chưa có frontmatter — chèn vào đầu file
    return `---\nexecutionStatus: ${status}\n---\n\n${content}`;
  }
  const [, open, body, close] = frontmatterMatch;
  // Thay thế hoặc thêm executionStatus
  const lines = body.split('\n');
  let found = false;
  const newLines = lines.map(line => {
    if (line.startsWith('executionStatus:')) {
      found = true;
      return `executionStatus: ${status}`;
    }
    return line;
  });
  if (!found) {
    newLines.push(`executionStatus: ${status}`);
  }
  // Rebuild frontmatter + phần còn lại (sau ---)
  const afterFrontmatter = content.slice(frontmatterMatch[0].length);
  return `${open}${newLines.join('\n')}${close}${afterFrontmatter}`;
}

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

    /** Quét đệ quy tất cả file .md trong plansDir (bao gồm subdirectories) */
    function getAllPlanFiles(dir: string, rel: string = ''): Array<{
      filename: string;
      updatedAt: string;
      sizeBytes: number;
      executionStatus: ExecutionStatus;
    }> {
      const files: Array<{
        filename: string;
        updatedAt: string;
        sizeBytes: number;
        executionStatus: ExecutionStatus;
      }> = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          files.push(...getAllPlanFiles(fullPath, relativePath));
        } else if (entry.name.endsWith('.md')) {
          const stat = fs.statSync(fullPath);
          files.push({
            filename: relativePath.replace(/\\/g, '/'),
            updatedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
            executionStatus: readPlanExecutionStatus(fullPath),
          });
        }
      }
      return files;
    }

    const files = getAllPlanFiles(plansDir)
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
      // Hỗ trợ subfolder path: filename có thể là "sub/plan.md"
      // Validate: chỉ chấp nhận relative path nằm trong plansDir, chặn traversal
      const normalized = filename.replace(/\\/g, '/').replace(/\.\./g, '');
      const safeRelative = path.join('.', normalized).replace(/\\/g, '/').replace(/^\.\//, '');
      const fullPath = path.join(plansDir, safeRelative);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(path.resolve(plansDir))) {
        return res.status(400).json({ error: 'Path không hợp lệ' });
      }
      if (!fs.existsSync(fullPath)) {
        return res.json({ found: false, filename: normalized });
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      return res.json({
        found: true,
        filename: normalized,
        filepath: fullPath,
        content,
      });
    }

    // Backward compatible: tìm file đầu tiên (mới nhất theo mtime)
    function findNewestMd(dir: string): string | null {
      function walk(currentDir: string): { path: string; mtimeMs: number } | null {
        let newest: { path: string; mtimeMs: number } | null = null;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const full = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            const subNewest = walk(full);
            if (subNewest && (!newest || subNewest.mtimeMs > newest.mtimeMs)) {
              newest = subNewest;
            }
          } else if (entry.name.endsWith('.md')) {
            const stat = fs.statSync(full);
            if (!newest || stat.mtimeMs > newest.mtimeMs) {
              newest = { path: full, mtimeMs: stat.mtimeMs };
            }
          }
        }

        return newest;
      }

      const newest = walk(dir);
      return newest ? newest.path : null;
    }

    const firstFile = findNewestMd(plansDir);
    if (!firstFile) {
      return res.json({ found: false });
    }
    const content = fs.readFileSync(firstFile, 'utf-8');
    const relativeName = path.relative(plansDir, firstFile).replace(/\\/g, '/');
    return res.json({
      found: true,
      filename: relativeName,
      filepath: firstFile,
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
 * Preserve executionStatus trong frontmatter nếu file đã tồn tại.
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
    // Hỗ trợ subfolder path: filename có thể là "sub/plan.md"
    const normalized = (filename || 'IMPLEMENTATION_PLAN.md').replace(/\\/g, '/').replace(/\.\./g, '');
    const safeRelative = path.join('.', normalized).replace(/\\/g, '/').replace(/^\.\//, '');
    const planPath = path.join(plansDir, safeRelative);
    const resolved = path.resolve(planPath);
    if (!resolved.startsWith(path.resolve(plansDir))) {
      return res.status(400).json({ error: 'Path không hợp lệ' });
    }
    const parentDir = path.dirname(planPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Nếu file đã tồn tại, preserve executionStatus hiện tại
    let finalContent = content;
    if (fs.existsSync(planPath)) {
      const existingStatus = readPlanExecutionStatus(planPath);
      finalContent = setExecutionStatusInContent(content, existingStatus);
    } else {
      // File mới — đảm bảo có frontmatter với status mặc định
      finalContent = setExecutionStatusInContent(content, 'not_executed');
    }

    fs.writeFileSync(planPath, finalContent, 'utf-8');
    logger.info(`[Plan] Saved plan to ${planPath}`);

    return res.json({
      success: true,
      filename: safeRelative,
      filepath: planPath,
    });
  } catch (err) {
    logger.error('[Plan] PUT error:', err);
    return res.status(500).json({ error: 'Lỗi ghi file plan' });
  }
});

/**
 * PATCH /api/plan/status
 * Cập nhật executionStatus của một plan qua frontmatter.
 * Body: { projectId, filename, executionStatus }
 */
router.patch('/status', (req, res) => {
  try {
    const { projectId, filename, executionStatus } = req.body as {
      projectId: string;
      filename: string;
      executionStatus: ExecutionStatus;
    };

    if (!projectId || !filename || !executionStatus) {
      return res.status(400).json({ error: 'projectId, filename và executionStatus là bắt buộc' });
    }

    const validStatuses: ExecutionStatus[] = ['not_executed', 'in_progress', 'completed'];
    if (!validStatuses.includes(executionStatus)) {
      return res.status(400).json({ error: 'executionStatus không hợp lệ' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project không tồn tại' });
    }

    const plansDir = getPlansDir(project.path);
    const normalized = filename.replace(/\\/g, '/').replace(/\.\./g, '');
    const safeRelative = path.join('.', normalized).replace(/\\/g, '/').replace(/^\.\//, '');
    const fullPath = path.join(plansDir, safeRelative);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(plansDir))) {
      return res.status(400).json({ error: 'Path không hợp lệ' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File không tồn tại' });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const updatedContent = setExecutionStatusInContent(content, executionStatus);
    fs.writeFileSync(fullPath, updatedContent, 'utf-8');
    logger.info(`[Plan] Updated executionStatus to '${executionStatus}' for ${safeRelative}`);

    return res.json({ success: true, executionStatus });
  } catch (err) {
    logger.error('[Plan] PATCH /status error:', err);
    return res.status(500).json({ error: 'Lỗi cập nhật trạng thái plan' });
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
    const normalized = filename.replace(/\\/g, '/').replace(/\.\./g, '');
    const safeRelative = path.join('.', normalized).replace(/\\/g, '/').replace(/^\.\//, '');
    const fullPath = path.join(plansDir, safeRelative);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(plansDir))) {
      return res.status(400).json({ error: 'Path không hợp lệ' });
    }

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
