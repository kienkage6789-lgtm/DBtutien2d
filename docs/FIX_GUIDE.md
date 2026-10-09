# Bộ hướng dẫn fix lỗi TuTien2D

Ngày: 2026-10-07. Mọi số dòng dưới đây tính theo source tại thời điểm viết; hãy tìm theo tên hàm nếu số dòng đã lệch.

## 0. Tổng quan và thứ tự thực hiện

| Giai đoạn | Nội dung | Lỗi | Rủi ro |
|---|---|---|---|
| 1 | Frontend: freshness, merge theo timestamp, retry geometry | 1, 2, 4, 5 | Thấp (chỉ `apps/web`, cộng 2 dòng backend tùy chọn) |
| 2 | Bảo mật mức chặn | Mục E | Trung bình (đổi cách chạy và cách đăng nhập dashboard) |
| 3 | Chẩn đoán packet rồi sửa HP/MP | 3, 9, 11 | Trung bình (đụng `core-client`) |
| 4 | Ledger cho move/attack | 8 | Trung bình |
| 5 | Ghi chú giới hạn protocol | 6, 7, 10 | Không sửa code |

### Dữ liệu live đã xác minh khi viết tài liệu (đọc từ `GET /api/accounts`)

```
worldSync.received = accepted = 22553, resyncs = 0, fullRejected = 0
worldSync.fullReceived = 1, lastFullShape = { players: 14, monsters: 0, playerIdType: "string" }
player keys: id, x, y, dir, state, hp, dn, fly, fs
mapContext = { mapId: "tan_vien", khu: 1, observedAt: <ms>, fresh: true }, mapContextAgeMs = 38, mapContextIsCurrent = true
vitals = { hp: null, ..., status: "unknown", source: null }
```

Kết luận rút ra từ số liệu này:

- Pipeline snap2 khỏe: nhận 22553 gói và chấp nhận 22553 gói, không resync. Vì vậy `monsters = 0` **không** do parser reject. Rất có thể `tan_vien` (làng tân thủ) đúng là không có quái. Phải kiểm tra ở map có quái trước khi kết luận (mục C).
- Mục `p` của người chơi có `hp` nhưng không có `maxHp`. Giá trị `100` rất có thể là **phần trăm**, không phải HP tuyệt đối. Không được ghi giá trị này vào `vitals.hp` (mục B).
- `mapContextIsCurrent: true` và `mapContextAgeMs: 38` đến từ backend, trong khi UI báo stale. Nguyên nhân nằm ở frontend (mục A).

Lưu ý bảo mật: `test_ws.mjs` và `test_ping.mjs` hiện đọc token từ `TUTIEN_TEST_TOKEN`, và grep toàn repo không còn chuỗi JWT `eyJ…`. Phần review cũ về JWT tĩnh đã được xử lý trong code. Nhưng token cũ từng nằm trong file thì vẫn phải coi là đã lộ và rotate (mục E.7).

---

## A. Frontend: freshness, click MiniMap, merge theo timestamp (lỗi 1, 2, 4, 5)

### A.0 Nguyên nhân gốc

Trong `MiniMap.tsx`, `clock` chỉ tăng mỗi 1 giây (`setInterval(..., 1000)`), còn tuổi context được tính bằng `clock - mapContext.observedAt`. Khi một frame mới về giữa hai lần tick, `observedAt` lớn hơn `clock` nên tuổi ra **số âm**. Code coi số âm là "timestamp không hợp lệ", đặt `mapContextStale = true`, và `contextValid = false`. Hệ quả:

1. Status báo `Map context stale · tuổi timestamp không hợp lệ`.
2. SVG không gắn `onClick` (`enabled=false`), nên click bị chặn ở UI. Vì vậy không có request nào đi ra và `moveTo` giữ nguyên `null`. Đây là câu trả lời cho câu hỏi "UI chặn hay request lỗi": UI chặn.
3. Backend lại tự clamp bằng `Math.max(0, …)` ở `mapContextRuntime`, nên backend không bao giờ ra số âm.

Ba lỗi nhỏ khác cùng khu vực:

- `App.tsx` `handleMoveTo` có `if (!context ...) return;` rồi im lặng, người dùng không thấy lý do.
- `App.tsx` effect tải geometry: map nào tải lỗi (ví dụ `long_uyen` chưa có walk-grid) bị xóa khỏi `geometryRequestsRef` ở `finally`, nên **mỗi frame realtime (tới 5 Hz) lại gọi API lần nữa** cho map đó.
- Type web khai `MapDataContext.observedAt: number` và `mapId: string`, trong khi backend gửi `null` khi chưa có context.

### A.1 Cập nhật type: `apps/web/src/types/index.ts`

Thay `MapDataContext` và `MapEntityContext`:

```ts
export interface MapDataContext {
  mapId: string | null;
  khu: number | null;
  soKhu: number | null;
  observedAt: number | null;
  fresh: boolean;
}

export interface MapEntityContext {
  mapId: string | null;
  khu: number | null;
  observedAt: number | null;
  fresh: boolean;
}
```

Trong `AccountRuntime`, thêm cạnh `mapContext`:

```ts
  /** Tuổi context do backend tính tại thời điểm gửi frame (đã clamp >= 0). */
  mapContextAgeMs?: number | null;
  /** Backend xác nhận context khớp client state hiện tại và chưa quá TTL. */
  mapContextIsCurrent?: boolean;
  /** Epoch của context ở backend (tùy chọn, xem A.7). */
  mapContextEpoch?: number | null;
  /** Chỉ dùng ở client: Date.now() lúc nhận frame mang mapContext. */
  mapContextReceivedAt?: number;
```

Sau khi sửa, chạy `pnpm --filter @tutien2d/web build`. `tsc` sẽ báo các chỗ đang giả định `mapId: string`; sửa bằng null-check hoặc dùng `resolveMapContext` ở A.3.

### A.2 File mới: `apps/web/src/lib/context.ts`

Toàn bộ logic thuần (không React) để test được.

```ts
import type { AccountRuntime, MapDataContext, MapEntityContext } from '../types';

/** Phải bằng MAP_CONTEXT_TTL_MS ở apps/server/src/orchestrator/worker-pool.ts (hiện 15_000). */
export const MAP_CONTEXT_TTL_MS = 15_000;
export const ENTITY_CONTEXT_TTL_MS = 5_000;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readMapId = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' && value.trim() ? value : undefined;
const readKhu = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
const readObservedAt = (value: unknown): number | null | undefined =>
  value === null ? null : isFiniteNumber(value) && value >= 0 ? value : undefined;

/** Trả về undefined nếu payload sai schema (khi đó caller giữ nguyên giá trị cũ). */
export function sanitizeMapContext(value: unknown): MapDataContext | undefined {
  if (!isRecord(value)) return undefined;
  const mapId = readMapId(value.mapId);
  const khu = readKhu(value.khu);
  const observedAt = readObservedAt(value.observedAt);
  if (mapId === undefined || khu === undefined || observedAt === undefined || typeof value.fresh !== 'boolean') return undefined;
  const soKhu = value.soKhu === null || value.soKhu === undefined ? null
    : isFiniteNumber(value.soKhu) && value.soKhu > 0 ? value.soKhu : undefined;
  if (soKhu === undefined) return undefined;
  return { mapId, khu, soKhu, observedAt, fresh: value.fresh };
}

export function sanitizeEntityContext(value: unknown): MapEntityContext | undefined {
  if (!isRecord(value)) return undefined;
  const mapId = readMapId(value.mapId);
  const khu = readKhu(value.khu);
  const observedAt = readObservedAt(value.observedAt);
  if (mapId === undefined || khu === undefined || observedAt === undefined || typeof value.fresh !== 'boolean') return undefined;
  return { mapId, khu, observedAt, fresh: value.fresh };
}

interface ContextLike { mapId: string | null; khu: number | null; observedAt: number | null }

/**
 * Quy tắc monotonic: chỉ nhận context mới hơn hoặc bằng context đang giữ.
 * - Khác mapId/khu: nhận (server là nguồn sự thật khi đổi map, kể cả reset về null).
 * - Cùng mapId/khu: observedAt không được lùi.
 */
export function isContextNewer(previous: ContextLike | null | undefined, next: ContextLike): boolean {
  if (!previous) return true;
  if (previous.mapId !== next.mapId || previous.khu !== next.khu) return true;
  if (next.observedAt === null) return true;
  if (previous.observedAt === null) return true;
  return next.observedAt >= previous.observedAt;
}

/** Epoch nhỏ hơn epoch đang giữ nghĩa là frame cũ từ trước lần đổi map gần nhất. */
export function isOlderEpoch(previous: unknown, next: unknown): boolean {
  return isFiniteNumber(previous) && isFiniteNumber(next) && next < previous;
}

export type MapContextView =
  | { usable: true; mapId: string; khu: number; ageMs: number }
  | { usable: false; reason: 'missing' | 'not_current' | 'expired' | 'mismatch'; ageMs: number | null };

/**
 * Nguồn sự thật DUY NHẤT cho "map context có dùng được để di chuyển/hiển thị không".
 * Tuổi = tuổi backend tính khi gửi + thời gian đã trôi từ lúc dashboard nhận frame.
 * Cách này không phụ thuộc đồng hồ máy chủ và không bao giờ ra số âm.
 */
export function resolveMapContext(
  account: Pick<AccountRuntime, 'mapContext' | 'mapContextAgeMs' | 'mapContextIsCurrent' | 'mapContextReceivedAt' | 'mapId' | 'khu'>,
  now: number = Date.now(),
): MapContextView {
  const ctx = account.mapContext;
  if (!ctx || ctx.mapId === null || ctx.khu === null) return { usable: false, reason: 'missing', ageMs: null };

  let ageMs: number | null = null;
  if (isFiniteNumber(account.mapContextAgeMs) && account.mapContextAgeMs >= 0 && isFiniteNumber(account.mapContextReceivedAt)) {
    ageMs = account.mapContextAgeMs + Math.max(0, now - account.mapContextReceivedAt);
  } else if (isFiniteNumber(ctx.observedAt)) {
    ageMs = Math.max(0, now - ctx.observedAt); // fallback cho backend cũ chưa có mapContextAgeMs
  }
  if (ageMs === null) return { usable: false, reason: 'missing', ageMs: null };

  const current = account.mapContextIsCurrent ?? ctx.fresh;
  if (!current) return { usable: false, reason: 'not_current', ageMs };
  if (ageMs > MAP_CONTEXT_TTL_MS) return { usable: false, reason: 'expired', ageMs };
  if (account.mapId && (account.mapId !== ctx.mapId || account.khu !== ctx.khu)) {
    return { usable: false, reason: 'mismatch', ageMs };
  }
  return { usable: true, mapId: ctx.mapId, khu: ctx.khu, ageMs };
}

/** Context entity (người/quái) hợp lệ khi cùng map/khu với map context và đủ mới. */
export function isEntityContextValid(
  ctx: MapEntityContext | null | undefined,
  view: MapContextView,
  ttlMs: number | null,
  now: number = Date.now(),
): boolean {
  if (!view.usable || !ctx || !ctx.fresh) return false;
  if (ctx.mapId !== view.mapId || ctx.khu !== view.khu) return false;
  if (ttlMs !== null) {
    if (ctx.observedAt === null) return false;
    if (Math.max(0, now - ctx.observedAt) > ttlMs) return false;
  }
  return true;
}

export const describeContextBlock = (view: MapContextView, ttlMs: number = MAP_CONTEXT_TTL_MS): string | null => {
  if (view.usable) return null;
  const age = view.ageMs === null ? '—' : `${Math.floor(view.ageMs / 1000)}s`;
  switch (view.reason) {
    case 'missing': return 'Chưa có map context từ backend';
    case 'not_current': return `Backend báo context không còn khớp client (tuổi ${age}); chờ snapshot mới`;
    case 'expired': return `Map context quá hạn: ${age} > TTL ${ttlMs / 1000}s; chờ snapshot mới`;
    case 'mismatch': return 'Vị trí và map context đang khác map/khu; chờ đồng bộ';
  }
};
```

### A.3 Sửa `apps/web/src/components/MiniMap.tsx`

Xóa `const MAP_CONTEXT_TTL_MS = 15_000;` và hàm tính tuổi cục bộ. Thay import và toàn bộ khối từ dòng `const mapContext = ...` đến hết biến `status`:

