import { Router } from 'express';
import { getAllSessions, getSession, deleteSession } from '../services/session';

const router = Router();

// GET all sessions
router.get('/', (_req, res) => {
  try {
    const sessions = getAllSessions();
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET session by ID
router.get('/:id', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE session by ID
router.delete('/:id', (req, res) => {
  try {
    const success = deleteSession(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
