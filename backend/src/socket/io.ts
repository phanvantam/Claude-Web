import type { Server } from 'socket.io';

let _io: Server | null = null;

/**
 * Lưu Socket.IO instance sau khi khởi tạo trong index.ts.
 * Cho phép REST routes emit events mà không cần circular import.
 */
export function setIo(io: Server): void {
  _io = io;
}

/**
 * Lấy Socket.IO instance để emit events từ REST routes.
 * Trả null nếu chưa khởi tạo (dev hot-reload edge case).
 */
export function getIo(): Server | null {
  return _io;
}
