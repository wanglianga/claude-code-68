import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, Empty, ErrorBox, Field, Loading, OkBox } from '../components';
import {
  fmtDT, INJURY_PLANS, INJURY_TYPES, MARKER_TYPES, MEMBER_TYPE, parseJSON,
} from '../util';
import type { InjuryCase } from '../types';

const STEPS = [
  { key: 'collect', label: '信息收集' },
  { key: 'decision', label: '店长决策' },
  { key: 'confirm', label: '家长确认' },
  { key: 'review', label: '员工复盘' },
  { key: 'patrol', label: '巡场整改闭环' },
];

export default function InjuryDetail() {
  const { id } = useParams();
  const caseId = Number(id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['injury', caseId],
    queryFn: () => api.injury(caseId),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['injury', caseId] });
    qc.invalidateQueries({ queryKey: ['event'] });
    qc.invalidateQueries({ queryKey: ['attractions'] });
    qc.invalidateQueries({ queryKey: ['patrolTasks'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const c: InjuryCase = data.injury_case;
  const isManager = user?.role === 'manager';
  const canConfirm = user && ['manager', 'frontdesk'].includes(user.role);
  const canPatrol = user && ['patrol', 'manager'].includes(user.role);

  const stageIndex = !c.plan ? 0
    : !c.parent_confirmed ? (c.plan ? 1 : 0)
      : !c.reviewed ? 2
        : (c.patrol_tasks || []).some((t) => t.status === 'open') ? 3 : 4;
  const closed = !!c.plan && c.parent_confirmed === 1 && c.reviewed === 1
    && (c.patrol_tasks || []).length > 0 && (c.patrol_tasks || []).every((t) => t.status === 'done');
  const restricted = c.control_status === 'restricted';

  return (
    <div>
      <div className="muted small mb8"><Link to="/injuries">← 返回受伤赔付协商</Link></div>

      <Card>
        <div className="event-head">
          <div>
            <div className="row">
              <Chip tone="info">{c.code}</Chip>
              <Chip tone="bad">{c.injury_type}</Chip>
              {c.plan
                ? <Chip tone="warn">{INJURY_PLANS[c.plan]?.icon} {c.plan_label}</Chip>
                : <Chip tone="warn">待店长决策</Chip>}
              {c.parent_confirmed ? <Chip tone="ok">家长已确认</Chip> : c.plan ? <Chip tone="warn">待家长确认</Chip> : null}
              {c.reviewed ? <Chip tone="ok">复盘已完成</Chip> : c.parent_confirmed ? <Chip tone="warn">待员工复盘</Chip> : null}
              {restricted && <Chip tone="bad">⛔ 项目限制开放中</Chip>}
              {closed && <Chip tone="ok">✓ 已闭环</Chip>}
            </div>
            <h2 className="mt8" style={{ fontSize: 18 }}>
              {c.child_name || '受伤儿童'} · {c.play_item}
              {c.attraction_name ? `（${c.attraction_name}）` : ''}
            </h2>
            <div className="muted small mt8">
              关联事件 <Link to={`/events/${c.event_id}`}>{c.event_code}</Link>
              {c.card_no && <> · 会员卡 {c.card_no}（{MEMBER_TYPE[c.card_type || 'member']}）</>}
              {' · '}登记：{c.created_by_name} · {fmtDT(c.created_at)}
            </div>
          </div>
        </div>
        {/* 流程步骤条 */}
        <div className="steps mt16">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`step ${i <= stageIndex ? 'on' : ''} ${i === stageIndex ? 'cur' : ''}`}>
              <span className="step-no">{i + 1}</span><span>{s.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="detail-layout mt16">
        <div>
          <CollectCard c={c} invalidate={invalidate} />
          <DecisionCard c={c} isManager={isManager} invalidate={invalidate} />
          <ReviewCard c={c} isManager={isManager} invalidate={invalidate} />
        </div>

        <div>
          <Card title="家长确认（协商任务）" className="mb16">
            {!c.plan ? (
              <Empty text="店长决策后生成家长确认" />
            ) : c.parent_confirmed ? (
              <div className="ok-box">
                ✓ {c.parent_confirmer} 已确认「{c.plan_label}」方案并签字
                <div className="small muted mt8">{fmtDT(c.parent_confirmed_at)}</div>
              </div>
            ) : (
              <ParentConfirmForm c={c} canConfirm={!!canConfirm} invalidate={invalidate} />
            )}
            {(c.tasks || []).filter((t) => t.type === 'parent_confirm').map((t) => (
              <div key={t.id} className="small muted mt8">
                任务状态：{t.status === 'done' ? <Chip tone="ok">已完成 · {t.done_by}</Chip> : <Chip tone="warn">待办</Chip>}
              </div>
            ))}
          </Card>

          <Card title="会员卡权益同步" className="mb16">
            {c.card_no ? (
              <dl className="kv">
                <dt>会员卡</dt><dd>{c.card_no}（{MEMBER_TYPE[c.card_type || 'member']}）</dd>
                {c.card_type === 'punch' && <><dt>剩余次数</dt><dd>{c.remaining_sessions} 次</dd></>}
                <dt>本次方案</dt>
                <dd>
                  {!c.plan ? '待决策' : c.plan === 'medical_reimburse'
                    ? <>医药费报销 <b>{Number(c.medical_fee).toFixed(2)}</b> 元（计次权益不变，赔付已记入会员卡）</>
                    : c.plan === 'class_compensation'
                      ? <>课时补偿 <b>{c.class_sessions}</b> 节 {c.benefit_applied ? <Chip tone="ok">已写入会员卡</Chip> : <Chip tone="warn">待写入</Chip>}</>
                      : '继续观察（不产生赔付）'}
                </dd>
              </dl>
            ) : <Empty text="未关联会员卡" />}
            {c.card_benefits && (
              <BenefitTags benefits={c.card_benefits} />
            )}
          </Card>

          <PatrolTasksCard c={c} canPatrol={!!canPatrol} isManager={isManager} invalidate={invalidate} />
        </div>
      </div>
    </div>
  );
}

function BenefitTags({ benefits }: { benefits: string }) {
  const b = parseJSON<Record<string, string | string[]>>(benefits, {});
  const recs = Array.isArray(b['赔付记录']) ? b['赔付记录'] : [];
  if (!recs.length) return null;
  return (
    <div className="mt8">
      <div className="small muted mb8">会员卡赔付/补偿留痕：</div>
      {recs.map((r, i) => <span key={i} className="tag tag-warn">🤝 {r}</span>)}
    </div>
  );
}

/* ---------- ① 信息收集 ---------- */
function CollectCard({ c, invalidate }: { c: InjuryCase; invalidate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Record<string, string>>({
    injury_type: c.injury_type, play_item: c.play_item, action_desc: c.action_desc,
    companion_position: c.companion_position, first_aid: c.first_aid, parent_demands: c.parent_demands,
  });
  const locked = !!c.plan;

  const rows: [string, string, string][] = [
    ['play_item', '项目', '受伤时正在玩的项目/环节'],
    ['action_desc', '动作', '孩子当时的动作'],
    ['companion_position', '陪同人位置', '事发时陪同监护人在哪里、视线是否被遮挡'],
    ['first_aid', '急救处理', '清创/包扎/冰敷等医疗点处置'],
    ['parent_demands', '家长诉求', '家长到场后的明确诉求'],
  ];

  return (
    <Card title="① 受伤信息收集（项目 · 动作 · 陪同人位置 · 急救处理 · 家长诉求）" className="mb16"
      extra={!locked && !editing
        ? <button className="btn btn-sm" onClick={() => setEditing(true)}>补充/修订</button>
        : locked ? <Chip tone="muted">店长已决策 · 已锁定</Chip> : undefined}>
      {!editing ? (
        <dl className="kv">
          <dt>伤情</dt><dd><Chip tone="bad">{c.injury_type}</Chip></dd>
          {rows.map(([k, label]) => (
            <Fragment2 key={k} label={label} value={(c as unknown as Record<string, string>)[k]} />
          ))}
        </dl>
      ) : (
        <CollectEdit f={f} setF={setF} caseId={c.id} onDone={() => { setEditing(false); invalidate(); }}
          invalidate={invalidate} />
      )}
    </Card>
  );
}

function Fragment2({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd>{value || '—'}</dd></>;
}

function CollectEdit({ f, setF, caseId, onDone }: {
  f: Record<string, string>; setF: (v: Record<string, string>) => void;
  caseId: number; onDone: () => void; invalidate: () => void;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => api.updateCollect(caseId, f),
    onSuccess: () => { qc.invalidateQueries(); onDone(); },
  });
  const upd = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div>
      <Field label="伤情类型">
        <select value={f.injury_type} onChange={(e) => upd('injury_type', e.target.value)}>
          {INJURY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <div className="grid grid-2">
        <Field label="项目 *"><input value={f.play_item} onChange={(e) => upd('play_item', e.target.value)} /></Field>
        <Field label="动作 *"><input value={f.action_desc} onChange={(e) => upd('action_desc', e.target.value)} /></Field>
      </div>
      <Field label="陪同人位置 *">
        <input value={f.companion_position} onChange={(e) => upd('companion_position', e.target.value)}
          placeholder="如：母亲在休息区就座，立柱遮挡约 3 秒" />
      </Field>
      <Field label="急救处理 *">
        <textarea value={f.first_aid} onChange={(e) => upd('first_aid', e.target.value)} /></Field>
      <Field label="家长诉求 *">
        <textarea value={f.parent_demands} onChange={(e) => upd('parent_demands', e.target.value)} /></Field>
      <ErrorBox error={mut.error} />
      <div className="row">
        <button className="btn btn-primary" disabled={mut.isPending || Object.values(f).some((v) => !v.trim())}
          onClick={() => mut.mutate()}>保存收集信息</button>
      </div>
    </div>
  );
}

/* ---------- ② 店长决策 ---------- */
function DecisionCard({ c, isManager, invalidate }: { c: InjuryCase; isManager: boolean; invalidate: () => void }) {
  const [plan, setPlan] = useState('medical_reimburse');
  const [fee, setFee] = useState('');
  const [sessions, setSessions] = useState('2');
  const [detail, setDetail] = useState('');

  const mut = useMutation({
    mutationFn: () => api.injuryDecision(c.id, {
      plan,
      medical_fee: plan === 'medical_reimburse' ? Number(fee) : 0,
      class_sessions: plan === 'class_compensation' ? Number(sessions) : 0,
      plan_detail: detail,
    }),
    onSuccess: invalidate,
  });

  if (c.plan) {
    return (
      <Card title="② 店长赔付决策（会员卡权益 · 事故复盘同步调整）" className="mb16">
        <dl className="kv">
          <dt>选择方案</dt><dd><Chip tone="warn">{INJURY_PLANS[c.plan]?.icon} {c.plan_label}</Chip></dd>
          {c.plan === 'medical_reimburse' && <><dt>报销金额</dt><dd><b>{Number(c.medical_fee).toFixed(2)}</b> 元</dd></>}
          {c.plan === 'class_compensation' && <><dt>补偿课时</dt><dd><b>{c.class_sessions}</b> 节 · {c.benefit_applied ? '已直接写入会员卡' : '待写入'}</dd></>}
          {c.plan_detail && <><dt>补充说明</dt><dd>{c.plan_detail}</dd></>}
          <dt>决策人</dt><dd>{c.decided_by} · {fmtDT(c.decided_at)}</dd>
        </dl>
        <div className="ok-box mt8">决策已同步：会员卡权益已调整；事故复盘会已纳入议程并生成员工复盘任务。</div>
      </Card>
    );
  }

  return (
    <Card title="② 店长赔付决策（三选一：医药费报销 · 课时补偿 · 继续观察）" className="mb16">
      {!isManager && <div className="error-box mb8">仅店长可做出赔付方式决策</div>}
      <div className="plan-grid">
        {Object.entries(INJURY_PLANS).map(([k, p]) => (
          <button key={k} type="button" disabled={!isManager}
            className={`plan-card ${plan === k ? 'sel' : ''}`} onClick={() => setPlan(k)}>
            <div className="plan-ico">{p.icon}</div>
            <b>{p.label}</b>
            <div className="small muted mt8">{p.desc}</div>
          </button>
        ))}
      </div>
      {plan === 'medical_reimburse' && (
        <Field label="报销医药费金额（元）*">
          <input type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="如 88.50" />
        </Field>
      )}
      {plan === 'class_compensation' && (
        <Field label="补偿课时数（节）*">
          <input type="number" min="1" value={sessions} onChange={(e) => setSessions(e.target.value)} />
        </Field>
      )}
      <Field label="补充说明（凭证/有效期/观察安排等）">
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)}
          placeholder={plan === 'continue_observation' ? '如：48 小时内电话回访，如有肿胀加重立即复诊' : '如：凭医疗小票当日结清 / 补偿课时 7 日内预约有效'} />
      </Field>
      <ErrorBox error={mut.error} />
      {isManager && (
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={mut.isPending}
          onClick={() => mut.mutate()}>
          确认决策并同步会员卡权益、生成家长确认与员工复盘任务
        </button>
      )}
    </Card>
  );
}

/* ---------- ③ 家长确认 ---------- */
function ParentConfirmForm({ c, canConfirm, invalidate }: { c: InjuryCase; canConfirm: boolean; invalidate: () => void }) {
  const [confirmer, setConfirmer] = useState(c.child_name ? `${c.child_name}的家长` : '');
  const mut = useMutation({ mutationFn: () => api.parentConfirm(c.id, confirmer), onSuccess: invalidate });
  return (
    <div>
      <div className="small muted mb8">
        方案：<b>{c.plan_label}</b>
        {c.plan === 'medical_reimburse' && ` · 报销 ${Number(c.medical_fee).toFixed(2)} 元`}
        {c.plan === 'class_compensation' && ` · 补偿 ${c.class_sessions} 节（已写入会员卡）`}
      </div>
      <Field label="确认家长（姓名 + 与儿童关系）*">
        <input value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="如：孙倩（母亲）" />
      </Field>
      <ErrorBox error={mut.error} />
      <OkBox text={mut.isSuccess ? '家长已确认签字' : null} />
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={!canConfirm || !confirmer.trim() || mut.isPending}
        onClick={() => mut.mutate()}>
        {canConfirm ? '登记家长确认签字' : '仅店长/前台可登记'}
      </button>
    </div>
  );
}

/* ---------- ④ 员工复盘：动线 / 站位 / 盲区 ---------- */
function ReviewCard({ c, isManager, invalidate }: { c: InjuryCase; isManager: boolean; invalidate: () => void }) {
  const [mtype, setMtype] = useState('route');
  const [content, setContent] = useState('');
  const [fix, setFix] = useState('');
  const [rule, setRule] = useState('');

  const add = useMutation({
    mutationFn: () => api.addMarker(c.id, { marker_type: mtype, content, fix_action: fix }),
    onSuccess: () => { setContent(''); setFix(''); invalidate(); },
  });
  const complete = useMutation({
    mutationFn: () => api.completeReview(c.id, rule),
    onSuccess: invalidate,
  });
  const clear = useMutation({ mutationFn: () => api.clearControl(c.id), onSuccess: invalidate });

  const markersByType = (t: string) => (c.markers || []).filter((m) => m.marker_type === t);
  const hasTypes = new Set((c.markers || []).map((m) => m.marker_type));
  const openPatrol = (c.patrol_tasks || []).filter((t) => t.status === 'open').length;

  return (
    <Card title="④ 员工复盘会（项目动线 · 员工站位 · 家长视线盲区 → 下一次巡场依据）">
      {!c.plan && <Empty text="请先完成店长决策，再组织复盘会" />}
      {c.plan && (
        <>
          <div className="marker-grid">
            {Object.entries(MARKER_TYPES).map(([k, m]) => {
              const list = markersByType(k);
              return (
                <div className={`marker-col ${list.length ? 'has' : ''}`} key={k}>
                  <div className="marker-head">{m.icon} {m.label}
                    {list.length > 0 && <Chip tone="ok">{list.length}</Chip>}
                  </div>
                  {list.length === 0 && <div className="small muted">待标记</div>}
                  {list.map((x) => (
                    <div className="info-block" key={x.id}>
                      <div>{x.content}</div>
                      {x.fix_action && <div className="small mt8">🛠 整改：{x.fix_action}</div>}
                      <div className="small muted mt8">{x.created_by_name} · {fmtDT(x.created_at)}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {!c.reviewed ? (
            <>
              {!isManager && <div className="error-box mt8">仅店长可录入复盘标记并结束复盘会</div>}
              {isManager && (
                <div className="mt16" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  <Field label="标记类型">
                    <div className="row">
                      {Object.entries(MARKER_TYPES).map(([k, m]) => (
                        <button key={k} type="button" className={`btn btn-sm ${mtype === k ? 'btn-primary' : ''}`}
                          onClick={() => setMtype(k)}>{m.icon} {m.label}</button>
                      ))}
                    </div>
                  </Field>
                  <Field label="隐患描述 *">
                    <textarea value={content} onChange={(e) => setContent(e.target.value)}
                      placeholder={MARKER_TYPES[mtype].hint} />
                  </Field>
                  <Field label="整改/调整措施">
                    <input value={fix} onChange={(e) => setFix(e.target.value)}
                      placeholder="如：软包隔离动线、增设定点岗、加装凸面镜/重划等候线" />
                  </Field>
                  <ErrorBox error={add.error} />
                  <button className="btn" disabled={!content.trim() || add.isPending} onClick={() => add.mutate()}>＋ 添加复盘标记</button>

                  <Field label="项目限制开放新规则（结束复盘后生效，留空使用默认规则）">
                    <textarea value={rule} onChange={(e) => setRule(e.target.value)}
                      placeholder={`如：${c.attraction_name || '该项目'}限制开放：单次限 1 人通过、巡场定点看护，整改完成前不按原规则开放`} />
                  </Field>
                  <ErrorBox error={complete.error} />
                  <button className="btn btn-primary" style={{ width: '100%' }} disabled={complete.isPending}
                    onClick={() => complete.mutate()}>
                    结束复盘会：项目改为限制开放并生成复盘巡场待办（须三类标记齐备）
                  </button>
                  {(!hasTypes.has('route') || !hasTypes.has('positioning') || !hasTypes.has('blindspot')) && (
                    <div className="small muted mt8">三类标记（动线/站位/盲区）各至少 1 条才能结束复盘会。</div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="ok-box mt8">
              ✓ 复盘会已结束（{c.reviewed_by} · {fmtDT(c.reviewed_at)}）：
              {c.attraction_name ? `项目「${c.attraction_name}」已按新规限制开放，${(c.patrol_tasks || []).length} 项整改转为巡场待办` : '隐患已转为巡场关注'}，防止同类项目继续按原规则开放。
            </div>
          )}
          {c.reviewed && c.control_status === 'restricted' && isManager && (
            <div className="mt16">
              <ErrorBox error={clear.error} />
              <button className="btn btn-primary" disabled={openPatrol > 0 || clear.isPending}
                onClick={() => clear.mutate()}>
                {openPatrol > 0 ? `仍有 ${openPatrol} 项巡场待办未核验，暂不能解除限制开放` : '确认整改全部完成，解除限制开放'}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ---------- ⑤ 复盘巡场待办（下一次巡场依据） ---------- */
function PatrolTasksCard({ c, canPatrol, isManager, invalidate }: {
  c: InjuryCase; canPatrol: boolean; isManager: boolean; invalidate: () => void;
}) {
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const tasks = c.patrol_tasks || [];
  const done = useMutation({
    mutationFn: (id: number) => api.donePatrolTask(id, noteById[id] || ''),
    onSuccess: invalidate,
  });
  return (
    <Card title="复盘巡场待办（下一次巡场逐项核验）"
      extra={c.control_status === 'restricted' ? <Chip tone="bad">限制开放中</Chip> : c.reviewed ? <Chip tone="ok">已解除</Chip> : undefined}>
      {tasks.length === 0 ? <Empty text={c.reviewed ? '无待办' : '复盘会结束后生成'} /> : (
        <>
          {tasks.map((t) => (
            <div className="info-block" key={t.id}>
              <div className="row spread">
                <b>{MARKER_TYPES[t.marker_type]?.icon} {t.title}</b>
                {t.status === 'done'
                  ? <Chip tone="ok">已核验 · {t.done_by}</Chip>
                  : <Chip tone="warn">待巡场</Chip>}
              </div>
              <div className="small muted mt8">{t.detail}</div>
              {t.status === 'open' && (
                <div className="row mt8">
                  <input placeholder="核验记录（现场情况/照片编号）" value={noteById[t.id] || ''}
                    onChange={(e) => setNoteById({ ...noteById, [t.id]: e.target.value })} />
                  <button className="btn btn-sm btn-primary" disabled={!canPatrol || done.isPending}
                    onClick={() => done.mutate(t.id)}>
                    {canPatrol ? '核验完成' : '巡场/店长'}
                  </button>
                </div>
              )}
              {t.status === 'done' && t.done_at && <div className="small muted mt8">{fmtDT(t.done_at)}</div>}
            </div>
          ))}
          {!isManager && !canPatrol && <div className="small muted mt8">巡场或店长可登记核验结果。</div>}
        </>
      )}
    </Card>
  );
}