```tsx
import { ENTITY_CONTEXT_TTL_MS, describeContextBlock, isEntityContextValid, resolveMapContext } from '../lib/context';
```

```tsx
  const view = resolveMapContext(account, clock);
  const contextValid = view.usable;
  const monstersValid = isEntityContextValid(account.monstersContext, view, ENTITY_CONTEXT_TTL_MS, clock);
  const playersValid = isEntityContextValid(account.playersContext, view, null, clock);
  const monstersAge = account.monstersContext?.observedAt != null
    ? Math.max(0, clock - account.monstersContext.observedAt) : null;
  const activeMove = account.moveTo && ['accepted', 'running'].includes(account.moveTo.status) ? account.moveTo : null;
  const activeNavigation = account.navigation && ['planning', 'moving_to_portal', 'waiting_map_confirmation'].includes(account.navigation.phase);
  const movementLocked = !!activeMove || !!activeNavigation;
  const enabled = contextValid && isValidWorldBounds(geometry) && typeof onMoveTo === 'function' && !movementLocked;
  const contextBlock = describeContextBlock(view);
  const status = contextBlock
    ? contextBlock
    : movementLocked ? activeMove ? 'Đang có lệnh di chuyển; hủy lệnh để chọn tọa độ khác' : 'Đang điều hướng qua cổng; chờ hoàn tất trước khi chọn tọa độ'
    : !isValidWorldBounds(geometry) ? 'Thiếu geometry map; thao tác bị khóa'
      : !onMoveTo ? 'Chưa kết nối API di chuyển; thao tác bị khóa' : 'Bấm bản đồ để chọn tọa độ di chuyển';
```

Các biến `mapContext` còn dùng ở chỗ khác trong file:

- Dòng `portals` dùng `mapContext?.mapId`. Đổi thành `view.usable ? view.mapId : account.mapContext?.mapId`.
- Dòng tam giác vị trí nhân vật dùng `contextValid`, giữ nguyên.
- Dòng cuối dùng `account.monstersContext` và `monstersAge`, giữ nguyên vì `monstersAge` đã được định nghĩa lại ở trên.

Lý do giữ `clock` tick 1 giây: nó chỉ để UI đếm tuổi tăng dần. Vì `resolveMapContext` clamp bằng `Math.max(0, …)` và cộng thời gian trôi từ `mapContextReceivedAt`, độ trễ của tick không còn gây số âm.

### A.4 Sửa `apps/web/src/App.tsx`

Thêm import:

```tsx
import { resolveMapContext, describeContextBlock } from './lib/context';
```

**Effect tải geometry**: thay toàn bộ `useEffect` dòng 61–73 (có backoff cho map tải lỗi):

```tsx
  const geometryFailedAtRef = useRef(new Map<string, number>());
  const GEOMETRY_RETRY_MS = 30_000;

  useEffect(() => {
    const now = Date.now();
    const mapIds = new Set<string>();
    for (const account of accounts) {
      const view = resolveMapContext(account, now);
      const mapId = view.usable ? view.mapId : account.mapId;
      if (typeof mapId === 'string' && mapId.trim().length > 0) mapIds.add(mapId);
    }
    for (const mapId of mapIds) {
      if (mapGeometryById[mapId] || geometryRequestsRef.current.has(mapId)) continue;
      const failedAt = geometryFailedAtRef.current.get(mapId);
      if (failedAt !== undefined && now - failedAt < GEOMETRY_RETRY_MS) continue;
      geometryRequestsRef.current.add(mapId);
      fetchMapGeometry(mapId)
        .then((geometry) => {
          geometryFailedAtRef.current.delete(mapId);
          setMapGeometryById((previous) => ({ ...previous, [mapId]: geometry }));
        })
        .catch(() => { geometryFailedAtRef.current.set(mapId, Date.now()); /* map chưa hỗ trợ: vẫn hiển thị nhưng không click được */ })
        .finally(() => geometryRequestsRef.current.delete(mapId));
    }
  }, [accounts, mapGeometryById]);
```

**`handleMoveTo`**: không còn im lặng; ném lỗi để MiniMap hiện trong `role="alert"`:

```tsx
  const handleMoveTo = async (account: AccountRuntime, target: { x: number; y: number }) => {
    const view = resolveMapContext(account);
    if (!view.usable) throw new Error(describeContextBlock(view) ?? 'Map context không hợp lệ.');
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('Tọa độ đích không hợp lệ.');
    await requestMoveTo(account.id, {
      requestId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `move-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mapId: view.mapId,
      khu: view.khu,
      x: target.x,
      y: target.y,
      arrivalRadius: 20,
    });
  };
```

Backend vẫn kiểm tra lại context bằng `isMapContextFresh` khi nhận request, nên frontend chỉ là lớp chặn sớm chứ không phải lớp bảo vệ duy nhất.

### A.5 Sửa `apps/web/src/hooks/useRealtime.ts`

Thêm import ở đầu file:

```ts
import {
  isContextNewer, isOlderEpoch, sanitizeEntityContext, sanitizeMapContext,
} from '../lib/context';
```

Thêm hàm lọc entity (đặt trên `mergeAccountRuntime`):

```ts
type EntityRow = { id: string; x: number; y: number; [key: string]: unknown };
function sanitizeEntities(value: unknown): EntityRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((row): row is EntityRow => !!row && typeof row === 'object'
    && typeof (row as EntityRow).id === 'string' && (row as EntityRow).id.length > 0
    && isFiniteNumber((row as EntityRow).x) && isFiniteNumber((row as EntityRow).y));
}
```

Thay **toàn bộ** hàm `mergeAccountRuntime` (từ `/** Merge only validated fields ...` đến hết hàm) bằng:

```ts
const WORLD_NUMBER_FIELDS = new Set<string>(['khu', 'x', 'y', 'soKhu']);
const WORLD_STRING_FIELDS = new Set<string>(['mapId']);

/** Merge only validated fields from an untrusted realtime payload. */
export function mergeAccountRuntime(previous: AccountRuntime | undefined, incoming: unknown): AccountRuntime | null {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous ?? null;
  const payload = incoming as Record<string, unknown>;
  if (typeof payload.id !== 'string' || !payload.id.trim()) return previous ?? null;
  if (!previous && (typeof payload.status !== 'string' || !ACCOUNT_STATUSES.has(payload.status as AccountRuntime['status']))) return null;

  const next = { ...(previous ?? {} as AccountRuntime), id: payload.id } as AccountRuntime;

  // 1) Quyết định frame này có được cập nhật phần "world" (vị trí, map, context, entity) hay không.
  const incomingMapContext = hasOwn(payload, 'mapContext') ? sanitizeMapContext(payload.mapContext) : undefined;
  const incomingEpoch = hasOwn(payload, 'mapContextEpoch') ? payload.mapContextEpoch : undefined;
  let worldAccepted = true;
  if (incomingMapContext && previous?.mapContext) {
    worldAccepted = isContextNewer(previous.mapContext, incomingMapContext)
      && !isOlderEpoch(previous.mapContextEpoch, incomingEpoch);
  }

  const numberFields = ['hp', 'maxHp', 'mp', 'maxMp', 'stones', 'khu', 'x', 'y', 'bagCount', 'latencyMs', 'farmKhu', 'farmX', 'farmY', 'soKhu'] as const;
  for (const field of numberFields) {
    if (!worldAccepted && WORLD_NUMBER_FIELDS.has(field)) continue;
    if (hasOwn(payload, field) && isNullableNumber(payload[field])) next[field] = payload[field] as never;
  }
  for (const field of ['accountName', 'connection', 'authError', 'characterName', 'realm', 'mapId', 'activity', 'farmMapId'] as const) {
    if (!worldAccepted && WORLD_STRING_FIELDS.has(field)) continue;
    if (hasOwn(payload, field) && (typeof payload[field] === 'string' || payload[field] === null)) next[field] = payload[field] as never;
  }
  if (hasOwn(payload, 'status') && typeof payload.status === 'string' && ACCOUNT_STATUSES.has(payload.status as AccountRuntime['status'])) next.status = payload.status as AccountRuntime['status'];

  // 2) Vitals/stones có observedAt riêng: không cho lùi.
  if (hasOwn(payload, 'vitals')) {
    const vitals = sanitizeVitals(payload.vitals, previous?.vitals);
    const prevAt = previous?.vitals?.observedAt;
    if (vitals && !(isFiniteNumber(prevAt) && isFiniteNumber(vitals.observedAt) && vitals.observedAt < prevAt)) next.vitals = vitals;
  }
  if (hasOwn(payload, 'stonesSnapshot')) {
    const stones = sanitizeStones(payload.stonesSnapshot, previous?.stonesSnapshot);
    const prevAt = previous?.stonesSnapshot?.observedAt;
    if (stones && !(isFiniteNumber(prevAt) && isFiniteNumber(stones.observedAt) && stones.observedAt < prevAt)) next.stonesSnapshot = stones;
  }
  if (hasOwn(payload, 'dataStatus') && payload.dataStatus && typeof payload.dataStatus === 'object' && !Array.isArray(payload.dataStatus)) {
    const dataStatus = { ...(previous?.dataStatus ?? {}) } as AccountRuntime['dataStatus'];
    for (const key of ['realm', 'hp', 'maxHp', 'mp', 'maxMp', 'stones', 'location', 'monsters', 'players'] as const) {
      if (hasOwn(payload.dataStatus as object, key) && typeof (payload.dataStatus as Record<string, unknown>)[key] === 'boolean') dataStatus[key] = (payload.dataStatus as Record<string, boolean>)[key];
    }
    next.dataStatus = dataStatus;
  }
  for (const field of ['bag', 'training', 'worldSync', 'navigation'] as const) {
    if (hasOwn(payload, field) && payload[field] !== undefined) next[field] = payload[field] as never;
  }

  // 3) World group: map context, players, monsters.
  if (worldAccepted) {
    if (incomingMapContext) {
      next.mapContext = incomingMapContext;
      if (hasOwn(payload, 'mapContextAgeMs') && (payload.mapContextAgeMs === null || isFiniteNumber(payload.mapContextAgeMs))) {
        next.mapContextAgeMs = payload.mapContextAgeMs as number | null;
      }
      if (typeof payload.mapContextIsCurrent === 'boolean') next.mapContextIsCurrent = payload.mapContextIsCurrent;
      if (incomingEpoch === null || isFiniteNumber(incomingEpoch)) next.mapContextEpoch = incomingEpoch as number | null;
      next.mapContextReceivedAt = Date.now();
    }
    for (const [contextField, listField] of [['playersContext', 'players'], ['monstersContext', 'monsters']] as const) {
      const context = hasOwn(payload, contextField) ? sanitizeEntityContext(payload[contextField]) : undefined;
      const contextOk = !context || isContextNewer(previous?.[contextField], context);
      if (context && contextOk) next[contextField] = context;
      if (contextOk && hasOwn(payload, listField)) {
        const rows = sanitizeEntities(payload[listField]);
        if (rows) next[listField] = rows as never;
      }
    }
  }

  if (hasOwn(payload, 'moveTo')) {
    const moveTo = sanitizeMoveTo(payload.moveTo);
    if (moveTo !== undefined) next.moveTo = moveTo;
  }
  return next;
}
```

Điểm cần kiểm tra khi áp dụng:

- Mảng `for (const field of ['bag', 'training', 'worldSync', 'navigation'] ...)`: dòng gốc **không** có `navigation`, nhưng `MiniMap` đọc `account.navigation`. Nếu `navigation` đã được merge ở chỗ khác thì bỏ nó khỏi mảng này; kiểm tra bằng cách grep `navigation` trong `useRealtime.ts`. Nếu hiện tại không merge thì UI `movementLocked` không bao giờ biết đang đi cổng, nên thêm vào là đúng.
- Frame có `mapContext` sai schema thì `incomingMapContext = undefined`, `worldAccepted` vẫn `true`, và `mapContext` cũ được giữ nguyên. Đây là hành vi "giữ trạng thái cũ khi payload hỏng", đúng với yêu cầu.

### A.6 Lỗi 4: vì sao sửa mà `:4000` không đổi

`apps/server/src/index.ts` phục vụ `apps/web/dist`. Quy trình kiểm tra đúng:

```bash
pnpm --filter @tutien2d/web build
# Windows: Ctrl+F5 để bỏ cache; hoặc kiểm tra hash file trong dist/assets đã đổi
```

Hoặc dùng `http://localhost:3000` (Vite dev, proxy `/api` và `/ws` sang 4000) khi đang sửa. Cách kiểm tra live build có phải source hiện tại không: sau khi build, mở DevTools, tab Network, xem tên file `index-<hash>.js` đã đổi so với trước.

