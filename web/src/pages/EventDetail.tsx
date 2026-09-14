import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal } from '../components';
import {
  ageOf, EVENT_STATUS, EVENT_TYPES, fmtDT, fmtT, KIND_META, MEMBER_TYPE,
  parseJSON, ROLE_NAMES, SEVERITY, TIMELINE_KIND_OPTIONS,
} from '../util';
import type { ArchiveData } from '../types';

export default function EventDetail() {
  const { id } = useParams();
  const eventId = Number(id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.eventDetail(eventId),
  });

  const [kind, setKind] = useState('communication');
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [showArchive, setShowArchive] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['event', eventId] });

  const addEntry = useMutation({
    mutationFn: () => api.addTimeline(eventId, kind, content, meta),
    onSuccess: () => { setContent(''); setMeta({}); invalidate(); },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api.setEventStatus(eventId, status),
    onSuccess: invalidate,
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const { event, timeline, child, member, guardians, parties } = data;
  const archive = parseJSON<ArchiveData | null>(event.archive, null);
  const st = EVENT_STATUS[event.status];

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
              <button className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate('resolved')}>标记解决</button>
            )}
            {event.status !== 'archived' && user?.role === 'manager' && (
              <button className="btn btn-primary" onClick={() => setShowArchive(true)}>归档（档案+权益调整）</button>
            )}
          </div>
        </div>
        <ErrorBox error={setStatus.error} />
      </Card>

      <div className="detail-layout">
        <div>
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
                <dd>{archive.photos.length ? archive.photos.map((p, i) => <span key={i} className="tag">📷 {p}</span>) : '—'}</dd>
                <dt>监控时间段</dt>
                <dd>{archive.cctv.length
                  ? archive.cctv.map((c, i) => <span key={i} className="tag">🎥 {c.camera} {c.start}–{c.end}{c.note ? `（${c.note}）` : ''}</span>)
                  : '—'}</dd>
                <dt>家长签字</dt><dd>{archive.parent_signature || '—'}</dd>
                <dt>赔付方案</dt><dd>{archive.compensation || '—'}</dd>
                <dt>设备复检</dt>
                <dd>{archive.recheck?.result ? `${archive.recheck.result}（复检人：${archive.recheck.inspector || '—'}）` : '—'}</dd>
                <dt>权益调整</dt>
                <dd>{archive.benefit_adjustment
                  ? `会员卡 ${archive.benefit_adjustment.applied_to || '—'} 补偿 ${archive.benefit_adjustment.add_sessions || 0} 次${archive.benefit_adjustment.note ? `；${archive.benefit_adjustment.note}` : ''}`
                  : '—'}</dd>
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
                    <span key={b} className="tag tag-warn">🚫 禁玩：{{ slide: '滑梯', trampoline: '蹦床', climb: '攀爬网', ballpit: '海洋球池' }[b] || b}</span>
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
        <ArchiveModal eventId={eventId} onClose={() => setShowArchive(false)}
          onDone={() => { setShowArchive(false); invalidate(); }} />
      )}
    </div>
  );
}

function ArchiveModal({ eventId, onClose, onDone }: { eventId: number; onClose: () => void; onDone: () => void }) {
  const [photos, setPhotos] = useState('');
  const [cctv, setCctv] = useState([{ camera: '', start: '', end: '', note: '' }]);
  const [signature, setSignature] = useState('');
  const [compensation, setCompensation] = useState('');
  const [recheckResult, setRecheckResult] = useState('');
  const [recheckInspector, setRecheckInspector] = useState('');
  const [addSessions, setAddSessions] = useState('');
  const [benefitNote, setBenefitNote] = useState('');

  const archive = useMutation({
    mutationFn: () => api.archiveEvent(eventId, {
      photos: photos.split('\n').map((s) => s.trim()).filter(Boolean),
      cctv: cctv.filter((c) => c.camera || c.start || c.end),
      parent_signature: signature,
      compensation,
      recheck: recheckResult ? { result: recheckResult, inspector: recheckInspector } : null,
      benefit_adjustment: addSessions ? { add_sessions: Number(addSessions), note: benefitNote } : null,
    }),
    onSuccess: onDone,
  });

  return (
    <Modal title="事件归档：现场照片 / 监控 / 签字 / 赔付 / 复检 / 权益调整" onClose={onClose} wide>
      <div className="grid grid-2">
        <Field label="现场照片（每行一个文件名/链接）">
          <textarea value={photos} onChange={(e) => setPhotos(e.target.value)} placeholder={'滑梯入口特写.jpg\n警示牌照片.jpg'} />
        </Field>
        <Field label="家长签字确认">
          <textarea value={signature} onChange={(e) => setSignature(e.target.value)}
            placeholder="如：母亲张莉已现场确认伤情与处理结果并签字" />
        </Field>
      </div>
      <Field label="监控时间段">
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
        <Field label="赔付方案">
          <textarea value={compensation} onChange={(e) => setCompensation(e.target.value)}
            placeholder="如：承担医药费 200 元；赠送次卡 1 次" />
        </Field>
        <Field label="设备复检">
          <textarea value={recheckResult} onChange={(e) => setRecheckResult(e.target.value)}
            placeholder="如：更换弹簧 2 根，满载测试合格" />
          <input className="mt8" placeholder="复检人" value={recheckInspector}
            onChange={(e) => setRecheckInspector(e.target.value)} />
        </Field>
      </div>
      <Field label="会员权益调整（补偿次数将直接写入会员卡）">
        <div className="row">
          <input style={{ width: 140 }} type="number" min="0" placeholder="补偿次数" value={addSessions}
            onChange={(e) => setAddSessions(e.target.value)} />
          <input placeholder="调整说明，如：设备临停受影响补偿" value={benefitNote}
            onChange={(e) => setBenefitNote(e.target.value)} />
        </div>
      </Field>
      <ErrorBox error={archive.error} />
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={archive.isPending}
        onClick={() => archive.mutate()}>
        确认归档（写入安全档案并调整会员权益）
      </button>
    </Modal>
  );
}
