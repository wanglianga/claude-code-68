import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal } from '../components';
import {
  ageOf, ATTR_KEY_NAMES, EVENT_STATUS, EVENT_TYPES, fmtDT, fmtT, INJURY_TYPES, KIND_META, MEMBER_TYPE,
  parseJSON, ROLE_NAMES, SEVERITY, TIMELINE_KIND_OPTIONS,
} from '../util';
import type { ArchiveData } from '../types';

function ConclusionTag({ text }: { text?: string }) {
  return text ? <span className="tag tag-warn">结论：{text}</span> : <span className="muted">—</span>;
}

/** 各事件类型适用的归档资料（与服务端 ARCHIVE_RULES 一致） */
const ARCHIVE_APPLICABLE: Record<string, string[]> = {
  fall: ['photos', 'cctv', 'parent_signature', 'compensation'],
  push: ['photos', 'cctv', 'parent_signature'],
  equipment_stop: ['photos', 'cctv', 'recheck', 'benefit_adjustment'],
  lost_child: ['cctv', 'parent_signature'],
  card_dispute: ['parent_signature', 'compensation', 'benefit_adjustment'],
  refund: ['parent_signature', 'compensation', 'benefit_adjustment'],
};
const MATERIAL_LABELS: Record<string, string> = {
  photos: '现场照片', cctv: '监控时间段', parent_signature: '家长签字',
  compensation: '赔付方案', recheck: '设备复检', benefit_adjustment: '会员权益调整',
};