### A.7 Tùy chọn backend (2 dòng): xuất `mapContextEpoch`

Trong `getRuntimeInfo` ở `worker-pool.ts`, cạnh `mapContextIsCurrent: projectedMapContext.isCurrent`, thêm:

```ts
      mapContextEpoch: entry.mapContextEpoch,
```

và thêm `mapContextEpoch: null` vào object runtime "chưa chạy" (khối có `mapContextIsCurrent: false`). Thêm `mapContextEpoch: number | null;` vào kiểu `AccountRuntimeInfo`. Epoch giúp frontend loại frame cũ khi vừa đổi map, trường hợp mà so sánh `observedAt` không đủ.

### A.8 Test (Vitest)

```bash
pnpm --filter @tutien2d/web add -D vitest
```

Trong `apps/web/package.json` thêm `"test": "vitest run"`. File `apps/web/src/lib/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isContextNewer, resolveMapContext, sanitizeMapContext } from './context';

const base = {
  mapContext: { mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 1_000_000, fresh: true },
  mapContextAgeMs: 27, mapContextIsCurrent: true, mapContextReceivedAt: 1_000_030,
  mapId: 'tan_vien', khu: 1,
};

describe('resolveMapContext', () => {
  it('không bao giờ âm khi now < receivedAt (lỗi gốc)', () => {
    const view = resolveMapContext(base, 1_000_000);
    expect(view.usable).toBe(true);
    expect(view.ageMs).toBeGreaterThanOrEqual(0);
  });
  it('hết hạn sau TTL', () => {
    expect(resolveMapContext(base, 1_000_030 + 15_000).usable).toBe(true);
    expect(resolveMapContext(base, 1_000_030 + 15_100)).toMatchObject({ usable: false, reason: 'expired' });
  });
  it('backend báo không current thì khóa', () => {
    expect(resolveMapContext({ ...base, mapContextIsCurrent: false }, 1_000_100)).toMatchObject({ usable: false, reason: 'not_current' });
  });
  it('map hoặc khu lệch nhau thì khóa', () => {
    expect(resolveMapContext({ ...base, mapId: 'long_uyen' }, 1_000_100)).toMatchObject({ usable: false, reason: 'mismatch' });
  });
  it('backend cũ không có age thì fallback observedAt', () => {
    const { mapContextAgeMs, mapContextReceivedAt, ...legacy } = base;
    expect(resolveMapContext(legacy, 1_000_500).usable).toBe(true);
  });
});

describe('isContextNewer', () => {
  const prev = { mapId: 'a', khu: 1, observedAt: 100 };
  it('từ chối cùng map nhưng lùi thời gian', () => expect(isContextNewer(prev, { ...prev, observedAt: 99 })).toBe(false));
  it('nhận cùng map và tiến', () => expect(isContextNewer(prev, { ...prev, observedAt: 100 })).toBe(true));
  it('nhận khi đổi map dù observedAt nhỏ hơn', () => expect(isContextNewer(prev, { mapId: 'b', khu: 1, observedAt: 1 })).toBe(true));
});

describe('sanitizeMapContext', () => {
  it('từ chối payload sai kiểu', () => {
    expect(sanitizeMapContext({ mapId: 5, khu: 1, observedAt: 1, fresh: true })).toBeUndefined();
    expect(sanitizeMapContext({ mapId: 'a', khu: 0, observedAt: 1, fresh: true })).toBeUndefined();
    expect(sanitizeMapContext({ mapId: 'a', khu: 1, observedAt: NaN, fresh: true })).toBeUndefined();
  });
  it('nhận trạng thái reset toàn null', () => {
    expect(sanitizeMapContext({ mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false })).toBeTruthy();
  });
});
```

### A.9 Nghiệm thu phần A

1. `pnpm test` ở web: tất cả pass, đặc biệt ca "không âm".
2. `pnpm build`, mở `:4000`: dòng status MiniMap hiện `Bấm bản đồ để chọn tọa độ di chuyển` khi `mapContextIsCurrent=true` và có geometry.
3. Click bản đồ: tab Network thấy `POST /api/accounts/:id/move-to`, và `moveTo.status` chuyển `accepted`/`running`.
4. Mở Network, tìm `/geometry`: map không hỗ trợ chỉ bị gọi lại tối đa 1 lần mỗi 30 giây.
5. Dừng bot rồi bật lại: UI báo `Chưa có map context từ backend` rồi tự hết khi có snapshot (không còn kẹt "timestamp không hợp lệ").

---

## B. HP/MP không có dữ liệu authoritative (lỗi 3)

### B.0 Hai giả thuyết phải loại trừ, theo thứ tự

**Giả thuyết 1 (đã thấy trong code, nhiều khả năng đúng): gói `state` đầu tiên bị guard reject rồi mất vitals.**
Khi `worldPacketGuard` reject gói `state`, `client.ts` chỉ gọi `state.updateVitalsOnly(state, 'state')`. Nhưng `updateState` (đường bình thường) gộp thêm `save.hp/maxHp/mp/maxMp` (`{ ...saveVitals, ...state }`) còn `updateVitalsOnly` thì **không**. Nếu server gửi HP/MP trong `state.save` và gói đầu tiên đến lúc context chưa biết (bị guard từ chối), HP/MP bị bỏ vĩnh viễn, vì sau đó server không gửi lại `state`. Kết quả là `vitals.status` mãi là `unknown`, đúng với live.

**Giả thuyết 2: server không gửi HP tuyệt đối cho nhân vật chính ở bất kỳ gói nào.** Khi đó chỉ còn mục của chính mình trong `p` (id = `welcome.selfId`) với `hp` có thể là phần trăm.

Cần capture để biết giả thuyết nào đúng (B.1) trước khi chốt phần sửa.

### B.1 Packet tap: chẩn đoán trên chính kết nối của bot (không tạo phiên đăng nhập thứ hai)

Không chạy một client thứ hai bằng cùng tài khoản: game có thể đá phiên bot ra. Thay vào đó gắn một "tap" tắt mặc định vào `socket-client.ts`.

File mới `packages/core-client/src/debug/packet-tap.ts`:

```ts
import fs from 'fs';
import path from 'path';

interface ArrayShape { count: number; rows: number; keys: Set<string>; idTypes: Set<string> }

/** Tóm tắt cấu trúc packet để chẩn đoán protocol. KHÔNG lưu token, chỉ lưu tên key và vài giá trị số. */
export class PacketTap {
  private readonly startedAt = Date.now();
  private readonly ops = new Map<string, number>();
  private readonly arrays = new Map<string, ArrayShape>();
  private readonly vitals: Array<Record<string, unknown>> = [];
  private readonly selfEntries: Array<Record<string, unknown>> = [];
  private flushed = false;

  constructor(
    private readonly outDir: string,
    private readonly durationMs: number,
    private readonly getSelfId: () => string,
  ) {}

  record(packet: unknown): void {
    if (this.flushed || !packet || typeof packet !== 'object') return;
    const p = packet as Record<string, unknown>;
    const op = typeof p.op === 'string' ? p.op : 'unknown';
    this.ops.set(op, (this.ops.get(op) ?? 0) + 1);
    const selfId = this.getSelfId();

    for (const [key, value] of Object.entries(p)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const first = value[0];
      if (!first || typeof first !== 'object' || !('id' in first) || !('x' in first)) continue;
      const slot = `${op}.${key}`;
      const shape = this.arrays.get(slot) ?? { count: 0, rows: 0, keys: new Set<string>(), idTypes: new Set<string>() };
      shape.count += 1;
      shape.rows += value.length;
      for (const row of value.slice(0, 5) as Array<Record<string, unknown>>) {
        Object.keys(row).forEach((k) => shape.keys.add(k));
        shape.idTypes.add(typeof row.id);
      }
      this.arrays.set(slot, shape);
      if (selfId && this.selfEntries.length < 20) {
        const mine = (value as Array<Record<string, unknown>>).find((row) => row.id === selfId);
        if (mine) this.selfEntries.push({ at: Date.now() - this.startedAt, slot, entry: mine });
      }
    }

    const save = p.save && typeof p.save === 'object' ? p.save as Record<string, unknown> : {};
    const hasVital = ['hp', 'maxHp', 'mp', 'maxMp'].some((k) => k in p || k in save);
    if (hasVital && this.vitals.length < 50) {
      this.vitals.push({
        at: Date.now() - this.startedAt, op,
        top: { hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp },
        save: { hp: save.hp, maxHp: save.maxHp, mp: save.mp, maxMp: save.maxMp },
      });
    }
    if (Date.now() - this.startedAt >= this.durationMs) this.flush();
  }

  flush(): void {
    if (this.flushed) return;
    this.flushed = true;
    fs.mkdirSync(this.outDir, { recursive: true });
    const file = path.join(this.outDir, `packet-tap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const toObject = (m: Map<string, ArrayShape>) => Object.fromEntries([...m].map(([k, v]) => [k, {
      packets: v.count, rows: v.rows, keys: [...v.keys].sort(), idTypes: [...v.idTypes],
    }]));
    fs.writeFileSync(file, JSON.stringify({
      selfId: this.getSelfId(), durationMs: this.durationMs,
      ops: Object.fromEntries(this.ops), entityArrays: toObject(this.arrays),
      vitalPackets: this.vitals, selfEntries: this.selfEntries,
    }, null, 2));
    console.log(`[PacketTap] đã ghi ${file}`);
  }
}
```

Gắn vào `SocketClient`. Thêm field và tạo tap ngay ở đầu `processPacket`, trước `switch`. `snap2` cũng phải được ghi, nên đặt **trước** câu lệnh lọc `snap2`/`hon`:

```ts
// socket-client.ts: import và field
import { PacketTap } from '../debug/packet-tap.js';
private tap: PacketTap | null = null;
public attachTap(getSelfId: () => string): void {
  const seconds = Number(process.env.TUTIEN_PACKET_TAP);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  this.tap = new PacketTap(process.env.TUTIEN_PACKET_TAP_DIR || 'docs/evidence', seconds * 1000, getSelfId);
}

// đầu processPacket:
this.tap?.record(packet);
```

Gọi `this.socket.attachTap(() => this.state.selfId)` trong constructor của `GameClient` (`client.ts`) sau khi tạo `this.socket` và `this.state`. Chạy server với `TUTIEN_PACKET_TAP=90` (PowerShell: `$env:TUTIEN_PACKET_TAP=90; pnpm dev:server`), đăng nhập bot, đi lại ít nhất một lần, chờ 90 giây. File JSON nằm ở `docs/evidence/`. Với biến môi trường không đặt thì tap không làm gì cả.

### B.2 Cách đọc kết quả và nhánh sửa

| Quan sát trong `packet-tap-*.json` | Kết luận | Làm gì |
|---|---|---|
| `vitalPackets` có `op: "state"` với `save.hp` (hoặc `top.hp`) là số | Giả thuyết 1 | Làm B.3, bỏ B.4 |
| `vitalPackets` rỗng; `selfEntries` có `hp` | Giả thuyết 2 | Làm B.4 |
| Cả hai rỗng | Server gửi HP qua opcode khác | Xem `ops` tìm opcode lạ (`hud`, `stat`…), đối chiếu `vendor/.../src/ui/hud.js` rồi bổ sung parser |
| `selfEntries` rỗng dù `selfId` có | `selfId` khác với `id` trong `p` | Xem `entityArrays["snap2.pf"].idTypes` và tên key; có thể id người chơi là account id còn `selfId` là session id |

Cách quyết định `hp` trong `p` là % hay tuyệt đối: nếu `selfEntries` luôn ≤ 100 và người chơi khác cũng 100, hoặc nó đổi theo bước nhỏ khi bị đánh, thì coi là phần trăm. Chỉ coi là tuyệt đối khi có `maxHp` đi kèm hoặc giá trị khớp với `state.save.hp`.

### B.3 Sửa giả thuyết 1: `updateVitalsOnly` phải gộp `save`

`packages/core-client/src/state/game-state.ts`. Thêm hàm dùng chung (đặt trên class) và dùng ở cả hai chỗ:

```ts
/** Gộp vitals nằm trong state.save với vitals ở gốc packet (gốc thắng, như updateState). */
function withSaveVitals<T extends Record<string, unknown>>(packet: T): T {
  const save = (packet as { save?: { hp?: unknown; maxHp?: unknown; mp?: unknown; maxMp?: unknown } }).save;
  if (!save || typeof save !== 'object') return packet;
  return { hp: save.hp, maxHp: save.maxHp, mp: save.mp, maxMp: save.maxMp, ...packet } as T;
}
```

Trong `updateVitalsOnly`, đổi đối số đầu của `normalizeVitals`:

```ts
    const snapshot = normalizeVitals(
      withSaveVitals(packet as Record<string, unknown>) as Partial<StatePacket>,
      source,
      Date.now(),
      this.vitals,
      false,
    );
