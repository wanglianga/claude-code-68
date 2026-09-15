import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'playground.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL -- frontdesk 前台 | patrol 巡场 | manager 店长 | medical 医疗点 | activity 活动专员
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_no TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,             -- member 会员卡 | punch 次卡
  holder_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  remaining_sessions INTEGER NOT NULL DEFAULT 0,  -- 次卡剩余次数（会员卡为 0，权益看 benefits）
  benefits TEXT NOT NULL DEFAULT '{}',            -- 剩余权益 JSON
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',          -- active | frozen | expired
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  name TEXT NOT NULL,
  gender TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  height_cm REAL NOT NULL,
  allergies TEXT NOT NULL DEFAULT '',             -- 过敏史
  banned TEXT NOT NULL DEFAULT '[]',              -- 禁玩项目 attraction key 数组
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id),
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_authorized INTEGER NOT NULL DEFAULT 0,       -- 可陪同监护人（授权）
  is_emergency INTEGER NOT NULL DEFAULT 0         -- 紧急联系人
);
CREATE TABLE IF NOT EXISTS attractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  min_height REAL,
  max_height REAL,
  capacity INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'open',            -- open | closed | maintenance | emergency_stop
  is_facility INTEGER NOT NULL DEFAULT 0,         -- 1 = 卫生间/休息区等巡场区域（非游玩项目）
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  guardian_id INTEGER NOT NULL REFERENCES guardians(id),
  wristband_no TEXT NOT NULL,
  sessions_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inside',          -- inside | left
  checkin_at TEXT NOT NULL,
  checkout_at TEXT
);
CREATE TABLE IF NOT EXISTS wristband_locations (
  wristband_no TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patrol_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  status TEXT NOT NULL,                           -- 正常 | 需关注 | 异常
  note TEXT NOT NULL DEFAULT '',
  staff_id INTEGER,
  staff_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,   -- fall|push|equipment_stop|lost_child|card_dispute|refund
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  child_id INTEGER REFERENCES children(id),
  member_id INTEGER REFERENCES members(id),
  attraction_id INTEGER REFERENCES attractions(id),
  severity TEXT NOT NULL DEFAULT 'medium',        -- low | medium | high
  status TEXT NOT NULL DEFAULT 'open',            -- open | processing | resolved | archived
  archive TEXT,                                   -- 归档 JSON：照片/监控/签字/赔付/复检/权益调整
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS event_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  kind TEXT NOT NULL,   -- status|communication|wristband|cctv|firstaid|disinfection|compensation|handover|photo|signature|recheck|benefit|note
  actor_id INTEGER,
  actor_name TEXT,
  actor_role TEXT,
  content TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                             -- birthday 生日会 | daycare 托管班
  title TEXT NOT NULL,
  leader_id INTEGER,
  leader_name TEXT,                               -- 活动负责人
  area TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
);
CREATE TABLE IF NOT EXISTS party_children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  child_id INTEGER NOT NULL REFERENCES children(id),
  guardian_id INTEGER NOT NULL REFERENCES guardians(id),  -- 该儿童本次活动对应的监护人（真正授权人）
  UNIQUE(party_id, child_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  child_id INTEGER NOT NULL REFERENCES children(id),
  wristband_no TEXT,           -- 手环编号（未入园为 NULL）
  last_zone TEXT NOT NULL,     -- 最后入场项目/最后定位
  cameras TEXT NOT NULL,       -- 监控点位 JSON 数组
  assignments TEXT NOT NULL,   -- 巡场分派 JSON：[{staff,last_area,zone}]
  status TEXT NOT NULL DEFAULT 'searching',  -- searching | found | superseded
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS found_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  found_zone TEXT NOT NULL,              -- 发现地点
  companion TEXT NOT NULL,               -- 陪同人（发现时在孩子身边/发现人）
  child_state TEXT NOT NULL,             -- 孩子状态
  need_comfort INTEGER NOT NULL DEFAULT 0,   -- 是否需要安抚
  taken_by_other INTEGER NOT NULL DEFAULT 0, -- 曾被其他家长带离项目区
  other_guardian_name TEXT,              -- 对方监护人
  other_guardian_phone TEXT,
  recorded_by_id INTEGER,
  recorded_by_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stop_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,             -- ST-20260914-0001
  attraction_id INTEGER NOT NULL REFERENCES attractions(id),
  status TEXT NOT NULL DEFAULT 'open',   -- open 处理中 | recovered 已恢复
  reason TEXT NOT NULL DEFAULT '',
  affected TEXT NOT NULL DEFAULT '[]',   -- 受影响儿童快照 JSON
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  recovered_at TEXT
);
CREATE TABLE IF NOT EXISTS queue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attraction_id INTEGER NOT NULL REFERENCES attractions(id),
  child_id INTEGER NOT NULL REFERENCES children(id),
  ticket_id INTEGER REFERENCES stop_tickets(id),
  queue_no TEXT NOT NULL,                -- 排队号 如 B-01
  status TEXT NOT NULL DEFAULT 'waiting',-- waiting | transferred | cancelled
  transferred_to TEXT,                   -- 分流去向项目名
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES stop_tickets(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  child_id INTEGER REFERENCES children(id),
  type TEXT NOT NULL,                    -- 次卡补偿 | 陪同券 | 折扣券 | 退款
  amount TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  applied INTEGER NOT NULL DEFAULT 0,    -- 是否已实际写入会员权益
  issued_by_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES stop_tickets(id),
  type TEXT NOT NULL,                    -- party_delay 生日会延误 | class_makeup 课程补时 | complaint 家长投诉
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',   -- open | done
  created_by_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rechecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attraction_id INTEGER NOT NULL REFERENCES attractions(id),
  ticket_id INTEGER REFERENCES stop_tickets(id),
  photos TEXT NOT NULL DEFAULT '[]',     -- 检修照片 JSON
  result TEXT NOT NULL,
  inspector TEXT NOT NULL,               -- 检修人
  confirmed_by TEXT,                     -- 负责人确认（店长）
  confirmed_at TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL
);
-- 受伤赔付协商（儿童擦伤/扭伤等）：信息收集 → 店长决策 → 会员卡权益/事故复盘同步 → 家长确认/员工复盘
CREATE TABLE IF NOT EXISTS injury_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,             -- IC-20260915-0001
  event_id INTEGER NOT NULL REFERENCES events(id),
  child_id INTEGER REFERENCES children(id),
  member_id INTEGER REFERENCES members(id),
  attraction_id INTEGER REFERENCES attractions(id),
  injury_type TEXT NOT NULL DEFAULT '',  -- 擦伤 | 扭伤 | 磕碰 | 其他
  -- ① 页面收集
  play_item TEXT NOT NULL DEFAULT '',    -- 项目（受伤时正在玩的项目/环节）
  action_desc TEXT NOT NULL DEFAULT '',  -- 动作（孩子当时的动作）
  companion_position TEXT NOT NULL DEFAULT '', -- 陪同人位置
  first_aid TEXT NOT NULL DEFAULT '',    -- 急救处理
  parent_demands TEXT NOT NULL DEFAULT '',     -- 家长诉求
  -- ② 店长决策：medical_reimburse 医药费报销 | class_compensation 课时补偿 | continue_observation 继续观察
  plan TEXT,
  plan_detail TEXT NOT NULL DEFAULT '',
  medical_fee REAL NOT NULL DEFAULT 0,   -- 报销医药费金额
  class_sessions INTEGER NOT NULL DEFAULT 0, -- 课时补偿数量
  benefit_applied INTEGER NOT NULL DEFAULT 0, -- 权益是否已写入会员卡
  decided_by TEXT, decided_at TEXT,
  -- ③ 家长确认
  parent_confirmed INTEGER NOT NULL DEFAULT 0,
  parent_confirmer TEXT, parent_confirmed_at TEXT,
  -- ④ 员工复盘
  reviewed INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT, reviewed_at TEXT,
  created_by_id INTEGER, created_by_name TEXT,
  created_at TEXT NOT NULL
);
-- 复盘会标记：项目动线 / 员工站位 / 家长视线盲区（作为下一次巡场依据）
CREATE TABLE IF NOT EXISTS staff_review_markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  injury_case_id INTEGER NOT NULL REFERENCES injury_cases(id),
  event_id INTEGER REFERENCES events(id),
  attraction_id INTEGER REFERENCES attractions(id),
  marker_type TEXT NOT NULL,             -- route 项目动线 | positioning 员工站位 | blindspot 家长视线盲区
  content TEXT NOT NULL,
  fix_action TEXT NOT NULL DEFAULT '',   -- 整改/调整措施
  created_by_name TEXT,
  created_at TEXT NOT NULL
);
-- 协商结束后自动生成的任务：家长确认 / 员工复盘 / 复盘巡场待办
CREATE TABLE IF NOT EXISTS staff_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- parent_confirm | staff_review | patrol_followup
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,                        -- 关联 injury_case / marker id
  attraction_id INTEGER,
  assignee_role TEXT NOT NULL DEFAULT '', -- manager | patrol
  status TEXT NOT NULL DEFAULT 'open',   -- open | done
  done_by TEXT, done_at TEXT,
  created_at TEXT NOT NULL
);
`);

// ---------- 轻量迁移：既有 SQLite 增加项目受伤管控列（防止同类项目继续按原规则开放） ----------
for (const col of [
  ['control_status', "TEXT NOT NULL DEFAULT 'open'"], // open 正常 | restricted 限制开放（受伤新规）
  ['control_reason', 'TEXT'],
  ['control_rule', 'TEXT'],        // 新规则（替代原开放规则）
  ['control_case_id', 'INTEGER'],  // 来源受伤协商单
  ['controlled_at', 'TEXT'],
]) {
  const exists = db.prepare('PRAGMA table_info(attractions)').all().some((c) => c.name === col[0]);
  if (!exists) db.exec(`ALTER TABLE attractions ADD COLUMN ${col[0]} ${col[1]}`);
}

const nowIso = () => new Date().toISOString();
// 种子数据的时间统一按 Asia/Shanghai（UTC+8）墙钟时间生成，与运行时展示口径一致
const CN_OFFSET_MS = 8 * 3600 * 1000;
function at(dayOffset, h, m = 0) {
  const day = new Date(Date.now() + dayOffset * 86400000 + CN_OFFSET_MS).toISOString().slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return new Date(`${day}T${p(h)}:${p(m)}:00+08:00`).toISOString();
}
function minutesAgo(min) {
  return new Date(Date.now() - min * 60000).toISOString();
}

// ---------- 走失查找：监控点位与查找任务生成 ----------
export const CAMERA_MAP = {
  '滑梯': ['C-01', 'C-02'],
  '蹦床': ['C-03', 'C-04'],
  '攀爬网': ['C-05', 'C-06'],
  '海洋球池': ['C-07', 'C-08'],
  '入口': ['C-09'],
  '出口': ['C-10'],
  '休息区': ['C-11'],
  '卫生间': ['C-12'],
  '医疗点': ['C-13'],
};

/**
 * 根据最后入场项目、手环编号、监控点位和巡场人员位置生成查找任务。
 * 旧的查找中任务标记为 superseded，返回新任务。
 */
export function generateSearchTask(event, fallbackZone = null) {
  const ci = event.child_id
    ? db.prepare("SELECT * FROM checkins WHERE child_id=? AND status='inside'").get(event.child_id)
    : null;
  const wristband_no = ci ? ci.wristband_no : null;
  const loc = wristband_no
    ? db.prepare('SELECT * FROM wristband_locations WHERE wristband_no=?').get(wristband_no)
    : null;
  const last_zone = (loc && loc.zone) || fallbackZone || '入口';
  const cameras = [...(CAMERA_MAP[last_zone] || []), ...CAMERA_MAP['出口']];

  const patrols = db.prepare("SELECT * FROM users WHERE role='patrol' ORDER BY id").all();
  const lastAreaStmt = db.prepare('SELECT area FROM patrol_logs WHERE staff_id=? ORDER BY created_at DESC, id DESC LIMIT 1');
  const attractions = db.prepare('SELECT name FROM attractions WHERE is_facility=0 ORDER BY id').all().map((r) => r.name);
  // 搜索优先级：最后位置 → 出口/入口 → 休息区 → 其余项目
  const zones = [last_zone, '出口', '入口', '休息区', ...attractions.filter((a) => a !== last_zone)];
  const assignments = patrols.map((p, i) => ({
    staff: p.name,
    last_area: (lastAreaStmt.get(p.id) || {}).area || '暂无巡场记录',
    zone: zones[i % zones.length],
  }));

  db.prepare("UPDATE search_tasks SET status='superseded' WHERE event_id=? AND status='searching'").run(event.id);
  const info = db.prepare(`INSERT INTO search_tasks (event_id, child_id, wristband_no, last_zone, cameras, assignments, status, created_at)
                           VALUES (?,?,?,?,?,?,'searching',?)`)
    .run(event.id, event.child_id, wristband_no, last_zone, JSON.stringify(cameras), JSON.stringify(assignments), nowIso());
  return { id: info.lastInsertRowid, wristband_no, last_zone, cameras, assignments };
}

export const searchTaskSummary = (t) =>
  `最后位置 ${t.last_zone}；手环 ${t.wristband_no || '无（未入园）'}；监控点位 ${t.cameras.join('、')}；巡场分派 ${t.assignments.map((a) => `${a.staff}→${a.zone}`).join('，')}`;

export function seedIfEmpty() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c > 0) return;

  const tx = db.transaction(() => {
    // ---------- 员工账号（密码为演示用途明文） ----------
    const insUser = db.prepare('INSERT INTO users (username, password, name, role) VALUES (?,?,?,?)');
    const fd = insUser.run('frontdesk', 'fd123456', '王芳', 'frontdesk').lastInsertRowid;
    const pt = insUser.run('patrol', 'pt123456', '李强', 'patrol').lastInsertRowid;
    const mg = insUser.run('manager', 'mg123456', '赵敏', 'manager').lastInsertRowid;
    const md = insUser.run('medical', 'md123456', '陈曦', 'medical').lastInsertRowid;
    const ac = insUser.run('activity', 'ac123456', '周婷', 'activity').lastInsertRowid;
    insUser.run('security', 'sc123456', '郑安', 'security'); // 门口安保

    db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('daily_limit', '60');

    // ---------- 项目与巡场区域 ----------
    const insAttr = db.prepare(`INSERT INTO attractions (key, name, min_height, max_height, capacity, status, is_facility, updated_at)
                                VALUES (?,?,?,?,?,?,?,?)`);
    insAttr.run('slide', '滑梯', 90, 150, 20, 'open', 0, nowIso());
    insAttr.run('trampoline', '蹦床', 100, 160, 16, 'maintenance', 0, nowIso());
    insAttr.run('climb', '攀爬网', 110, 170, 12, 'open', 0, nowIso());
    insAttr.run('ballpit', '海洋球池', null, 120, 25, 'open', 0, nowIso());
    insAttr.run('restroom', '卫生间', null, null, 0, 'open', 1, nowIso());
    insAttr.run('rest', '休息区', null, null, 30, 'open', 1, nowIso());

    // ---------- 会员 / 儿童 / 监护人 ----------
    const insMember = db.prepare(`INSERT INTO members (card_no, type, holder_name, phone, remaining_sessions, benefits, valid_until, status, created_at)
                                  VALUES (?,?,?,?,?,?,?,?,?)`);
    const insChild = db.prepare(`INSERT INTO children (member_id, name, gender, birth_date, height_cm, allergies, banned, notes)
                                 VALUES (?,?,?,?,?,?,?,?)`);
    const insGuardian = db.prepare(`INSERT INTO guardians (child_id, name, relation, phone, is_authorized, is_emergency)
                                    VALUES (?,?,?,?,?,?)`);

    // M1001 年卡家庭：张莉
    const m1 = insMember.run('M1001', 'member', '张莉', '13800001111', 0,
      JSON.stringify({ 储物柜: '免费', 生日会折扣: '8折', 亲友陪同券: '剩余2张', 剩余权益说明: '年卡不限次入园' }),
      at(300, 23, 59), 'active', nowIso()).lastInsertRowid;
    const cYu = insChild.run(m1, '张小雨', '女', '2021-03-15', 105, '花生过敏', JSON.stringify(['climb']), '平衡感较弱，需重点关注').lastInsertRowid;
    const cXue = insChild.run(m1, '张小雪', '女', '2019-07-02', 122, '无', JSON.stringify([]), '').lastInsertRowid;
    const gLi = insGuardian.run(cYu, '张莉', '母亲', '13800001111', 1, 1).lastInsertRowid;
    insGuardian.run(cYu, '王建国', '父亲', '13800001112', 1, 1);
    insGuardian.run(cYu, '王秀兰', '奶奶', '13800001113', 0, 1); // 仅紧急联系，未授权陪同
    insGuardian.run(cXue, '张莉', '母亲', '13800001111', 1, 1);
    const gJian = insGuardian.run(cXue, '王建国', '父亲', '13800001112', 1, 1).lastInsertRowid;

    // M1002 次卡家庭：刘洋（含设备临停补偿 1 次 + 滑梯扭伤课时补偿 2 次）
    const m2 = insMember.run('M1002', 'punch', '刘洋', '13800002222', 8,
      JSON.stringify({
        剩余权益说明: '次卡按次扣减；含设备临停补偿1次、滑梯扭伤课时补偿共2节',
        赔付记录: ['课时补偿 2 节（受伤赔付协商 IC 滑梯扭伤）'],
      }),
      at(110, 23, 59), 'active', nowIso()).lastInsertRowid;
    const cTian = insChild.run(m2, '刘天天', '男', '2020-11-20', 98, '尘螨过敏', JSON.stringify([]), '').lastInsertRowid;
    const gYang = insGuardian.run(cTian, '刘洋', '父亲', '13800002222', 1, 1).lastInsertRowid;
    insGuardian.run(cTian, '陈静', '母亲', '13800002223', 1, 1);

    // M1003 次卡家庭：孙倩（仅剩 1 次）
    const m3 = insMember.run('M1003', 'punch', '孙倩', '13800003333', 1,
      JSON.stringify({ 剩余权益说明: '次卡即将用完' }), at(20, 23, 59), 'active', nowIso()).lastInsertRowid;
    const cGuo = insChild.run(m3, '孙果果', '女', '2022-05-08', 92, '牛奶蛋白过敏', JSON.stringify(['trampoline']), '').lastInsertRowid;
    const gQian = insGuardian.run(cGuo, '孙倩', '母亲', '13800003333', 1, 1).lastInsertRowid;

    // M1004 年卡家庭：周正
    const m4 = insMember.run('M1004', 'member', '周正', '13800004444', 0,
      JSON.stringify({ 储物柜: '免费', 生日会折扣: '8折', 亲友陪同券: '剩余5张', 剩余权益说明: '年卡不限次入园' }),
      at(200, 23, 59), 'active', nowIso()).lastInsertRowid;
    const cLe = insChild.run(m4, '周乐乐', '男', '2018-01-30', 130, '无', JSON.stringify([]), '').lastInsertRowid;
    const gZheng = insGuardian.run(cLe, '周正', '父亲', '13800004444', 1, 1).lastInsertRowid;
    insGuardian.run(cLe, '林芳', '母亲', '13800004445', 1, 1);

    // M1005 次卡家庭：吴敏（剩余 0 次，用于演示核验拦截）
    const m5 = insMember.run('M1005', 'punch', '吴敏', '13800005555', 0,
      JSON.stringify({ 剩余权益说明: '次卡已用完，需续费' }), at(60, 23, 59), 'active', nowIso()).lastInsertRowid;
    const cDou = insChild.run(m5, '吴豆豆', '男', '2020-06-18', 108, '无', JSON.stringify([]), '').lastInsertRowid;
    insGuardian.run(cDou, '吴敏', '母亲', '13800005555', 1, 1);

    // ---------- 在场儿童（入园核验 + 手环定位） ----------
    const insCheckin = db.prepare(`INSERT INTO checkins (child_id, member_id, guardian_id, wristband_no, sessions_used, status, checkin_at)
                                   VALUES (?,?,?,?,?,'inside',?)`);
    insCheckin.run(cYu, m1, gLi, 'WB-101', 0, minutesAgo(95));
    insCheckin.run(cTian, m2, gYang, 'WB-102', 1, minutesAgo(70));
    insCheckin.run(cLe, m4, gZheng, 'WB-103', 0, minutesAgo(40));
    const insLoc = db.prepare('INSERT INTO wristband_locations (wristband_no, zone, updated_at) VALUES (?,?,?)');
    insLoc.run('WB-101', '医疗点', minutesAgo(12));
    insLoc.run('WB-102', '滑梯', minutesAgo(8));
    insLoc.run('WB-103', '攀爬网', minutesAgo(5));

    // ---------- 生日会 / 托管班（儿童 ↔ 监护人 ↔ 活动负责人） ----------
    const insParty = db.prepare(`INSERT INTO parties (type, title, leader_id, leader_name, area, start_at, end_at, status)
                                 VALUES (?,?,?,?,?,?,?,?)`);
    const p1 = insParty.run('birthday', '张小雨的5岁生日会', ac, '周婷', '海洋球池、休息区', at(0, 15, 0), at(0, 17, 0), 'scheduled').lastInsertRowid;
    const p2 = insParty.run('daycare', '周末托管班A组', ac, '周婷', '攀爬网、休息区', at(1, 9, 0), at(1, 12, 0), 'scheduled').lastInsertRowid;
    const insPC = db.prepare('INSERT INTO party_children (party_id, child_id, guardian_id) VALUES (?,?,?)');
    insPC.run(p1, cYu, gLi);      // 张小雨 ↔ 母亲张莉
    insPC.run(p1, cTian, gYang);  // 刘天天 ↔ 父亲刘洋
    insPC.run(p1, cGuo, gQian);   // 孙果果 ↔ 母亲孙倩
    insPC.run(p1, cLe, gZheng);   // 周乐乐 ↔ 父亲周正
    insPC.run(p2, cXue, gJian);   // 张小雪 ↔ 父亲王建国
    insPC.run(p2, cLe, gZheng);   // 周乐乐 ↔ 父亲周正

    // ---------- 巡场记录 ----------
    const insPatrol = db.prepare(`INSERT INTO patrol_logs (area, status, note, staff_id, staff_name, created_at)
                                  VALUES (?,?,?,?,?,?)`);
    insPatrol.run('滑梯', '正常', '早检完成，软包完好', pt, '李强', minutesAgo(180));
    insPatrol.run('蹦床', '异常', '弹簧区域异响，已停用挂牌，通知维保', pt, '李强', minutesAgo(150));
    insPatrol.run('攀爬网', '正常', '网面无破损，卡扣齐全', pt, '李强', minutesAgo(120));
    insPatrol.run('海洋球池', '需关注', '摔倒点位已局部消毒，补球 200 个', pt, '李强', minutesAgo(30));
    insPatrol.run('卫生间', '正常', '整点清洁消毒已完成', pt, '李强', minutesAgo(25));
    insPatrol.run('休息区', '正常', '座椅与饮水机正常', pt, '李强', minutesAgo(20));

    // ---------- 事件 ----------
    const insEvent = db.prepare(`INSERT INTO events (code, type, title, description, child_id, member_id, attraction_id, severity, status, archive, created_by_id, created_by_name, created_at, resolved_at)
                                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insTL = db.prepare(`INSERT INTO event_timeline (event_id, kind, actor_id, actor_name, actor_role, content, meta, created_at)
                              VALUES (?,?,?,?,?,?,?,?)`);
    const dstr = new Date(Date.now() + CN_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');

    // EV1 处理中：张小雨海洋球池摔倒
    const ev1 = insEvent.run(`EV-${dstr}-0001`, 'fall', '张小雨在海洋球池摔倒，右膝擦伤',
      '巡场发现张小雨在海洋球池边缘摔倒，右膝轻微擦伤，已启动应急处置。',
      cYu, m1, 4, 'medium', 'processing', null, pt, '李强', minutesAgo(35), null).lastInsertRowid;
    insTL.run(ev1, 'status', pt, '李强', 'patrol', '事件创建（儿童摔倒）：张小雨在海洋球池边缘摔倒，右膝擦伤', '{}', minutesAgo(35));
    insTL.run(ev1, 'firstaid', md, '陈曦', 'medical', '急救箱#1 取用：碘伏棉签×2、创可贴×1；伤口已消毒包扎，无需送医',
      JSON.stringify({ kit: '急救箱#1', items: ['碘伏棉签×2', '创可贴×1'] }), minutesAgo(31));
    insTL.run(ev1, 'communication', fd, '王芳', 'frontdesk', '已电话通知母亲张莉（138****1111），约10分钟后到场',
      JSON.stringify({ to: '张莉', channel: '电话' }), minutesAgo(28));
    insTL.run(ev1, 'wristband', null, '系统', 'system', '手环 WB-101 当前定位：医疗点',
      JSON.stringify({ wristband_no: 'WB-101', zone: '医疗点' }), minutesAgo(12));
    insTL.run(ev1, 'cctv', pt, '李强', 'patrol', '申请调阅海洋球池区域监控：摄像头 C-07，14:02-14:12',
      JSON.stringify({ camera: 'C-07', start: '14:02', end: '14:12' }), minutesAgo(10));
    insTL.run(ev1, 'disinfection', pt, '李强', 'patrol', '海洋球池摔倒点位局部消毒完成，消毒记录已登记',
      JSON.stringify({ area: '海洋球池' }), minutesAgo(8));

    // IC1 收集中：张小雨擦伤的受伤赔付协商（信息已收集，待店长三选一决策）
    const ic1 = db.prepare(`INSERT INTO injury_cases
      (code, event_id, child_id, member_id, attraction_id, injury_type, play_item, action_desc, companion_position, first_aid, parent_demands, created_by_id, created_by_name, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `IC-${dstr}-0001`, ev1, cYu, m1, 4, '擦伤', '海洋球池边缘缓冲区', '从池边跃入球池时右膝磕到池沿软包',
      '母亲张莉在休息区就座（视线可及，但中间有立柱遮挡约 3 秒）',
      '医疗点陈曦清创，碘伏消毒 + 创可贴包扎；留观 15 分钟无异常',
      '母亲到场后表示不追究责任，希望门店承担清创医药费并加强池沿看护',
      pt, '李强', minutesAgo(7)).lastInsertRowid;
    insTL.run(ev1, 'communication', fd, '王芳', 'frontdesk',
      `受伤信息已录入赔付协商单 IC-${dstr}-0001：项目/动作/陪同人位置/急救处理/家长诉求齐备，等待店长选择赔付方式`,
      JSON.stringify({ injury_case_id: ic1 }), minutesAgo(6));

    // EV2 已归档：蹦床设备临停（含完整档案：照片/监控/签字/赔付/复检/权益调整）
    const ev2 = insEvent.run(`EV-${dstr}-0002`, 'equipment_stop', '蹦床运行异响，执行设备临停',
      '巡场发现蹦床弹簧区域异响，立即临停疏散并挂牌，无儿童受伤。',
      null, null, 2, 'high', 'archived',
      JSON.stringify({
        photos: ['蹦床弹簧异响部位特写.jpg', '蹦床停用警示牌照片.jpg'],
        cctv: [{ camera: 'C-03', start: '10:15', end: '10:25', note: '临停前后时段监控已拷贝存档' }],
        parent_signature: '本次事件无儿童受伤，无需家长签字',
        compensation: '无人身赔付；向受影响在场会员 M1002 赠送次卡 1 次',
        recheck: { result: '更换老化弹簧 2 根，满载测试合格，待店长复核后恢复开放', inspector: '维保商 刘工' },
        benefit_adjustment: { add_sessions: 1, applied_to: 'M1002', note: '设备临停受影响会员补偿' }
      }),
      pt, '李强', minutesAgo(60 * 26), minutesAgo(60 * 24)).lastInsertRowid;
    insTL.run(ev2, 'status', pt, '李强', 'patrol', '事件创建（设备临停）：蹦床弹簧区域异响，立即临停', '{}', minutesAgo(60 * 26));
    insTL.run(ev2, 'communication', fd, '王芳', 'frontdesk', '向在场家长广播说明蹦床临停原因与预计恢复时间', '{}', minutesAgo(60 * 26 - 5));
    insTL.run(ev2, 'compensation', fd, '王芳', 'frontdesk', '会员补偿登记：向受影响会员 M1002 赠送次卡 1 次',
      JSON.stringify({ member: 'M1002', add_sessions: 1 }), minutesAgo(60 * 25));
    insTL.run(ev2, 'handover', mg, '赵敏', 'manager', '员工交接：夜班关注蹦床停用挂牌状态，明早维保上门复检', '{}', minutesAgo(60 * 25 - 30));
    insTL.run(ev2, 'recheck', mg, '赵敏', 'manager', '设备复检：更换老化弹簧 2 根，满载测试合格',
      JSON.stringify({ inspector: '维保商 刘工' }), minutesAgo(60 * 24));

    // EV3 待处理：生日会彩排期间家长找不到孩子
    const ev3 = insEvent.run(`EV-${dstr}-0003`, 'lost_child', '生日会彩排期间家长报告找不到孙果果',
      '生日会彩排期间，孙倩报告找不到孙果果，已启动寻人流程。',
      cGuo, m3, null, 'high', 'open', null, ac, '周婷', minutesAgo(6), null).lastInsertRowid;
    insTL.run(ev3, 'status', ac, '周婷', 'activity', '事件创建（走失寻人）：孙果果在生日会彩排期间离开视线', '{}', minutesAgo(6));
    insTL.run(ev3, 'wristband', null, '系统', 'system', '该儿童今日未核验入园，无手环定位；最后目击位置：休息区',
      JSON.stringify({ wristband_no: null, zone: '休息区' }), minutesAgo(5));
    insTL.run(ev3, 'communication', fd, '王芳', 'frontdesk', '前台已广播寻人，并电话同步母亲孙倩；已通知各出口留意',
      JSON.stringify({ to: '孙倩', channel: '广播+电话' }), minutesAgo(3));
    // 走失查找任务（种子）：孙果果未核验入园，无手环，最后目击休息区
    const task3 = generateSearchTask({ id: ev3, child_id: cGuo }, '休息区');
    insTL.run(ev3, 'search', ac, '周婷', 'activity', `已生成查找任务：${searchTaskSummary(task3)}`,
      JSON.stringify({ task_id: task3.id }), minutesAgo(2));

    // ---------- 设备临停分流 ----------
    const insTicket = db.prepare(`INSERT INTO stop_tickets (code, attraction_id, status, reason, affected, created_by_id, created_by_name, created_at, recovered_at)
                                  VALUES (?,?,?,?,?,?,?,?,?)`);
    const insQueue = db.prepare(`INSERT INTO queue_entries (attraction_id, child_id, ticket_id, queue_no, status, transferred_to, created_at)
                                 VALUES (?,?,?,?,?,?,?)`);
    const insRecheck = db.prepare(`INSERT INTO rechecks (attraction_id, ticket_id, photos, result, inspector, confirmed_by, confirmed_at, created_by_name, created_at)
                                   VALUES (?,?,?,?,?,?,?,?,?)`);
    const insIssue = db.prepare(`INSERT INTO ticket_issues (ticket_id, type, title, detail, status, created_by_name, created_at)
                                 VALUES (?,?,?,?,?,?,?)`);

    // 历史单：攀爬网临停已恢复（含检修照片 + 店长确认，作为恢复标准示例）
    const st1 = insTicket.run(`ST-${dstr}-0001`, 3, 'recovered', '卡扣松动，临时检修',
      JSON.stringify([{ child_id: 5, name: '周乐乐', height_cm: 130, wristband_no: 'WB-103', card_no: 'M1004', member_id: 4, source: '在场' }]),
      pt, '李强', minutesAgo(60 * 30), minutesAgo(60 * 28)).lastInsertRowid;
    insRecheck.run(3, st1, JSON.stringify(['卡扣更换特写.jpg', '攀爬网复检合影.jpg']),
      '更换卡扣 3 个，满载测试合格', '维保 刘工', '赵敏', minutesAgo(60 * 28), '李强', minutesAgo(60 * 29));

    // 当前单：蹦床临停（处理中）——受影响儿童来自排队快照
    const affectedTrampoline = [
      { child_id: 1, name: '张小雨', height_cm: 105, wristband_no: 'WB-101', card_no: 'M1001', member_id: 1, source: '排队' },
      { child_id: 5, name: '周乐乐', height_cm: 130, wristband_no: 'WB-103', card_no: 'M1004', member_id: 4, source: '排队' },
    ];
    const st2 = insTicket.run(`ST-${dstr}-0002`, 2, 'open', '弹簧区域异响，临时检修',
      JSON.stringify(affectedTrampoline), pt, '李强', minutesAgo(150), null).lastInsertRowid;
    insQueue.run(2, 1, st2, 'B-01', 'waiting', null, minutesAgo(160));
    insQueue.run(2, 5, st2, 'B-02', 'waiting', null, minutesAgo(155));
    insQueue.run(1, 3, null, 'S-01', 'waiting', null, minutesAgo(50)); // 滑梯正常排队（未受影响）
    insIssue.run(st2, 'party_delay', '「张小雨的5岁生日会」蹦床环节延误',
      '生日会 15:00 开始，蹦床环节预计延误 30 分钟，已通知家长调整流程', 'open', '周婷', minutesAgo(100));

    // ---------- 历史受伤赔付协商：刘天天滑梯下梯口扭伤（已完成全流程，滑梯仍处限制开放） ----------
    const ev4 = insEvent.run(`EV-${dstr}-0004`, 'fall', '刘天天在滑梯下梯口踩空，左脚踝轻微扭伤',
      '刘天天从滑梯缓冲段跑向排队区时踩空台阶，左脚踝轻微扭伤肿胀，已完成赔付协商与员工复盘。',
      cTian, m2, 1, 'medium', 'archived',
      JSON.stringify({
        photos: ['滑梯下梯口台阶照片.jpg', '脚踝冰敷照片.jpg'],
        cctv: [{ camera: 'C-01', start: '10:32', end: '10:40', note: '踩空瞬间及处置过程已拷贝存档' }],
        parent_signature: '父亲刘洋已在赔付协商单上签字确认课时补偿方案（IC-' + dstr + '-0002）',
        compensation: '课时补偿 2 节（协商单 IC-' + dstr + '-0002 店长决策，已写入 M1002），无需医药费报销',
        recheck: null,
        benefit_adjustment: { add_sessions: 2, applied_to: 'M1002', note: '滑梯扭伤赔付协商：课时补偿 2 节' },
        conclusions: { recheck: '本事件为儿童轻微扭伤，不涉及设备损坏，无需设备复检' },
      }),
      pt, '李强', minutesAgo(60 * 50), minutesAgo(60 * 47)).lastInsertRowid;
    insTL.run(ev4, 'status', pt, '李强', 'patrol', '事件创建（儿童摔倒）：刘天天在滑梯下梯口踩空，左脚踝轻微扭伤', '{}', minutesAgo(60 * 50));
    insTL.run(ev4, 'firstaid', md, '陈曦', 'medical', '急救箱#2 取用：冰袋×1、弹性绷带×1；制动冰敷 20 分钟，建议回家观察',
      JSON.stringify({ kit: '急救箱#2', items: ['冰袋×1', '弹性绷带×1'] }), minutesAgo(60 * 50 + 4));
    insTL.run(ev4, 'communication', fd, '王芳', 'frontdesk', '已电话联系父亲刘洋到场，说明伤情与急救处理，家长提出课时补偿诉求',
      JSON.stringify({ to: '刘洋', channel: '电话' }), minutesAgo(60 * 49));

    const ic2 = db.prepare(`INSERT INTO injury_cases
      (code, event_id, child_id, member_id, attraction_id, injury_type, play_item, action_desc, companion_position, first_aid, parent_demands,
       plan, plan_detail, class_sessions, benefit_applied, decided_by, decided_at,
       parent_confirmed, parent_confirmer, parent_confirmed_at, reviewed, reviewed_by, reviewed_at,
       created_by_id, created_by_name, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `IC-${dstr}-0002`, ev4, cTian, m2, 1, '扭伤', '滑梯缓冲段 → 下梯口台阶', '未停稳直接跑向排队区，踩空最后一级台阶',
      '父亲刘洋当时在滑梯正面拍摄区，下梯口在其身后视线盲区',
      '冰袋冰敷 20 分钟、弹性绷带制动；医疗点判定无需送医，回家观察 48 小时',
      '父亲接受道歉，要求补偿课时 2 节并改造下梯口动线',
      'class_compensation', '店长选择「课时补偿」：向次卡 M1002 补偿课时 2 节，已直接写入会员卡；事故复盘会同步纳入本周安全议题',
      2, 1, '赵敏', minutesAgo(60 * 49),
      1, '刘洋（父亲）', minutesAgo(60 * 48), 1, '赵敏', minutesAgo(60 * 47),
      pt, '李强', minutesAgo(60 * 50 + 2)).lastInsertRowid;
    insTL.run(ev4, 'settlement', mg, '赵敏', 'manager',
      '店长决策（赔付协商）：课时补偿 2 节，已写入会员卡 M1002（剩余 4 → 6 节）；事故复盘会同步纳入本周议题',
      JSON.stringify({ plan: 'class_compensation', class_sessions: 2, card_no: 'M1002' }), minutesAgo(60 * 49));
    insTL.run(ev4, 'signature', fd, '王芳', 'frontdesk', '家长确认：父亲刘洋已签字确认课时补偿方案与伤情结论',
      JSON.stringify({ confirmer: '刘洋（父亲）' }), minutesAgo(60 * 48));

    const insMarker = db.prepare(`INSERT INTO staff_review_markers (injury_case_id, event_id, attraction_id, marker_type, content, fix_action, created_by_name, created_at)
                                  VALUES (?,?,?,?,?,?,?,?)`);
    const mk1 = insMarker.run(ic2, ev4, 1, 'route', '下梯口正对排队折返动线，儿童冲下滑梯后直接汇入排队人流，易踩空/碰撞',
      '用软包隔离栏把下梯口动线右移 1.5 米，与排队区物理分流', '赵敏', minutesAgo(60 * 47)).lastInsertRowid;
    const mk2 = insMarker.run(ic2, ev4, 1, 'positioning', '事发时巡场固定在滑梯顶部，下梯口无人站位，存在约 8 秒看护真空',
      '高峰时段增设下梯口定点岗（1 名巡场/前台支援），负责缓冲段减速提醒', '赵敏', minutesAgo(60 * 47)).lastInsertRowid;
    const mk3 = insMarker.run(ic2, ev4, 1, 'blindspot', '家长拍摄区位于滑梯正面，下梯口在家长身后，属于家长视线盲区',
      '地面张贴「请看护至孩子下梯」提示，并把家长等候线划到能同时看到梯口的位置', '赵敏', minutesAgo(60 * 47)).lastInsertRowid;
    insTL.run(ev4, 'review', mg, '赵敏', 'manager',
      `员工复盘会完成，标记 3 项（作为下一次巡场依据）：动线—${'下梯口与排队区动线交叉'}；站位—下梯口看护真空；盲区—家长拍摄区看不到下梯口`,
      JSON.stringify({ markers: [mk1, mk2, mk3] }), minutesAgo(60 * 47));

    // 复盘结论：滑梯在巡场确认整改完成前「限制开放」（不再按原规则开放）
    db.prepare(`UPDATE attractions SET control_status='restricted',
      control_reason=?, control_rule=?, control_case_id=?, controlled_at=? WHERE id=1`)
      .run(`受伤复盘（${'IC-' + dstr + '-0002'} 刘天天扭伤）：下梯口动线/看护/盲区待整改`,
        '限制开放：下梯口限 1 人通过、巡场定点看护；完成 3 项复盘巡场待办并经店长确认前不恢复原规则',
        ic2, minutesAgo(60 * 47));
    insTL.run(ev4, 'status', mg, '赵敏', 'manager', '复盘会决议：滑梯改为限制开放（新规则），3 项整改生成巡场待办，下次巡场逐项核验', '{}', minutesAgo(60 * 47));

    // 协商结束生成的任务：历史两张（家长确认/员工复盘）已完成；3 张复盘巡场待办仍 open（下一次巡场依据）
    const insTask = db.prepare(`INSERT INTO staff_tasks (type, title, detail, ref_id, attraction_id, assignee_role, status, done_by, done_at, created_at)
                                VALUES (?,?,?,?,?,?,?,?,?,?)`);
    insTask.run('parent_confirm', '家长确认赔付方案（刘天天滑梯扭伤）', '请父亲刘洋到场确认课时补偿 2 节并签字', ic2, 1, 'manager', 'done', '王芳', minutesAgo(60 * 48), minutesAgo(60 * 49));
    insTask.run('staff_review', '组织员工复盘会（刘天天滑梯扭伤）', '复盘项目动线、员工站位、家长视线盲区并形成标记', ic2, 1, 'manager', 'done', '赵敏', minutesAgo(60 * 47), minutesAgo(60 * 49));
    insTask.run('patrol_followup', '巡场核验：下梯口动线软包隔离改造', '将下梯口动线右移 1.5 米并与排队区分流，核验后拍照登记', mk1, 1, 'patrol', 'open', null, null, minutesAgo(60 * 47));
    insTask.run('patrol_followup', '巡场核验：高峰下梯口定点岗站位', '高峰时段安排下梯口定点岗并落实减速提醒', mk2, 1, 'patrol', 'open', null, null, minutesAgo(60 * 47));
    insTask.run('patrol_followup', '巡场核验：家长视线盲区提示与等候线', '张贴下梯看护提示，重划可同时看到梯口的家长等候线', mk3, 1, 'patrol', 'open', null, null, minutesAgo(60 * 47));
  });
  tx();
  console.log('[seed] 演示数据已初始化');
}
