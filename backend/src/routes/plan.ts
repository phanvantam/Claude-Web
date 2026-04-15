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
    const files = fs.readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(filename => {
        const fullPath = path.join(plansDir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          updatedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
          executionStatus: readPlanExecutionStatus(fullPath),
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
    // Validate tên file — tránh path traversal
    const safeName = path.basename(filename || 'IMPLEMENTATION_PLAN.md');
    const planPath = path.join(plansDir, safeName);

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
      filename: safeName,
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
    const safeName = path.basename(filename);
    const fullPath = path.join(plansDir, safeName);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File không tồn tại' });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const updatedContent = setExecutionStatusInContent(content, executionStatus);
    fs.writeFileSync(fullPath, updatedContent, 'utf-8');
    logger.info(`[Plan] Updated executionStatus to '${executionStatus}' for ${safeName}`);

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