```

Một bẫy khi gộp: `{hp: undefined, ...}` đặt khóa với giá trị `undefined`; `normalizeVitals` dùng `standard !== undefined` nên bỏ qua đúng. Vì `updateState` đang tự gộp theo cách riêng, có thể thay bằng `withSaveVitals` luôn để đồng nhất (tùy bạn, không bắt buộc).

Test (đặt trong `packages/core-client`, dùng `node:test` nếu chưa có runner):

```ts
const store = new GameStateStore('t');
store.updateVitalsOnly({ save: { hp: 80, maxHp: 100, mp: 30, maxMp: 50 } } as any, 'state');
assert.equal(store.vitals.status, 'fresh');
assert.equal(store.vitals.hp, 80);
```

Sau khi sửa, kiểm tra thêm một điều: gói `state` bị guard reject lúc login có nên được **phát lại** sau khi context biết không. Nếu capture cho thấy HP chỉ xuất hiện trong chính gói bị reject, B.3 đã đủ vì vitals không phụ thuộc context.

### B.4 Sửa giả thuyết 2: dùng mục của chính mình trong `p`

**Nguyên tắc an toàn**: giá trị `hp` trong `p` chưa chắc là HP tuyệt đối, và đã từng có sự cố `hp=0/maxHp=1` bị hiểu là chết (xem `docs/VITALS_SYNC_FIX.md`). Do đó **không** ghi nó vào `vitals.hp`. Lưu thành tín hiệu riêng `selfPresence` (còn sống theo phần trăm, có mặt trong world), và để automation dùng nó như một tín hiệu yếu.

`game-state.ts`, thêm vào class:

```ts
export interface SelfPresence {
  /** HP phần trăm 0..100 lấy từ mục của chính mình trong danh sách người chơi; KHÔNG phải vitals.hp. */
  hpPercent: number | null;
  observedAt: number;
}

public selfPresence: SelfPresence | null = null;

/** Chọn đúng một mục có id === selfId. 0 hoặc nhiều hơn 1 mục: không đoán, xóa tín hiệu. */
public applySelfEntry(players: ReadonlyArray<{ id?: unknown; hp?: unknown }>, observedAt: number = Date.now()): void {
  if (!this.selfId) { this.selfPresence = null; return; }
  const matches = players.filter((row) => row && row.id === this.selfId);
  if (matches.length !== 1) { this.selfPresence = null; return; }
  const raw = matches[0].hp;
  const hpPercent = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
  this.selfPresence = { hpPercent, observedAt };
}
```

Reset `selfPresence = null` trong `updateWelcome` (kết nối mới) và trong chỗ đổi context map.

Trong `client.ts`, ngay trước `this.emit('worldSnapshot', result.snapshot);`:

```ts
        this.state.applySelfEntry(result.snapshot.players, result.snapshot.observedAt);
```

Worker (`worker-pool.ts`): trong `getRuntimeInfo`, thêm vào object trả về:

```ts
      selfPresence: client.state.selfPresence ? { ...client.state.selfPresence } : null,
```

(lấy `client` từ `entry.client`). Thêm vào kiểu `AccountRuntimeInfo`, vào object "chưa chạy" (`selfPresence: null`), và type web (`selfPresence?: { hpPercent: number | null; observedAt: number } | null`), rồi cho phép merge trong `useRealtime` bằng cách thêm `'selfPresence'` vào danh sách field copy ở bước 2 (kiểm tra `isRecord` và `hpPercent` là số hoặc null).

UI: ở `AccountCard`, khi `hp === null` và `selfPresence?.hpPercent != null` hiển thị `HP ~{hpPercent}% (ước lượng)`; khi cả hai null hiển thị `Chưa có HP`. Không bao giờ in `0` cho dữ liệu chưa biết.

### B.5 Chính sách "còn sống" cho state machine

Ở `packages/automation-engine/src/training/state-machine.ts` (chỗ chặn `RESPAWN_PROTOCOL_UNAVAILABLE`, quanh dòng 124), thay điều kiện chết bằng hàm thuần:

```ts
export type Liveness = 'alive' | 'dead' | 'unknown';

export function resolveLiveness(input: {
  vitals: { hp: number | null; status: string; observedAt: number | null };
  selfPresence: { hpPercent: number | null; observedAt: number } | null;
  now: number;
  maxAgeMs: number; // ví dụ 10_000
}): Liveness {
  const { vitals, selfPresence, now, maxAgeMs } = input;
  // 1) Vitals tuyệt đối đang fresh là nguồn authoritative duy nhất cho "chết".
  if (vitals.status === 'fresh' && vitals.hp !== null && vitals.observedAt !== null && now - vitals.observedAt <= maxAgeMs) {
    return vitals.hp > 0 ? 'alive' : 'dead';
  }
  // 2) Không có vitals: chỉ dùng phần trăm để xác nhận "còn sống", không bao giờ để kết luận "chết".
  if (selfPresence && selfPresence.hpPercent !== null && now - selfPresence.observedAt <= maxAgeMs) {
    return selfPresence.hpPercent > 0 ? 'alive' : 'unknown';
  }
  return 'unknown';
}
```

Cách dùng:

- `dead` → giữ nguyên `BLOCKED: RESPAWN_PROTOCOL_UNAVAILABLE` (hành vi an toàn hiện tại).
- `unknown` → dừng tấn công, tiếp tục cho phép di chuyển thủ công. Không block vĩnh viễn kiểu "chết".
- `alive` → cho di chuyển. Cho tấn công **chỉ khi** điều kiện kỹ năng không cần MP, hoặc MP tuyệt đối đang `fresh`.

Lý do hạ `hpPercent == 0` về `unknown` thay vì `dead`: vì ngữ nghĩa của giá trị này chưa được xác nhận bằng capture, đúng bài học của sự cố `0/1`.

### B.6 Nghiệm thu phần B

1. Tap ghi được file; xác định giả thuyết đúng.
2. Sau khi sửa: `vitals.status = fresh`, `dataStatus.hp = true`, hoặc `selfPresence.hpPercent` có giá trị và UI hiện `HP ~100%`.
3. Đăng nhập lại (reconnect): trạng thái được reset ở `welcome`, rồi nạp lại sau vài giây.
4. Test đơn vị `resolveLiveness`: `hp=0 fresh → dead`; `hp null, percent 0 → unknown`; `percent 80 → alive`; quá `maxAgeMs → unknown`.

---

## C. Quái = 0 và điều kiện unlock training (lỗi 9, 11)

### C.0 Bằng chứng hiện có

Số liệu live (đầu tài liệu): pipeline snap2 nhận và chấp nhận 22553 gói, 0 resync, 0 full bị reject. Full duy nhất (seq 1) có 14 người, 0 quái, ở `tan_vien`. Nếu parser lọc sai, ta sẽ thấy `fullRejected > 0` hoặc `resyncs > 0` (reducer reject khi `id` không phải chuỗi). Không thấy cả hai, nên khả năng cao `tan_vien` đúng là không có quái. Giả thuyết còn lại cần loại trừ là quái có mặt ở map khác nhưng id/opcode khác.

### C.1 Thêm bộ đếm hàng quái để không phải đoán

`worldSync.lastFullShape` chỉ ghi **full đầu tiên**, nên không cho thấy quái xuất hiện sau đó. Thêm bộ đếm tích lũy.

`types.ts` (kiểu `Snap2Stats`, xem `resetSnap2Stats`/`emptySnap2Stats` để cập nhật cùng lúc): thêm

```ts
  monsterRowsSeen: number;       // tổng số hàng trong ef đã nhận
  monsterPatchRowsSeen: number;  // tổng số hàng trong e (patch)
  lastMonsterRowsAt: number | null;
```

Khởi tạo `0, 0, null` ở mọi nơi tạo stats (core-client `resetSnap2Stats` và `emptySnap2Stats` ở worker-pool). Trong `processSnap2Packet`, khối `if (recordReceived) { ... }`, thêm:

```ts
        const efRows = Array.isArray(packet.ef) ? packet.ef.length : 0;
        const eRows = Array.isArray(packet.e) ? packet.e.length : 0;
        this.snap2Stats.monsterRowsSeen += efRows;
        this.snap2Stats.monsterPatchRowsSeen += eRows;
        if (efRows + eRows > 0) this.snap2Stats.lastMonsterRowsAt = receivedAt;
```

Thêm field tương ứng vào type `worldSync` của web (có thể để optional).

### C.2 Quy trình kết luận

1. Cho một nhân vật đi vào map có quái (qua portal bằng chức năng điều hướng sẵn có), đợi 30 giây.
2. Đọc `worldSync`:
   - `monsterRowsSeen > 0` và `runtime.monsters.length == 0` → bộ lọc ở worker đang bỏ quái. Kiểm tra bộ lọc `typeof monster.id === 'string' && Number.isFinite(monster.x/y)` ở handler `worldSnapshot`; log lại hàng bị loại.
   - `monsterRowsSeen == 0` mà `ops` trong packet tap có mảng entity ở opcode khác (`entityArrays` có key không phải `snap2.ef`) → quái đi qua opcode khác, bổ sung parser theo `vendor/.../src/net/gateway.js`.
   - `fullRejected > 0` hoặc `resyncs > 0` với `lastFullRejectReason = invalid` → id quái không phải chuỗi. Chỉ trong trường hợp này mới sửa reducer:
     ```ts
     // snap2-reducer.ts: chuẩn hóa id số thành chuỗi trước khi upsert/patch/remove
     const normalizeId = (id: unknown): string | null =>
       typeof id === 'string' && id ? id : typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : null;
     ```
     và dùng nó thay cho `typeof row.id !== 'string'`. Phải áp dụng đồng bộ cho `remove` (`gp`/`ge`), `upsert` (`pf`/`ef`) và `patch` (`p`/`e`), nếu không patch sẽ không tìm thấy hàng.
   - `monsterRowsSeen == 0` ở mọi map có quái và không có mảng entity lạ → server thực sự không gửi quái cho client này (ví dụ cần nhìn thấy trong tầm), ghi nhận vào `TRAINING_PROTOCOL_GAPS.md`.

### C.3 Điều kiện unlock training (lỗi 11)

Không cần "mở khóa" bằng cách nới điều kiện. Mở khóa tự nhiên khi đủ năm thứ: context hiện tại (đã có), vị trí mới (đã có), HP/MP valid (phần B), danh sách quái cùng context (phần C.2), loại quái đúng. Thêm một bảng chẩn đoán vào API training để thấy rõ cái nào thiếu:

```ts
export function trainingBlockers(input: {
  mapContextCurrent: boolean; locationFresh: boolean;
  liveness: Liveness; mpOk: boolean;
  monstersFresh: boolean; monsterCount: number; targetTypeMatched: boolean;
  phase: 'MOVING_TO_AREA' | 'COMBAT';
}): string[] {
  const out: string[] = [];
  if (!input.mapContextCurrent) out.push('MAP_CONTEXT_STALE');
  if (!input.locationFresh) out.push('LOCATION_STALE');
  if (input.liveness === 'dead') out.push('RESPAWN_PROTOCOL_UNAVAILABLE');
  else if (input.liveness === 'unknown' && input.phase === 'COMBAT') out.push('VITALS_UNKNOWN');
  if (!input.mpOk) out.push('MP_UNKNOWN');
  if (!input.monstersFresh) out.push('MONSTERS_STALE');
  else if (input.monsterCount === 0) out.push('NO_MONSTERS_IN_VIEW');
  else if (!input.targetTypeMatched) out.push('NO_MATCHING_MONSTER_TYPE');
  return out;
}
```

Quy ước phase ở helper trên là bắt buộc: `VITALS_UNKNOWN` chỉ là blocker của
`COMBAT`/attack/skill. Ở `MOVING_TO_AREA`, vitals unknown không được dừng lệnh
đi; state machine hiện thực hóa cùng quy ước bằng action `MOVE_TO_AREA`, sau đó
trả reason `VITALS_UNKNOWN` khi đã ở vùng có mục tiêu nhưng chưa đủ HP
authoritative để tấn công.

Trả mảng này trong `training` của runtime để dashboard hiện đúng lý do khóa.

---

## D. Move/attack không có ACK (lỗi 8)

### D.0 Hiện trạng đã đọc từ code

- `sendMove` đã có `seq` tăng dần và chỉ tăng khi `sendRaw` thành công. Move là **tuyệt đối** (`x`, `y`), gửi lại cùng tọa độ là vô hại về mặt ý nghĩa.
- REST move-to đã có chống trùng theo `requestId` (`previous?.requestId === input.requestId` trong `worker-pool.ts` quanh dòng 1429), nên retry REST không tạo hai operation.
- `attackMob` và `castSkill` dùng `sendRaw`, trả về `true` nếu ghi vào socket được, không có ACK. Retry attack mới là rủi ro thật (đánh kép, tiêu MP).

Vì giao thức game không cho ACK nên không thể làm idempotency phía server game. Cách đúng là **không retry mù** và **xác nhận bằng quan sát**.

### D.1 Sổ lệnh (operation ledger)

File mới `packages/core-client/src/operation-ledger.ts`:

```ts
export type OpKind = 'move' | 'attack' | 'skill';
export type OpStatus = 'sent' | 'confirmed' | 'unconfirmed' | 'failed';

