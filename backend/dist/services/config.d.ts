import type { GlobalConfig } from '../types';
/**
 * Đọc config từ CSDL, merge với default để đảm bảo luôn có đầy đủ giá trị.
 */
export declare function getConfig(): GlobalConfig;
/**
 * Cập nhật config — merge giá trị mới vào config hiện tại rồi ghi lại.
 */
export declare function updateConfig(config: Partial<GlobalConfig>): GlobalConfig;
//# sourceMappingURL=config.d.ts.map