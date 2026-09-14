// ---------- 时间 ----------
const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDT = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtT = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtD = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function ageOf(birth: string): string {
  const b = new Date(birth);
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}岁${m}个月` : `${y}岁`;
}

export const parseJSON = <T,>(s: string | null | undefined, fb: T): T => {
  try { return s ? JSON.parse(s) as T : fb; } catch { return fb; }
};

// ---------- 文案映射 ----------
export const ROLE_NAMES: Record<string, string> = {
  frontdesk: '前台', patrol: '巡场', manager: '店长', medical: '医疗点', activity: '活动专员', system: '系统',
};

export const EVENT_TYPES: Record<string, string> = {
  fall: '儿童摔倒', push: '被推搡冲突', equipment_stop: '设备临停',
  lost_child: '走失寻人', card_dispute: '会员卡争议', refund: '退课/退费申请',
};

export const EVENT_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: '待处理', tone: 'bad' },
  processing: { label: '处理中', tone: 'warn' },
  resolved: { label: '已解决', tone: 'info' },
  archived: { label: '已归档', tone: 'ok' },
};

export const SEVERITY: Record<string, { label: string; tone: string }> = {
  low: { label: '轻微', tone: 'info' },
  medium: { label: '一般', tone: 'warn' },
  high: { label: '严重', tone: 'bad' },
};

export const ATTR_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: '开放', tone: 'ok' },
  closed: { label: '关闭', tone: 'bad' },
  maintenance: { label: '维护中', tone: 'warn' },
  emergency_stop: { label: '急停', tone: 'bad' },
};

export const PATROL_STATUS = ['正常', '需关注', '异常'];

export const KIND_META: Record<string, { label: string; icon: string; tone: string }> = {
  status: { label: '状态变更', icon: '⚑', tone: 'info' },
  communication: { label: '家长沟通', icon: '📞', tone: 'info' },
  wristband: { label: '手环定位', icon: '📍', tone: 'info' },
  cctv: { label: '监控调阅', icon: '🎥', tone: 'info' },
  firstaid: { label: '急救箱使用', icon: '🩹', tone: 'bad' },
  disinfection: { label: '消毒记录', icon: '🧴', tone: 'ok' },
  compensation: { label: '会员补偿', icon: '🎁', tone: 'warn' },
  handover: { label: '员工交接', icon: '🔁', tone: 'warn' },
  photo: { label: '现场照片', icon: '📷', tone: 'info' },
  signature: { label: '家长签字', icon: '✍️', tone: 'ok' },
  recheck: { label: '设备复检', icon: '🔧', tone: 'ok' },
  benefit: { label: '权益调整', icon: '💳', tone: 'warn' },
  note: { label: '备注', icon: '📝', tone: 'info' },
};

export const TIMELINE_KIND_OPTIONS = Object.entries(KIND_META)
  .filter(([k]) => k !== 'status')
  .map(([value, v]) => ({ value, label: `${v.icon} ${v.label}` }));

export const MEMBER_TYPE: Record<string, string> = { member: '会员卡', punch: '次卡' };