export default function EventDetail() {
  const { id } = useParams();
  const eventId = Number(id);
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.eventDetail(eventId),
  });

  const [kind, setKind] = useState('communication');
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [showArchive, setShowArchive] = useState(false);
  const [showCreateInjury, setShowCreateInjury] = useState(false);

  // 走失查找：发现登记
  const attrs = useQuery({ queryKey: ['attractions'], queryFn: api.attractions });
  const [foundZone, setFoundZone] = useState('');
  const [companion, setCompanion] = useState('');
  const [childState, setChildState] = useState('情绪平稳');
  const [needComfort, setNeedComfort] = useState(false);
  const [takenByOther, setTakenByOther] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['event', eventId] });

  const addEntry = useMutation({
    mutationFn: () => api.addTimeline(eventId, kind, content, meta),
    onSuccess: () => { setContent(''); setMeta({}); invalidate(); },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api.setEventStatus(eventId, status),
    onSuccess: invalidate,
  });
  const genTask = useMutation({
    mutationFn: () => api.regenSearchTask(eventId),
    onSuccess: invalidate,
  });
  const reportFound = useMutation({
    mutationFn: () => api.reportFound(eventId, {
      found_zone: foundZone, companion, child_state: childState,
      need_comfort: needComfort, taken_by_other: takenByOther,
      other_guardian_name: otherName, other_guardian_phone: otherPhone,
    }),
    onSuccess: invalidate,
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const { event, timeline, child, member, guardians, parties, search_task, found_report, injury_case } = data;
  const archive = parseJSON<ArchiveData | null>(event.archive, null);
  const st = EVENT_STATUS[event.status];
  const isLost = event.type === 'lost_child';
  const isInjuryEvent = ['fall', 'push'].includes(event.type);
  const canOperate = !!user && ['patrol', 'manager'].includes(user.role);
  const needFoundReport = isLost && !found_report; // 走失事件须先登记发现信息才能关闭
  const zones = [...(attrs.data?.attractions.map((a) => a.name) || []), '医疗点', '入口', '出口'];

  const metaFields: Record<string, { key: string; label: string; ph?: string }[]> = {
    wristband: [{ key: 'wristband_no', label: '手环号', ph: 'WB-101' }, { key: 'zone', label: '定位区域', ph: '医疗点 / 滑梯…' }],
    cctv: [{ key: 'camera', label: '摄像头', ph: 'C-07' }, { key: 'start', label: '开始时间', ph: '14:02' }, { key: 'end', label: '结束时间', ph: '14:12' }],
    firstaid: [{ key: 'kit', label: '急救箱编号', ph: '急救箱#1' }, { key: 'items', label: '取用物品', ph: '碘伏棉签×2、创可贴×1' }],
    disinfection: [{ key: 'area', label: '消毒区域', ph: '海洋球池' }],
    compensation: [{ key: 'amount', label: '补偿内容', ph: '次卡+1 / 退款 200 元' }],
    handover: [{ key: 'to', label: '交接给', ph: '夜班值班长' }],
  };

  return (
    <div>
      <div className="muted small mb8"><Link to="/events">← 返回事件中心</Link></div>
      <Card>
        <div className="event-head">
          <div>
            <div className="row">
              <Chip tone="info">{event.code}</Chip>
              <Chip tone="warn">{EVENT_TYPES[event.type]}</Chip>
              <Chip tone={SEVERITY[event.severity].tone}>{SEVERITY[event.severity].label}</Chip>
              <Chip tone={st.tone}>{st.label}</Chip>
            </div>
            <h2 className="mt8" style={{ fontSize: 18 }}>{event.title}</h2>
            <div className="muted small mt8">
              上报：{event.created_by_name} · {fmtDT(event.created_at)}
              {event.attraction_name && ` · 项目：${event.attraction_name}`}
              {event.resolved_at && ` · 解决：${fmtDT(event.resolved_at)}`}
            </div>
            {event.description && <p className="muted mb8">{event.description}</p>}
          </div>
          <div className="row">
            {event.status === 'open' && (
              <button className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate('processing')}>开始处置</button>
            )}
            {(event.status === 'open' || event.status === 'processing') && user && ['manager', 'medical'].includes(user.role) && (
              needFoundReport
                ? <span className="muted small">登记发现信息后方可关闭</span>
                : <button className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate('resolved')}>标记解决</button>
            )}
            {event.status !== 'archived' && user?.role === 'manager' && (
              event.status === 'resolved' ? (
                <button className="btn btn-primary" onClick={() => setShowArchive(true)}>归档（档案+权益调整）</button>
              ) : (
                <span className="muted small">事件「已解决」后方可归档</span>
              )
            )}
          </div>
        </div>
        <ErrorBox error={setStatus.error} />
      </Card>

      {isLost && (
        <div className="grid grid-2 mt16">
          <Card title="查找任务（最后入场项目 · 手环 · 监控点位 · 巡场分派）"
            extra={search_task && (
              <Chip tone={search_task.status === 'found' ? 'ok' : 'bad'}>
                {search_task.status === 'found' ? '已找到' : '查找中 · 出园已冻结'}
              </Chip>
            )}>
            {!search_task ? <Empty text="尚未生成查找任务" /> : (() => {
              const cams = parseJSON<string[]>(search_task.cameras, []);
              const asg = parseJSON<{ staff: string; last_area: string; zone: string }[]>(search_task.assignments, []);
              return (
                <>
                  <dl className="kv">
                    <dt>手环编号</dt><dd>{search_task.wristband_no || '无（未核验入园）'}</dd>
                    <dt>最后位置</dt><dd><b>{search_task.last_zone}</b></dd>
                    <dt>监控点位</dt>
                    <dd>{cams.map((c) => <span key={c} className="tag">🎥 {c}</span>)}</dd>
                  </dl>
                  <table className="table mt8">
                    <thead><tr><th>巡场人员</th><th>最近巡场位置</th><th>负责搜索区域</th></tr></thead>
                    <tbody>
                      {asg.map((a, i) => (
                        <tr key={i}><td>{a.staff}</td><td>{a.last_area}</td><td><b>{a.zone}</b></td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              );
            })()}
            {search_task?.status !== 'found' && event.status !== 'archived' && user && ['patrol', 'manager', 'frontdesk'].includes(user.role) && (
              <button className="btn btn-sm mt8" disabled={genTask.isPending} onClick={() => genTask.mutate()}>
                ↻ 按最新信息重新生成查找任务
              </button>
            )}
            <ErrorBox error={genTask.error} />
          </Card>

          {found_report ? (
            <Card title="发现孩子登记" extra={<Chip tone="ok">已登记</Chip>}>
              <dl className="kv">
                <dt>发现地点</dt><dd><b>{found_report.found_zone}</b></dd>
                <dt>陪同人</dt><dd>{found_report.companion}</dd>
                <dt>孩子状态</dt><dd>{found_report.child_state}</dd>
                <dt>需要安抚</dt><dd>{found_report.need_comfort ? '是' : '否'}</dd>
                {!!found_report.taken_by_other && (
                  <>
                    <dt>曾被带离</dt>
                    <dd>
                      <span className="tag tag-warn">曾被其他家长带离项目区</span>
                      对方监护人：{found_report.other_guardian_name}（{found_report.other_guardian_phone || '电话未留'}）
                      <div className="muted small mt8">已下发巡场提醒：出口岗核对陪同授权后再放行</div>
                    </dd>
                  </>
                )}
                <dt>登记人</dt><dd>{found_report.recorded_by_name} · {fmtDT(found_report.created_at)}</dd>
              </dl>
            </Card>
          ) : (
            <Card title="发现孩子登记" extra={<Chip tone="warn">登记后事件方可关闭</Chip>}>
              {!canOperate ? (
                <Empty text="由巡场或店长登记发现信息" />
              ) : (
                <>
                  <div className="grid grid-2">
                    <Field label="发现地点 *">
                      <select value={foundZone} onChange={(e) => setFoundZone(e.target.value)}>
                        <option value="">请选择…</option>
                        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </Field>
                    <Field label="陪同人 *">
                      <input value={companion} onChange={(e) => setCompanion(e.target.value)}
                        placeholder="发现时在孩子身边的人，如：巡场 李强" />
                    </Field>
                  </div>
                  <div className="grid grid-2">
                    <Field label="孩子状态 *">
                      <select value={childState} onChange={(e) => setChildState(e.target.value)}>
                        {['情绪平稳', '受惊哭闹', '轻微擦伤', '需医疗检查'].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </Field>
                    <Field label="是否需要安抚">
                      <label className="row small" style={{ gap: 6, marginTop: 10 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={needComfort}
                          onChange={(e) => setNeedComfort(e.target.checked)} />
                        需要安抚（通知家长到医疗点/休息区）
                      </label>
                    </Field>
                  </div>
                  <Field label="是否曾被其他家长带离项目区">
                    <label className="row small" style={{ gap: 6 }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={takenByOther}
                        onChange={(e) => setTakenByOther(e.target.checked)} />
                      是，曾被其他家长带离（须记录对方监护人并提醒巡场）
                    </label>
                  </Field>
                  {takenByOther && (
                    <div className="grid grid-2">
                      <Field label="对方监护人姓名 *">
                        <input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="如：王某" />
                      </Field>
                      <Field label="对方监护人电话">
                        <input value={otherPhone} onChange={(e) => setOtherPhone(e.target.value)} placeholder="138…" />
                      </Field>
                    </div>
                  )}
                  <ErrorBox error={reportFound.error} />
                  <button className="btn btn-primary" style={{ width: '100%' }}
                    disabled={!foundZone || !companion.trim() || reportFound.isPending}
                    onClick={() => reportFound.mutate()}>
                    确认发现孩子并登记
                  </button>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      <div className="detail-layout">
        <div>
          {isInjuryEvent && (
            <Card className="mb16"
              title={injury_case ? `受伤赔付协商单 ${injury_case.code}` : '受伤赔付协商（擦伤 / 扭伤）'}
              extra={injury_case ? (
                <span className="row">
                  {!injury_case.plan && <Chip tone="warn">待店长决策</Chip>}
                  {injury_case.plan && <Chip tone="info">{injury_case.plan_label}</Chip>}
                  {injury_case.parent_confirmed ? <Chip tone="ok">家长已确认</Chip> : injury_case.plan ? <Chip tone="warn">待家长确认</Chip> : null}
                  {injury_case.reviewed ? <Chip tone="ok">复盘已完成</Chip> : injury_case.parent_confirmed ? <Chip tone="warn">待员工复盘</Chip> : null}
                </span>
              ) : undefined}>
              {injury_case ? (
                <div className="row spread">
                  <span className="small muted">
                    收集项目 / 动作 / 陪同人位置 / 急救处理 / 家长诉求；店长选择医药费报销、课时补偿或继续观察后，
                    会员卡权益与事故复盘会同步调整。
                  </span>
                  <Link className="btn btn-primary btn-sm" to={`/injuries/${injury_case.id}`}>进入协商 →</Link>
                </div>
              ) : event.status === 'archived' ? (
                <Empty text="事件已归档，未发起赔付协商" />
              ) : (
                <div className="row spread">
                  <span className="small muted">儿童擦伤或扭伤后，在此收集伤情与诉求并发起赔付协商，生成家长确认与员工复盘任务。</span>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowCreateInjury(true)}>＋ 发起赔付协商</button>
                </div>
              )}
            </Card>
          )}
          <Card title="统一事件线（手环定位 · 监控调阅 · 急救箱 · 消毒 · 补偿 · 交接 · 沟通）">
            <div className="timeline mt8">
              {timeline.map((t) => {
                const km = KIND_META[t.kind] || KIND_META.note;
                const m = parseJSON<Record<string, string>>(t.meta, {});
                return (
                  <div className="tl-item" key={t.id}>
                    <div className="tl-dot">{km.icon}</div>
                    <div className="tl-head">
                      <Chip tone={km.tone}>{km.label}</Chip>
                      <b>{t.actor_name}</b>
                      <span className="muted small">{ROLE_NAMES[t.actor_role] || t.actor_role}</span>
                      <span className="tl-time">{fmtDT(t.created_at)}</span>
                    </div>
                    <div className="tl-content">{t.content}</div>
                    {Object.keys(m).length > 0 && (
                      <div className="tl-meta">
                        {Object.entries(m).map(([k, v]) => <span key={k} className="tag">{k}: {String(v)}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {event.status !== 'archived' ? (
              <div className="mt16" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <div className="row mb8">
                  <select style={{ width: 200 }} value={kind} onChange={(e) => { setKind(e.target.value); setMeta({}); }}>
                    {TIMELINE_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {(metaFields[kind] || []).map((f) => (
                    <input key={f.key} style={{ width: 170 }} placeholder={f.ph || f.label}
                      value={meta[f.key] || ''} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} />
                  ))}
                </div>
                <textarea placeholder={`记录${KIND_META[kind].label}详情…`} value={content}
                  onChange={(e) => setContent(e.target.value)} />
                <ErrorBox error={addEntry.error} />
                <button className="btn btn-primary mt8" disabled={!content.trim() || addEntry.isPending}
                  onClick={() => addEntry.mutate()}>
                  追加到事件线
                </button>
              </div>
            ) : (
              <div className="ok-box mt16">事件已归档，档案完整，仅供查阅。</div>
            )}
          </Card>

          {archive && (
            <Card className="mt16" title="安全档案（照片 · 监控 · 签字 · 赔付 · 复检 · 权益调整）">
              <dl className="kv">
                <dt>现场照片</dt>
                <dd>{archive.photos.length
                  ? archive.photos.map((p, i) => <span key={i} className="tag">📷 {p}</span>)
                  : <ConclusionTag text={archive.conclusions?.photos} />}</dd>
                <dt>监控时间段</dt>
                <dd>{archive.cctv.length
                  ? archive.cctv.map((c, i) => <span key={i} className="tag">🎥 {c.camera} {c.start}–{c.end}{c.note ? `（${c.note}）` : ''}</span>)
                  : <ConclusionTag text={archive.conclusions?.cctv} />}</dd>
                <dt>家长签字</dt>
                <dd>{archive.parent_signature || <ConclusionTag text={archive.conclusions?.parent_signature} />}</dd>
                <dt>赔付方案</dt>
                <dd>{archive.compensation || <ConclusionTag text={archive.conclusions?.compensation} />}</dd>
                <dt>设备复检</dt>
                <dd>{archive.recheck?.result
                  ? `${archive.recheck.result}（复检人：${archive.recheck.inspector || '—'}）`
                  : <ConclusionTag text={archive.conclusions?.recheck} />}</dd>
                <dt>权益调整</dt>
                <dd>{archive.benefit_adjustment
                  ? `会员卡 ${archive.benefit_adjustment.applied_to || '—'} 补偿 ${archive.benefit_adjustment.add_sessions || 0} 次${archive.benefit_adjustment.note ? `；${archive.benefit_adjustment.note}` : ''}`
                  : <ConclusionTag text={archive.conclusions?.benefit_adjustment} />}</dd>
                <dt>归档人</dt><dd>{archive.archived_by} · {fmtDT(archive.archived_at)}</dd>
              </dl>
            </Card>
          )}
        </div>

        <div>
          {child && (
            <Card title="关联儿童档案" className="mb16">
              <div className="info-block">
                <div className="row spread">
                  <b style={{ fontSize: 15 }}>{child.name}</b>
                  <Chip tone="info">{ageOf(child.birth_date)} · {child.height_cm}cm</Chip>
                </div>
                <div className="mt8">
                  {child.allergies && child.allergies !== '无' && <span className="tag tag-bad">⚠ 过敏：{child.allergies}</span>}
                  {parseJSON<string[]>(child.banned, []).map((b) => (
                    <span key={b} className="tag tag-warn">🚫 禁玩：{ATTR_KEY_NAMES[b] || b}</span>
                  ))}
                </div>
                {member && (
                  <div className="small muted mt8">
                    会员卡 {member.card_no}（{MEMBER_TYPE[member.type]}）
                    {member.type === 'punch' && ` · 剩余 ${member.remaining_sessions} 次`}
                  </div>
                )}
              </div>
              <h4 className="small muted mb8">监护人（事故沟通时找真正授权人）</h4>
              <table className="table">
                <tbody>
                  {guardians.map((g) => (
                    <tr key={g.id}>
                      <td><b>{g.name}</b> <span className="muted small">{g.relation}</span></td>
                      <td>{g.phone}</td>
                      <td>{g.is_authorized ? <Chip tone="ok">授权陪同</Chip> : <Chip tone="muted">仅紧急联系</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {parties.length > 0 && (
            <Card title="所属活动（儿童 ↔ 监护人 ↔ 负责人）" className="mb16">
              {parties.map((p) => (
                <div className="info-block" key={p.id}>
                  <div className="row spread">
                    <b>{p.type === 'birthday' ? '🎂' : '🎒'} {p.title}</b>
                    <Chip tone="info">{fmtT(p.start_at)}–{fmtT(p.end_at)}</Chip>
                  </div>
                  <div className="small muted mt8">活动负责人：<b>{p.leader_name}</b> · 区域：{p.area}</div>
                  <table className="table mt8">
                    <thead><tr><th>儿童</th><th>对应监护人（授权人）</th><th>电话</th></tr></thead>
                    <tbody>
                      {(p.children || []).map((pc) => (
                        <tr key={pc.child_id} style={pc.child_id === child?.id ? { background: '#fff8f3' } : undefined}>
                          <td>{pc.child_name}{pc.child_id === child?.id && ' ← 本事件儿童'}</td>
                          <td>{pc.guardian_name}（{pc.relation}）{pc.is_authorized ? ' ✓' : ''}</td>
                          <td>{pc.guardian_phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </Card>
          )}

          {!child && member && (
            <Card title="关联会员" className="mb16">
              <dl className="kv">
                <dt>会员卡</dt><dd>{member.card_no}（{MEMBER_TYPE[member.type]}）</dd>
                <dt>持卡人</dt><dd>{member.holder_name} {member.phone}</dd>
                {member.type === 'punch' && <><dt>剩余次数</dt><dd>{member.remaining_sessions} 次</dd></>}
              </dl>
            </Card>
          )}
        </div>
      </div>

      {showArchive && (
        <ArchiveModal eventId={eventId} eventType={event.type} onClose={() => setShowArchive(false)}
          onDone={() => { setShowArchive(false); invalidate(); }} />
      )}

      {showCreateInjury && (
        <CreateInjuryModal eventId={eventId}
          defaultChildId={child?.id} defaultAttrId={event.attraction_id}
          onClose={() => setShowCreateInjury(false)}
          onDone={(icId) => { setShowCreateInjury(false); invalidate(); nav(`/injuries/${icId}`); }} />
      )}
    </div>
  );
}

function ArchiveModal({ eventId, eventType, onClose, onDone }: {
  eventId: number; eventType: string; onClose: () => void; onDone: () => void;
}) {
  const [photos, setPhotos] = useState('');
  const [cctv, setCctv] = useState([{ camera: '', start: '', end: '', note: '' }]);
  const [signature, setSignature] = useState('');
  const [compensation, setCompensation] = useState('');
  const [recheckResult, setRecheckResult] = useState('');
  const [recheckInspector, setRecheckInspector] = useState('');
  const [addSessions, setAddSessions] = useState('');
  const [benefitNote, setBenefitNote] = useState('');
  const [conclusions, setConclusions] = useState<Record<string, string>>({});

  const applicable = ARCHIVE_APPLICABLE[eventType] || [];
  const typeLabel = EVENT_TYPES[eventType] || eventType;
  const mark = (key: string) => (applicable.includes(key) ? ' *' : '（不适用）');

  const archive = useMutation({
    mutationFn: () => api.archiveEvent(eventId, {
      photos: photos.split('\n').map((s) => s.trim()).filter(Boolean),
      cctv: cctv.filter((c) => c.camera || c.start || c.end),
      parent_signature: signature,
      compensation,
      recheck: recheckResult ? { result: recheckResult, inspector: recheckInspector } : null,
      benefit_adjustment: addSessions ? { add_sessions: Number(addSessions), note: benefitNote } : null,
      conclusions: Object.fromEntries(Object.entries(conclusions).filter(([, v]) => v.trim())),
    }),
    onSuccess: onDone,
  });

  const req = (key: string) => applicable.includes(key)
    ? <span style={{ color: 'var(--bad)' }}> *</span>
    : <span className="muted">（不适用）</span>;

  return (
    <Modal title="事件归档：现场照片 / 监控 / 签字 / 赔付 / 复检 / 权益调整" onClose={onClose} wide>
      <div className="ok-box" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>
        事件类型「{typeLabel}」适用资料（标 * 项）：{applicable.map((k) => MATERIAL_LABELS[k]).join('、') || '无'}。
        适用项必须提供真实资料，不能用结论替代；不适用项可填写明确结论，留空自动生成。
      </div>
      <div className="grid grid-2">
        <Field label={`现场照片（每行一个文件名/链接）${mark('photos')}`}>
          <textarea value={photos} onChange={(e) => setPhotos(e.target.value)} placeholder={'滑梯入口特写.jpg\n警示牌照片.jpg'} />
        </Field>
        <Field label={`家长签字确认${mark('parent_signature')}`}>
          <textarea value={signature} onChange={(e) => setSignature(e.target.value)}
            placeholder="如：母亲张莉已现场确认伤情与处理结果并签字" />
        </Field>
      </div>
      <Field label={`监控时间段${mark('cctv')}`}>
        {cctv.map((c, i) => (
          <div className="row mb8" key={i}>
            <input style={{ width: 110 }} placeholder="摄像头 C-07" value={c.camera}
              onChange={(e) => setCctv(cctv.map((x, j) => j === i ? { ...x, camera: e.target.value } : x))} />
            <input style={{ width: 90 }} placeholder="开始 14:02" value={c.start}
              onChange={(e) => setCctv(cctv.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} />
            <input style={{ width: 90 }} placeholder="结束 14:12" value={c.end}
              onChange={(e) => setCctv(cctv.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} />
            <input placeholder="备注" value={c.note}
              onChange={(e) => setCctv(cctv.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
            {i === cctv.length - 1 && (
              <button type="button" className="btn btn-sm" onClick={() => setCctv([...cctv, { camera: '', start: '', end: '', note: '' }])}>＋</button>
            )}
          </div>
        ))}
      </Field>
      <div className="grid grid-2">
        <Field label={`赔付方案${mark('compensation')}`}>
          <textarea value={compensation} onChange={(e) => setCompensation(e.target.value)}
            placeholder="如：承担医药费 200 元；赠送次卡 1 次" />
        </Field>
        <Field label={`设备复检${mark('recheck')}`}>
          <textarea value={recheckResult} onChange={(e) => setRecheckResult(e.target.value)}
            placeholder="如：更换弹簧 2 根，满载测试合格" />
          <input className="mt8" placeholder="复检人" value={recheckInspector}
            onChange={(e) => setRecheckInspector(e.target.value)} />
        </Field>
      </div>
      <Field label={`会员权益调整（补偿次数将直接写入会员卡）${mark('benefit_adjustment')}`}>
        <div className="row">
          <input style={{ width: 140 }} type="number" min="0" placeholder="补偿次数" value={addSessions}
            onChange={(e) => setAddSessions(e.target.value)} />
          <input placeholder="调整说明，如：设备临停受影响补偿" value={benefitNote}
            onChange={(e) => setBenefitNote(e.target.value)} />
        </div>
      </Field>
      <Field label="不适用项明确结论（仅不适用项可填；适用项必须提供真实资料）">
        <div className="grid grid-2">
          {Object.entries(MATERIAL_LABELS)
            .filter(([key]) => !applicable.includes(key))
            .map(([key, label]) => (
              <div key={key} className="row" style={{ gap: 6 }}>
                <span className="small" style={{ width: 96, flexShrink: 0 }}>{label}（不适用）</span>
                <input placeholder="如：无需提供，原因…" value={conclusions[key] || ''}
                  onChange={(e) => setConclusions({ ...conclusions, [key]: e.target.value })} />
              </div>
            ))}
          {applicable.length === Object.keys(MATERIAL_LABELS).length && (
            <span className="muted small">本事件类型无不适用项</span>
          )}
        </div>
      </Field>
      <ErrorBox error={archive.error} />
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={archive.isPending}
        onClick={() => archive.mutate()}>
        确认归档（校验资料完整性后写入安全档案）
      </button>
    </Modal>
  );
}

function CreateInjuryModal({ eventId, defaultChildId, defaultAttrId, onClose, onDone }: {
  eventId: number; defaultChildId?: number; defaultAttrId?: number | null;
  onClose: () => void; onDone: (id: number) => void;
}) {
  const [f, setF] = useState({
    injury_type: '擦伤', play_item: '', action_desc: '',
    companion_position: '', first_aid: '', parent_demands: '',
  });
  const upd = (k: string, v: string) => setF({ ...f, [k]: v });
  const create = useMutation({
    mutationFn: () => api.createInjury(eventId, f),
    onSuccess: (r) => onDone(r.id),
  });
  return (
    <Modal title="发起受伤赔付协商（信息收集）" onClose={onClose} wide>
      <div className="ok-box" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>
        儿童擦伤或扭伤后，先收集完整信息，再由店长选择「医药费报销 / 课时补偿 / 继续观察」；
        决策后会员卡权益与事故复盘会同步调整，并生成家长确认与员工复盘任务。
      </div>
      <div className="grid grid-2">
        <Field label="伤情类型">
          <select value={f.injury_type} onChange={(e) => upd('injury_type', e.target.value)}>
            {INJURY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="项目 *">
          <input value={f.play_item} onChange={(e) => upd('play_item', e.target.value)}
            placeholder="受伤时正在玩的项目/环节，如：海洋球池边缘缓冲区" />
        </Field>
      </div>
      <Field label="孩子当时的动作 *">
        <input value={f.action_desc} onChange={(e) => upd('action_desc', e.target.value)}
          placeholder="如：从池边跃入球池时右膝磕到池沿软包" />
      </Field>
      <Field label="陪同人位置 *">
        <input value={f.companion_position} onChange={(e) => upd('companion_position', e.target.value)}
          placeholder="如：母亲在休息区就座，立柱遮挡约 3 秒" />
      </Field>
      <div className="grid grid-2">
        <Field label="急救处理 *">
          <textarea value={f.first_aid} onChange={(e) => upd('first_aid', e.target.value)}
            placeholder="如：医疗点清创，碘伏消毒+创可贴包扎，留观15分钟" />
        </Field>
        <Field label="家长诉求 *">
          <textarea value={f.parent_demands} onChange={(e) => upd('parent_demands', e.target.value)}
            placeholder="如：希望门店承担清创医药费并加强池沿看护" />
        </Field>
      </div>
      <div className="small muted">默认关联本事件儿童{defaultChildId ? '' : '（事件未关联儿童）'}与项目，无需重复选择。</div>
      <ErrorBox error={create.error} />
      <button className="btn btn-primary" style={{ width: '100%' }}
        disabled={Object.values(f).some((v) => !v.trim()) || create.isPending}
        onClick={() => create.mutate()}>
        创建协商单并进入处置
      </button>
    </Modal>
  );
}
