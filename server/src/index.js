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
const TIMELINE_KINDS = ['status', 'communication', 'wristband', 'cctv', 'firstaid', 'disinfection', 'compensation', 'handover', 'photo', 'signature', 'recheck', 'benefit', 'note', 'search', 'found', 'settlement', 'review'];

// ---------- 受伤赔付协商 ----------
const INJURY_PLANS = {
  medical_reimburse: '医药费报销',
  class_compensation: '课时补偿',
  continue_observation: '继续观察',
};
const MARKER_TYPES = { route: '项目动线', positioning: '员工站位', blindspot: '家长视线盲区' };
const TASK_LABELS = { parent_confirm: '家长确认', staff_review: '员工复盘', patrol_followup: '复盘巡场待办' };

const getInjuryCase = (id) => db.prepare('SELECT * FROM injury_cases WHERE id=?').get(id);
const injuryCaseByEvent = (eventId) =>
  db.prepare('SELECT * FROM injury_cases WHERE event_id=? ORDER BY id DESC LIMIT 1').get(eventId);
const openTaskCount = (type, refId) =>
  db.prepare("SELECT COUNT(*) c FROM staff_tasks WHERE type=? AND ref_id=? AND status='open'").get(type, refId).c;

/**
 * 店长决策落地到会员卡：
 * - 课时补偿：次卡直接加次数，会员卡写入权益说明；
 * - 医药费报销 / 继续观察：不改计次权益，仅在会员卡 benefits 留赔付记录（便于档案追溯）。
 */
function applyInjuryBenefit(memberId, plan, classSessions, medicalFee) {
  const m = getMember(memberId);
  if (!m) return null;
  const benefits = parse(m.benefits, {});
  const records = Array.isArray(benefits['赔付记录']) ? benefits['赔付记录'] : [];
  let applied = 0;
  if (plan === 'class_compensation' && classSessions > 0) {
    if (m.type === 'punch') {
      db.prepare('UPDATE members SET remaining_sessions = remaining_sessions + ? WHERE id=?').run(classSessions, m.id);
    }
    records.push(`课时补偿 ${classSessions} 节（受伤赔付协商）`);
    const total = records.filter((r) => r.startsWith('课时补偿')).reduce((n, r) => n + (Number(r.match(/(\d+)\s*节/)?.[1]) || 0), 0);
    benefits['赔付记录'] = records;
    benefits['剩余权益说明'] = m.type === 'punch'
      ? `次卡按次扣减；含受伤赔付课时补偿共 ${total} 节`
      : `${benefits['剩余权益说明'] ? benefits['剩余权益说明'] + '；' : ''}含受伤赔付课时补偿共 ${total} 节`;
    applied = 1;
  } else if (plan === 'medical_reimburse' && medicalFee > 0) {
    records.push(`医药费报销 ${Number(medicalFee).toFixed(2)} 元（受伤赔付协商）`);
    benefits['赔付记录'] = records;
  }
  if (records.length) db.prepare('UPDATE members SET benefits=? WHERE id=?').run(JSON.stringify(benefits), m.id);
  return { card_no: m.card_no, benefits, applied };
}

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
  const restricted = db.prepare("SELECT id, name, control_reason, control_rule FROM attractions WHERE is_facility=0 AND control_status='restricted'").all();
  const pendingInjuries = db.prepare('SELECT COUNT(*) c FROM injury_cases WHERE plan IS NULL').get().c;
  const openPatrolTasks = db.prepare("SELECT COUNT(*) c FROM staff_tasks WHERE type='patrol_followup' AND status='open'").get().c;
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
    restricted_attractions: restricted,
    pending_injury_count: pendingInjuries,
    open_patrol_task_count: openPatrolTasks,
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
  // 游玩项目的临停/恢复必须走处理单流程，保证受影响儿童分流与安全复检
  if (!a.is_facility && ['maintenance', 'emergency_stop'].includes(status))
    return res.status(400).json({ error: '请通过「设备临停分流」发起临停（POST /api/attractions/:id/stop），自动生成处理单' });
  if (!a.is_facility && status === 'open' && ['maintenance', 'emergency_stop'].includes(a.status))
    return res.status(400).json({ error: '请在临停处理单中完成检修照片与负责人确认后恢复开放（补券不能替代安全复检）' });
  db.prepare('UPDATE attractions SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), a.id);
  res.json({ ok: true });
});