export interface LedgerEntry {
  key: string;            // khóa chống trùng, ví dụ attack:<targetId>
  kind: OpKind;
  seq: number;
  sentAt: number;
  status: OpStatus;
  confirmBy: number;      // hạn xác nhận
}

export class OperationLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private seq = 0;

  constructor(
    private readonly confirmWindowMs: Record<OpKind, number> = { move: 1500, attack: 1200, skill: 1500 },
    /** Khoảng tối thiểu giữa hai lệnh cùng khóa, bắt buộc với attack/skill. */
    private readonly minIntervalMs: Record<OpKind, number> = { move: 0, attack: 600, skill: 800 },
    private readonly maxEntries = 200,
  ) {}

  /** Trả về mục mới nếu được phép gửi, hoặc lý do bị chặn. */
  begin(kind: OpKind, key: string, now: number): { ok: true; entry: LedgerEntry } | { ok: false; reason: 'in_flight' | 'cooldown' } {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.status === 'sent' && now < existing.confirmBy) return { ok: false, reason: 'in_flight' };
      if (now - existing.sentAt < this.minIntervalMs[kind]) return { ok: false, reason: 'cooldown' };
    }
    const entry: LedgerEntry = {
      key, kind, seq: ++this.seq, sentAt: now, status: 'sent', confirmBy: now + this.confirmWindowMs[kind],
    };
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    return { ok: true, entry };
  }

  confirm(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.status = 'confirmed';
  }

  fail(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.status = 'failed';
  }

  /** Gọi định kỳ: lệnh quá hạn xác nhận chuyển thành unconfirmed (KHÔNG tự gửi lại). */
  sweep(now: number): LedgerEntry[] {
    const expired: LedgerEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === 'sent' && now >= entry.confirmBy) {
        entry.status = 'unconfirmed';
        expired.push(entry);
      }
    }
    return expired;
  }

  get(key: string): LedgerEntry | undefined { return this.entries.get(key); }
}
```

### D.2 Quy tắc dùng

1. **Attack/skill**: khóa là `attack:<targetId>` hoặc `skill:<skillId>:<targetId>`. Trong `attackMob`, gọi `ledger.begin(...)` trước `sendRaw`. Nếu `ok:false` thì trả `false` và không gửi. Nếu `sendRaw` trả `false` thì `ledger.fail(key)`.
2. **Xác nhận bằng quan sát** (gọi `ledger.confirm`): nhận được `hurt`/`act`/gói hit của đúng `targetId`, hoặc HP quái trong snapshot giảm, hoặc `kill` của quái đó. Tên gói thật phải lấy từ capture, đừng đoán trong code.
3. **Hết hạn xác nhận** (`unconfirmed`): không tự gửi lại. State machine đọc lại world (quái còn sống, còn trong tầm, còn HP) rồi *quyết định mới* cho nhịp kế, vẫn qua `begin` nên bị chặn bởi cooldown.
4. **Move**: khóa là `move`. Vì tuyệt đối nên được phép gửi liên tục theo nhịp ~10 Hz như hiện nay; ledger chỉ dùng để biết "đã gửi tới đâu". Xác nhận move bằng việc `x,y` trong `you`/snapshot tiến gần đích; không tiến sau `confirmWindowMs` thì ghi `unconfirmed` và để vòng điều hướng tự quyết định (đi lại, đổi đường), không lặp vô hạn.
5. **Reset khi đổi kết nối**: gọi tạo mới ledger trong `welcome` để không giữ lệnh của phiên cũ.

### D.3 REST `requestId`

Hiện chỉ so với lệnh gần nhất (`previous?.requestId`). Nếu client gửi `A`, rồi `B`, rồi retry `A`, `A` sẽ chạy lại. Nếu cần chặt hơn, thêm bộ nhớ biên nhận ngắn hạn:

```ts
private readonly moveReceipts = new Map<string, { at: number; receipt: unknown }>(); // key = `${accountId}:${requestId}`
// khi nhận request:
const cached = this.moveReceipts.get(key);
if (cached && Date.now() - cached.at < 10 * 60_000) return cached.receipt;
// sau khi tạo biên nhận:
this.moveReceipts.set(key, { at: Date.now(), receipt });
// dọn: xóa mục cũ hơn 10 phút mỗi lần ghi
```

Lưu ý: `requestId` của REST là khóa idempotency ở **control-plane**, không phải của game server; không được hiểu nó đảm bảo game không xử lý hai lần.

### D.4 Test

`OperationLedger`: (a) `begin` hai lần cùng khóa trong cửa sổ → lần hai `in_flight`; (b) sau hạn xác nhận → `sweep` đổi `unconfirmed` và `begin` lại khi qua `minIntervalMs`; (c) trong `minIntervalMs` → `cooldown`; (d) `confirm` rồi `begin` trước `minIntervalMs` vẫn `cooldown`.

---

## E. Bảo mật (chặn trước khi expose ra Internet)

Trạng thái hiện tại đã đọc trong code: `HOST` mặc định `0.0.0.0`; `app.use(cors())` mở hoàn toàn; `WebSocketServer({ server, path: '/ws' })` không kiểm tra gì; `GET /api/logs?limit=` dùng `parseInt` không giới hạn; `db.getLogs` dùng `slice(-limit)` với giá trị chưa kiểm tra.

Lỗi nhỏ có thật trong `getLogs`: `limit=0` hoặc `limit=abc` (→ `NaN`) khiến `slice(-0)`/`slice(NaN)` trả **toàn bộ** log; `limit` âm trả về ngược. Cần clamp (E.5).

### E.1 Cấu hình: `apps/server/src/config.ts`

Thêm vào `CONFIG` và đổi `HOST`:

```ts
const isLoopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = (process.env.API_TOKEN || '').trim();

if (!isLoopback(HOST) && API_TOKEN.length < 32) {
  throw new Error('HOST không phải loopback thì bắt buộc đặt API_TOKEN >= 32 ký tự (vd: openssl rand -hex 32).');
}

// trong CONFIG:
  HOST,
  API_TOKEN,
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS
    || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000')
    .split(',').map((s) => s.trim()).filter(Boolean),
```

Khi chạy local mặc định (`127.0.0.1`, không có `API_TOKEN`) auth tắt để không phá dev flow. Khi mở ra ngoài thì bị ép phải có token; ứng dụng từ chối khởi động nếu thiếu.

Sinh token: `openssl rand -hex 32` (chỉ chứa ký tự hex, cần cho WebSocket subprotocol ở E.3). Đặt vào `.env`, không commit.

### E.2 Middleware: file mới `apps/server/src/security/auth.ts`

```ts
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'http';
import { CONFIG } from '../config.js';

const authEnabled = CONFIG.API_TOKEN.length > 0;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest();

/** So sánh thời gian hằng số; băm trước để hai chuỗi luôn cùng độ dài. */
export function tokenMatches(candidate: string | undefined | null): boolean {
  if (!authEnabled) return true;
  if (!candidate) return false;
  return crypto.timingSafeEqual(digest(candidate), digest(CONFIG.API_TOKEN));
}

export function bearerFromHeader(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1];
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // client không phải trình duyệt (curl, script) không gửi Origin
  return CONFIG.ALLOWED_ORIGINS.includes(origin);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (tokenMatches(bearerFromHeader(req.headers.authorization))) { next(); return; }
  res.status(401).json({
    success: false, error: 'Unauthorized', errorCode: 'UNAUTHORIZED',
    requestId: res.locals.requestId, retryable: false,
  });
}

/** Xác thực cho WebSocket upgrade: Origin + token trong Sec-WebSocket-Protocol: "bearer, <token>". */
export function verifyWsUpgrade(req: IncomingMessage): { ok: true } | { ok: false; code: number; reason: string } {
  if (!originAllowed(req.headers.origin)) return { ok: false, code: 403, reason: 'Origin not allowed' };
  if (!authEnabled) return { ok: true };
  const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
  const idx = protocols.indexOf('bearer');
  const token = idx >= 0 ? protocols[idx + 1] : undefined;
  return tokenMatches(token) ? { ok: true } : { ok: false, code: 401, reason: 'Unauthorized' };
}
```

Vì sao truyền token qua subprotocol mà không qua query string: URL xuất hiện trong log proxy và lịch sử trình duyệt; trình duyệt không cho đặt header `Authorization` cho WebSocket.

### E.3 Gắn vào server: `apps/server/src/index.ts`

```ts
import crypto from 'crypto';
import { requireAuth } from './security/auth.js';

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || CONFIG.ALLOWED_ORIGINS.includes(origin)),
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
}));
app.use((req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
});
app.use(express.json({ limit: '100kb' }));

app.use('/api', requireAuth, apiRouter);   // /health giữ công khai, không lộ dữ liệu
```

Thứ tự `app.use` quan trọng: request id phải đứng trước `requireAuth` để lỗi 401 có `requestId`.

`apps/server/src/ws/hub.ts`: đổi khởi tạo để xác thực trong lúc upgrade:

```ts
import { verifyWsUpgrade } from '../security/auth.js';

this.wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  maxPayload: 64 * 1024,
  // Nếu client gửi subprotocol "bearer" thì chọn nó; token là phần tử kế tiếp, không echo lại.
  handleProtocols: (protocols) => (protocols.has('bearer') ? 'bearer' : false),
  verifyClient: (info, done) => {
    const verdict = verifyWsUpgrade(info.req);
    if (verdict.ok) done(true);
    else done(false, verdict.code, verdict.reason);
  },
});
```

Nếu auth tắt (local, không token), client không gửi subprotocol; `handleProtocols` trả `false`, kết nối vẫn mở bình thường.

Dashboard là kênh chỉ-đọc nên bỏ qua mọi message client gửi lên (hiện tại không có handler `ws.on('message')`, giữ như vậy).

### E.4 Frontend gửi token: `apps/web/src/lib/api.ts` và `useRealtime.ts`

Tạo `apps/web/src/lib/auth.ts`:

```ts
const KEY = 'tutien2d.apiToken';
export const getToken = (): string => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setToken = (value: string): void => { try { sessionStorage.setItem(KEY, value.trim()); } catch { /* chặn storage */ } };
export const authHeaders = (): Record<string, string> => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };
```

Dùng `sessionStorage` (mất khi đóng tab) thay vì `localStorage` để token không nằm lâu trên đĩa. Trong mọi `fetch` ở `api.ts`, thêm `headers: { ...authHeaders(), ...existingHeaders }`. Cách ít sửa nhất là bọc một hàm `apiFetch(url, init)` rồi thay toàn bộ `fetch(` trong file bằng `apiFetch(`:

```ts
export const apiFetch = (input: string, init: RequestInit = {}) =>
  fetch(input, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) } });
