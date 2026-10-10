import React, { useEffect, useMemo, useState } from 'react';
import { Clipboard, MoreHorizontal, Plus, RefreshCw, Search, Shield, Square, UserCog, Users, X, Network } from 'lucide-react';
import type { AccountRuntime, AdminProxy, AdminUser, AuditLogEntry } from '../types';
import {
  createAdminUser, deleteAdminUser, fetchAdminAudit, fetchAdminUsers, grantAdminUser, resetAdminUserPassword,
  revokeAdminUserSessions, setAdminUserExpiry, stopAdminUserBots, stopBot, updateAdminUser,
  checkAdminProxy, createAdminProxy, deleteAdminProxy, fetchAdminProxies, updateAdminProxy, setAccountProxy,
} from '../lib/api';
import { confirmAction, notify } from '../lib/dialogs';
import {
  auditActionLabel, filterAdminUsers, filterAuditLogs, formatAdminExpiry,
  generateRandomPassword, getAdminActionPolicy, parseProxyLine, PROXY_KINDS, type ProxyKind,
} from '../lib/admin';

type AdminTab = 'users' | 'accounts' | 'proxies' | 'audit';

interface AdminPanelProps {
  currentUserId: string;
  accounts: AccountRuntime[];
  onRefreshAccounts: () => Promise<void>;
  onOpenAccountLog: (accountId: string) => void;
}

