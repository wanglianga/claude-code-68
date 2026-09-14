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
`);

const nowIso = () => new Date().toISOString();
function at(dayOffset, h, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
function minutesAgo(min) {
  return new Date(Date.now() - min * 60000).toISOString();
}

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

    // M1002 次卡家庭：刘洋（剩余 6 次，含设备临停补偿的 1 次）
    const m2 = insMember.run('M1002', 'punch', '刘洋', '13800002222', 6,
      JSON.stringify({ 剩余权益说明: '次卡按次扣减；含设备临停补偿1次' }),
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
    const dstr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

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
  });
  tx();
  console.log('[seed] 演示数据已初始化');
}
