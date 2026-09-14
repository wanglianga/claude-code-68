import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, seedIfEmpty, generateSearchTask, searchTaskSummary } from './db.js';

seedIfEmpty();

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 8080);
const nowIso = () => new Date().toISOString();
const parse = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };

// ---------- 时间口径：全场统一按 Asia/Shanghai（UTC+8，无夏令时）展示与计算 ----------
const CN_OFFSET_MS = 8 * 3600 * 1000;
const cnDay = (d = new Date()) => new Date(d.getTime() + CN_OFFSET_MS).toISOString().slice(0, 10);
const cnTodayRange = () => {
  const day = cnDay();
  return [new Date(`${day}T00:00:00+08:00`).toISOString(), new Date(`${day}T23:59:59.999+08:00`).toISOString()];
};
const fmtHM = (iso) => new Date(new Date(iso).getTime() + CN_OFFSET_MS).toISOString().slice(11, 16);
const cnHour = (iso) => Number(new Date(new Date(iso).getTime() + CN_OFFSET_MS).toISOString().slice(11, 13));
// 前端 datetime-local / date 等不带时区的输入一律按 Asia/Shanghai 解析
function parseCNDateTime(s, endOfDay = false) {
  if (!s) return null;
  const str = String(s);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str).toISOString();
  const suffix = str.length === 10 ? (endOfDay ? 'T23:59:59.999' : 'T00:00:00') : '';
  return new Date(`${str}${suffix}+08:00`).toISOString();
}

// ---------------- 认证 ----------------
const tokens = new Map(); // token -> userId
const pubUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const uid = tokens.get(t);
  if (!uid) return res.status(401).json({ error: '未登录或登录已过期' });
  const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(uid);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  req.user = user;
  next();
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: '当前角色无权执行此操作' });

// ---------------- 通用查询 ----------------
const getMember = (id) => db.prepare('SELECT * FROM members WHERE id=?').get(id);
const getChild = (id) => db.prepare('SELECT * FROM children WHERE id=?').get(id);
const insideCount = () => db.prepare("SELECT COUNT(*) c FROM checkins WHERE status='inside'").get().c;
const dailyLimit = () => Number(db.prepare("SELECT value FROM settings WHERE key='daily_limit'").get().value);
const occupancy = () => {
  const rows = db.prepare('SELECT zone, COUNT(*) c FROM wristband_locations GROUP BY zone').all();
  return Object.fromEntries(rows.map((r) => [r.zone, r.c]));
};