```

Khi nhận `401`, hiển thị hộp nhập token (một modal nhỏ gọi `setToken` rồi `refreshAccounts`). Trong `useRealtime.ts`:

```ts
const token = getToken();
const ws = token ? new WebSocket(wsUrl, ['bearer', token]) : new WebSocket(wsUrl);
```

Nếu kết nối WS bị đóng ngay khi mở (mã 1006 sau lỗi 401), `onclose` hiện tại đã tự reconnect mỗi 3 giây; thêm trần thử lại (ví dụ dừng sau 5 lần liên tiếp và hiện thông báo cần nhập token) để không spam server.

### E.5 Pagination có biên: `routes.ts` và `database.ts`

Hàm dùng chung (đặt trong `routes.ts` hoặc `security/params.ts`):

```ts
export function parseLimit(raw: unknown, fallback = 100, max = 500): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
```

Thay hai chỗ `parseInt((req.query.limit as string) || '100', 10)` bằng `parseLimit(req.query.limit)`. Và phòng thủ thêm trong `database.ts`:

```ts
public getLogs(accountId?: string, limit: number = 100): DbLog[] {
  const safe = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 500) : 100;
  const source = accountId ? this.data.logs.filter((l) => l.accountId === accountId) : this.data.logs;
  return source.slice(-safe);
}
```

### E.6 Lỗi API chuẩn: `apps/server/src/security/errors.ts`

```ts
import type { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) { super(message); }
}

export function sendError(res: Response, status: number, errorCode: string, message: string, extra: { retryable?: boolean; details?: Record<string, unknown> } = {}): void {
  res.status(status).json({
    success: false,
    error: message,              // giữ để frontend hiện tại (json.error) không gãy
    errorCode,
    requestId: res.locals.requestId,
    retryable: extra.retryable ?? false,
    ...(extra.details ? { details: extra.details } : {}),
  });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) { sendError(res, err.status, err.errorCode, err.message, { retryable: err.retryable, ...(err.details ? { details: err.details } : {}) }); return; }
  console.error(JSON.stringify({ event: 'unhandled_api_error', requestId: res.locals.requestId, message: err instanceof Error ? err.message : String(err) }));
  sendError(res, 500, 'INTERNAL_ERROR', 'Lỗi máy chủ nội bộ.', { retryable: false }); // không lộ stack/chi tiết
}
```

Gắn `app.use(errorHandler)` **sau** `app.use('/api', ...)`. Chuyển dần các `res.status(400).json({ success:false, error: err.message })` trong `routes.ts` sang `sendError(res, 400, 'BAD_REQUEST', err.message)`. Với lỗi hiện đã có mã (`KHU_PROTOCOL_UNAVAILABLE`, `character_not_alive`…) giữ nguyên mã đó làm `errorCode`. Chỉ đặt `retryable: true` cho lỗi tạm thời (mất kết nối game, context chưa fresh); lỗi 4xx do đầu vào là `false`.

Một lưu ý: hiện nhiều route trả `err.message` thẳng cho client (ví dụ `res.status(400).json({ error: err.message })`). Với message nội bộ không chủ đích công khai thì chỉ trả mã và thông điệp đã định sẵn, không trả `err.message` gốc.

### E.7 Token và bí mật

1. Rotate token game đã từng nằm trong `test_ws.mjs`/`test_ping.mjs` (đăng nhập lại để lấy phiên mới); xem token cũ là đã lộ. Bản hiện tại đã đọc từ `TUTIEN_TEST_TOKEN`, giữ nguyên cách này.
2. Dùng `.env` cho `API_TOKEN`, `ENCRYPTION_SECRET`; không đưa vào repo. `data/.secret` và `data/tutien_db.json` chứa credential đã mã hóa: không chia sẻ, không đưa vào backup công khai.
3. `SUPABASE_ANON_KEY` trong `config.ts` là khóa công khai do chính game phát hành, không phải bí mật.
4. Dự án không có `.git`: nên chạy `git init` và thêm `.gitignore` gồm `.env`, `data/`, `node_modules/`, `apps/web/dist/`, `docs/evidence/`, để từ nay có lịch sử thay đổi và tránh commit nhầm bí mật.

### E.8 Validate packet game bằng schema (thay `any`)

Thêm `zod` vào `packages/core-client` (`pnpm --filter @tutien2d/core-client add zod`). Mục tiêu: dữ liệu từ socket đi qua schema, sai thì bỏ gói và log, không để `any` lan vào state.

`packages/core-client/src/schemas.ts`:

```ts
import { z } from 'zod';

const finite = z.number().finite();

export const MapPlayerSchema = z.object({
  id: z.string().min(1),
  x: finite,
  y: finite,
  hp: finite.optional(),
}).passthrough();

export const WelcomeSchema = z.object({
  op: z.literal('welcome'),
  selfId: z.string().min(1),
  name: z.string().optional(),
  ep: z.number().int().optional(),
}).passthrough();

export const YouSchema = z.object({
  op: z.literal('you'),
  x: finite.optional(), y: finite.optional(),
  hp: finite.optional(), maxHp: finite.optional(),
  mp: finite.optional(), maxMp: finite.optional(),
  ep: z.number().int().optional(),
}).passthrough();

export const StateSchema = z.object({
  op: z.literal('state'),
  mapId: z.string().optional(),
  khu: z.number().int().positive().optional(),
  x: finite.optional(), y: finite.optional(),
  p: z.array(MapPlayerSchema).optional(),
}).passthrough();

export const Snap2Schema = z.object({
  op: z.literal('snap2'),
  sq: z.number().int().optional(),
  ep: z.number().int().optional(),
  full: z.union([z.boolean(), z.number(), z.string()]).optional(),
  p: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  e: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  pf: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  ef: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  gp: z.array(z.string()).optional(),
  ge: z.array(z.string()).optional(),
}).passthrough();

