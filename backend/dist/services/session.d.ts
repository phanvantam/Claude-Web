import type { ChatSession } from '../types';
export declare function getAllSessions(): ChatSession[];
export declare function getSession(id: string): ChatSession | null;
export declare function saveSession(session: ChatSession): void;
export declare function deleteSession(id: string): boolean;
//# sourceMappingURL=session.d.ts.map