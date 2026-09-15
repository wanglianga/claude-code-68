import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, OkBox } from '../components';
import { ATTR_STATUS, fmtDT, parseJSON } from '../util';

const ISSUE_TYPES: Record<string, string> = {
  party_delay: '生日会延误', class_makeup: '课程补时', complaint: '家长投诉',
};

export default function Tickets() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [showStop, setShowStop] = useState(false);

  const tickets = useQuery({ queryKey: ['tickets'], queryFn: api.tickets, refetchInterval: 10000 });
  const detail = useQuery({
    queryKey: ['ticket', selected],
    queryFn: () => api.ticket(selected!),
    enabled: selected != null,
  });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['ticket', selected] }); qc.invalidateQueries(); };

  const canFront = !!user && ['frontdesk', 'manager'].includes(user.role);
  const canPatrol = !!user && ['patrol', 'manager'].includes(user.role);
  const isManager = user?.role === 'manager';

  // ---- 临停发起 ----
  const attrs = useQuery({ queryKey: ['attractions'], queryFn: api.attractions });
  const [stopAttrId, setStopAttrId] = useState('');
  const [stopStatus, setStopStatus] = useState('maintenance');
  const [stopReason, setStopReason] = useState('');
  const stop = useMutation({
    mutationFn: () => api.stopAttraction(Number(stopAttrId), stopReason, stopStatus),
    onSuccess: () => { setShowStop(false); setStopReason(''); invalidate(); },
  });

  // ---- 分流 / 补券 / 复检 / 子项 ----
  const [divertTarget, setDivertTarget] = useState<Record<number, string>>({});
  const divert = useMutation({
    mutationFn: ({ qid, to }: { qid: number; to: string }) => api.divert(selected!, qid, to),
    onSuccess: invalidate,
  });
  const [vForm, setVForm] = useState({ member_id: '', child_id: '', type: '次卡补偿', amount: '1', note: '' });
  const voucher = useMutation({
    mutationFn: () => api.addVoucher(selected!, {
      member_id: Number(vForm.member_id),
      child_id: vForm.child_id ? Number(vForm.child_id) : null,
      type: vForm.type, amount: vForm.amount, note: vForm.note,
    }),
    onSuccess: () => { setVForm({ member_id: '', child_id: '', type: '次卡补偿', amount: '1', note: '' }); invalidate(); },
  });
  const [rForm, setRForm] = useState({ photos: '', result: '', inspector: '' });
  const recheck = useMutation({
    mutationFn: () => api.addRecheck(selected!, {
      photos: rForm.photos.split('\n').map((s) => s.trim()).filter(Boolean),
      result: rForm.result, inspector: rForm.inspector,
    }),
    onSuccess: () => { setRForm({ photos: '', result: '', inspector: '' }); invalidate(); },
  });
  const confirm = useMutation({ mutationFn: (id: number) => api.confirmRecheck(id), onSuccess: invalidate });
  const reopen = useMutation({ mutationFn: (attractionId: number) => api.reopenAttraction(attractionId), onSuccess: invalidate });
  const [iForm, setIForm] = useState({ type: 'party_delay', title: '', detail: '' });
  const issue = useMutation({
    mutationFn: () => api.addIssue(selected!, iForm),
    onSuccess: () => { setIForm({ type: 'party_delay', title: '', detail: '' }); invalidate(); },
  });
  const doneIssue = useMutation({ mutationFn: (id: number) => api.doneIssue(id), onSuccess: invalidate });

  const d = detail.data;
  const t = d?.ticket;
  const latestRecheck = d?.rechecks[0];
  const reopenReady = !!latestRecheck && parseJSON<string[]>(latestRecheck.photos, []).length > 0 && !!latestRecheck.confirmed_by;

  return (
    <div>
      <div className="filter-bar">
        {canPatrol && <button className="btn btn-primary" onClick={() => setShowStop(true)}>＋ 发起设备临停</button>}
        <span className="muted small">临停处理单：受影响儿童 · 排队分流 · 可替代项目 · 会员补偿 · 安全复检 · 关联子项</span>
      </div>

      <div className="member-layout">
        <Card title="临停处理单" extra={<span className="muted small">{tickets.data?.length ?? 0} 单</span>}>
          {tickets.isLoading && <Loading />}
          {tickets.data?.map((x) => (
            <div key={x.id} className={`member-item ${selected === x.id ? 'active' : ''}`} onClick={() => setSelected(x.id)}>
              <div className="row spread">
                <b>{x.attraction_name}</b>
                <Chip tone={x.status === 'open' ? 'bad' : 'ok'}>{x.status === 'open' ? '处理中' : '已恢复'}</Chip>
              </div>
              <div className="small muted">{x.code} · {fmtDT(x.created_at)} · {x.created_by_name}</div>
              <div className="small mt8">
                <span className="tag">受影响 {x.affected.length} 人</span>
                <span className="tag">排队待分流 {x.waiting_count}</span>
                <span className="tag">补券 {x.voucher_count}</span>
                {(x.open_issue_count ?? 0) > 0 && <span className="tag tag-warn">子项 {x.open_issue_count}</span>}
              </div>
            </div>
          ))}
          {tickets.data?.length === 0 && <Empty text="暂无临停处理单" />}
        </Card>

        <div>
          {!selected && <Card><Empty text="选择左侧处理单查看分流详情" /></Card>}
          {selected && detail.isLoading && <Loading />}
          {d && t && (
            <>
              <Card title={`${t.attraction_name} · ${t.code}`}
                extra={<Chip tone={ATTR_STATUS[t.attraction_status || 'open'].tone}>{ATTR_STATUS[t.attraction_status || 'open'].label}</Chip>}>
                <div className="muted small mb8">{t.reason} · {t.created_by_name} 发起于 {fmtDT(t.created_at)}
                  {t.recovered_at && ` · 恢复于 ${fmtDT(t.recovered_at)}`}</div>
                <h4 className="small muted mb8">受影响儿童（{t.affected.length} 人）</h4>
                {t.affected.length === 0 ? <Empty text="无受影响儿童" /> : (
                  <table className="table">
                    <thead><tr><th>儿童</th><th>身高</th><th>手环</th><th>会员卡</th><th>来源</th></tr></thead>
                    <tbody>
                      {t.affected.map((a) => (
                        <tr key={a.child_id}>
                          <td><b>{a.name}</b></td><td>{a.height_cm}cm</td>
                          <td>{a.wristband_no || '—'}</td><td>{a.card_no}</td>
                          <td><Chip tone="info">{a.source}</Chip></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <div className="grid grid-2 mt16">
                <Card title={`排队分流（${d.queue.filter((q) => q.status === 'waiting').length} 人等待）`}>
                  {d.queue.length === 0 ? <Empty text="无排队记录" /> : (
                    <table className="table">
                      <thead><tr><th>排队号</th><th>儿童</th><th>状态</th><th>分流</th></tr></thead>
                      <tbody>
                        {d.queue.map((q) => (
                          <tr key={q.id}>
                            <td><Chip tone="info">{q.queue_no}</Chip></td>
                            <td>{q.child_name}</td>
                            <td>
                              {q.status === 'waiting' && <Chip tone="warn">排队中</Chip>}
                              {q.status === 'transferred' && <Chip tone="ok">已分流→{q.transferred_to}</Chip>}
                              {q.status === 'cancelled' && <Chip tone="muted">已取消</Chip>}
                            </td>
                            <td>
                              {q.status === 'waiting' && t.status === 'open' && canFront && (
                                <div className="row" style={{ gap: 4 }}>
                                  <select style={{ width: 110 }} value={divertTarget[q.id] || ''}
                                    onChange={(e) => setDivertTarget({ ...divertTarget, [q.id]: e.target.value })}>
                                    <option value="">去向…</option>
                                    {d.alternatives.map((a) => <option key={a.attraction.id} value={a.attraction.name}>{a.attraction.name}</option>)}
                                  </select>
                                  <button className="btn btn-sm" disabled={!divertTarget[q.id] || divert.isPending}
                                    onClick={() => divert.mutate({ qid: q.id, to: divertTarget[q.id] })}>分流</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <ErrorBox error={divert.error} />
                </Card>

                <Card title="可替代项目（按受影响儿童身高/禁玩适配）">
                  {d.alternatives.length === 0 && <Empty text="当前无可替代项目" />}
                  {d.alternatives.map((a) => (
                    <div className="info-block" key={a.attraction.id}>
                      <div className="row spread">
                        <b>{a.attraction.name}</b>
                        <Chip tone={a.occupancy / a.attraction.capacity < 0.5 ? 'ok' : 'warn'}>
                          {a.occupancy}/{a.attraction.capacity} 人
                        </Chip>
                      </div>
                      <div className="small muted mt8">适合：{a.suitable.join('、')}</div>
                    </div>
                  ))}
                </Card>

                <Card title="会员补偿（补券）">
                  {canFront && t.status === 'open' && (
                    <div className="mb16">
                      <div className="grid grid-2">
                        <Field label="受影响儿童（会员）">
                          <select value={vForm.member_id} onChange={(e) => {
                            const a = t.affected.find((x) => String(x.member_id) === e.target.value);
                            setVForm({ ...vForm, member_id: e.target.value, child_id: a ? String(a.child_id) : '' });
                          }}>
                            <option value="">请选择…</option>
                            {t.affected.map((a) => (
                              <option key={a.child_id} value={a.member_id}>{a.name}（{a.card_no}）</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="补偿方式">
                          <select value={vForm.type} onChange={(e) => setVForm({ ...vForm, type: e.target.value })}>
                            {d.compensation_options.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="row">
                        <input style={{ width: 110 }} value={vForm.amount} onChange={(e) => setVForm({ ...vForm, amount: e.target.value })}
                          placeholder="数量/金额" />
                        <input value={vForm.note} onChange={(e) => setVForm({ ...vForm, note: e.target.value })}
                          placeholder="说明，如：蹦床临停补偿" />
                        <button className="btn btn-primary" disabled={!vForm.member_id || voucher.isPending}
                          onClick={() => voucher.mutate()}>发券</button>
                      </div>
                      <div className="muted small mt8">「次卡补偿」数量将直接写入会员剩余次数；补券不能替代安全复检</div>
                    </div>
                  )}
                  {d.vouchers.length === 0 ? <Empty text="尚未发放补券" /> : (
                    <table className="table">
                      <thead><tr><th>会员卡</th><th>儿童</th><th>类型</th><th>数量</th><th>状态</th><th>发放人</th></tr></thead>
                      <tbody>
                        {d.vouchers.map((v) => (
                          <tr key={v.id}>
                            <td>{v.card_no}</td><td>{v.child_name || '—'}</td>
                            <td>{v.type}</td><td>{v.amount}</td>
                            <td>{v.applied ? <Chip tone="ok">已写入权益</Chip> : <Chip tone="info">已登记</Chip>}</td>
                            <td>{v.issued_by_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <ErrorBox error={voucher.error} />
                </Card>

                <Card title="安全复检与恢复开放">
                  {d.rechecks.length > 0 && (
                    <div className="mb16">
                      {d.rechecks.map((r) => (
                        <div className="info-block" key={r.id}>
                          <div className="row spread">
                            <b>复检：{r.result}</b>
                            {r.confirmed_by
                              ? <Chip tone="ok">✓ {r.confirmed_by} 已确认</Chip>
                              : <Chip tone="warn">待负责人确认</Chip>}
                          </div>
                          <div className="small mt8">
                            {parseJSON<string[]>(r.photos, []).map((p, i) => <span key={i} className="tag">📷 {p}</span>)}
                          </div>
                          <div className="small muted mt8">检修人 {r.inspector} · {r.created_by_name} 提交 · {fmtDT(r.created_at)}</div>
                          {!r.confirmed_by && isManager && t.status === 'open' && (
                            <button className="btn btn-sm mt8" disabled={confirm.isPending}
                              onClick={() => confirm.mutate(r.id)}>负责人确认</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {canPatrol && t.status === 'open' && (
                    <>
                      <Field label="检修照片（每行一个文件名/链接）">
                        <textarea value={rForm.photos} onChange={(e) => setRForm({ ...rForm, photos: e.target.value })}
                          placeholder={'弹簧更换特写.jpg\n安全网复检.jpg'} />
                      </Field>
                      <div className="grid grid-2">
                        <Field label="复检结果">
                          <input value={rForm.result} onChange={(e) => setRForm({ ...rForm, result: e.target.value })}
                            placeholder="如：更换弹簧 2 根，测试合格" />
                        </Field>
                        <Field label="检修人">
                          <input value={rForm.inspector} onChange={(e) => setRForm({ ...rForm, inspector: e.target.value })}
                            placeholder="如：维保 刘工" />
                        </Field>
                      </div>
                      <button className="btn" disabled={recheck.isPending} onClick={() => recheck.mutate()}>提交复检</button>
                    </>
                  )}
                  <ErrorBox error={recheck.error} />
                  <ErrorBox error={reopen.error} />
                  {t.status === 'open' ? (
                    <>
                      <div className="muted small mt16 mb8">
                        恢复开放条件：检修照片 ✓ + 负责人确认 ✓（已发补券 {d.vouchers.length} 张，补券不能替代安全复检）
                      </div>
                      {canPatrol && (
                        <button className="btn btn-primary" style={{ width: '100%' }}
                          disabled={!reopenReady || reopen.isPending}
                          onClick={() => reopen.mutate(t.attraction_id)}>
                          {reopenReady ? '恢复开放该项目' : '未满足恢复条件（缺检修照片或负责人确认）'}
                        </button>
                      )}
                    </>
                  ) : (
                    <OkBox text={`项目已于 ${fmtDT(t.recovered_at)} 恢复开放`} />
                  )}
                </Card>
              </div>

              <Card className="mt16" title="处理单子项（生日会延误 / 课程补时 / 家长投诉 合并处理）">
                {d.issues.length === 0 ? <Empty text="暂无子项" /> : (
                  <table className="table">
                    <thead><tr><th>类型</th><th>事项</th><th>详情</th><th>状态</th><th>登记</th><th></th></tr></thead>
                    <tbody>
                      {d.issues.map((i) => (
                        <tr key={i.id}>
                          <td><Chip tone={i.type === 'complaint' ? 'bad' : 'warn'}>{ISSUE_TYPES[i.type]}</Chip></td>
                          <td><b>{i.title}</b></td>
                          <td className="muted small">{i.detail || '—'}</td>
                          <td>{i.status === 'done' ? <Chip tone="ok">已办结</Chip> : <Chip tone="warn">跟进中</Chip>}</td>
                          <td className="small">{i.created_by_name}<div className="muted">{fmtDT(i.created_at)}</div></td>
                          <td>{i.status !== 'done' && <button className="btn btn-sm" onClick={() => doneIssue.mutate(i.id)}>办结</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {t.status === 'open' && (
                  <div className="row mt8">
                    <select style={{ width: 140 }} value={iForm.type} onChange={(e) => setIForm({ ...iForm, type: e.target.value })}>
                      {Object.entries(ISSUE_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input style={{ width: 220 }} placeholder="事项标题" value={iForm.title}
                      onChange={(e) => setIForm({ ...iForm, title: e.target.value })} />
                    <input placeholder="详情（可选）" value={iForm.detail}
                      onChange={(e) => setIForm({ ...iForm, detail: e.target.value })} />
                    <button className="btn" disabled={!iForm.title.trim() || issue.isPending}
                      onClick={() => issue.mutate()}>添加子项</button>
                  </div>
                )}
                <ErrorBox error={issue.error} />
              </Card>
            </>
          )}
        </div>
      </div>

      {showStop && (
        <Modal title="发起设备临停（自动生成处理单）" onClose={() => setShowStop(false)}>
          <Field label="临停项目">
            <select value={stopAttrId} onChange={(e) => setStopAttrId(e.target.value)}>
              <option value="">请选择…</option>
              {attrs.data?.attractions.filter((a) => !a.is_facility && a.status === 'open').map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="临停类型">
            <div className="row">
              <button type="button" className={`btn ${stopStatus === 'maintenance' ? 'btn-primary' : ''}`}
                onClick={() => setStopStatus('maintenance')}>检修（维护中）</button>
              <button type="button" className={`btn ${stopStatus === 'emergency_stop' ? 'btn-primary' : ''}`}
                onClick={() => setStopStatus('emergency_stop')}>急停</button>
            </div>
          </Field>
          <Field label="临停原因">
            <textarea value={stopReason} onChange={(e) => setStopReason(e.target.value)}
              placeholder="如：弹簧区域异响，临时检修" />
          </Field>
          <ErrorBox error={stop.error} />
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={!stopAttrId || stop.isPending} onClick={() => stop.mutate()}>
            确认临停并生成处理单（快照受影响儿童与排队）
          </button>
        </Modal>
      )}
    </div>
  );
}
