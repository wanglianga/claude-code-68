import type {
  Attraction, Checkin, Child, EventDetail, EventItem, Member, Overview,
  Party, PatrolLog, RecommendResult, ReviewResult, SearchAlertItem, User,
} from './types';

const TOKEN_KEY = 'pg_token';
const USER_KEY = 'pg_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = (): User | null => {
  try { const s = localStorage.getItem(USER_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
};
export const storeAuth = (token: string, user: User) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearAuth = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !url.includes('/auth/login')) {
    clearAuth();
    if (!location.pathname.startsWith('/login')) location.href = '/login';
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(url: string) => req<T>('GET', url);
const post = <T,>(url: string, body?: unknown) => req<T>('POST', url, body);
const patch = <T,>(url: string, body?: unknown) => req<T>('PATCH', url, body);

export const api = {
  login: (username: string, password: string) => post<{ token: string; user: User }>('/api/auth/login', { username, password }),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  me: () => get<User>('/api/auth/me'),
  staff: () => get<User[]>('/api/staff'),

  overview: () => get<Overview>('/api/overview'),

  members: (q = '') => get<Member[]>(`/api/members?q=${encodeURIComponent(q)}`),
  member: (id: number) => get<Member>(`/api/members/${id}`),
  children: () => get<Child[]>('/api/children'),
  child: (id: number) => get<Child & { member: Member; active_checkin: Checkin | null; parties: Party[] }>(`/api/children/${id}`),

  attractions: () => get<{ attractions: Attraction[]; occupancy: Record<string, number> }>('/api/attractions'),
  setAttractionStatus: (id: number, status: string) => patch<{ ok: boolean }>(`/api/attractions/${id}`, { status }),
  scanWristband: (wristband_no: string, zone: string) => post<{ ok: boolean }>('/api/wristbands/scan', { wristband_no, zone }),

  activeCheckins: () => get<{ inside_count: number; daily_limit: number; list: Checkin[] }>('/api/checkins/active'),
  nextWristband: () => get<{ wristband_no: string }>('/api/wristbands/next'),
  checkin: (child_id: number, guardian_id: number, wristband_no: string) =>
    post<{ ok: boolean; message: string }>('/api/checkins', { child_id, guardian_id, wristband_no }),
  checkout: (id: number) => post<{ ok: boolean }>(`/api/checkins/${id}/checkout`),

  recommend: (childId: number) => get<RecommendResult>(`/api/recommendations/${childId}`),

  patrolLogs: () => get<PatrolLog[]>('/api/patrol/logs'),
  addPatrolLog: (area: string, status: string, note: string) => post<{ ok: boolean }>('/api/patrol/logs', { area, status, note }),

  events: (status = '', type = '') => get<EventItem[]>(`/api/events?status=${status}&type=${type}`),
  createEvent: (body: { type: string; title: string; description?: string; child_id?: number | null; attraction_id?: number | null; severity?: string }) =>
    post<{ ok: boolean; id: number; code: string }>('/api/events', body),
  eventDetail: (id: number) => get<EventDetail>(`/api/events/${id}`),
  addTimeline: (id: number, kind: string, content: string, meta: Record<string, unknown>) =>
    post<{ ok: boolean }>(`/api/events/${id}/timeline`, { kind, content, meta }),
  setEventStatus: (id: number, status: string) => post<{ ok: boolean }>(`/api/events/${id}/status`, { status }),
  archiveEvent: (id: number, body: unknown) => post<{ ok: boolean }>(`/api/events/${id}/archive`, body),
  alerts: () => get<SearchAlertItem[]>('/api/alerts/active'),
  regenSearchTask: (id: number) => post<{ ok: boolean }>(`/api/events/${id}/search-task`),
  reportFound: (id: number, body: {
    found_zone: string; companion: string; child_state: string;
    need_comfort: boolean; taken_by_other: boolean;
    other_guardian_name?: string; other_guardian_phone?: string;
  }) => post<{ ok: boolean }>(`/api/events/${id}/found`, body),

  review: (params: Record<string, string>) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return get<ReviewResult>(`/api/review${qs ? `?${qs}` : ''}`);
  },

  parties: () => get<Party[]>('/api/parties'),
  createParty: (body: { type: string; title: string; area: string; start_at: string; end_at: string; leader_id?: number }) =>
    post<{ ok: boolean; id: number }>('/api/parties', body),
  addPartyChild: (partyId: number, child_id: number, guardian_id: number) =>
    post<{ ok: boolean }>(`/api/parties/${partyId}/children`, { child_id, guardian_id }),
};