const buttonClass = 'rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40';
const inputClass = 'rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500';

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Chưa đăng nhập';
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toLocaleString() : 'chưa biết';
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUserId, accounts, onRefreshAccounts, onOpenAccountLog }) => {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [auditCursor, setAuditCursor] = useState<number | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [query, setQuery] = useState('');
  const [accountOwner, setAccountOwner] = useState('all');
  const [accountStatus, setAccountStatus] = useState('all');
  const [auditAction, setAuditAction] = useState('');
  const [auditUser, setAuditUser] = useState('');
  const [auditTargetId, setAuditTargetId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [proxies, setProxies] = useState<AdminProxy[]>([]);
  const [loadingProxies, setLoadingProxies] = useState(false);

  const refreshUsers = async () => {
    setLoadingUsers(true);
    try { setUsers(await fetchAdminUsers()); } catch (error) { notify(error); } finally { setLoadingUsers(false); }
  };

  const refreshAudit = async (reset = false) => {
    setLoadingAudit(true);
    try {
      const result = await fetchAdminAudit(50, reset ? undefined : auditCursor ?? undefined);
      setAudit((previous) => reset ? result.data : [...previous, ...result.data]);
      setAuditCursor(result.nextBefore);
    } catch (error) { notify(error); } finally { setLoadingAudit(false); }
  };

  const refreshProxies = async () => {
    setLoadingProxies(true);
    try { setProxies(await fetchAdminProxies()); } catch (error) { notify(error); } finally { setLoadingProxies(false); }
  };

  useEffect(() => {
    void refreshUsers();
    void refreshProxies();
    const timer = window.setInterval(() => { void refreshUsers(); }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { if (tab === 'audit' && audit.length === 0) void refreshAudit(true); }, [tab]);
  useEffect(() => { if (tab === 'proxies') void refreshProxies(); }, [tab]);

  const visibleUsers = useMemo(() => filterAdminUsers(users, query), [users, query]);
  const visibleAudit = useMemo(() => filterAuditLogs(audit, auditAction, auditUser, auditTargetId), [audit, auditAction, auditUser, auditTargetId]);
  const activeAdminCount = users.filter((user) => user.role === 'admin' && user.status === 'active').length;
  const owners = useMemo(() => Array.from(new Set(accounts.map((account) => account.ownerUsername ?? account.ownerId ?? ''))).filter(Boolean).sort(), [accounts]);
  const filteredAccounts = accounts.filter((account) => {
    const owner = account.ownerUsername ?? account.ownerId ?? 'chưa biết';
    return (accountOwner === 'all' || owner === accountOwner) && (accountStatus === 'all' || account.status === accountStatus);
  });

  return <section className="space-y-5">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">Khu vực quản trị</p>
        <h2 className="mt-1 text-xl font-bold text-slate-100">Quản trị hệ thống</h2>
      </div>
      <button type="button" onClick={() => { void refreshUsers(); if (tab === 'audit') void refreshAudit(true); }} className={buttonClass} disabled={loadingUsers || loadingAudit}>
        <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loadingUsers || loadingAudit ? 'animate-spin' : ''}`} /> Làm mới
      </button>
    </div>

    <div className="flex max-w-full flex-wrap gap-2 border-b border-slate-800 pb-2">
      {([['users', 'Người dùng', Users], ['accounts', 'Tài khoản toàn hệ thống', Shield], ['proxies', 'Proxy', Network], ['audit', 'Nhật ký kiểm toán', UserCog]] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === value ? 'bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}><Icon className="mr-1.5 inline h-3.5 w-3.5" />{label}</button>)}
    </div>
    {tab === 'users' && <UsersTab users={visibleUsers} allUsers={users} query={query} setQuery={setQuery} loading={loadingUsers} activeAdminCount={activeAdminCount} currentUserId={currentUserId} onRefresh={refreshUsers} onCreate={() => setCreateOpen(true)} />}
    {tab === 'accounts' && <AccountsTab accounts={filteredAccounts} proxies={proxies} owners={owners} owner={accountOwner} status={accountStatus} setOwner={setAccountOwner} setStatus={setAccountStatus} onRefresh={onRefreshAccounts} onOpenAccountLog={onOpenAccountLog} />}
    {tab === 'proxies' && <ProxyTab proxies={proxies} loading={loadingProxies} onRefresh={refreshProxies} />}
    {tab === 'audit' && <AuditTab logs={visibleAudit} action={auditAction} user={auditUser} targetId={auditTargetId} setAction={setAuditAction} setUser={setAuditUser} setTargetId={setAuditTargetId} loading={loadingAudit} hasMore={auditCursor !== null} onLoadMore={() => { if (!loadingAudit) void refreshAudit(false); }} />}

    <CreateUserModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={async () => { await refreshUsers(); void refreshAudit(true); }} />
  </section>;
};

function ProxyTab({ proxies, loading, onRefresh }: { proxies: AdminProxy[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<ProxyKind>('socks5');
  const [maxAccounts, setMaxAccounts] = useState('1');
  const [working, setWorking] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editMax, setEditMax] = useState('1');
  const [editEnabled, setEditEnabled] = useState(true);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const capacity = Number(maxAccounts);
    const lines = url.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000) { notify('Dán ít nhất một proxy và nhập sức chứa 1..1000.'); return; }
    const parsed = lines.map((line) => ({ line, item: parseProxyLine(line, kind) }));
    const bad = parsed.filter((entry) => !entry.item);
    if (bad.length) { notify(`Sai định dạng ở dòng ${parsed.findIndex((entry) => !entry.item) + 1}. Dùng host:port, host:port:user:pass, user:pass@host:port hoặc scheme://...`); return; }
    setWorking('create');
    const failed: string[] = [];
    for (const { item } of parsed) {
      try { await createAdminProxy({ label: (lines.length === 1 && label.trim()) || item!.label, url: item!.url, maxAccounts: capacity }); }
      catch (error) { failed.push(`${item!.label}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (failed.length) notify(`Không thêm được ${failed.length}/${lines.length} proxy:\n${failed.join('\n')}`);
    else { setLabel(''); setUrl(''); setMaxAccounts('1'); }
    await onRefresh();
    setWorking('');
  };
  const startEdit = (proxy: AdminProxy) => { setEditing(proxy.id); setEditLabel(proxy.label); setEditUrl(''); setEditMax(String(proxy.maxAccounts)); setEditEnabled(proxy.enabled); };
  const saveEdit = async (proxy: AdminProxy) => {
    const capacity = Number(editMax);
    if (!editLabel.trim() || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000) { notify('Nhãn/sức chứa proxy không hợp lệ.'); return; }
    setWorking(proxy.id);
    try { await updateAdminProxy(proxy.id, { label: editLabel.trim(), maxAccounts: capacity, enabled: editEnabled, ...(editUrl.trim() ? { url: editUrl.trim() } : {}) }); setEditing(null); await onRefresh(); }
    catch (error) { notify(error); } finally { setWorking(''); }
  };
  const remove = async (proxy: AdminProxy) => {
    if (!(await confirmAction(`Xóa proxy ${proxy.label}?`, { confirmLabel: 'Xóa', danger: true }))) return;
    setWorking(proxy.id);
    try { await deleteAdminProxy(proxy.id); await onRefresh(); } catch (error) { notify(error); } finally { setWorking(''); }
  };
  return <div className="space-y-4">
    <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 md:grid-cols-[8rem_1fr_8rem_auto]">
      <select value={kind} onChange={(event) => setKind(event.target.value as ProxyKind)} className={inputClass} aria-label="Loại proxy">{PROXY_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <textarea value={url} onChange={(event) => setUrl(event.target.value)} rows={3} placeholder={'Mỗi dòng một proxy: host:port:user:pass\nhoặc user:pass@host:port, host:port, scheme://...'} className={`${inputClass} min-w-0 font-mono`} autoComplete="off" spellCheck={false} />
      <div className="grid gap-2"><input value={maxAccounts} onChange={(event) => setMaxAccounts(event.target.value)} type="number" min="1" max="1000" className={inputClass} aria-label="Sức chứa" title="Sức chứa (số tài khoản)" /><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Nhãn (tuỳ chọn)" className={inputClass} /></div>
      <button type="submit" disabled={!!working} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"><Plus className="mr-1 inline h-3.5 w-3.5" />Thêm proxy</button>
    </form>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {proxies.map((proxy) => <article key={proxy.id} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs">
        {editing === proxy.id ? <div className="space-y-2"><input value={editLabel} onChange={(event) => setEditLabel(event.target.value)} className={`${inputClass} w-full`} /><input value={editUrl} onChange={(event) => setEditUrl(event.target.value)} placeholder="URL mới (để trống giữ nguyên)" className={`${inputClass} w-full`} autoComplete="off" /><input value={editMax} onChange={(event) => setEditMax(event.target.value)} type="number" min="1" max="1000" className={`${inputClass} w-full`} /><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.target.checked)} /> Proxy đang bật</label><div className="flex gap-2"><button type="button" disabled={!!working} onClick={() => void saveEdit(proxy)} className={buttonClass}>Lưu</button><button type="button" onClick={() => setEditing(null)} className={buttonClass}>Hủy</button></div></div> : <><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate font-semibold text-slate-100">{proxy.label}</h3><p className="truncate text-[11px] text-slate-400">{proxy.endpoint}</p></div><span className={proxy.enabled && proxy.status === 'ok' ? 'text-emerald-300' : proxy.enabled && proxy.status === 'down' ? 'text-rose-300' : 'text-slate-400'}>{!proxy.enabled ? 'Tắt' : proxy.status === 'ok' ? 'Hoạt động' : proxy.status === 'down' ? 'Hỏng' : 'Chưa biết'}</span></div><dl className="mt-3 grid grid-cols-2 gap-2"><div><dt className="text-slate-500">Đã gán</dt><dd>{proxy.assigned}/{proxy.maxAccounts}</dd></div><div><dt className="text-slate-500">Độ trễ</dt><dd>{proxy.lastLatencyMs === null ? 'chưa biết' : `${proxy.lastLatencyMs} ms`}</dd></div><div className="col-span-2 break-words text-slate-400"><dt className="text-slate-500">Lỗi gần nhất</dt><dd>{proxy.lastError || 'chưa biết'}</dd></div></dl><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!!working} onClick={() => { setWorking(proxy.id); void checkAdminProxy(proxy.id).then(onRefresh).catch(notify).finally(() => setWorking('')); }} className={buttonClass}>Kiểm tra</button><button type="button" disabled={!!working} onClick={() => startEdit(proxy)} className={buttonClass}>Sửa</button><button type="button" disabled={!!working || proxy.assigned > 0} onClick={() => void remove(proxy)} className="rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-xs text-rose-200 disabled:opacity-40">Xóa</button></div></>}
      </article>)}
    </div>
    {proxies.length === 0 && <p className="rounded-xl border border-slate-800 p-8 text-center text-slate-500">{loading ? 'Đang tải…' : 'Chưa có proxy.'}</p>}
  </div>;
}

function UsersTab(props: {
  users: AdminUser[]; allUsers: AdminUser[]; query: string; setQuery: (value: string) => void; loading: boolean;
  activeAdminCount: number; currentUserId: string; onRefresh: () => Promise<void>; onCreate: () => void;
}) {
  const { users, allUsers, query, setQuery, loading, activeAdminCount, currentUserId, onRefresh, onCreate } = props;
  return <div className="space-y-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="relative min-w-[min(100%,16rem)] flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên đăng nhập" className={`${inputClass} w-full pl-8`} /></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void onRefresh()} className={buttonClass} disabled={loading}><RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Tải lại</button><button type="button" onClick={onCreate} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"><Plus className="mr-1 inline h-3.5 w-3.5" /> Tạo người dùng</button></div>
    </div>
    <div className="hidden overflow-x-auto rounded-xl border border-slate-800 md:block">
      <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-slate-950/70 text-slate-400"><tr><th className="px-3 py-3">Người dùng</th><th className="px-3 py-3">Vai trò</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3">Hạn dùng</th><th className="px-3 py-3">Bot / tài khoản</th><th className="px-3 py-3">Đăng nhập cuối</th><th className="px-3 py-3 text-right">Hành động</th></tr></thead><tbody>{users.map((user) => <UserRow key={user.id} user={user} activeAdminCount={activeAdminCount} currentUserId={currentUserId} onDone={onRefresh} />)}</tbody></table>
      {users.length === 0 && <p className="p-8 text-center text-slate-500">{loading ? 'Đang tải…' : 'Không có người dùng phù hợp.'}</p>}
    </div>
    <div className="space-y-3 md:hidden">{users.map((user) => <UserCard key={user.id} user={user} activeAdminCount={activeAdminCount} currentUserId={currentUserId} onDone={onRefresh} />)}{users.length === 0 && <p className="rounded-xl border border-slate-800 p-8 text-center text-slate-500">{loading ? 'Đang tải…' : 'Không có người dùng phù hợp.'}</p>}</div>
    <p className="text-[11px] text-slate-500">{users.length}/{allUsers.length} người dùng · phiên hoạt động được tính theo session chưa hết hạn.</p>
  </div>;
}

function UserRow({ user, activeAdminCount, currentUserId, onDone }: { user: AdminUser; activeAdminCount: number; currentUserId: string; onDone: () => Promise<void> }) {
  const expiry = formatAdminExpiry(user);
  return <tr className="border-t border-slate-800/80 align-top"><td className="px-3 py-3 font-semibold text-slate-100">{user.username}<div className="mt-1 text-[10px] font-normal text-slate-500">Tạo {formatDate(user.createdAt)} · {user.activeSessions} phiên</div></td><td className="px-3 py-3 text-slate-300">{user.role === 'admin' ? 'Quản trị' : 'Người dùng'}</td><td className="px-3 py-3"><span className={user.status === 'active' ? 'text-emerald-300' : 'text-rose-300'}>{user.status === 'active' ? 'Hoạt động' : 'Khóa'}</span></td><td className="px-3 py-3" title={expiry.title}>{expiry.label}</td><td className="px-3 py-3">{user.usage.running} đang chạy · {user.usage.accounts}/{user.usage.maxBots}</td><td className="px-3 py-3 text-slate-400">{formatDate(user.lastLoginAt)}</td><td className="px-3 py-3 text-right"><UserActions user={user} activeAdminCount={activeAdminCount} currentUserId={currentUserId} onDone={onDone} /></td></tr>;
}

function UserCard({ user, activeAdminCount, currentUserId, onDone }: { user: AdminUser; activeAdminCount: number; currentUserId: string; onDone: () => Promise<void> }) {
  const expiry = formatAdminExpiry(user);
  return <article className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-100">{user.username}</h3><p className="mt-1 text-[11px] text-slate-500">{user.role === 'admin' ? 'Quản trị' : 'Người dùng'} · {user.status === 'active' ? 'Hoạt động' : 'Khóa'}</p></div><UserActions user={user} activeAdminCount={activeAdminCount} currentUserId={currentUserId} onDone={onDone} /></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-slate-500">Hạn dùng</dt><dd title={expiry.title} className="text-slate-200">{expiry.label}</dd></div><div><dt className="text-slate-500">Bot / tài khoản</dt><dd className="text-slate-200">{user.usage.running} / {user.usage.accounts}/{user.usage.maxBots}</dd></div><div><dt className="text-slate-500">Đăng nhập cuối</dt><dd className="text-slate-300">{formatDate(user.lastLoginAt)}</dd></div><div><dt className="text-slate-500">Phiên</dt><dd className="text-slate-300">{user.activeSessions}</dd></div></dl></article>;
}

function UserActions({ user, activeAdminCount, currentUserId, onDone }: { user: AdminUser; activeAdminCount: number; currentUserId: string; onDone: () => Promise<void> }) {
  const policy = getAdminActionPolicy(currentUserId, user, activeAdminCount);
  const [working, setWorking] = useState('');
  const [maxBots, setMaxBots] = useState(String(user.maxBots));
  const [expiry, setExpiry] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const run = async (name: string, action: () => Promise<void>) => { setWorking(name); try { await action(); await onDone(); } catch (error) { notify(error); try { await onDone(); } catch { /* danh sách sẽ tự làm mới lần sau */ } } finally { setWorking(''); } };
  const confirmRun = async (name: string, message: string, action: () => Promise<void>, danger = false) => {
    if (working) return;
    setWorking(name);
    try {
      if (await confirmAction(message, { confirmLabel: 'Xác nhận', danger })) { await action(); await onDone(); }
    } catch (error) { notify(error); try { await onDone(); } catch { /* danh sách sẽ tự làm mới lần sau */ } } finally { setWorking(''); }
  };
  const setMax = async (event: React.FormEvent) => { event.preventDefault(); const value = Number(maxBots); if (!Number.isInteger(value) || value < 0 || value > 1000) { notify('maxBots phải là số nguyên trong khoảng 0..1000.'); return; } await confirmRun('maxBots', `Đặt hạn mức bot của ${user.username} thành ${value}?`, () => updateAdminUser(user.id, { maxBots: value })); };
  const setAbsoluteExpiry = async (event: React.FormEvent) => { event.preventDefault(); const value = Date.parse(expiry); if (!Number.isFinite(value)) { notify('Ngày giờ hết hạn không hợp lệ.'); return; } await confirmRun('expiry', `Đặt hạn dùng tuyệt đối cho ${user.username}?`, () => setAdminUserExpiry(user.id, value)); };
  return <>
    <details className="relative inline-block text-left"><summary className="cursor-pointer list-none rounded-lg border border-slate-700 bg-slate-800/70 p-2 text-slate-200 hover:bg-slate-700"><MoreHorizontal className="h-4 w-4" /></summary><div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900 p-2 text-left shadow-2xl">
      <div className="grid grid-cols-3 gap-1 border-b border-slate-800 pb-2"><button type="button" disabled={!policy.canGrant || !!working} onClick={() => void confirmRun('grant-1d', `Cấp thêm 1 ngày cho ${user.username}?`, () => grantAdminUser(user.id, '1d'))} className={buttonClass}>+1 ngày</button><button type="button" disabled={!policy.canGrant || !!working} onClick={() => void confirmRun('grant-7d', `Cấp thêm 1 tuần cho ${user.username}?`, () => grantAdminUser(user.id, '7d'))} className={buttonClass}>+1 tuần</button><button type="button" disabled={!policy.canGrant || !!working} onClick={() => void confirmRun('grant-30d', `Cấp thêm 1 tháng cho ${user.username}?`, () => grantAdminUser(user.id, '30d'))} className={buttonClass}>+1 tháng</button></div>
      <form onSubmit={(event) => void setAbsoluteExpiry(event)} className="flex flex-wrap gap-1 border-b border-slate-800 py-2"><input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} disabled={!policy.canSetExpiry || !!working} className={`${inputClass} min-w-0 flex-1`} /><button type="submit" disabled={!policy.canSetExpiry || !expiry || !!working} className={buttonClass}>Đặt hạn</button></form>
       <button type="button" disabled={!policy.canSetExpiry || !!working} onClick={() => void confirmRun('revoke-expiry', `Thu hồi hạn dùng của ${user.username} ngay bây giờ?`, () => setAdminUserExpiry(user.id, null), true)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-slate-800 disabled:opacity-40">Thu hồi hạn dùng</button>
      <form onSubmit={(event) => void setMax(event)} className="flex gap-1 border-b border-slate-800 py-2"><input type="number" min="0" max="1000" step="1" value={maxBots} onChange={(event) => setMaxBots(event.target.value)} disabled={!policy.canEditMaxBots || !!working} className={`${inputClass} min-w-0 flex-1`} /><button type="submit" disabled={!policy.canEditMaxBots || !!working} className={buttonClass}>Sửa maxBots</button></form>
      <button type="button" disabled={!policy.canLock || !!working} onClick={() => void confirmRun('status', `${user.status === 'active' ? 'Khóa' : 'Mở khóa'} ${user.username}?`, () => updateAdminUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' }), user.status === 'active')} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40">{user.status === 'active' ? 'Khóa người dùng' : 'Mở khóa người dùng'}</button>
      <button type="button" disabled={!policy.canResetPassword || !!working} onClick={() => setResetOpen(true)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40">Đặt lại mật khẩu</button>
      <button type="button" disabled={!policy.canStopBots || !!working} onClick={() => void confirmRun('stop-bots', `Dừng toàn bộ bot của ${user.username}?`, async () => { const stopped = await stopAdminUserBots(user.id); notify(`Đã dừng ${stopped} bot.`, 'success'); })} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-slate-800 disabled:opacity-40">Dừng toàn bộ bot</button>
      <button type="button" disabled={!policy.canRevokeSessions || !!working} onClick={() => void confirmRun('sessions', `Buộc đăng xuất các phiên của ${user.username}?`, async () => { const result = await revokeAdminUserSessions(user.id); notify(`Đã thu hồi ${result.revoked} phiên${result.preservedCurrent ? ' (giữ phiên hiện tại)' : ''}.`, 'success'); })} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-slate-800 disabled:opacity-40">Buộc đăng xuất</button>
      <button type="button" disabled={!policy.canDelete || !!working} onClick={() => setDeleteOpen(true)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-rose-300 hover:bg-slate-800 disabled:opacity-40">Xóa người dùng</button>
      {working && <p className="px-2 py-1.5 text-[11px] text-slate-500">Đang xử lý…</p>}
    </div></details>
    <ResetPasswordModal isOpen={resetOpen} username={user.username} onClose={() => setResetOpen(false)} onSubmit={async (password) => { await run('password', () => resetAdminUserPassword(user.id, password)); setResetOpen(false); }} />
    <DeleteUserModal isOpen={deleteOpen} username={user.username} onClose={() => setDeleteOpen(false)} onSubmit={async () => { await run('delete', () => deleteAdminUser(user.id)); setDeleteOpen(false); }} />
  </>;
}

function AccountsTab({ accounts, proxies, owners, owner, status, setOwner, setStatus, onRefresh, onOpenAccountLog }: { accounts: AccountRuntime[]; proxies: AdminProxy[]; owners: string[]; owner: string; status: string; setOwner: (value: string) => void; setStatus: (value: string) => void; onRefresh: () => Promise<void>; onOpenAccountLog: (id: string) => void }) {
  return <div className="space-y-3"><div className="flex flex-wrap gap-2"><select value={owner} onChange={(event) => setOwner(event.target.value)} className={inputClass}><option value="all">Mọi chủ sở hữu</option>{owners.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}><option value="all">Mọi trạng thái</option><option value="running">Đang chạy</option><option value="stopped">Đã dừng</option><option value="error">Lỗi</option></select><button type="button" onClick={() => void onRefresh()} className={buttonClass}><RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Tải runtime</button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <AccountAdminCard key={account.id} account={account} proxies={proxies} onRefresh={onRefresh} onOpenAccountLog={onOpenAccountLog} />)}</div>{accounts.length === 0 && <p className="rounded-xl border border-slate-800 p-8 text-center text-slate-500">Không có tài khoản phù hợp.</p>}</div>;
}

function AccountAdminCard({ account, proxies, onRefresh, onOpenAccountLog }: { account: AccountRuntime; proxies: AdminProxy[]; onRefresh: () => Promise<void>; onOpenAccountLog: (id: string) => void }) {
  const [working, setWorking] = useState(false);
  const stop = async () => { if (working) return; setWorking(true); try { if (await confirmAction(`Dừng tài khoản ${account.accountName}?`, { confirmLabel: 'Dừng', danger: true })) { await stopBot(account.id); await onRefresh(); } } catch (error) { notify(error); } finally { setWorking(false); } };
  const assign = async (proxyId: string | null) => {
    if (working || account.status === 'running') return;
    setWorking(true);
    try { await setAccountProxy(account.id, proxyId); await onRefresh(); } catch (error) { notify(error); } finally { setWorking(false); }
  };
  const selectableProxies = proxies.filter((proxy) => (proxy.enabled && proxy.status !== 'down') || proxy.id === account.proxy?.id);
  return <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-semibold text-slate-100">{account.accountName}</h3><p className="truncate text-[11px] text-slate-400">Chủ sở hữu: {account.ownerUsername ?? 'chưa biết'}</p></div><span className={`shrink-0 text-xs ${account.status === 'running' ? 'text-emerald-300' : account.status === 'error' ? 'text-rose-300' : 'text-slate-400'}`}>{account.status === 'running' ? 'Đang chạy' : account.status === 'error' ? 'Lỗi' : 'Đã dừng'}</span></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-slate-500">Map</dt><dd className="truncate text-slate-200">{account.mapId || 'chưa biết'}</dd></div><div><dt className="text-slate-500">HP</dt><dd className="text-slate-200">{account.hp === null ? 'chưa biết' : account.hp}</dd></div><div><dt className="text-slate-500">Hurt</dt><dd className="text-slate-200">{account.vendor?.hurtCount ?? 'chưa biết'}</dd></div><div><dt className="text-slate-500">Auto</dt><dd className="text-slate-200">{account.vendor?.autoRequested ? 'Bật' : 'Tắt'}</dd></div><div><dt className="text-slate-500">Kết nối</dt><dd className="truncate text-slate-200">{account.connection || 'chưa biết'}</dd></div></dl><div className="mt-3 space-y-2"><label className="block text-[11px] text-slate-500">Proxy tài khoản<select value={account.proxy?.id ?? ''} disabled={working || account.status === 'running'} onChange={(event) => void assign(event.target.value || null)} className={`${inputClass} mt-1 w-full`}><option value="">Không gán proxy</option>{selectableProxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.label} · {proxy.endpoint}</option>)}</select></label><div className="flex flex-wrap gap-2"><button type="button" disabled={working || account.status !== 'running'} onClick={() => void stop()} className="rounded-lg border border-rose-500/40 bg-rose-600/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200 disabled:opacity-40"><Square className="mr-1 inline h-3.5 w-3.5" /> Dừng</button><button type="button" onClick={() => onOpenAccountLog(account.id)} className={buttonClass}>Mở nhật ký</button></div></div></article>;
}

function AuditTab({ logs, action, user, targetId, setAction, setUser, setTargetId, loading, hasMore, onLoadMore }: { logs: AuditLogEntry[]; action: string; user: string; targetId: string; setAction: (value: string) => void; setUser: (value: string) => void; setTargetId: (value: string) => void; loading: boolean; hasMore: boolean; onLoadMore: () => void }) {
  const actions = Array.from(new Set(logs.map((log) => log.action))).sort();
  return <div className="space-y-3"><div className="flex flex-wrap gap-2"><select value={action} onChange={(event) => setAction(event.target.value)} className={inputClass}><option value="">Mọi hành động</option>{actions.map((item) => <option key={item} value={item}>{auditActionLabel(item)}</option>)}</select><input value={user} onChange={(event) => setUser(event.target.value)} placeholder="Lọc người dùng" className={inputClass} /><input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="Lọc target id" className={`${inputClass} min-w-48`} /><button type="button" onClick={() => { setAction(''); setUser(''); setTargetId(''); }} className={buttonClass}>Xóa lọc</button></div><div className="overflow-x-auto rounded-xl border border-slate-800"><table className="min-w-[800px] w-full text-left text-xs"><thead className="bg-slate-950/70 text-slate-400"><tr><th className="px-3 py-3">Thời gian</th><th className="px-3 py-3">Người thực hiện</th><th className="px-3 py-3">Hành động</th><th className="px-3 py-3">Đối tượng</th><th className="px-3 py-3">Chi tiết</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-t border-slate-800/80 align-top"><td className="whitespace-nowrap px-3 py-3 text-slate-400">{new Date(log.at).toLocaleString()}</td><td className="px-3 py-3">{log.actor?.username ?? 'đã xóa / hệ thống'}</td><td className="px-3 py-3"><span title={log.action}>{auditActionLabel(log.action)}</span></td><td className="px-3 py-3">{log.targetName ? `${log.targetName} · ` : ''}{log.targetType}{log.targetId ? ` · ${log.targetId}` : ''}</td><td className="max-w-md break-words px-3 py-3 text-slate-400">{log.detail ?? '—'}</td></tr>)}</tbody></table>{logs.length === 0 && <p className="p-8 text-center text-slate-500">{loading ? 'Đang tải…' : 'Chưa có dòng phù hợp.'}</p>}</div><div className="flex justify-center"><button type="button" onClick={onLoadMore} disabled={loading || !hasMore} className={buttonClass}>{loading ? 'Đang tải…' : hasMore ? 'Tải thêm' : 'Đã tải hết'}</button></div></div>;
}

function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0c101a] p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3"><h2 className="font-title text-base font-bold text-slate-100">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>{children}</div></div>;
}

function CreateUserModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [maxBots, setMaxBots] = useState('3'); const [show, setShow] = useState(false); const [createdPassword, setCreatedPassword] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  if (!isOpen) return null;
  const close = () => { setUsername(''); setPassword(''); setMaxBots('3'); setShow(false); setCreatedPassword(null); setLoading(false); onClose(); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); const bots = Number(maxBots); if (!username.trim() || password.length < 6 || !Number.isInteger(bots) || bots < 0 || bots > 1000) { notify('Nhập tên, mật khẩu ít nhất 6 ký tự và maxBots trong khoảng 0..1000.'); return; } setLoading(true); try { await createAdminUser({ username: username.trim(), password, maxBots: bots }); setCreatedPassword(password); await onCreated(); } catch (error) { notify(error); } finally { setLoading(false); } };
  const copy = async () => { if (!createdPassword) return; try { await navigator.clipboard.writeText(createdPassword); notify('Đã sao chép mật khẩu.', 'success'); } catch { notify('Không thể sao chép tự động; hãy chọn và sao chép thủ công.'); } };
  return <ModalFrame title="Tạo người dùng" onClose={close}><form onSubmit={(event) => void submit(event)} className="space-y-3 text-xs"><label className="block text-slate-300">Tên đăng nhập<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" className={`${inputClass} mt-1 w-full`} /></label><label className="block text-slate-300">Mật khẩu ban đầu<div className="mt-1 flex gap-1"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className={`${inputClass} min-w-0 flex-1`} /><button type="button" onClick={() => setShow(!show)} className={buttonClass}>{show ? 'Ẩn' : 'Hiện'}</button><button type="button" onClick={() => { try { setPassword(generateRandomPassword()); setShow(true); } catch (error) { notify(error); } }} className={buttonClass}>Tạo ngẫu nhiên</button></div></label><label className="block text-slate-300">maxBots<input type="number" min="0" max="1000" step="1" value={maxBots} onChange={(event) => setMaxBots(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label>{createdPassword && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-100"><p className="font-semibold">Mật khẩu vừa tạo — chỉ hiển thị lần này</p><code className="mt-2 block break-all rounded bg-black/30 p-2 font-mono">{createdPassword}</code><button type="button" onClick={() => void copy()} className="mt-2 rounded-lg border border-emerald-500/40 px-2.5 py-1.5 font-semibold hover:bg-emerald-500/20"><Clipboard className="mr-1 inline h-3.5 w-3.5" /> Sao chép</button></div>}<div className="flex justify-end gap-2 pt-2"><button type="button" onClick={close} className={buttonClass}>Đóng</button><button type="submit" disabled={loading || !!createdPassword} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">{loading ? 'Đang tạo…' : 'Tạo người dùng'}</button></div></form></ModalFrame>;
}

function ResetPasswordModal({ isOpen, username, onClose, onSubmit }: { isOpen: boolean; username: string; onClose: () => void; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState(''); const [show, setShow] = useState(false); const [loading, setLoading] = useState(false); if (!isOpen) return null;
  const close = () => { setPassword(''); setShow(false); setLoading(false); onClose(); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (password.length < 6) { notify('Mật khẩu mới phải có ít nhất 6 ký tự.'); return; } setLoading(true); try { await onSubmit(password); close(); } catch { /* UserActions shows the error. */ } finally { setLoading(false); } };
  return <ModalFrame title={`Đặt lại mật khẩu · ${username}`} onClose={close}><form onSubmit={(event) => void submit(event)} className="space-y-3 text-xs"><label className="block text-slate-300">Mật khẩu mới<div className="mt-1 flex gap-1"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className={`${inputClass} min-w-0 flex-1`} /><button type="button" onClick={() => setShow(!show)} className={buttonClass}>{show ? 'Ẩn' : 'Hiện'}</button><button type="button" onClick={() => { try { setPassword(generateRandomPassword()); setShow(true); } catch (error) { notify(error); } }} className={buttonClass}>Tạo ngẫu nhiên</button></div></label><div className="flex justify-end gap-2"><button type="button" onClick={close} className={buttonClass}>Hủy</button><button type="submit" disabled={loading} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">{loading ? 'Đang lưu…' : 'Đặt lại'}</button></div></form></ModalFrame>;
}

function DeleteUserModal({ isOpen, username, onClose, onSubmit }: { isOpen: boolean; username: string; onClose: () => void; onSubmit: () => Promise<void> }) {
  const [value, setValue] = useState(''); const [loading, setLoading] = useState(false); if (!isOpen) return null;
  const close = () => { setValue(''); setLoading(false); onClose(); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (value !== username) { notify('Tên người dùng xác nhận không khớp.'); return; } setLoading(true); try { if (await confirmAction(`Xóa ${username} sẽ xóa toàn bộ tài khoản game, cấu hình và log của họ. Tiếp tục?`, { confirmLabel: 'Xóa vĩnh viễn', danger: true })) await onSubmit(); } finally { setLoading(false); } };
  return <ModalFrame title={`Xóa người dùng · ${username}`} onClose={close}><form onSubmit={(event) => void submit(event)} className="space-y-3 text-xs"><p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-rose-200">Hành động này sẽ xóa toàn bộ tài khoản game, cấu hình, log và phiên của người dùng. Không thể hoàn tác.</p><label className="block text-slate-300">Gõ lại tên <strong>{username}</strong> để xác nhận<input value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" className={`${inputClass} mt-1 w-full`} /></label><div className="flex justify-end gap-2"><button type="button" onClick={close} className={buttonClass}>Hủy</button><button type="submit" disabled={loading || value !== username} className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">{loading ? 'Đang xóa…' : 'Xóa người dùng'}</button></div></form></ModalFrame>;
}