// 设备临停：生成处理单，快照受影响儿童（在场定位 + 排队）
app.post('/api/attractions/:id/stop', auth, requireRole('patrol', 'manager'), (req, res) => {
  const a = db.prepare('SELECT * FROM attractions WHERE id=?').get(req.params.id);
  if (!a || a.is_facility) return res.status(404).json({ error: '游玩项目不存在' });
  const { reason = '', stop_status = 'maintenance' } = req.body || {};
  if (!['maintenance', 'emergency_stop'].includes(stop_status))
    return res.status(400).json({ error: '临停状态须为 maintenance 或 emergency_stop' });
  if (['maintenance', 'emergency_stop'].includes(a.status))
    return res.status(400).json({ error: '该项目已处于临停状态，请直接处理现有处理单' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE attractions SET status=?, updated_at=? WHERE id=?').run(stop_status, nowIso(), a.id);
    // 受影响儿童：手环当前定位在该项目的在场儿童 + 该项目排队儿童
    const zoneKids = db.prepare(`
      SELECT ch.id AS child_id, ch.name, ch.height_cm, ci.wristband_no, m.id AS member_id, m.card_no, '在场' AS source
      FROM wristband_locations wl
      JOIN checkins ci ON ci.wristband_no = wl.wristband_no AND ci.status='inside'
      JOIN children ch ON ch.id = ci.child_id
      JOIN members m ON m.id = ci.member_id
      WHERE wl.zone = ?`).all(a.name);
    const queueKids = db.prepare(`
      SELECT ch.id AS child_id, ch.name, ch.height_cm, ci.wristband_no, m.id AS member_id, m.card_no, '排队' AS source
      FROM queue_entries q
      JOIN children ch ON ch.id = q.child_id
      LEFT JOIN checkins ci ON ci.child_id = ch.id AND ci.status='inside'
      LEFT JOIN members m ON m.id = ch.member_id
      WHERE q.attraction_id = ? AND q.status = 'waiting'`).all(a.id);
    const seen = new Set();
    const affected = [...zoneKids, ...queueKids].filter((k) => !seen.has(k.child_id) && seen.add(k.child_id));
    const dstr = cnDay().replace(/-/g, '');
    const seq = db.prepare("SELECT COUNT(*) c FROM stop_tickets WHERE code LIKE ?").get(`ST-${dstr}-%`).c + 1;
    const code = `ST-${dstr}-${String(seq).padStart(4, '0')}`;
    const info = db.prepare(`INSERT INTO stop_tickets (code, attraction_id, status, reason, affected, created_by_id, created_by_name, created_at)
                             VALUES (?,?, 'open', ?,?,?,?,?)`)
      .run(code, a.id, reason || '设备临时检修', JSON.stringify(affected), req.user.id, req.user.name, nowIso());
    const ticketId = info.lastInsertRowid;
    db.prepare("UPDATE queue_entries SET ticket_id=? WHERE attraction_id=? AND status='waiting'").run(ticketId, a.id);
    return { ticketId, code, affected: affected.length };
  });
  res.json({ ok: true, ...tx() });
});

// 恢复开放：必须有检修照片 + 负责人确认（补券不能替代安全复检）
app.post('/api/attractions/:id/reopen', auth, requireRole('patrol', 'manager'), (req, res) => {
  const a = db.prepare('SELECT * FROM attractions WHERE id=?').get(req.params.id);
  if (!a || a.is_facility) return res.status(404).json({ error: '游玩项目不存在' });
  if (!['maintenance', 'emergency_stop'].includes(a.status))
    return res.status(400).json({ error: '该项目当前不在临停状态' });
  const ticket = db.prepare("SELECT * FROM stop_tickets WHERE attraction_id=? AND status='open' ORDER BY id DESC").get(a.id);
  if (!ticket) return res.status(400).json({ error: '未找到该项目进行中的临停处理单' });
  const recheck = db.prepare('SELECT * FROM rechecks WHERE ticket_id=? ORDER BY id DESC LIMIT 1').get(ticket.id);
  const photos = recheck ? parse(recheck.photos, []) : [];
  if (!recheck || photos.length === 0)
    return res.status(400).json({ error: '恢复开放前须由巡场补充检修照片（补券不能替代安全复检）' });
  if (!recheck.confirmed_by)
    return res.status(400).json({ error: '恢复开放前须经负责人（店长）确认复检结果（补券不能替代安全复检）' });

  const tx = db.transaction(() => {
    db.prepare("UPDATE attractions SET status='open', updated_at=? WHERE id=?").run(nowIso(), a.id);
    db.prepare("UPDATE stop_tickets SET status='recovered', recovered_at=? WHERE id=?").run(nowIso(), ticket.id);
    db.prepare("UPDATE queue_entries SET status='cancelled' WHERE attraction_id=? AND status='waiting'").run(a.id);
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/wristbands/scan', auth, (req, res) => {
  const { wristband_no, zone } = req.body || {};
  if (!wristband_no || !zone) return res.status(400).json({ error: '手环号与区域必填' });
  const ci = db.prepare("SELECT * FROM checkins WHERE wristband_no=? AND status='inside'").get(wristband_no);
  if (!ci) return res.status(400).json({ error: '该手环无在场记录' });
  // 避免孩子回到已停用项目
  const stopped = db.prepare("SELECT * FROM attractions WHERE name=? AND is_facility=0 AND status IN ('maintenance','emergency_stop')").get(zone);
  if (stopped) return res.status(400).json({ error: `${zone}已临停，禁止进入；请按临停处理单分流到可替代项目` });
  // 受伤复盘限制开放：整改巡场待办完成前，不得按原规则扫码进入
  const restricted = db.prepare("SELECT * FROM attractions WHERE name=? AND is_facility=0 AND control_status='restricted'").get(zone);
  if (restricted)
    return res.status(400).json({ error: `${zone}正按受伤复盘新规「限制开放」（${restricted.control_rule || '待整改'}），手环暂不可进入，请先完成复盘巡场待办并经店长确认` });
  db.prepare(`INSERT INTO wristband_locations (wristband_no, zone, updated_at) VALUES (?,?,?)
              ON CONFLICT(wristband_no) DO UPDATE SET zone=excluded.zone, updated_at=excluded.updated_at`)
    .run(wristband_no, zone, nowIso());
  res.json({ ok: true });
});

// ---------------- 设备临停分流（处理单） ----------------
app.get('/api/tickets', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, a.name AS attraction_name, a.key AS attraction_key
    FROM stop_tickets t JOIN attractions a ON a.id = t.attraction_id
    ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.id DESC`).all();
  const cnt = (sql) => Object.fromEntries(db.prepare(sql).all().map((r) => [r.ticket_id, r.c]));
  const qMap = cnt("SELECT ticket_id, COUNT(*) c FROM queue_entries WHERE status='waiting' GROUP BY ticket_id");
  const vMap = cnt('SELECT ticket_id, COUNT(*) c FROM vouchers GROUP BY ticket_id');
  const iMap = cnt("SELECT ticket_id, COUNT(*) c FROM ticket_issues WHERE status='open' GROUP BY ticket_id");
  res.json(rows.map((t) => ({
    ...t,
    affected: parse(t.affected, []),
    waiting_count: qMap[t.id] || 0,
    voucher_count: vMap[t.id] || 0,
    open_issue_count: iMap[t.id] || 0,
  })));
});

app.get('/api/tickets/:id', auth, (req, res) => {
  const t = db.prepare(`SELECT t.*, a.name AS attraction_name, a.key AS attraction_key, a.status AS attraction_status
                        FROM stop_tickets t JOIN attractions a ON a.id=t.attraction_id WHERE t.id=?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: '处理单不存在' });
  const affected = parse(t.affected, []);
  const queue = db.prepare(`
    SELECT q.*, ch.name AS child_name, ch.height_cm FROM queue_entries q
    JOIN children ch ON ch.id=q.child_id WHERE q.attraction_id=? ORDER BY q.queue_no`).all(t.attraction_id);
  const vouchers = db.prepare(`
    SELECT v.*, m.card_no, ch.name AS child_name FROM vouchers v
    JOIN members m ON m.id=v.member_id LEFT JOIN children ch ON ch.id=v.child_id
    WHERE v.ticket_id=? ORDER BY v.id DESC`).all(t.id);
  const issues = db.prepare('SELECT * FROM ticket_issues WHERE ticket_id=? ORDER BY id DESC').all(t.id);
  const rechecks = db.prepare('SELECT * FROM rechecks WHERE ticket_id=? ORDER BY id DESC').all(t.id);
  // 可替代项目：开放中、非本项目，且至少适合一名受影响儿童（身高+禁玩）
  const occ = occupancy();
  const openAttrs = db.prepare("SELECT * FROM attractions WHERE is_facility=0 AND status='open' AND control_status='open' AND id != ?").all(t.attraction_id);
  const alternatives = openAttrs.map((a) => {
    const suitable = affected.filter((ac) => {
      const c = getChild(ac.child_id);
      if (!c) return false;
      const banned = parse(c.banned, []);
      return !banned.includes(a.key)
        && (a.min_height == null || c.height_cm >= a.min_height)
        && (a.max_height == null || c.height_cm <= a.max_height);
    }).map((ac) => ac.name);
    return { attraction: a, occupancy: occ[a.key] || 0, suitable };
  }).filter((x) => x.suitable.length > 0);
  res.json({
    ticket: { ...t, affected },
    queue, vouchers, issues, rechecks, alternatives,
    compensation_options: ['次卡补偿', '陪同券', '折扣券', '退款'],
  });
});

