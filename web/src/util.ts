// ---------- 时间（全场统一按 Asia/Shanghai 展示，与服务端计算口径一致） ----------
function partsInCN(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}
export const fmtDT = (iso?: string | null) => {
  if (!iso) return '—';
  const p = partsInCN(iso);
  return `${p.m}-${p.d} ${p.hh}:${p.mm}`;
};
export const fmtT = (iso?: string | null) => {
  if (!iso) return '—';
  const p = partsInCN(iso);
  return `${p.hh}:${p.mm}`;
};
export const fmtD = (iso?: string | null) => {
  if (!iso) return '—';
  const p = partsInCN(iso);
  return `${p.y}-${p.m}-${p.d}`;
};
/** datetime-local 输入框默认值（Asia/Shanghai 墙钟时间） */
export const cnInputValue = (d: Date) => {
  const p = partsInCN(d.toISOString());
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}`;
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
  frontdesk: '前台', patrol: '巡场', manager: '店长', medical: '医疗点', activity: '活动专员', security: '门口安保', system: '系统',
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
  search: { label: '查找任务', icon: '🔍', tone: 'bad' },
  found: { label: '发现孩子', icon: '🎯', tone: 'ok' },
  settlement: { label: '赔付协商决策', icon: '🤝', tone: 'warn' },
  review: { label: '事故复盘', icon: '🗂️', tone: 'ok' },
  note: { label: '备注', icon: '📝', tone: 'info' },
};

export const TIMELINE_KIND_OPTIONS = Object.entries(KIND_META)
  .filter(([k]) => k !== 'status')
  .map(([value, v]) => ({ value, label: `${v.icon} ${v.label}` }));

export const MEMBER_TYPE: Record<string, string> = { member: '会员卡', punch: '次卡' };

/** 项目 key → 中文名（禁玩项目等场景展示用） */
export const ATTR_KEY_NAMES: Record<string, string> = {
  slide: '滑梯', trampoline: '蹦床', climb: '攀爬网', ballpit: '海洋球池',
};

// ---------- 受伤赔付协商 ----------
export const INJURY_TYPES = ['擦伤', '扭伤', '磕碰', '划伤', '其他'];

export const INJURY_PLANS: Record<string, { label: string; icon: string; desc: string }> = {
  medical_reimburse: { label: '医药费报销', icon: '💰', desc: '门店承担清创/医药费用，金额与凭证登记入档，会员卡计次权益不变' },
  class_compensation: { label: '课时补偿', icon: '🎟️', desc: '按课时补偿直接写入会员卡（次卡加次数，年卡写入权益说明）' },
  continue_observation: { label: '继续观察', icon: '👀', desc: '暂不产生赔付，持续跟踪孩子恢复情况，复盘会照常组织' },
};

export const INJURY_PLAN_LABELS = Object.fromEntries(Object.entries(INJURY_PLANS).map(([k, v]) => [k, v.label]));

export const MARKER_TYPES: Record<string, { label: string; icon: string; hint: string }> = {
  route: { label: '项目动线', icon: '🔀', hint: '如：下梯口正对排队折返动线，儿童冲下即汇入人流' },
  positioning: { label: '员工站位', icon: '🧍', hint: '如：事发时巡场固定在项目顶部，落点无人看护' },
  blindspot: { label: '家长视线盲区', icon: '🙈', hint: '如：家长拍摄/等候位置看不到孩子受伤的角落' },
};

export const INJURY_STAGE: Record<string, { label: string; tone: string }> = {
  collecting: { label: '收集中 · 待店长决策', tone: 'warn' },
  decided: { label: '协商进行中', tone: 'info' },
  done: { label: '协商已闭环', tone: 'ok' },
};
