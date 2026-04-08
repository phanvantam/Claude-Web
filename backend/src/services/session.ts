import fs from 'fs';
import path from 'path';
import type { ChatSession } from '../types';

const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

function ensureDataDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export function getAllSessions(): ChatSession[] {
  ensureDataDir();
  const files = fs.readdirSync(SESSIONS_DIR);
  const sessions: ChatSession[] = [];
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      const session = JSON.parse(data) as ChatSession;
      sessions.push(session);
    } catch (e) {
      console.error(`Failed to read session file: ${file}`, e);
    }
  }
  
  // Sort by updatedAt descending
  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getSession(id: string): ChatSession | null {
  ensureDataDir();
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as ChatSession;
  } catch (e) {
    return null;
  }
}

export function saveSession(session: ChatSession): void {
  ensureDataDir();
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

export function deleteSession(id: string): boolean {
  ensureDataDir();
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    return false;
  }
}