function addTimeline(eventId, kind, user, content, meta = {}) {
  db.prepare(`INSERT INTO event_timeline (event_id, kind, actor_id, actor_name, actor_role, content, meta, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(eventId, kind, user ? user.id : null, user ? user.name : '系统', user ? user.role : 'system',
      content, JSON.stringify(meta), nowIso());
}

const EVENT_TYPES = { fall: '儿童摔倒', push: '被推搡冲突', equipment_stop: '设备临停', lost_child: '走失寻人', card_dispute: '会员卡争议', refund: '退课/退费申请' };
const TIMELINE_KINDS = ['status', 'communication', 'wristband', 'cctv', 'firstaid', 'disinfection', 'compensation', 'handover', 'photo', 'signature', 'recheck', 'benefit', 'note', 'search', 'found'];

// 进行中走失寻人事件：child_id → 事件编号（用于出园冻结与风险提示）
const lostChildMap = () => {
  const rows = db.prepare(`SELECT child_id, code FROM events
    WHERE type='lost_child' AND status IN ('open','processing') AND child_id IS NOT NULL`).all();
  return new Map(rows.map((r) => [r.child_id, r.code]));
};

// ---------------- 健康检查 / 认证 ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: nowIso() }));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=? AND password=?').get(username || '', password || '');
  if (!u) return res.status(401).json({ error: '用户名或密码错误' });
  const token = crypto.randomUUID();
  tokens.set(token, u.id);
  res.json({ token, user: pubUser(u) });
});
app.get('/api/auth/me', auth, (req, res) => res.json(pubUser(req.user)));
app.post('/api/auth/logout', auth, (req, res) => {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  tokens.delete(t);
  res.json({ ok: true });
});
app.get('/api/staff', auth, (req, res) =>
  res.json(db.prepare('SELECT id, name, role FROM users ORDER BY id').all()));

// ---------------- 总览 ----------------
app.get('/api/overview', auth, (req, res) => {
  const attractions = db.prepare('SELECT * FROM attractions ORDER BY id').all();
  const occ = occupancy();
  const [ds, de] = cnTodayRange();
  const parties = db.prepare(`SELECT * FROM parties WHERE start_at BETWEEN ? AND ? ORDER BY start_at`).all(ds, de)
    .map(withPartyChildren);
  const events = db.prepare(`SELECT status, COUNT(*) c FROM events WHERE status IN ('open','processing') GROUP BY status`).all();
  const active = db.prepare(`
    SELECT ci.*, ch.name AS child_name, ch.height_cm, g.name AS guardian_name, g.phone AS guardian_phone, wl.zone
    FROM checkins ci
    JOIN children ch ON ch.id = ci.child_id
    JOIN guardians g ON g.id = ci.guardian_id
    LEFT JOIN wristband_locations wl ON wl.wristband_no = ci.wristband_no
    WHERE ci.status='inside' ORDER BY ci.checkin_at DESC`).all()
    .map((c) => ({ ...c, lost_frozen: lostChildMap().has(c.child_id) ? 1 : 0, lost_event_code: lostChildMap().get(c.child_id) || null }));
  const patrol = db.prepare('SELECT * FROM patrol_logs ORDER BY created_at DESC LIMIT 6').all();
  res.json({
    inside_count: insideCount(),
    daily_limit: dailyLimit(),
    attractions,
    occupancy: occ,
    open_events: events.find((e) => e.status === 'open')?.c || 0,
    processing_events: events.find((e) => e.status === 'processing')?.c || 0,
    today_parties: parties,
    active_checkins: active,
    recent_patrol: patrol,
  });
});

// ---------------- 会员 / 儿童档案 ----------------
app.get('/api/members', auth, (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const members = db.prepare(`
    SELECT * FROM members
    WHERE card_no LIKE ? OR holder_name LIKE ? OR phone LIKE ?
    ORDER BY id`).all(q, q, q);
  const childStmt = db.prepare('SELECT * FROM children WHERE member_id=?');
  res.json(members.map((m) => ({ ...m, children: childStmt.all(m.id) })));
});

app.get('/api/members/:id', auth, (req, res) => {
  const m = getMember(req.params.id);
  if (!m) return res.status(404).json({ error: '会员不存在' });
  const children = db.prepare('SELECT * FROM children WHERE member_id=?').all(m.id)
    .map((c) => ({ ...c, guardians: db.prepare('SELECT * FROM guardians WHERE child_id=?').all(c.id) }));
  res.json({ ...m, children });
});

app.get('/api/children/:id', auth, (req, res) => {
  const c = getChild(req.params.id);
  if (!c) return res.status(404).json({ error: '儿童不存在' });
  const member = getMember(c.member_id);
  const guardians = db.prepare('SELECT * FROM guardians WHERE child_id=?').all(c.id);
  const checkin = db.prepare(`
    SELECT ci.*, wl.zone FROM checkins ci
    LEFT JOIN wristband_locations wl ON wl.wristband_no = ci.wristband_no
    WHERE ci.child_id=? AND ci.status='inside'`).get(c.id);
  const parties = db.prepare(`
    SELECT p.* FROM parties p JOIN party_children pc ON pc.party_id=p.id
    WHERE pc.child_id=? AND p.end_at >= ? ORDER BY p.start_at`).all(c.id, nowIso()).map(withPartyChildren);
  res.json({ ...c, member, guardians, active_checkin: checkin || null, parties });
});

app.get('/api/children', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, m.card_no, m.holder_name FROM children c JOIN members m ON m.id=c.member_id ORDER BY c.id`).all());
});

// ---------------- 项目 / 手环 ----------------
app.get('/api/attractions', auth, (req, res) => {
  res.json({ attractions: db.prepare('SELECT * FROM attractions ORDER BY id').all(), occupancy: occupancy() });
});

