/**
 * Thông báo và xác nhận hiển thị NGAY TRONG giao diện, thay cho alert()/confirm() gốc của trình duyệt.
 * Các trình duyệt nhúng (kể cả trình duyệt trong app) tắt hộp thoại gốc: confirm() tự trả false và alert() không hiện,
 * nên nút gọi confirm() không bao giờ chạy được và lỗi không đến được người dùng.
 */

export type NoticeKind = 'error' | 'info' | 'success';

export interface Notice {
  id: number;
  message: string;
  kind: NoticeKind;
}

export interface ConfirmRequest {
  id: number;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export interface DialogState {
  notices: Notice[];
  confirm: ConfirmRequest | null;
}

const MAX_NOTICES = 4;
const MAX_MESSAGE = 240;
const DEFAULT_TTL_MS = 8_000;

let nextId = 1;
let state: DialogState = { notices: [], confirm: null };
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const confirmQueue: Array<{ request: ConfirmRequest; resolve: (value: boolean) => void }> = [];
let activeResolve: ((value: boolean) => void) | null = null;

function emit(next: DialogState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Làm sạch chuỗi hiển thị: ký tự điều khiển thành khoảng trắng RỒI gộp khoảng trắng, cắt độ dài. */
export function cleanMessage(value: unknown): string {
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '');
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
}

const FRIENDLY: Array<[RegExp, string]> = [
  [/PROXY_REQUIRED|NO_PROXY_AVAILABLE/, 'Quản trị viên chưa gán proxy cho tài khoản này.'],
  [/PROXY_UNAVAILABLE|PROXY_CONNECT_FAILED|PROXY_TIMEOUT|PROXY_PROTOCOL_ERROR/, 'Proxy tạm thời không khả dụng, hãy thử lại sau.'],
  [/PROXY_DISABLED/, 'Proxy đang tắt.'],
  [/PROXY_AUTH_FAILED/, 'Proxy từ chối xác thực; hãy kiểm tra cấu hình.'],
  [/ENTITLEMENT_EXPIRED/, 'Tài khoản đã hết hạn, liên hệ admin để gia hạn.'],
  [/ENTITLEMENT_NONE/, 'Tài khoản chưa được cấp hạn sử dụng. Liên hệ admin để được cấp hạn.'],
  [/USER_DISABLED/, 'Tài khoản người dùng đã bị khóa.'],
  [/QUOTA_BOTS/, 'Đã đủ số tài khoản theo hạn mức bot.'],
  [/BOT_LIMIT_REACHED/, 'Đã đạt số bot chạy đồng thời cho phép.'],
  [/SERVER_CAPACITY/, 'Máy chủ đang đủ runner, hãy thử lại sau.'],
  [/FORBIDDEN/, 'Bạn không có quyền thực hiện thao tác này.'],
  [/USER_NOT_FOUND/, 'Không tìm thấy người dùng.'],
  [/USERNAME_TAKEN/, 'Tên đăng nhập đã tồn tại.'],
  [/MAX_BOTS_INVALID/, 'maxBots phải là số nguyên trong khoảng 0..1000.'],
  [/LAST_ADMIN_FORBIDDEN/, 'Không thể khóa hoặc xóa admin cuối cùng.'],
  [/SELF_MODIFICATION_FORBIDDEN/, 'Không thể khóa hoặc xóa chính mình.'],
  [/ADMIN_NOT_EXPIRING/, 'Admin không dùng thời hạn sử dụng.'],
  [/RUNNER_NOT_STOPPED/, 'Không thể dừng hết bot của người dùng.'],
  [/AUDIT_LIMIT_INVALID/, 'Số dòng nhật ký phải trong khoảng 1..200.'],
  [/AUDIT_CURSOR_INVALID/, 'Con trỏ phân trang nhật ký không hợp lệ.'],
  [/TARGET_ON_PORTAL/, 'Điểm đã chọn nằm trên ô cổng. Hãy chọn điểm khác (muốn sang map khác thì dùng "Đi tới map").'],
  [/TARGET_UNREACHABLE/, 'Không có đường tới điểm đã chọn.'],
  [/TARGET_INVALID/, 'Điểm hoặc tham số đã chọn không hợp lệ.'],
  [/PATH_CROSSES_PORTAL/, 'Đường đi sẽ cắt qua một ô cổng và không tránh được. Hãy chọn điểm khác.'],
  [/ROUTE_UNAVAILABLE/, 'Không có tuyến đường qua các cổng tới map đó.'],
  [/AUTO_ACTIVE/, 'Đang bật Auto. Hãy tắt Auto trước khi thao tác bằng tay.'],
  [/OPERATION_IN_PROGRESS/, 'Đang có một thao tác khác chạy. Hãy chờ hoặc hủy nó.'],
  [/VENDOR_MAP_NOT_READY/, 'Map chưa sẵn sàng (đang vào game hoặc đang chuyển map). Thử lại sau vài giây.'],
  [/NOT_IN_GAME/, 'Bot chưa vào game. Hãy bấm "Chạy" trước.'],
  [/CHARACTER_DOWN/, 'Nhân vật đang gục.'],
];

/** Chuyển mã lỗi kỹ thuật thành câu tiếng Việt dễ hiểu; không nhận ra thì giữ nguyên (đã làm sạch). */
export function friendlyErrorMessage(value: unknown): string {
  const message = cleanMessage(value);
  for (const [pattern, text] of FRIENDLY) {
    if (pattern.test(message)) return text;
  }
  return message || 'Có lỗi không rõ.';
}

export function getDialogState(): DialogState {
  return state;
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function dismissNotice(id: number): void {
  const timer = timers.get(id);
  if (timer) { clearTimeout(timer); timers.delete(id); }
  if (!state.notices.some((notice) => notice.id === id)) return;
  emit({ ...state, notices: state.notices.filter((notice) => notice.id !== id) });
}

/** Hiện một thông báo (lỗi mặc định) tự tắt sau một lúc; cùng nội dung đang hiện thì không thêm lần nữa. */
export function notify(value: unknown, kind: NoticeKind = 'error', ttlMs: number = DEFAULT_TTL_MS): number {
  const message = kind === 'error' ? friendlyErrorMessage(value) : cleanMessage(value);
  if (!message) return 0;
  const existing = state.notices.find((notice) => notice.message === message && notice.kind === kind);
  if (existing) return existing.id;
  const id = nextId++;
  const notices = [...state.notices, { id, message, kind }];
  while (notices.length > MAX_NOTICES) {
    const dropped = notices.shift();
    if (dropped) { const t = timers.get(dropped.id); if (t) { clearTimeout(t); timers.delete(dropped.id); } }
  }
  emit({ ...state, notices });
  if (ttlMs > 0) timers.set(id, setTimeout(() => dismissNotice(id), ttlMs));
  return id;
}

function showNextConfirm(): void {
  if (activeResolve || confirmQueue.length === 0) return;
  const next = confirmQueue.shift()!;
  activeResolve = next.resolve;
  emit({ ...state, confirm: next.request });
}

/** Hỏi xác nhận ngay trong giao diện. Trả true khi người dùng đồng ý, false khi hủy. Nhiều yêu cầu xếp hàng lần lượt. */
export function confirmAction(
  message: string,
  options: { confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmQueue.push({
      resolve,
      request: {
        id: nextId++,
        message: cleanMessage(message),
        confirmLabel: cleanMessage(options.confirmLabel ?? 'Tiếp tục') || 'Tiếp tục',
        cancelLabel: cleanMessage(options.cancelLabel ?? 'Hủy') || 'Hủy',
        danger: options.danger === true,
      },
    });
    showNextConfirm();
  });
}

export function resolveConfirm(value: boolean): void {
  const resolve = activeResolve;
  activeResolve = null;
  emit({ ...state, confirm: null });
  resolve?.(value);
  showNextConfirm();
}

/** Chỉ dùng trong test: đưa kho về trạng thái ban đầu. */
export function resetDialogsForTest(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  confirmQueue.length = 0;
  activeResolve = null;
  state = { notices: [], confirm: null };
}
