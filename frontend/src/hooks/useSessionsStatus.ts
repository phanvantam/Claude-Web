import { useState, useEffect, useCallback } from 'react';
import { socketService } from '../services/socket';
import { sessionsApi } from '../services/api';

/** Key prefix lưu mốc thời gian xem cuối cùng trong localStorage */
const VIEWED_PREFIX = 'sessionViewed:';

interface UseSessionsStatusReturn {
  /** Set các sessionId đang xử lý (isProcessing = true) */
  processingSessions: Set<string>;
  /** Kiểm tra session có đang xử lý không */
  isProcessing: (sessionId: string) => boolean;
  /** Kiểm tra session có tin nhắn mới chưa đọc không */
  isUnread: (sessionId: string, updatedAt: string) => boolean;
  /** Đánh dấu session đã đọc (cập nhật mốc xem vào localStorage) */
  markAsViewed: (sessionId: string) => void;
}

/**
 * Hook toàn cục theo dõi trạng thái processing của các session.
 * Kết hợp REST API (khởi tạo) + WebSocket (Realtime) để đảm bảo
 * trạng thái luôn chính xác kể cả khi F5 hoặc mở lại tab.
 */
export function useSessionsStatus(): UseSessionsStatusReturn {
  const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    // 1. Đồng bộ ban đầu qua REST — lấy danh sách session đang chạy
    sessionsApi.getActive()
      .then((data) => {
        if (data.processing.length > 0) {
          setProcessingSessions(new Set(data.processing));
        }
      })
      .catch((err) => {
        console.error('[useSessionsStatus] Lỗi khi tải trạng thái:', err);
      });

    // 2. Lắng nghe trạng thái Realtime qua WebSocket
    const socket = socketService.connect();

    const handleGlobalStatus = (data: { sessionId: string; status: string }) => {
      setProcessingSessions((prev) => {
        const next = new Set(prev);
        if (data.status === 'thinking' || data.status === 'tool_use') {
          next.add(data.sessionId);
        } else if (data.status === 'idle') {
          next.delete(data.sessionId);
        }
        return next;
      });
    };

    socket.on('global:session_status', handleGlobalStatus);

    return () => {
      socket.off('global:session_status', handleGlobalStatus);
      // Giảm refCount — socket chỉ thực sự disconnect khi hết consumer
      socketService.release();
    };
  }, []);

  const isProcessing = useCallback(
    (sessionId: string) => processingSessions.has(sessionId),
    [processingSessions],
  );

  /**
   * Kiểm tra session có chưa đọc không:
   * - Không đang xử lý (đã xong)
   * - updatedAt > mốc xem cuối cùng trong localStorage
   * - Buffer 2 giây để tránh tick xanh nháy
   */
  const isUnread = useCallback(
    (sessionId: string, updatedAt: string) => {
      // Nếu đang xử lý thì chưa phải "xong" → không tick
      if (processingSessions.has(sessionId)) return false;

      const viewedRaw = localStorage.getItem(`${VIEWED_PREFIX}${sessionId}`);
      if (!viewedRaw) {
        // Chưa bao giờ xem → chỉ coi là unread nếu có messages (updatedAt khác createdAt)
        return true;
      }

      const viewedTs = Number(viewedRaw);
      const updatedTs = new Date(updatedAt).getTime();

      // Buffer 2 giây — tránh tick xanh nháy khi vừa kết thúc
      return updatedTs > viewedTs + 2000;
    },
    [processingSessions],
  );

  const markAsViewed = useCallback((sessionId: string) => {
    localStorage.setItem(`${VIEWED_PREFIX}${sessionId}`, String(Date.now()));
  }, []);

  return {
    processingSessions,
    isProcessing,
    isUnread,
    markAsViewed,
  };
}