// 排队号分流（前台解释后更新，避免孩子回到已停用项目）
app.post('/api/tickets/:id/divert', auth, requireRole('frontdesk', 'manager'), (req, res) => {
  const t = db.prepare('SELECT * FROM stop_tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '处理单不存在' });
  const { queue_entry_id, transferred_to } = req.body || {};
  const q = db.prepare("SELECT * FROM queue_entries WHERE id=? AND attraction_id=? AND status='waiting'")
    .get(queue_entry_id, t.attraction_id);
  if (!q) return res.status(400).json({ error: '排队记录不存在或已处理' });
  const target = db.prepare("SELECT * FROM attractions WHERE name=? AND is_facility=0").get(transferred_to || '');
  if (!target) return res.status(400).json({ error: '分流去向项目不存在' });
  if (target.id === t.attraction_id) return res.status(400).json({ error: '不能分流回已停用项目' });
  if (target.status !== 'open') return res.status(400).json({ error: `${target.name} 当前未开放，不可作为分流去向` });
  if (target.control_status === 'restricted')
    return res.status(400).json({ error: `${target.name} 正按受伤复盘新规限制开放，不可作为分流去向` });
  db.prepare("UPDATE queue_entries SET status='transferred', transferred_to=? WHERE id=?").run(target.name, q.id);
  res.json({ ok: true });
});

// 发放补券（次卡补偿直接写入会员剩余次数）
app.post('/api/tickets/:id/vouchers', auth, requireRole('frontdesk', 'manager'), (req, res) => {
  const t = db.prepare('SELECT * FROM stop_tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '处理单不存在' });
  if (t.status !== 'open') return res.status(400).json({ error: '处理单已关闭' });
  const { member_id, child_id = null, type, amount = '', note = '' } = req.body || {};
  if (!member_id || !type) return res.status(400).json({ error: '会员与补券类型必填' });
  const m = getMember(member_id);
  if (!m) return res.status(400).json({ error: '会员不存在' });
  let applied = 0;
  const n = parseInt(amount, 10);
  const tx = db.transaction(() => {
    if (type === '次卡补偿' && n > 0) {
      db.prepare('UPDATE members SET remaining_sessions = remaining_sessions + ? WHERE id=?').run(n, m.id);
      applied = 1;
    }
    db.prepare(`INSERT INTO vouchers (ticket_id, member_id, child_id, type, amount, note, applied, issued_by_name, created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(t.id, member_id, child_id, type, String(amount), note, applied, req.user.name, nowIso());
  });
  tx();
  res.json({ ok: true, applied });
});

// 巡场提交安全复检（检修照片 + 结果）
app.post('/api/tickets/:id/recheck', auth, requireRole('patrol', 'manager'), (req, res) => {
  const t = db.prepare('SELECT * FROM stop_tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '处理单不存在' });
  if (t.status !== 'open') return res.status(400).json({ error: '处理单已关闭' });
  const { photos = [], result = '', inspector = '' } = req.body || {};
  const photoList = (Array.isArray(photos) ? photos : []).map((s) => String(s).trim()).filter(Boolean);
  if (photoList.length === 0) return res.status(400).json({ error: '检修照片至少 1 张（补券不能替代安全复检）' });
  if (!result.trim() || !inspector.trim()) return res.status(400).json({ error: '复检结果与检修人必填' });
  const info = db.prepare(`INSERT INTO rechecks (attraction_id, ticket_id, photos, result, inspector, created_by_name, created_at)
                           VALUES (?,?,?,?,?,?,?)`)
    .run(t.attraction_id, t.id, JSON.stringify(photoList), result, inspector, req.user.name, nowIso());
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 负责人（店长）确认复检结果
app.post('/api/rechecks/:id/confirm', auth, requireRole('manager'), (req, res) => {
  const r = db.prepare('SELECT * FROM rechecks WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '复检记录不存在' });
  if (r.confirmed_by) return res.status(400).json({ error: '该复检已确认' });
  db.prepare('UPDATE rechecks SET confirmed_by=?, confirmed_at=? WHERE id=?').run(req.user.name, nowIso(), r.id);
  res.json({ ok: true });
});

// 处理单子项：生日会延误 / 课程补时 / 家长投诉
const ISSUE_TYPES = { party_delay: '生日会延误', class_makeup: '课程补时', complaint: '家长投诉' };
app.post('/api/tickets/:id/issues', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM stop_tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '处理单不存在' });
  const { type, title, detail = '' } = req.body || {};
  if (!ISSUE_TYPES[type]) return res.status(400).json({ error: '子项类型须为生日会延误/课程补时/家长投诉' });
  if (!title || !title.trim()) return res.status(400).json({ error: '子项标题必填' });
  const info = db.prepare('INSERT INTO ticket_issues (ticket_id, type, title, detail, status, created_by_name, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(t.id, type, title.trim(), detail, 'open', req.user.name, nowIso());
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.post('/api/issues/:id/done', auth, requireRole('frontdesk', 'manager', 'patrol'), (req, res) => {
  const i = db.prepare('SELECT * FROM ticket_issues WHERE id=?').get(req.params.id);
  if (!i) return res.status(404).json({ error: '子项不存在' });
  db.prepare("UPDATE ticket_issues SET status='done' WHERE id=?").run(i.id);
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
    if (a.control_status === 'restricted') {
      blocked.push({ attraction: a, reasons: [`受伤复盘限制开放：${a.control_rule || '该项目复盘整改未完成，暂不按原规则开放'}（${a.control_reason || ''}）`] });
      continue;
    }
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
  const injury_case = injuryCaseByEvent(e.id);
  res.json({
    event: e, timeline, child, member, guardians, parties, search_task, found_report,
    injury_case: injury_case ? {
      id: injury_case.id, code: injury_case.code, plan: injury_case.plan,
      plan_label: injury_case.plan ? INJURY_PLANS[injury_case.plan] : null,
      parent_confirmed: injury_case.parent_confirmed, reviewed: injury_case.reviewed,
    } : null,
  });
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

  // 受伤赔付协商：家长确认是归档前置条件；协商结论自动带入档案（不重复加次）
  const injury = injuryCaseByEvent(e.id);
  if (injury && injury.plan && !injury.parent_confirmed)
    return res.status(400).json({ error: `该事件存在受伤赔付协商单 ${injury.code}，须先完成家长确认（签字）后才能归档` });
  const injuryPlanText = injury && injury.plan
    ? `${INJURY_PLANS[injury.plan]}（协商单 ${injury.code}）：` +
      (injury.plan === 'medical_reimburse' ? `报销医药费 ${Number(injury.medical_fee).toFixed(2)} 元`
        : injury.plan === 'class_compensation' ? `课时补偿 ${injury.class_sessions} 节${injury.benefit_applied ? '，已直接写入会员卡' : ''}`
        : '继续观察，暂不产生赔付') + (injury.plan_detail ? `；${injury.plan_detail}` : '')
    : '';
  if (injury && injury.plan) {
    if (!String(body.compensation || '').trim()) body.compensation = injuryPlanText;
    if (!String(body.parent_signature || '').trim() && injury.parent_confirmed)
      body.parent_signature = `家长 ${injury.parent_confirmer} 已在赔付协商单 ${injury.code} 上确认签字`;
    // 课时补偿在店长决策时已写入会员卡，归档不再重复加次，仅保留说明
    if (injury.benefit_applied)
      body.benefit_adjustment = { add_sessions: 0, note: `课时补偿 ${injury.class_sessions} 节已在协商单 ${injury.code} 决策时写入会员卡，归档不重复发放` };
  }

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

// ---------------- 受伤赔付协商 ----------------
function loadInjuryCase(id) {
  const c = db.prepare(`
    SELECT ic.*, e.code AS event_code, e.status AS event_status, e.type AS event_type,
           ch.name AS child_name, ch.height_cm, m.card_no, m.type AS card_type,
           m.remaining_sessions, m.benefits AS card_benefits,
           a.name AS attraction_name, a.control_status, a.control_rule
    FROM injury_cases ic
    JOIN events e ON e.id = ic.event_id
    LEFT JOIN children ch ON ch.id = ic.child_id
    LEFT JOIN members m ON m.id = ic.member_id
    LEFT JOIN attractions a ON a.id = ic.attraction_id
    WHERE ic.id=?`).get(id);
  if (!c) return null;
  c.markers = db.prepare('SELECT * FROM staff_review_markers WHERE injury_case_id=? ORDER BY id').all(id);
  c.tasks = db.prepare('SELECT * FROM staff_tasks WHERE ref_id=? AND type != ? ORDER BY id').all(id, 'patrol_followup');
  const markerIds = c.markers.map((m) => m.id);
  c.patrol_tasks = markerIds.length
    ? db.prepare(`
      SELECT st.*, m.marker_type, a.name AS attraction_name FROM staff_tasks st
      LEFT JOIN staff_review_markers m ON m.id = st.ref_id
      LEFT JOIN attractions a ON a.id = st.attraction_id
      WHERE st.type='patrol_followup' AND st.ref_id IN (${markerIds.map(() => '?').join(',')})
      ORDER BY st.id`).all(...markerIds)
    : [];
  return c;
}

// 协商单列表（可按状态/项目筛选），附带待办计数
app.get('/api/injuries', auth, (req, res) => {
  const { status, attraction_id } = req.query;
  let sql = `
    SELECT ic.*, e.code AS event_code, e.status AS event_status,
           ch.name AS child_name, m.card_no, a.name AS attraction_name
    FROM injury_cases ic
    JOIN events e ON e.id = ic.event_id
    LEFT JOIN children ch ON ch.id = ic.child_id
    LEFT JOIN members m ON m.id = ic.member_id
    LEFT JOIN attractions a ON a.id = ic.attraction_id
    WHERE 1=1`;
  const args = [];
  if (status === 'collecting') sql += ' AND ic.plan IS NULL';
  else if (status === 'decided') sql += ' AND ic.plan IS NOT NULL AND (ic.parent_confirmed=0 OR ic.reviewed=0)';
  else if (status === 'done') sql += ' AND ic.plan IS NOT NULL AND ic.parent_confirmed=1 AND ic.reviewed=1';
  if (attraction_id) { sql += ' AND ic.attraction_id=?'; args.push(Number(attraction_id)); }
  sql += ' ORDER BY ic.id DESC';
  const rows = db.prepare(sql).all(...args).map((c) => ({
    ...c,
    plan_label: c.plan ? INJURY_PLANS[c.plan] : null,
    open_parent_task: openTaskCount('parent_confirm', c.id),
    open_review_task: openTaskCount('staff_review', c.id),
  }));
  res.json(rows);
});

app.get('/api/injuries/:id', auth, (req, res) => {
  const c = loadInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  res.json({
    injury_case: c,
    plan_options: INJURY_PLANS,
    marker_types: MARKER_TYPES,
  });
});

// 事件详情：若存在受伤协商单一并返回（前端在事件页直接入口）
app.get('/api/events/:id/injury-case', auth, (req, res) => {
  const e = db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  const c = injuryCaseByEvent(e.id);
  res.json({ injury_case: c ? loadInjuryCase(c.id) : null });
});

// 新建协商单（擦伤/扭伤后录入），同时挂到事件线
app.post('/api/events/:id/injury-case', auth, (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '事件不存在' });
  if (e.status === 'archived') return res.status(400).json({ error: '事件已归档，不能新增协商单' });
  if (injuryCaseByEvent(e.id)) return res.status(400).json({ error: '该事件已存在受伤赔付协商单，请勿重复创建' });
  const b = req.body || {};
  if (!b.injury_type || !b.play_item || !b.action_desc || !b.companion_position || !b.first_aid || !b.parent_demands)
    return res.status(400).json({ error: '伤情类型、项目、动作、陪同人位置、急救处理、家长诉求均为必填' });
  const child = b.child_id ? getChild(b.child_id) : (e.child_id ? getChild(e.child_id) : null);
  const memberId = child ? child.member_id : e.member_id;
  const attractionId = b.attraction_id || e.attraction_id || null;

  const dstr = cnDay().replace(/-/g, '');
  const seq = db.prepare("SELECT COUNT(*) c FROM injury_cases WHERE code LIKE ?").get(`IC-${dstr}-%`).c + 1;
  const code = `IC-${dstr}-${String(seq).padStart(4, '0')}`;
  const info = db.prepare(`INSERT INTO injury_cases
    (code, event_id, child_id, member_id, attraction_id, injury_type, play_item, action_desc, companion_position, first_aid, parent_demands, created_by_id, created_by_name, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, e.id, child ? child.id : null, memberId, attractionId,
      String(b.injury_type).trim(), String(b.play_item).trim(), String(b.action_desc).trim(),
      String(b.companion_position).trim(), String(b.first_aid).trim(), String(b.parent_demands).trim(),
      req.user.id, req.user.name, nowIso());
  const id = info.lastInsertRowid;
  addTimeline(e.id, 'note', req.user,
    `受伤赔付协商单 ${code} 已创建：${b.injury_type}｜项目：${b.play_item}｜动作：${b.action_desc}｜陪同人位置：${b.companion_position}｜急救：${b.first_aid}｜家长诉求：${b.parent_demands}`,
    { injury_case_id: id });
  res.json({ ok: true, id, code });
});

// 补充/修订信息收集（店长决策前均可改）
app.put('/api/injuries/:id/collect', auth, (req, res) => {
  const c = getInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  if (c.plan) return res.status(400).json({ error: '店长已决策，收集信息锁定；如需变更请重新协商' });
  const b = req.body || {};
  for (const f of ['injury_type', 'play_item', 'action_desc', 'companion_position', 'first_aid', 'parent_demands']) {
    if (b[f] !== undefined && String(b[f]).trim() === '')
      return res.status(400).json({ error: '收集项不能为空' });
  }
  const fields = ['injury_type', 'play_item', 'action_desc', 'companion_position', 'first_aid', 'parent_demands'];
  const sets = [], args = [];
  for (const f of fields) if (b[f] !== undefined) { sets.push(`${f}=?`); args.push(String(b[f]).trim()); }
  if (sets.length) { args.push(c.id); db.prepare(`UPDATE injury_cases SET ${sets.join(',')} WHERE id=?`).run(...args); }
  addTimeline(c.event_id, 'note', req.user, `协商单 ${c.code} 信息收集已补充/修订`);
  res.json({ ok: true });
});

// 店长选择赔付方式：医药费报销 / 课时补偿 / 继续观察 → 会员卡权益与事故复盘同步调整
app.post('/api/injuries/:id/decision', auth, requireRole('manager'), (req, res) => {
  const c = getInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  if (c.plan) return res.status(400).json({ error: '该协商单已完成店长决策' });
  const { plan, plan_detail = '', medical_fee = 0, class_sessions = 0 } = req.body || {};
  if (!INJURY_PLANS[plan]) return res.status(400).json({ error: '赔付方式须为医药费报销 / 课时补偿 / 继续观察' });
  const fee = Number(medical_fee) || 0;
  const sessions = parseInt(class_sessions, 10) || 0;
  if (plan === 'medical_reimburse' && !(fee > 0)) return res.status(400).json({ error: '医药费报销须填写报销金额' });
  if (plan === 'class_compensation' && !(sessions > 0)) return res.status(400).json({ error: '课时补偿须填写补偿课时数' });
  if (!c.child_id && plan === 'class_compensation') return res.status(400).json({ error: '未关联会员儿童，无法做课时补偿' });

  const tx = db.transaction(() => {
    let appliedResult = null;
    if (c.member_id && plan !== 'continue_observation') {
      appliedResult = applyInjuryBenefit(c.member_id, plan, sessions, fee);
    }
    db.prepare(`UPDATE injury_cases SET plan=?, plan_detail=?, medical_fee=?, class_sessions=?, benefit_applied=?, decided_by=?, decided_at=? WHERE id=?`)
      .run(plan, String(plan_detail).trim(), fee, sessions, appliedResult?.applied ? 1 : 0, req.user.name, nowIso(), c.id);

    // 生成「家长确认」与「员工复盘」任务
    const childName = c.child_id ? getChild(c.child_id)?.name : '受伤儿童';
    db.prepare(`INSERT INTO staff_tasks (type, title, detail, ref_id, attraction_id, assignee_role, status, created_at)
                VALUES (?,?,?,?,?,?,'open',?)`)
      .run('parent_confirm', `家长确认赔付方案（${childName} ${c.code}）`,
        `店长已选择「${INJURY_PLANS[plan]}」，请联系家长到场确认伤情结论与赔付方案并签字`, c.id, c.attraction_id, 'manager', nowIso());
    db.prepare(`INSERT INTO staff_tasks (type, title, detail, ref_id, attraction_id, assignee_role, status, created_at)
                VALUES (?,?,?,?,?,?,'open',?)`)
      .run('staff_review', `组织员工复盘会（${childName} ${c.code}）`,
        '复盘会标记项目动线、员工站位、家长视线盲区，形成下一次巡场依据', c.id, c.attraction_id, 'manager', nowIso());

    // 事件线同步
    const planDesc = plan === 'medical_reimburse' ? `报销医药费 ${fee.toFixed(2)} 元`
      : plan === 'class_compensation' ? `课时补偿 ${sessions} 节（已写入会员卡 ${appliedResult?.card_no || ''}）`
      : '继续观察（暂不产生赔付，持续跟踪孩子状态）';
    addTimeline(c.event_id, 'settlement', req.user,
      `店长决策（赔付协商 ${c.code}）：${INJURY_PLANS[plan]}—${planDesc}${plan_detail ? `；${plan_detail}` : ''}。会员卡权益${plan === 'class_compensation' ? '已同步调整' : '已登记赔付记录'}，事故复盘会同步纳入议程。`,
      { plan, medical_fee: fee, class_sessions: sessions, benefit_applied: appliedResult?.applied ? 1 : 0 });
    return appliedResult;
  });
  const appliedResult = tx();
  res.json({ ok: true, benefit_applied: appliedResult?.applied ? 1 : 0 });
});

// 家长确认（店长/前台代登记签字确认）
app.post('/api/injuries/:id/parent-confirm', auth, requireRole('manager', 'frontdesk'), (req, res) => {
  const c = getInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  if (!c.plan) return res.status(400).json({ error: '请先由店长完成赔付方式决策' });
  if (c.parent_confirmed) return res.status(400).json({ error: '家长已确认' });
  const { confirmer = '' } = req.body || {};
  if (!String(confirmer).trim()) return res.status(400).json({ error: '请填写确认家长（与儿童关系/姓名）' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE injury_cases SET parent_confirmed=1, parent_confirmer=?, parent_confirmed_at=? WHERE id=?')
      .run(String(confirmer).trim(), nowIso(), c.id);
    db.prepare("UPDATE staff_tasks SET status='done', done_by=?, done_at=? WHERE type='parent_confirm' AND ref_id=? AND status='open'")
      .run(req.user.name, nowIso(), c.id);
    addTimeline(c.event_id, 'signature', req.user,
      `家长确认：${String(confirmer).trim()} 已确认「${INJURY_PLANS[c.plan]}」方案与伤情结论并签字（协商单 ${c.code}）`,
      { confirmer: String(confirmer).trim() });
  });
  tx();
  res.json({ ok: true });
});

// 员工复盘会：逐条标记项目动线 / 员工站位 / 家长视线盲区
app.post('/api/injuries/:id/markers', auth, requireRole('manager'), (req, res) => {
  const c = getInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  if (!c.plan) return res.status(400).json({ error: '请先完成店长赔付决策，再组织复盘' });
  const { marker_type, content, fix_action = '' } = req.body || {};
  if (!MARKER_TYPES[marker_type]) return res.status(400).json({ error: '标记类型须为项目动线/员工站位/家长视线盲区' });
  if (!String(content || '').trim()) return res.status(400).json({ error: '标记内容必填' });

  const info = db.prepare(`INSERT INTO staff_review_markers (injury_case_id, event_id, attraction_id, marker_type, content, fix_action, created_by_name, created_at)
                           VALUES (?,?,?,?,?,?,?,?)`)
    .run(c.id, c.event_id, c.attraction_id, marker_type, String(content).trim(), String(fix_action).trim(), req.user.name, nowIso());
  addTimeline(c.event_id, 'review', req.user,
    `复盘会标记（${c.code}）【${MARKER_TYPES[marker_type]}】${String(content).trim()}${fix_action ? `；整改：${String(fix_action).trim()}` : ''}（作为下一次巡场依据）`,
    { marker_id: info.lastInsertRowid, marker_type });
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 完成员工复盘会：三类标记至少各一 → 项目限制开放（不再按原规则开放）+ 生成复盘巡场待办
app.post('/api/injuries/:id/complete-review', auth, requireRole('manager'), (req, res) => {
  const c = getInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  if (!c.plan) return res.status(400).json({ error: '请先完成店长赔付决策' });
  if (c.reviewed) return res.status(400).json({ error: '员工复盘已完成' });
  const { control_rule = '' } = req.body || {};
  const markers = db.prepare('SELECT * FROM staff_review_markers WHERE injury_case_id=?').all(c.id);
  const types = new Set(markers.map((m) => m.marker_type));
  const missing = ['route', 'positioning', 'blindspot'].filter((t) => !types.has(t));
  if (missing.length)
    return res.status(400).json({ error: `复盘会须标记项目动线、员工站位、家长视线盲区三类，尚缺：${missing.map((t) => MARKER_TYPES[t]).join('、')}` });

  const a = c.attraction_id ? db.prepare('SELECT * FROM attractions WHERE id=?').get(c.attraction_id) : null;
  const tx = db.transaction(() => {
    db.prepare('UPDATE injury_cases SET reviewed=1, reviewed_by=?, reviewed_at=? WHERE id=?')
      .run(req.user.name, nowIso(), c.id);
    db.prepare("UPDATE staff_tasks SET status='done', done_by=?, done_at=? WHERE type='staff_review' AND ref_id=? AND status='open'")
      .run(req.user.name, nowIso(), c.id);

    // 每条盲区/动线/站位标记 → 一条复盘巡场待办（下一次巡场依据）
    const insTask = db.prepare(`INSERT INTO staff_tasks (type, title, detail, ref_id, attraction_id, assignee_role, status, created_at)
                                VALUES ('patrol_followup',?,?,?,?,'patrol','open',?)`);
    for (const m of markers) {
      insTask.run(`巡场核验：${MARKER_TYPES[m.marker_type]}—${m.content.slice(0, 24)}`,
        `${m.fix_action ? `整改措施：${m.fix_action}；` : ''}下次巡场到 ${a ? a.name : '相关区域'} 逐项核验并登记，全部完成后由店长确认解除限制开放`,
        m.id, c.attraction_id, nowIso());
    }

    if (a) {
      const rule = String(control_rule).trim()
        || `限制开放：完成 ${markers.length} 项复盘整改（动线/站位/盲区）并经店长确认前，不按原规则开放`;
      db.prepare(`UPDATE attractions SET control_status='restricted', control_reason=?, control_rule=?, control_case_id=?, controlled_at=? WHERE id=?`)
        .run(`受伤复盘（${c.code}）：${MARKER_TYPES[markers[0].marker_type]}等 ${markers.length} 项隐患待整改`, rule, c.id, nowIso(), a.id);
    }
    addTimeline(c.event_id, 'review', req.user,
      `员工复盘会结束（${c.code}）：共 ${markers.length} 项标记已转为复盘巡场待办；${a ? `项目「${a.name}」改为限制开放（新规则），防止同类项目继续按原规则开放，待巡场整改完成后由店长解除` : '本事件未关联具体项目，隐患纳入巡场关注'}。`,
      { marker_count: markers.length, restricted: a ? a.name : null });
  });
  tx();
  res.json({ ok: true });
});

// 巡场待办：按区域聚合（下一次巡场依据）
app.get('/api/patrol/tasks', auth, (req, res) => {
  const { status = 'open' } = req.query;
  const rows = db.prepare(`
    SELECT st.*, a.name AS attraction_name, m.marker_type, m.content AS marker_content,
           ic.code AS injury_code, ch.name AS child_name
    FROM staff_tasks st
    LEFT JOIN attractions a ON a.id = st.attraction_id
    LEFT JOIN staff_review_markers m ON m.id = st.ref_id
    LEFT JOIN injury_cases ic ON ic.id = m.injury_case_id
    LEFT JOIN children ch ON ch.id = ic.child_id
    WHERE st.type='patrol_followup' ${status === 'all' ? '' : 'AND st.status=?'}
    ORDER BY st.status, st.id DESC`).all(...(status === 'all' ? [] : [status]));
  res.json(rows);
});

// 巡场完成单条复盘待办
app.post('/api/patrol/tasks/:id/done', auth, requireRole('patrol', 'manager'), (req, res) => {
  const t = db.prepare("SELECT * FROM staff_tasks WHERE id=? AND type='patrol_followup'").get(req.params.id);
  if (!t) return res.status(404).json({ error: '巡场待办不存在' });
  if (t.status === 'done') return res.status(400).json({ error: '该待办已完成' });
  const { note = '' } = req.body || {};
  db.prepare("UPDATE staff_tasks SET status='done', done_by=?, done_at=?, detail=? WHERE id=?")
    .run(req.user.name, nowIso(), note ? `${t.detail}｜核验记录：${String(note).trim()}` : t.detail, t.id);
  // 巡场流水留痕
  if (t.attraction_id) {
    const a = db.prepare('SELECT name FROM attractions WHERE id=?').get(t.attraction_id);
    db.prepare('INSERT INTO patrol_logs (area, status, note, staff_id, staff_name, created_at) VALUES (?,?,?,?,?,?)')
      .run(a ? a.name : '全场', '需关注', `复盘巡场待办已核验：${t.title}${note ? `；${String(note).trim()}` : ''}`, req.user.id, req.user.name, nowIso());
  }
  res.json({ ok: true });
});

// 店长确认整改完成：全部巡场待办办结后解除限制开放，项目恢复按规则开放
app.post('/api/injuries/:id/clear-control', auth, requireRole('manager'), (req, res) => {
  const c = getInjuryCase(req.params.id);
  if (!c) return res.status(404).json({ error: '协商单不存在' });
  const a = c.attraction_id ? db.prepare('SELECT * FROM attractions WHERE id=?').get(c.attraction_id) : null;
  if (!a) return res.status(400).json({ error: '该协商单未关联项目' });
  if (a.control_status !== 'restricted' || a.control_case_id !== c.id)
    return res.status(400).json({ error: '该项目当前没有来自本协商单的限制开放' });
  const markerIds = db.prepare('SELECT id FROM staff_review_markers WHERE injury_case_id=?').all(c.id).map((x) => x.id);
  const open = db.prepare(`SELECT COUNT(*) c FROM staff_tasks WHERE type='patrol_followup' AND status='open' AND ref_id IN (${markerIds.map(() => '?').join(',')})`).get(...markerIds).c;
  if (open > 0) return res.status(400).json({ error: `仍有 ${open} 项复盘巡场待办未核验完成，不能解除限制开放` });

  const tx = db.transaction(() => {
    db.prepare("UPDATE attractions SET control_status='open', control_reason=NULL, control_rule=NULL, control_case_id=NULL, controlled_at=NULL WHERE id=?").run(a.id);
    addTimeline(c.event_id, 'review', req.user,
      `店长确认复盘整改全部完成（${c.code}）：项目「${a.name}」恢复按原规则开放，本次受伤处置闭环。`, { cleared: a.name });
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

  // 受伤赔付协商：决策分布、医药费、课时补偿
  const injuries = db.prepare(`SELECT * FROM injury_cases WHERE event_id IN (${events.map(() => '?').join(',')})`)
    .all(...events.map((e) => e.id));
  const byPlan = {};
  let medicalTotal = 0, classTotal = 0, confirmedCount = 0;
  for (const ic of injuries) {
    if (ic.plan) byPlan[INJURY_PLANS[ic.plan]] = (byPlan[INJURY_PLANS[ic.plan]] || 0) + 1;
    medicalTotal += ic.medical_fee || 0;
    classTotal += ic.class_sessions || 0;
    if (ic.parent_confirmed) confirmedCount += 1;
  }
  // 复盘会标记（动线/站位/盲区），作为下一次巡场依据
  const markers = db.prepare(`
    SELECT m.*, ic.code AS injury_code, a.name AS attraction_name FROM staff_review_markers m
    LEFT JOIN injury_cases ic ON ic.id = m.injury_case_id
    LEFT JOIN attractions a ON a.id = m.attraction_id
    WHERE m.event_id IN (${events.map(() => '?').join(',')})
    ORDER BY m.id DESC`).all(...events.map((e) => e.id));
  const byMarker = {};
  for (const m of markers) byMarker[MARKER_TYPES[m.marker_type]] = (byMarker[MARKER_TYPES[m.marker_type]] || 0) + 1;

  res.json({
    events,
    stats: { byType, byAttraction, byHour, bySeverity, staff: staffRows },
    injury: {
      total: injuries.length,
      decided: injuries.filter((i) => i.plan).length,
      confirmed: confirmedCount,
      reviewed: injuries.filter((i) => i.reviewed).length,
      byPlan, medical_total: medicalTotal, class_total: classTotal,
    },
    markers: { list: markers, byType: byMarker },
  });
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
