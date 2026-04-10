import { io, Socket } from 'socket.io-client';

/**
 * Singleton quản lý kết nối Socket.io.
 * Dùng reference counting để tránh disconnect sớm khi React StrictMode
 * double-mount hoặc nhiều hook cùng sử dụng.
 */
class SocketService {
  private socket: Socket | null = null;
  /** Số consumer đang giữ tham chiếu tới socket */
  private refCount = 0;

  /**
   * Đăng ký sử dụng socket — tạo kết nối nếu chưa có.
   * Mỗi lần gọi connect phải có một lần gọi release tương ứng.
   */
  connect(): Socket {
    this.refCount++;

    if (this.socket) return this.socket;

    this.socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected to backend');
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from backend');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    return this.socket;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Giảm refCount — chỉ thực sự disconnect khi không còn consumer nào.
   * Tránh phá hủy socket đang được hook khác sử dụng.
   */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0 && this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Force disconnect — dùng khi thực sự cần ngắt (ví dụ: unload trang).
   */
  disconnect(): void {
    this.refCount = 0;
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketService = new SocketService();