app.patch('/api/attractions/:id', auth, requireRole('patrol', 'manager'), (req, res) => {
  const { status } = req.body || {};
  if (!['open', 'closed', 'maintenance', 'emergency_stop'].includes(status))
    return res.status(400).json({ error: '非法状态' });
  const a = db.prepare('SELECT * FROM attractions WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: '项目不存在' });
  db.prepare('UPDATE attractions SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), a.id);
  res.json({ ok: true });
});

app.post('/api/wristbands/scan', auth, (req, res) => {
  const { wristband_no, zone } = req.body || {};
  if (!wristband_no || !zone) return res.status(400).json({ error: '手环号与区域必填' });
  const ci = db.prepare("SELECT * FROM checkins WHERE wristband_no=? AND status='inside'").get(wristband_no);
  if (!ci) return res.status(400).json({ error: '该手环无在场记录' });
  db.prepare(`INSERT INTO wristband_locations (wristband_no, zone, updated_at) VALUES (?,?,?)
              ON CONFLICT(wristband_no) DO UPDATE SET zone=excluded.zone, updated_at=excluded.updated_at`)
    .run(wristband_no, zone, nowIso());
  res.json({ ok: true });
});

// ---------------- 入园核验 ----------------
app.get('/api/checkins/active', auth, (req, res) => {
  const lost = lostChildMap();
  res.json({
    inside_count: insideCount(),
    daily_limit: dailyLimit(),
    list: db.prepare(`
      SELECT ci.*, ch.name AS child_name, ch.height_cm, g.name AS guardian_name, g.phone AS guardian_phone,
             m.card_no, wl.zone
      FROM checkins ci
      JOIN children ch ON ch.id=ci.child_id
      JOIN guardians g ON g.id=ci.guardian_id
      JOIN members m ON m.id=ci.member_id
      LEFT JOIN wristband_locations wl ON wl.wristband_no=ci.wristband_no
      WHERE ci.status='inside' ORDER BY ci.checkin_at DESC`).all()
      .map((c) => ({ ...c, lost_frozen: lost.has(c.child_id) ? 1 : 0, lost_event_code: lost.get(c.child_id) || null })),
  });
});

// 走失寻人风险提示（前台与门口安保等同一看板）
app.get('/api/alerts/active', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT e.id AS event_id, e.code, e.status, e.created_at,
           ch.id AS child_id, ch.name AS child_name,
           ci.wristband_no, wl.zone AS last_zone
    FROM events e
    JOIN children ch ON ch.id = e.child_id
    LEFT JOIN checkins ci ON ci.child_id = ch.id AND ci.status = 'inside'
    LEFT JOIN wristband_locations wl ON wl.wristband_no = ci.wristband_no
    WHERE e.type = 'lost_child' AND e.status IN ('open','processing')
    ORDER BY e.created_at DESC`).all());
});

app.get('/api/wristbands/next', auth, (req, res) => {
  const rows = db.prepare("SELECT wristband_no FROM checkins WHERE status='inside'").all();
  const used = new Set(rows.map((r) => r.wristband_no));
  for (let i = 101; i < 999; i++) {
    const no = `WB-${i}`;
    if (!used.has(no)) return res.json({ wristband_no: no });
  }
  res.json({ wristband_no: `WB-${Date.now() % 1000}` });
});

app.post('/api/checkins', auth, requireRole('frontdesk', 'manager'), (req, res) => {
  const { child_id, guardian_id, wristband_no } = req.body || {};
  const child = getChild(child_id);
  if (!child) return res.status(400).json({ error: '请选择儿童' });
  const member = getMember(child.member_id);
  const guardian = db.prepare('SELECT * FROM guardians WHERE id=? AND child_id=?').get(guardian_id, child_id);

  // 核验链：会员 → 儿童身份 → 陪同人授权 → 限流 → 手环
  if (!member || member.status !== 'active') return res.status(400).json({ error: '会员卡状态异常（冻结或已过期），禁止入园' });
  if (member.valid_until < nowIso()) return res.status(400).json({ error: '会员卡已过有效期，禁止入园' });
  if (member.type === 'punch' && member.remaining_sessions <= 0)
    return res.status(400).json({ error: `次卡剩余次数不足（剩余 ${member.remaining_sessions} 次），请先续费` });
  if (!guardian) return res.status(400).json({ error: '陪同人与儿童不匹配' });
  if (!guardian.is_authorized)
    return res.status(400).json({ error: `${guardian.name}（${guardian.relation}）未获该儿童陪同授权，仅作紧急联系人，不能陪同入园` });
  if (db.prepare("SELECT 1 FROM checkins WHERE child_id=? AND status='inside'").get(child_id))
    return res.status(400).json({ error: '该儿童当前已在场内，请勿重复核验' });
  if (insideCount() >= dailyLimit())
    return res.status(400).json({ error: `已达当日限流上限（${dailyLimit()} 人），请暂缓入园` });
  if (!wristband_no) return res.status(400).json({ error: '请分配手环号' });
  if (db.prepare("SELECT 1 FROM checkins WHERE wristband_no=? AND status='inside'").get(wristband_no))
    return res.status(400).json({ error: `手环 ${wristband_no} 已被占用` });

  const tx = db.transaction(() => {
    let used = 0;
    if (member.type === 'punch') {
      db.prepare('UPDATE members SET remaining_sessions = remaining_sessions - 1 WHERE id=?').run(member.id);
      used = 1;
    }
    const info = db.prepare(`INSERT INTO checkins (child_id, member_id, guardian_id, wristband_no, sessions_used, status, checkin_at)
                             VALUES (?,?,?,?,?,'inside',?)`)
      .run(child_id, member.id, guardian_id, wristband_no, used, nowIso());
    db.prepare(`INSERT INTO wristband_locations (wristband_no, zone, updated_at) VALUES (?,?,?)
                ON CONFLICT(wristband_no) DO UPDATE SET zone=excluded.zone, updated_at=excluded.updated_at`)
      .run(wristband_no, '入口', nowIso());
    return info.lastInsertRowid;
  });
  const id = tx();
  res.json({ ok: true, id, message: `${child.name} 核验通过，已入园（手环 ${wristband_no}）` });
});

app.post('/api/checkins/:id/checkout', auth, requireRole('frontdesk', 'manager'), (req, res) => {
  const ci = db.prepare("SELECT * FROM checkins WHERE id=? AND status='inside'").get(req.params.id);
  if (!ci) return res.status(404).json({ error: '在场记录不存在' });
  // 走失查找期间自动冻结该儿童手环的出园操作
  const lost = lostChildMap().get(ci.child_id);
  if (lost) {
    return res.status(423).json({ error: `走失寻人进行中（${lost}），该儿童手环出园已冻结，待事件关闭后放行` });
  }
  db.prepare("UPDATE checkins SET status='left', checkout_at=? WHERE id=?").run(nowIso(), ci.id);
  db.prepare('DELETE FROM wristband_locations WHERE wristband_no=?').run(ci.wristband_no);
  res.json({ ok: true });
});

// ---------------- 游玩推荐 ----------------
app.get('/api/recommendations/:childId', auth, (req, res) => {
  const child = getChild(req.params.childId);
  if (!child) return res.status(404).json({ error: '儿童不存在' });
  const banned = parse(child.banned, []);
  const attrs = db.prepare('SELECT * FROM attractions WHERE is_facility=0 ORDER BY id').all();
  const occ = occupancy();
  const [ds, de] = cnTodayRange();
  const parties = db.prepare('SELECT * FROM parties WHERE start_at BETWEEN ? AND ?').all(ds, de);
  const statusText = { open: '开放', closed: '已关闭', maintenance: '维护中', emergency_stop: '急停中' };

  const eligible = [];
  const blocked = [];
  for (const a of attrs) {
    if (banned.includes(a.key)) { blocked.push({ attraction: a, reasons: ['已列入该儿童禁玩项目（家长登记）'] }); continue; }
    if (a.status !== 'open') { blocked.push({ attraction: a, reasons: [`设备当前状态：${statusText[a.status]}`] }); continue; }
    if (a.min_height != null && child.height_cm < a.min_height) { blocked.push({ attraction: a, reasons: [`身高 ${child.height_cm}cm 低于最低要求 ${a.min_height}cm`] }); continue; }
    if (a.max_height != null && child.height_cm > a.max_height) { blocked.push({ attraction: a, reasons: [`身高 ${child.height_cm}cm 超过上限 ${a.max_height}cm`] }); continue; }
    const count = occ[a.key] || 0;
    const ratio = a.capacity ? count / a.capacity : 0;
    const reasons = [
      `身高 ${child.height_cm}cm 符合 ${a.min_height ?? 0}–${a.max_height ?? '不限'}cm 要求`,
      `当前 ${count}/${a.capacity} 人，${ratio < 0.5 ? '人较少，优先推荐' : ratio < 0.85 ? '人流适中' : '接近满载，建议错峰'}`,
    ];
    const hits = parties.filter((p) => p.area.includes(a.name));
    const partyNotes = hits.map((p) => `${fmtHM(p.start_at)}–${fmtHM(p.end_at)}「${p.title}」（负责人 ${p.leader_name}）`);
    if (partyNotes.length) reasons.push(`活动安排提示：${partyNotes.join('；')}，建议错峰`);
    eligible.push({ attraction: a, occupancy: count, ratio, reasons, parties: partyNotes });
  }
  eligible.sort((x, y) => x.ratio - y.ratio);
  res.json({ child: { ...child, banned }, eligible, blocked });
});

// ---------------- 巡场 ----------------
app.get('/api/patrol/logs', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM patrol_logs ORDER BY created_at DESC LIMIT 50').all());
});
app.post('/api/patrol/logs', auth, requireRole('patrol', 'manager'), (req, res) => {
  const { area, status, note = '' } = req.body || {};
  if (!area || !status) return res.status(400).json({ error: '区域与状态必填' });
  const info = db.prepare('INSERT INTO patrol_logs (area, status, note, staff_id, staff_name, created_at) VALUES (?,?,?,?,?,?)')
    .run(area, status, note, req.user.id, req.user.name, nowIso());
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ---------------- 事件中心 ----------------
function withPartyChildren(p) {
  const children = db.prepare(`
    SELECT pc.child_id, ch.name AS child_name, ch.height_cm, ch.allergies,
           g.id AS guardian_id, g.name AS guardian_name, g.relation, g.phone AS guardian_phone, g.is_authorized
    FROM party_children pc
    JOIN children ch ON ch.id = pc.child_id
    JOIN guardians g ON g.id = pc.guardian_id
    WHERE pc.party_id=?`).all(p.id);
  return { ...p, children };
}

app.get('/api/events', auth, (req, res) => {
  const { status, type } = req.query;
  let sql = `SELECT e.*, ch.name AS child_name, a.name AS attraction_name
             FROM events e
             LEFT JOIN children ch ON ch.id=e.child_id
             LEFT JOIN attractions a ON a.id=e.attraction_id WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND e.status=?'; args.push(status); }
  if (type) { sql += ' AND e.type=?'; args.push(type); }
  sql += ' ORDER BY e.created_at DESC';
  res.json(db.prepare(sql).all(...args));
});

app.post('/api/events', auth, (req, res) => {
  const { type, title, description = '', child_id = null, attraction_id = null, severity = 'medium' } = req.body || {};
  if (!EVENT_TYPES[type]) return res.status(400).json({ error: '非法事件类型' });
  if (!title) return res.status(400).json({ error: '事件标题必填' });
  const child = child_id ? getChild(child_id) : null;
  const member_id = child ? child.member_id : (req.body.member_id || null);
  const dstr = cnDay().replace(/-/g, '');
  const seq = db.prepare("SELECT COUNT(*) c FROM events WHERE code LIKE ?").get(`EV-${dstr}-%`).c + 1;
  const code = `EV-${dstr}-${String(seq).padStart(4, '0')}`;
  const info = db.prepare(`INSERT INTO events (code, type, title, description, child_id, member_id, attraction_id, severity, status, created_by_id, created_by_name, created_at)
                           VALUES (?,?,?,?,?,?,?,?,'open',?,?,?)`)
    .run(code, type, title, description, child_id, member_id, attraction_id, severity, req.user.id, req.user.name, nowIso());
  const id = info.lastInsertRowid;
  addTimeline(id, 'status', req.user, `事件创建（${EVENT_TYPES[type]}）：${title}`);
  if (child) {
    const ci = db.prepare("SELECT * FROM checkins WHERE child_id=? AND status='inside'").get(child.id);
    if (ci) {
      const loc = db.prepare('SELECT * FROM wristband_locations WHERE wristband_no=?').get(ci.wristband_no);
      addTimeline(id, 'wristband', null, `手环 ${ci.wristband_no} 当前定位：${loc ? loc.zone : '未知'}`,
        { wristband_no: ci.wristband_no, zone: loc ? loc.zone : null });
    }
  }
  // 走失寻人：自动生成查找任务并冻结该儿童手环出园
  if (type === 'lost_child' && child) {
    const task = generateSearchTask({ id, child_id: child.id });
    addTimeline(id, 'search', req.user, `已生成查找任务：${searchTaskSummary(task)}`, { task_id: task.id });
    addTimeline(id, 'status', null, `该儿童手环出园操作已自动冻结，待事件关闭后放行`);
  }
  res.json({ ok: true, id, code });
});

app.get('/api/events/:id', auth, (req, res) => {
  const e = db.prepare(`SELECT e.*, a.name AS attraction_name FROM events e
                        LEFT JOIN attractions a ON a.id=e.attraction_id WHERE e.id=?`).get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  const timeline = db.prepare('SELECT * FROM event_timeline WHERE event_id=? ORDER BY created_at, id').all(e.id);
  let child = null, member = null, guardians = [], parties = [];
  if (e.child_id) {
    child = getChild(e.child_id);
    member = getMember(e.member_id);
    guardians = db.prepare('SELECT * FROM guardians WHERE child_id=?').all(e.child_id);
    parties = db.prepare(`
      SELECT p.* FROM parties p JOIN party_children pc ON pc.party_id=p.id
      WHERE pc.child_id=? AND p.end_at >= ? ORDER BY p.start_at`).all(e.child_id, nowIso()).map(withPartyChildren);
  } else if (e.member_id) {
    member = getMember(e.member_id);
  }
  let search_task = null, found_report = null;
  if (e.type === 'lost_child') {
    search_task = db.prepare('SELECT * FROM search_tasks WHERE event_id=? ORDER BY id DESC LIMIT 1').get(e.id) || null;
    found_report = db.prepare('SELECT * FROM found_reports WHERE event_id=? ORDER BY id DESC LIMIT 1').get(e.id) || null;
  }
  res.json({ event: e, timeline, child, member, guardians, parties, search_task, found_report });
});

// 走失查找任务：按最新信息重新生成
app.post('/api/events/:id/search-task', auth, requireRole('patrol', 'manager', 'frontdesk'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  if (e.type !== 'lost_child') return res.status(400).json({ error: '仅走失寻人事件可生成查找任务' });
  if (['resolved', 'archived'].includes(e.status)) return res.status(400).json({ error: '事件已关闭，无需再查找' });
  const task = generateSearchTask(e);
  addTimeline(e.id, 'search', req.user, `重新生成查找任务：${searchTaskSummary(task)}`, { task_id: task.id });
  res.json({ ok: true, task });
});

// 发现孩子登记：记录后事件才能关闭
app.post('/api/events/:id/found', auth, requireRole('patrol', 'manager'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  if (e.type !== 'lost_child') return res.status(400).json({ error: '仅走失寻人事件可登记发现信息' });
  if (['resolved', 'archived'].includes(e.status)) return res.status(400).json({ error: '事件已关闭' });
  const {
    found_zone, companion, child_state,
    need_comfort = false, taken_by_other = false,
    other_guardian_name = '', other_guardian_phone = '',
  } = req.body || {};
  if (!found_zone || !companion || !child_state)
    return res.status(400).json({ error: '发现地点、陪同人、孩子状态均为必填' });
  if (taken_by_other && !String(other_guardian_name).trim())
    return res.status(400).json({ error: '孩子曾被其他家长带离项目区时，必须记录对方监护人' });

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO found_reports (event_id, found_zone, companion, child_state, need_comfort, taken_by_other,
                                           other_guardian_name, other_guardian_phone, recorded_by_id, recorded_by_name, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(e.id, found_zone, companion, child_state, need_comfort ? 1 : 0, taken_by_other ? 1 : 0,
        taken_by_other ? other_guardian_name : null, taken_by_other ? other_guardian_phone : null,
        req.user.id, req.user.name, nowIso());
    db.prepare("UPDATE search_tasks SET status='found' WHERE event_id=? AND status='searching'").run(e.id);
    addTimeline(e.id, 'found', req.user,
      `发现孩子：地点 ${found_zone}；陪同人 ${companion}；孩子状态 ${child_state}；${need_comfort ? '需要安抚' : '无需安抚'}`,
      { found_zone, companion, child_state, need_comfort: !!need_comfort });
    if (taken_by_other) {
      addTimeline(e.id, 'note', req.user,
        `孩子曾被其他家长带离项目区：对方监护人 ${other_guardian_name}（${other_guardian_phone || '电话未留'}），已下发巡场提醒`,
        { other_guardian_name, other_guardian_phone });
      db.prepare('INSERT INTO patrol_logs (area, status, note, staff_id, staff_name, created_at) VALUES (?,?,?,?,?,?)')
        .run('出口', '需关注',
          `走失事件 ${e.code}：孩子曾被其他家长带离项目区，对方监护人 ${other_guardian_name}（${other_guardian_phone || '-'}），请各出口岗核对陪同授权后再放行`,
          req.user.id, req.user.name, nowIso());
    }
    if (e.status === 'open') {
      db.prepare("UPDATE events SET status='processing' WHERE id=?").run(e.id);
      addTimeline(e.id, 'status', null, '孩子已找到，事件转为处理中，待确认后关闭');
    }
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/events/:id/timeline', auth, (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  if (e.status === 'archived') return res.status(400).json({ error: '事件已归档，不能再追加记录' });
  const { kind, content = '', meta = {} } = req.body || {};
  if (!TIMELINE_KINDS.includes(kind)) return res.status(400).json({ error: '非法记录类型' });
  if (!content.trim()) return res.status(400).json({ error: '内容必填' });
  addTimeline(e.id, kind, req.user, content, meta);
  // 手环定位记录同步更新实时位置
  if (kind === 'wristband' && meta.wristband_no && meta.zone) {
    db.prepare(`INSERT INTO wristband_locations (wristband_no, zone, updated_at) VALUES (?,?,?)
                ON CONFLICT(wristband_no) DO UPDATE SET zone=excluded.zone, updated_at=excluded.updated_at`)
      .run(meta.wristband_no, meta.zone, nowIso());
  }
  res.json({ ok: true });
});

app.post('/api/events/:id/status', auth, (req, res) => {
  const { status } = req.body || {};
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  const label = { processing: '处理中', resolved: '已解决', open: '待处理' }[status];
  if (!label) return res.status(400).json({ error: '非法状态' });
  if (status === 'resolved' && !['manager', 'medical'].includes(req.user.role))
    return res.status(403).json({ error: '仅店长或医疗点可标记解决' });
  if (e.status === 'archived') return res.status(400).json({ error: '事件已归档' });
  // 走失寻人：必须先登记发现信息才能关闭
  if (status === 'resolved' && e.type === 'lost_child') {
    const fr = db.prepare('SELECT 1 FROM found_reports WHERE event_id=?').get(e.id);
    if (!fr) return res.status(400).json({ error: '走失寻人事件须先由巡场登记发现信息（发现地点/陪同人/孩子状态/是否安抚）才能关闭' });
  }
  db.prepare('UPDATE events SET status=?, resolved_at=COALESCE(resolved_at, ?) WHERE id=?')
    .run(status, status === 'resolved' ? nowIso() : null, e.id);
  addTimeline(e.id, 'status', req.user, `事件状态变更为「${label}」`);
  res.json({ ok: true });
});

// 归档资料适用规则：1=适用（必须提供资料或明确结论），0=不适用（留空时自动生成结论）
const ARCHIVE_RULES = {
  fall:            { photos: 1, cctv: 1, parent_signature: 1, compensation: 1, recheck: 0, benefit_adjustment: 0 },
  push:            { photos: 1, cctv: 1, parent_signature: 1, compensation: 0, recheck: 0, benefit_adjustment: 0 },
  equipment_stop:  { photos: 1, cctv: 1, parent_signature: 0, compensation: 0, recheck: 1, benefit_adjustment: 1 },
  lost_child:      { photos: 0, cctv: 1, parent_signature: 1, compensation: 0, recheck: 0, benefit_adjustment: 0 },
  card_dispute:    { photos: 0, cctv: 0, parent_signature: 1, compensation: 1, recheck: 0, benefit_adjustment: 1 },
  refund:          { photos: 0, cctv: 0, parent_signature: 1, compensation: 1, recheck: 0, benefit_adjustment: 1 },
};
const MATERIAL_LABELS = {
  photos: '现场照片', cctv: '监控时间段', parent_signature: '家长签字',
  compensation: '赔付方案', recheck: '设备复检', benefit_adjustment: '会员权益调整',
};
const sectionEmpty = (key, val) => {
  if (val == null) return true;
  if (key === 'photos' || key === 'cctv') return !Array.isArray(val) || val.length === 0;
  if (key === 'recheck') return !(val.result && String(val.result).trim());
  if (key === 'benefit_adjustment') return !(Number(val.add_sessions) > 0 || (val.note && String(val.note).trim()));
  return !String(val).trim();
};

app.post('/api/events/:id/archive', auth, requireRole('manager'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  if (e.status === 'archived') return res.status(400).json({ error: '事件已归档' });
  if (e.status !== 'resolved') {
    const label = { open: '待处理', processing: '处理中' }[e.status] || e.status;
    return res.status(400).json({ error: `仅「已解决」状态的事件可归档（当前：${label}），请先完成处置并标记解决` });
  }
  const body = req.body || {};
  const conclusionsIn = body.conclusions || {};
  const rules = ARCHIVE_RULES[e.type] || {};
  const typeLabel = EVENT_TYPES[e.type] || e.type;

  const materials = {
    photos: (Array.isArray(body.photos) ? body.photos : []).map((s) => String(s).trim()).filter(Boolean),
    cctv: (Array.isArray(body.cctv) ? body.cctv : []).filter((c) => c && (c.camera || c.start || c.end || c.note)),
    parent_signature: String(body.parent_signature || '').trim(),
    compensation: String(body.compensation || '').trim(),
    recheck: body.recheck && String(body.recheck.result || '').trim()
      ? { result: String(body.recheck.result).trim(), inspector: String(body.recheck.inspector || '').trim() } : null,
    benefit_adjustment: body.benefit_adjustment && (Number(body.benefit_adjustment.add_sessions) > 0 || String(body.benefit_adjustment.note || '').trim())
      ? { add_sessions: Number(body.benefit_adjustment.add_sessions) || 0, note: String(body.benefit_adjustment.note || '').trim() } : null,
  };

  // 校验：适用项必须提供真实资料（不接受任何结论替代）；仅不适用项允许保存明确结论
  const missing = [];
  const conclusions = {};
  for (const key of Object.keys(MATERIAL_LABELS)) {
    if (!sectionEmpty(key, materials[key])) continue; // 已提供真实资料
    if (rules[key]) {
      missing.push(MATERIAL_LABELS[key]); // 适用项缺失：结论不能替代
    } else {
      const c = String(conclusionsIn[key] || '').trim();
      conclusions[key] = c || `本事件类型（${typeLabel}）不适用，无需提供`;
    }
  }
  if (missing.length) {
    return res.status(400).json({
      error: `归档资料不完整：${missing.join('、')} 缺失。适用资料必须提供真实材料，不能用结论替代`,
      missing,
    });
  }

  const tx = db.transaction(() => {
    let applied = null;
    if (materials.benefit_adjustment && materials.benefit_adjustment.add_sessions > 0 && e.member_id) {
      const n = materials.benefit_adjustment.add_sessions;
      db.prepare('UPDATE members SET remaining_sessions = remaining_sessions + ? WHERE id=?').run(n, e.member_id);
      applied = { add_sessions: n, applied_to: getMember(e.member_id).card_no, note: materials.benefit_adjustment.note };
    }
    const archive = {
      ...materials,
      benefit_adjustment: applied || materials.benefit_adjustment,
      conclusions,
      archived_by: req.user.name,
      archived_at: nowIso(),
    };
    db.prepare(`UPDATE events SET status='archived', archive=?, resolved_at=COALESCE(resolved_at, ?) WHERE id=?`)
      .run(JSON.stringify(archive), nowIso(), e.id);
    if (archive.photos.length) addTimeline(e.id, 'photo', req.user, `现场照片归档 ${archive.photos.length} 张：${archive.photos.join('、')}`, { photos: archive.photos });
    for (const c of archive.cctv) addTimeline(e.id, 'cctv', req.user, `监控时间段归档：摄像头 ${c.camera || '-'} ${c.start || ''}–${c.end || ''}${c.note ? `（${c.note}）` : ''}`, c);
    if (archive.parent_signature) addTimeline(e.id, 'signature', req.user, `家长签字确认：${archive.parent_signature}`);
    if (archive.compensation) addTimeline(e.id, 'compensation', req.user, `赔付方案：${archive.compensation}`);
    if (archive.recheck) addTimeline(e.id, 'recheck', req.user, `设备复检：${archive.recheck.result}（复检人：${archive.recheck.inspector || '-'}）`, archive.recheck);
    if (archive.benefit_adjustment) addTimeline(e.id, 'benefit', req.user,
      `会员权益调整：${archive.benefit_adjustment.applied_to ? `会员卡 ${archive.benefit_adjustment.applied_to} 补偿 ${archive.benefit_adjustment.add_sessions} 次；` : ''}${archive.benefit_adjustment.note || ''}`,
      archive.benefit_adjustment);
    const conclEntries = Object.entries(conclusions);
    if (conclEntries.length) addTimeline(e.id, 'note', req.user, `归档结论：${conclEntries.map(([k, v]) => `${MATERIAL_LABELS[k]}—${v}`).join('；')}`, conclusions);
    addTimeline(e.id, 'status', req.user, '事件归档完成，进入安全档案');
  });
  tx();
  res.json({ ok: true });
});

// ---------------- 店长复盘 ----------------
app.get('/api/review', auth, requireRole('manager'), (req, res) => {
  const { from, to, attraction_id, staff } = req.query;
  let sql = `SELECT DISTINCT e.*, a.name AS attraction_name, ch.name AS child_name
             FROM events e
             LEFT JOIN attractions a ON a.id=e.attraction_id
             LEFT JOIN children ch ON ch.id=e.child_id`;
  const args = [];
  const cond = [];
  if (from) { cond.push('e.created_at >= ?'); args.push(parseCNDateTime(from)); }
  if (to) { cond.push('e.created_at <= ?'); args.push(parseCNDateTime(to, true)); }
  if (attraction_id) { cond.push('e.attraction_id = ?'); args.push(Number(attraction_id)); }
  if (staff) {
    sql += ` JOIN event_timeline t ON t.event_id = e.id`;
    cond.push('(t.actor_name LIKE ? OR e.created_by_name LIKE ?)');
    args.push(`%${staff}%`, `%${staff}%`);
  }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY e.created_at DESC';
  const events = db.prepare(sql).all(...args);

  const byType = {}, byAttraction = {}, byHour = {}, bySeverity = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byAttraction[e.attraction_name || '未关联项目'] = (byAttraction[e.attraction_name || '未关联项目'] || 0) + 1;
    const h = `${cnHour(e.created_at)}时`;
    byHour[h] = (byHour[h] || 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
  }
  const staffRows = events.length
    ? db.prepare(`SELECT actor_name, actor_role, COUNT(*) c FROM event_timeline
                  WHERE event_id IN (${events.map(() => '?').join(',')}) AND actor_role != 'system'
                  GROUP BY actor_name, actor_role ORDER BY c DESC`)
        .all(...events.map((e) => e.id))
    : [];
  res.json({ events, stats: { byType, byAttraction, byHour, bySeverity, staff: staffRows } });
});

// ---------------- 生日会 / 托管班 ----------------
app.get('/api/parties', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM parties ORDER BY start_at DESC').all();
  res.json(rows.map(withPartyChildren));
});

app.post('/api/parties', auth, requireRole('frontdesk', 'manager', 'activity'), (req, res) => {
  const { type, title, area = '', start_at, end_at, leader_id } = req.body || {};
  if (!['birthday', 'daycare'].includes(type)) return res.status(400).json({ error: '活动类型须为生日会或托管班' });
  if (!title || !start_at || !end_at) return res.status(400).json({ error: '标题与起止时间必填' });
  const leader = leader_id ? db.prepare('SELECT * FROM users WHERE id=?').get(leader_id) : req.user;
  const startIso = parseCNDateTime(start_at);
  const endIso = parseCNDateTime(end_at);
  if (!startIso || !endIso) return res.status(400).json({ error: '起止时间格式不正确' });
  const info = db.prepare(`INSERT INTO parties (type, title, leader_id, leader_name, area, start_at, end_at, status)
                           VALUES (?,?,?,?,?,?,?,'scheduled')`)
    .run(type, title, leader.id, leader.name, area, startIso, endIso);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.post('/api/parties/:id/children', auth, requireRole('frontdesk', 'manager', 'activity'), (req, res) => {
  const p = db.prepare('SELECT * FROM parties WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '活动不存在' });
  const { child_id, guardian_id } = req.body || {};
  const child = getChild(child_id);
  if (!child) return res.status(400).json({ error: '请选择儿童' });
  const g = db.prepare('SELECT * FROM guardians WHERE id=? AND child_id=?').get(guardian_id, child_id);
  if (!g) return res.status(400).json({ error: '监护人与儿童不匹配' });
  if (!g.is_authorized) return res.status(400).json({ error: `${g.name} 未获陪同授权，不能登记为该儿童活动监护人` });
  try {
    db.prepare('INSERT INTO party_children (party_id, child_id, guardian_id) VALUES (?,?,?)').run(p.id, child_id, guardian_id);
  } catch {
    return res.status(400).json({ error: '该儿童已在活动名单中' });
  }
  res.json({ ok: true });
});

// ---------------- 静态资源（前端构建产物） ----------------
const dist = path.join(process.cwd(), 'web', 'dist');
app.use(express.static(dist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) next(); });
});

// ---------------- 错误处理 ----------------
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => console.log(`[server] 游乐场安全运营平台已启动: http://0.0.0.0:${PORT}`));