export const PACKET_SCHEMAS = {
  welcome: WelcomeSchema, state: StateSchema, you: YouSchema, snap2: Snap2Schema,
} as const;
```

Dùng `.passthrough()` để không làm rơi field protocol chưa biết (client chính thức có nhiều field). Trong `processPacket` của `socket-client.ts`:

```ts
const schema = PACKET_SCHEMAS[packet.op as keyof typeof PACKET_SCHEMAS];
if (schema) {
  const parsed = schema.safeParse(packet);
  if (!parsed.success) {
    this.rejectedPackets += 1;
    if (this.rejectedPackets <= 5 || this.rejectedPackets % 100 === 0) {
      this.emit('log', { level: 'warn', message: `Packet ${packet.op} sai schema: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` });
    }
    return;
  }
}
```

Triển khai dần: bắt đầu với bốn gói trên, đo `rejectedPackets` vài ngày trước khi siết thêm. Cảnh báo: schema quá chặt có thể làm bot ngừng nhận gói hợp lệ nếu server thêm biến thể; vì vậy chỉ bắt các trường mà code đang thực sự dùng và log đếm lượt reject.

### E.9 Nghiệm thu phần E

| Kiểm tra | Kết quả mong đợi |
|---|---|
| Chạy với `HOST=0.0.0.0` mà không có `API_TOKEN` | Server từ chối khởi động |
| `curl localhost:4000/api/accounts` khi có `API_TOKEN` | 401 kèm `errorCode`, `requestId` |
| Cùng lệnh kèm `Authorization: Bearer <token>` | 200 |
| `curl -H "Origin: http://evil.example" ...` | Không có header CORS cho origin lạ |
| WS từ trang có Origin lạ hoặc thiếu token | Upgrade bị 403/401 |
| `GET /api/logs?limit=0`, `?limit=abc`, `?limit=999999` | Tối đa 500 dòng, không trả toàn bộ log |
| Gọi API với JSON sai | Lỗi theo `errorHandler`, không có stack trace |
| Dashboard `:3000` và `:4000` | Nhập token một lần, REST và WS hoạt động |

---

## F. Các điểm là giới hạn protocol, không phải bug (lỗi 6, 7, 10)

Không sửa code. Chỉ cần đảm bảo UI và tài liệu nói rõ:

- **6. Chuyển map chỉ qua portal**: `enterMap()` gửi `{op:'enter', mapId}` và worker phải đi tới portal trước. Map chỉ có metadata catalog (chưa được live xác nhận) nên hiển thị là "chưa xác nhận" và khóa nút vào. Collision grid nay đã sinh đủ 16 map catalog trong `walk-grids.generated.ts`; map không có spawn tĩnh vẫn không được coi là đã có dữ liệu farm.
- **7. Chọn khu**: trước live giữ `KHU_PROTOCOL_UNAVAILABLE`; sau kết quả đo live ở `docs/RESEARCH_KHU_CHANGE.md` đã mở API/dashboard đổi khu. ACK là `map` cùng `mapId` và `khu` đích; route thử nghiệm `khu-probe` vẫn giữ để đo lại khi cần. Khu đầy, map có quái và giới hạn dài hạn vẫn chưa xác minh.
- **10. Chết và hồi sinh**: giữ `BLOCKED: RESPAWN_PROTOCOL_UNAVAILABLE`. Điều kiện để mở: lệnh hồi sinh đã xác minh, ACK, map/khu hồi sinh, chi phí/cooldown, và quy trình quay lại training. Với B.5, chỉ trạng thái `dead` dựa trên vitals tuyệt đối fresh mới kích hoạt khóa này.

---

## G. Checklist tổng và thứ tự commit

1. [x] A.1–A.5, A.8: đã sửa web freshness/context, MiniMap click, merge timestamp và geometry backoff; production build pass; đã thêm Vitest và `src/lib/context.test.ts`, 6/6 test pass.
2. [x] A.6: gate move-to không còn chặn chỉ vì vitals `unknown`; live request đúng tọa độ trả `202 running` và kết thúc `arrived`. Trường hợp gục dùng `character_down`, không dùng `character_not_alive`.
3. [~] E.1–E.5: đã có loopback bind mặc định, auth REST/WS, origin, request ID, pagination bounded, UI nhập token session và trần reconnect 5 lần với cảnh báo origin/token; E.7 rotate token/thiết lập Git vẫn là vận hành thủ công.
4. [x] B.1: packet tap 90 giây đã ghi summary redacted tại `docs/evidence/packet-tap-2026-10-07T13-19-41-452Z.json`; không có raw packet, token, ID hoặc tên nhân vật.
5. [x] B.2: live capture mới xác nhận trình tự `welcome@874ms → map@932ms → state@935ms → snap2@948ms`, realm ở `state.save.realm` và equipment ở `state.save.equipment`; `state.realm` không có. Worker đã fallback `save.realm`, runtime live `dataStatus.realm=true`. HP trong `p/pf` vẫn không được dùng; self row vẫn không xuất hiện.
6. [x] B.3–B.5: đã gộp `state.save` vitals, thêm `selfPresence` tách khỏi vitals và policy liveness an toàn; reconnect sau restart đã nạp lại vitals fresh từ `you`.
7. [x] C.1–C.2: tại `thanh_truc_lam`, sau 30 giây `monsterRowsSeen` tăng `93 → 247`, `monsterPatchRowsSeen` tăng `570 → 1622`, `runtime.monsters` còn `12`; parser/worker không bỏ toàn bộ quái, không có bằng chứng để sửa id số.
8. [~] D.1–D.2: đã thêm ledger và nối `attackMob`/`castSkill`; xác nhận ACK/observation vẫn bị giữ nguyên cho tới khi capture packet chứng minh.
9. [~] E.6: error envelope/request ID đã có lớp chuẩn hóa backward-compatible; E.8 schema packet chưa bật vì chưa thêm dependency và protocol còn biến thể chưa capture.
10. [ ] Cập nhật `docs/API_REVIEW.md`, `docs/VITALS_SYNC_FIX.md`, `docs/TRAINING_PROTOCOL_GAPS.md` sau khi có kết quả live capture/map có quái.
11. [x] Live HP/MP tap 120 giây: move đúng tọa độ đã `202 running → arrived` sau khi nới gate, nhưng evidence mới vẫn có `youPackets=[]`, `ops.hurt=0`, `ops.revived=0`; giả thuyết chủ động lấy HP bằng move đứng yên bị bác bỏ.
12. [x] BƯỚC 1 gate downed: `downed=true` chặn; `downed=null` + vitals unknown cho move-to; HP 0 từ `state` không tự kết luận gục; training vẫn trả `vitals_unknown` khi chưa biết.
13. [x] BƯỚC 2 save fallback: `save.realm` và `save.equipment` được đọc; top-level hợp lệ thắng; payload equipment sai kiểu bị bỏ qua.
14. [x] BƯỚC 4 derived maxima: generator đã đối chiếu vendor; `luyen_khi_8` không bonus = `225/188 complete`; item bonus cộng đúng; item lạ/realm lạ làm kết quả incomplete/unknown; không ghi derived vào `VitalSnapshot`.
15. [x] Training gate probe: `moveToTrainingArea` dùng gate mềm; test xác nhận vitals unknown vẫn di chuyển, `downed=true` chặn, state hp=0 không chặn; state machine chỉ trả `VITALS_UNKNOWN` ở pha combat.
16. [x] Live move thật với tap 150 giây: evidence `packet-tap-2026-10-07T14-59-31-958Z.json` có 90 outbound move records và 9/9 `you` seq khớp, latency 98–113ms, hp/mp 225/188, runtime `fresh/source=you`.

Các giả định chưa kiểm chứng (cần xác nhận khi áp dụng, không nên coi là sự thật):

- Giá trị `hp` trong mục người chơi là phần trăm (B.0, B.2): **chưa xác minh** vì capture không có `selfEntries`.
- `selfId` trùng với `id` trong `p`/`pf` (B.2, dòng cuối bảng): **chưa xác minh** vì capture không ghép được self row.
- Gói move về đúng tọa độ khi đứng yên luôn tạo `you` có HP/MP: **bác bỏ cho live run này**; move đã `arrived` nhưng 120 giây không có `you`.
- Realm trong login nằm ở `state.realm`: **bác bỏ**; evidence ghi `state.save.realm`, còn key cấp trên `state` chỉ có `op, reason, save`.
- `dataStatus.realm=false` nghĩa là server không nhận được realm: **bác bỏ**; server nhận `save.realm`, nhưng listener worker hiện chỉ bật cờ từ `packet.realm` cấp trên.
- Hiệu ứng thụ động làm đổi hpMax trong 120 giây quan sát: **chưa xác minh**; không có `you`, `hurt` hoặc `revived` và không thay đổi item/trận pháp/buff.
- `downed=null` trong khi vitals unknown phải chặn move-to: **bác bỏ**; gate mới cho move-to đi qua, nhưng training/attack vẫn chặn nghiêm.
- Max HP/MP suy ra được là vitals server: **bác bỏ**; `derivedMax` là trường riêng, UI đánh dấu “suy ra” và không ghi vào `VitalSnapshot`.
- `tan_vien` không có quái (C.0): **được hỗ trợ bởi capture**, trong khi map đích có quái; chưa chứng minh cho mọi thời điểm/tầm nhìn.
- `navigation` có đang được `useRealtime` merge hay chưa (A.5, điểm kiểm tra đầu): **đã xác nhận**, field có trong merge và UI nhận trạng thái portal.
- Worker bỏ toàn bộ quái do lọc id: **bác bỏ cho live run này**; counters `ef/e` tăng và runtime giữ nhiều quái.
- Tên gói dùng để xác nhận đòn đánh (D.2 điểm 2) chỉ biết sau capture.
- `you` chỉ xuất hiện sau mọi move: **bác bỏ cho move đứng yên**, nhưng **xác nhận trong probe này** sau move có dịch chuyển 42.45px; chưa xác minh ngưỡng tối thiểu kích ACK.
- `you` sau move là cách chủ động đáng tin để lấy HP trong probe này; không được khái quát thành đảm bảo cho mọi quãng đường/map trước khi có thêm evidence.
- Training có thể đi vào vùng farm khi HP unknown nhưng không được attack/skill; live game chưa bật autoTraining và chưa xác minh hành vi combat thực tế.

## H. Stationary probe — checklist và giả định

1. [x] Harness `TUTIEN_PROBE_STATIONARY=1` tắt mặc định, claim một lần cho cả process, chờ 20 giây sau `IN_GAME`, và tự hủy khi downed/quái gần/move-to/navigation/context/vị trí không an toàn.
2. [x] Đợt A là 10 move `idle` nhịp 100ms qua `sendMove`; B `walk` chỉ được phép nếu A không có `you`, tối đa 20 move.
3. [x] Test guard: `downed`, quái trong 300, move-to, navigation, thiếu vị trí; test env tắt; test one-shot và bound 20 move.
4. [x] Evidence live redacted: `docs/evidence/packet-tap-2026-10-07T15-34-28-827Z.json`; A `seq 1..10`, `idle`, `you seq=10`, delay 106ms, HP/MP 225/188, `dn=0`, `fix=0`, vị trí không đổi.
5. [~] H2 `walk` chưa chạy vì A đã thành công; full `pnpm build`/Vitest/server TS chưa tự chạy được do toolchain sandbox (`pnpm`/`tsx`/`ws`/`vitest`/symlink express).
6. [~] Đã thêm mode `TUTIEN_PROBE_STATIONARY=offset`: đúng `4 + 10` move `idle`, nhãn `offset-0`/`offset-1`, ghi `youDuringPostMoveWait`, guard và one-shot; test source bằng Node type-transform pass, nhưng build/dist và `node --test` chuẩn bị chặn bởi `EPERM` của toolchain.
7. [ ] Live evidence của mode offset và bảng phân biệt M1/M2/M3: **chưa xác minh**; không được tạo evidence giả khi chưa có build và phiên game thật.
8. [x] `vitalsAgeMs` được tính ở backend khi snapshot fresh; web merge giữ `observedAt` không lùi, tính tuổi không âm và AccountCard đánh dấu cũ sau 5s.
9. [~] `refreshVitals` đã tách coordinator có lock/rate-limit theo account, guard dùng chung với stationary probe, API/auth/UI/training đã nối; build/test sandbox chưa chạy do `pnpm`/TypeScript/Vitest bị chặn `EPERM`.
10. [~] Các ngưỡng `VITALS_DISPLAY_STALE_MS=5_000`, `VITALS_ATTACK_MAX_AGE_MS=30_000`, `VITALS_REFRESH_MIN_INTERVAL_MS=30_000` là policy đề xuất, **chưa xác minh live**.

Giả định/giới hạn còn lại: `idle` đã được đối chiếu với vendor (`gateway.js` dùng `o.state`, `player.js` khởi tạo `state:"idle"`); H1 và H3 mới có một live run. `vitalsAgeMs` và `refreshVitals` đã có code/test fixture nhưng chưa được build/test trong sandbox này; các ngưỡng 5 giây, 30 giây và 30 giây vẫn là đề xuất, chưa xác minh live.

## I. P0 auto data/parser — checklist cập nhật 2026-10-08

1. [x] Sinh bảng 62 enemy definitions và 27 skill definitions + Thunder bằng VM từ vendor; không sửa vendor.
2. [x] Ghi rõ ánh xạ `t`, ý nghĩa `hp` tuyệt đối, cờ `d`, event `kill`, các state `st` và payload combat vào `AUTO_SPEC.md`.
3. [x] Thêm kiểu/parser pure, fixture tổng hợp, `deriveLearnedSkills`, export công khai; chưa nối vào `GameStateStore`/luồng bot.
4. [x] Kiểm tra cú pháp generator/fixture/test và chạy lại hai generator với cross-check nguồn.
5. [~] `pnpm build` bị chặn do TypeScript dưới `.pnpm` bị `EPERM`; `node --test packages/core-client/test/auto-data.test.mjs` đã gọi nhưng dừng ở `ERR_MODULE_NOT_FOUND` vì `dist` chưa build. Không đánh dấu build/test pass cho tới khi chạy lại trong môi trường phù hợp.
6. [ ] Đo live các miền giá trị server, biến thể `act`, nguồn `hurt.byId`, thứ tự kill/loot và lock/preference kỹ năng trước P1–P3.

## J. P1 target + collision/spawn — checklist cập nhật 2026-10-08

1. [x] Sinh `walk-grids.generated.ts` cho 16/16 map catalog bằng VM vendor; không sửa vendor, không đọc mạng.
2. [x] Sinh `map-spawns.generated.ts`: 37 dòng map/loại, 187 điểm; mọi type tồn tại trong `ENEMY_DEFS`; giữ cảnh báo 1 spawn trên ô chặn.
3. [x] Facade server giữ API `WALK_TILE_SIZE`, `WalkGrid`, `WALK_GRIDS`, `getWalkGrid`, `isWalkableTile`; test cũ walk-path pass source.
4. [x] `selectTarget` + `inMeleeReach` + `inSkillRange`: priority/fallback, sticky tùy chọn, lọc unknown/dead/human/tuSi, tọa độ invalid và tie-break xác định.
5. [x] `pickAutoSkill` + `SkillCooldowns`: rotation, ready/range/mp/sp, cooldown riêng/chung, loại `bienHinh` và `playerTargetOnly`.
6. [x] A3 audit tĩnh: 11 map có spawn × 20 truy vấn = 220; không có lỗi rectangle safety; mismatch đường được ghi tài liệu, chưa sửa thuật toán.
7. [~] Full `pnpm build` và toàn bộ test TypeScript server/core còn chờ môi trường toolchain: `pnpm` không có PATH, Corepack bị EACCES khi resolve registry, TypeScript dưới `.pnpm` bị EPERM; không đánh dấu build pass khi chưa chạy được.
8. [ ] Đo live respawn/leash, prop điều kiện, server cooldown và xác nhận P2 approach trước khi nối vào state machine.

## K. P2 approach — checklist static/live

1. [x] Pure `computeApproachGoal` + `ApproachTracker`: deterministic, chỉ trả goal walkable hoặc `none`; test fixture `thanh_truc_lam` quét 62 điểm sinh.
2. [x] `runApproach`: dependency injection, guard vitals/context/connection, lock theo account, cancel-and-wait trước replan và không nối training/attack/skill.
3. [x] `approach-probe`: `TUTIEN_PROBE_APPROACH=1`, one-shot sau 20 giây, lọc boss/human/tuSi/contact/khoảng cách/path/aggro, arrived thì đứng yên 3 giây; packet tap redact.
4. [x] Tài liệu `docs/LIVE_SCENARIO_APPROACH.md` đã mô tả điều kiện, API map/enter, vitals/refresh, tiêu chí thành công và dừng khẩn.
5. [~] Test TypeScript/server và `pnpm build` bị chặn bởi toolchain sandbox (`pnpm` thiếu PATH, Corepack EACCES, TypeScript EPERM); live P2 chưa chạy.
6. [ ] Xác minh live: tới tầm ≤8 giây, không `hurt`, không xuyên vật cản, không move sau arrived; đo quái đuổi/leash và độ ổn định đứng yên.
## L. Engine vendor headless — checklist 2026-10-08

1. [x] `vendor-env.ts` nap read-only 241 script theo `index.html`; co DOM/canvas stub, RNG/clock offline, WebSocket inject duoc, `flushRaf`, Assets settle ngay, chan fetch/XHR/require/process va gioi han console error.
2. [x] `auto-supervisor.ts` giu neo va cac pha farming/down_wait/reviving/recovering/traveling/resuming/halted; Auto off trong pha an toan, max deaths/timeout/HP gate, under-one-tile arrival.
3. [x] `vendor-runner.ts` mot account/mot phien, TokenManager/sessionUpdated, Gateway.login truoc scene, real clock loop khong draw, counters/reconnect/watchdog/stop cleanup.
4. [x] Worker/API/UI engine vendor opt-in, mot engine moi account, Auto API qua auth/error envelope, dashboard hien phase/neo/death-trip/hurt va halt.
5. [x] Test source moi cho vm env, supervisor traps 1–6, runner fake WebSocket, engine exclusivity va Auto error envelope; nhom headless/API moi nhat 8/8 pass bang Node + tsx workaround.
6. [~] `pnpm build`/full test chua chay duoc trong sandbox: pnpm thieu PATH, Corepack bi EACCES mang, TypeScript bi EPERM, tsx bi ENOMEM; live reconnect/token-expiry/death/revive/long-run chua xac minh.
7. [~] Vendor vitals probe: da them probe toi da 10 move idle qua Gateway, guard dung yen/downed/auto va test fake `you`/`hurt`; build va test moi chua chay duoc do sandbox (`tsx` ENOMEM, Vitest EPERM), hanh vi game that chua xac minh.
8. [~] Vendor map/entity: da doc nguon `map.khu`/`KhuUI` va giu `khu=null` neu goi khong co truong, them snapshot monsters/players va UI hien map/toa do khi khu chua biet; marker/entity payload va khu tren game that chua xac minh.

## M. Core movement prediction/reconciliation — checklist 2026-10-08

1. [x] `PredictedMover` thuần hàm: injected time, dt 20–200 ms/lần đầu 100 ms, queue 32 command, speed mặc định từ `AUTO_CONSTANTS` và giới hạn bước sau rounding.
2. [x] Reconciliation đối chiếu `gateway.js`: ACK/pending offset, `ep`/seq stale, sai lệch 6 px, 140 px, mốc chờ 1,5 s và hard sau 3 correction liên tiếp.
3. [x] `runMoveTo` và portal loop dùng prediction để tính bước/path; arrival, blocked, failed, cancel và authoritative stall giữ nguyên vai trò.
4. [x] Listener `you` được gắn theo operation và gỡ ở `finally`; test fake ACK theo seq bội số 10 bao phủ move-to, portal, cancel, failed/stalled và cleanup.
5. [x] Offline: PredictedMover 9/9; movement integration 4/4; generator và esbuild transpile pass; `git diff --check` pass.
6. [~] Full `pnpm build`/TypeScript typecheck bị chặn bởi pnpm/Corepack/EPERM toolchain; live speed, `you.fix`, clip và portal thật chưa xác minh.

## N. Loại bỏ engine core — checklist 2026-10-08

1. [x] Xóa package `packages/automation-engine`, mã client/core controller, movement/navigation/vitals/training và test/debug chỉ phục vụ chúng.
2. [x] Giữ headless vendor, auth/token manager, vitals policy, generated data còn dùng, map geometry, CRUD/start-stop/restart/Auto/logs/WebSocket và control-plane security.
3. [x] Rút worker pool/API/web về vendor-only; MiniMap chỉ đọc; bỏ move-to, đổi map/khu, vitals refresh, inventory, training và engine config khỏi dashboard.
4. [x] Chuyển cấu hình DB tối giản vào server, đọc được record cũ và bỏ trường lạ khi ghi.
5. [~] Chưa chạy `pnpm install`, `pnpm build` hoặc test trong sandbox; cần người giao việc chạy toàn bộ lệnh được liệt kê trong handoff.

## O. Vendor map readiness — checklist 2026-10-08

1. [x] Đọc source vendor local: `Gateway.mapId` được gán ở `op:"map"` trước `SceneWorld.enterServerMap`; map khác cảnh hiện tại bật `SceneWorld.transitioning` cho tới sau commit và hai `requestAnimationFrame`.
2. [x] Runner ưu tiên `observedMapId`, xóa trạng thái khi reset/đóng kết nối/reconnect; snapshot không ghép map với tọa độ cũ trong lúc chưa biết/chuyển cảnh.
3. [x] `startAuto` chặn map chưa sẵn sàng và anchor khác map; API error envelope có HTTP 409 và retry semantics tương ứng.
4. [x] Test source thêm fake map khác `tan_vien`, map delay, snapshot trước/trong/sau transition, gate map và anchor mismatch; không phát sẵn kết quả snapshot.
5. [~] Chưa chạy được test/build trong sandbox do `tsx` lỗi `uv_os_get_passwd returned ENOMEM`; cần người giao việc chạy `npx tsx --test src/headless/vendor-runner.test.ts`, contract test và `pnpm build`.
6. [ ] Chưa xác minh timing/reconnect/anchor trên game thật.

## P. Vendor walkTo bản 1 — checklist 2026-10-08

1. [x] Module `walk-navigator.ts` dùng `Pathfinder.route`/`player.setPath`, snap waypoint cuối, gate portal, quyền lái Auto và vòng đời arrived/blocked/timeout/cancelled.
2. [x] `VendorRunnerSnapshot.moveTo`, worker/API move-to + cancel, error envelope và `startAuto` handoff đã nối.
3. [x] MiniMap có inverse transform, gate context/khu/geometry/Auto/operation, trạng thái, marker snap và nút hủy.
4. [x] Test source fake navigator, VendorRunner integration và web round-trip/geometry đã thêm.
5. [~] Chưa chạy được build/test trong phiên sandbox; cần chạy `pnpm build`, `pnpm --filter @tutien2d/web test`, và từng file server bằng `cd apps/server && npx tsx --test <file>`.
6. [ ] Chưa xác minh live tốc độ/độ chính xác, snap, đi sát cổng, hurt giữa đường, reconnect và đi ngay sau khi vào game.
## Q. walkTo Bản 2a — checklist 2026-10-08

1. [x] Đồ thị BFS thuần lấy từ `MapData.portals`; loại `byHand`, cooldown, `cooldownGroup`, `warps`/cấu trúc chưa xác minh.
2. [x] Navigator nhiều chặng, `route`/`leg`, chờ transition tối đa 8 giây, `unexpected_map`, `portal_no_transition`, hurt threshold và trần tổng 10 phút.
3. [x] API `mapId`/`abortOnHurt`/`maxHurt`, reachable-maps, ánh xạ `ROUTE_UNAVAILABLE`/`PATH_CROSSES_PORTAL`; UI chọn map và sanitize realtime.
4. [x] Fixture offline dùng client vendor thật và FakeSocket ghi outbound `enter`; fixture integration phản hồi `map` sau delay; bundle offline: map-route 3/3, walk-navigator 9/9, contract 2/2, vendor-runner 12/12.
5. [~] `pnpm build`, Vitest và lệnh `tsx` trực tiếp chưa chạy được trong sandbox (`tsx` ENOMEM, TypeScript/Vitest EPERM); cần chạy trong môi trường người giao việc.
6. [ ] Chưa xác minh trên game thật: thời gian transition, hurt giữa đường, cooldown/byHand ở map dùng thực tế, reconnect và độ chính xác tuyến nhiều map.

## R. API và dashboard đổi khu — checklist 2026-10-08

1. [x] `VendorRunner.changeKhu()`/`requestKhuList()` dùng Gateway chính thức, waiter theo `map`/`toast`/`khu`, gate an toàn, cooldown bảo vệ, timeout bounded và không retry mù.
2. [x] Snapshot/runtime giữ `khuList`; list được sanitize ở server và realtime web, chỉ hợp lệ theo map hiện tại; API `GET|POST /api/accounts/:id/khu` có envelope, status, `retryAfterSec` và `Retry-After`.
3. [x] Dashboard có chọn khu, số người/capacity, khóa khu đầy/khu hiện tại và khóa theo bot/map/Auto/đi bộ/đổi khu/cooldown; refresh có rate-limit phía component.
4. [x] Gói `map` cùng map nhưng khác khu hủy `walkTo` với `khu_changed`; giữ nguyên route thử nghiệm `khu-probe`, không sửa vendor/auto-supervisor.
5. [x] FakeSocket/test source bao phủ success, cooldown client/server, already-here, target/map split, Auto, walkTo, timeout, list và malformed list; contract mapping lỗi mới đã thêm.
6. [~] `git diff --check` pass; `pnpm build`, Vitest và các lệnh `tsx --test` chưa chạy trong sandbox phiên này, cần chạy ở môi trường người giao việc.
7. [ ] Chưa xác minh live: khu đầy, map có quái, giới hạn dài hạn, cooldown chính xác ngoài khoảng 5 giây và quy tắc khoảng cách Bảng Khu ở map khác.

## S. Module nhiệm vụ hằng ngày bản 1 — checklist 2026-10-08

1. [x] `DailyQuests` thuần với điểm danh và `duoc_moc`: state machine theo frame, ACK theo `cmd`, timeout, cancel/down/reconnect/Auto và giới hạn chặt không rơi cành.
2. [x] Nối `VendorRunner`, snapshot/runtime, WorkerPool và API `GET|POST /daily`; giữ nguyên `quest-probe`/`khu-probe`, không sửa `auto-supervisor.ts` hoặc `vendor/`.
3. [x] Dashboard `DailyControl`, kiểu API, realtime sanitize; việc chưa hỗ trợ hiển thị mờ, khóa theo bot/map/Auto/thao tác/stage.
4. [x] Thêm test source cho state machine và contract lỗi.
5. [~] `pnpm build`, Vitest và test server chưa chạy trong sandbox phiên này; cần chạy trong môi trường người giao việc.
6. [ ] Chưa xác minh live lại ngưỡng đứng cạnh NPC, giới hạn 3 lượt phía server, các việc còn lại và hành vi rời việc giữa chừng.
7. [~] Fixture `VendorRunner + FakeSocket` đã kiểm tra điểm danh và ACK đúng `cmd` (18/18 bundle offline); chưa mô phỏng trọn `duoc_moc` với map/props/ACK `seed.collect`/thưởng như server thật.

## T. Module nhiệm vụ hằng ngày — `linh_chi` (offline 2026-10-08)

1. [x] State machine hỗ trợ `duoc_moc` và `linh_chi`; `linh_chi` đi Đại Phu → `tan_vien`, chọn prop `ling_chi_prop`, harvest theo ACK và giao việc nhiều lượt.
2. [x] Xử lý prop ẩn, chọn gần nhất, `retryAfter`/`regrowAfter`, thử sát hơn một lần khi server báo chưa đứng cạnh; không retry mù khi ACK timeout hoặc lỗi khác.
3. [x] Vendor adapter đọc `SceneWorld.map`/`flatProps`, `Inventory.count('nam_linh_chi')`, gọi `Gateway.cmd('resource.harvest')`; dashboard/API/realtime hiển thị hai việc và tiến độ nấm.
4. [~] Esbuild transform cú pháp 8 file TS/TSX pass; test source `daily-quests` 16/16, `daily.contract` 1/1 và `vendor-runner` 18/18 pass với preload tạm cho lỗi `os.userInfo` của sandbox; `pnpm build`/Vitest/full typecheck vẫn chưa chạy được vì `pnpm` thiếu PATH và package dưới `.pnpm` bị `EPERM`.
5. [ ] Chưa xác minh live lại ngưỡng khoảng cách, mọi prop đồng thời hồi, giới hạn 3 lượt/ngày phía server; `truc_gia`/`cau_ca`/`ho_tong_chau`/`dai_hoi` vẫn chưa hỗ trợ.

## U. Module nhiệm vụ hằng ngày — `truc_gia` (offline 2026-10-09)

1. [x] State machine hỗ trợ `truc_gia`: nhận ở Đại Phu, đi theo map tới `thanh_truc_lam`, liệt kê cây từ map đang tải, chặt 4 prop và giao việc; tiếp tục việc đang dở.
2. [x] Vendor adapter suy tọa độ `tx/ty`, trả `activeCollectedIds`, giữ `startChopping(prop, mapId?)` tổng quát; `duoc_moc` và `linh_chi` giữ hành vi cũ.
3. [x] API/docs/dashboard hiển thị `truc_gia` và tiến độ `Trúc Tâm: n/4`; route thử nghiệm, vendor client và `auto-supervisor.ts` không đổi.
4. [~] `typescript.transpileModule` cho 5 file TS/TSX thay đổi pass cú pháp; `daily-quests.test.ts` và `vendor-runner.test.ts` bị chặn trước khi nạp bởi `uv_os_get_passwd returned ENOMEM`; chưa chạy được `pnpm build`, Vitest hoặc các test `tsx --test` còn lại trong sandbox; cần chạy từng file server theo danh sách handoff và toàn bộ build/test.
5. [ ] Chưa xác minh live ngưỡng khoảng cách, cây bị người khác chặt/`hidden`, giới hạn 3 lượt/ngày phía server; `cau_ca`/`ho_tong_chau`/`dai_hoi` chưa hỗ trợ.

## V. Việc `cau_ca` — đo live (2026-10-09), triển khai đang chờ Codex

1. [x] Đo live chu trình: `seed.start` (41 px), `seed.complete` bằng cá có sẵn (+30 Linh Thạch, +4 Dược Công, tiêu 3 cá), câu từ xa bị từ chối "không đứng cạnh mặt nước", câu ở bờ hồ (5 lần: 3 được, 2 hụt); chi tiết ở `docs/RESEARCH_DAILY_QUESTS.md` mục 12.
2. [x] Thăm dò `quest-probe`: `fish`, `status` (`ca`, `fishing`), `props` tìm `interactables`; build 3 package pass.
3. [ ] Triển khai `cau_ca` trong `daily-quests.ts` (dùng cá có sẵn nếu đủ, thiếu thì câu ở `ho_bich_thuy_cong`): giao Codex bằng `docs/PROMPT_DAILY_CAU_CA.md`, chưa nghiệm thu.
4. [ ] Chưa xác minh: ngưỡng khoảng cách chính xác tới mặt nước, `suoi_duoc_coc`, `linh_ngu`, túi đầy, giới hạn 3 lượt/ngày phía server; `ho_tong_chau`/`dai_hoi` chưa đo.
