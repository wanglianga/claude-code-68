import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Chip, Empty, Loading } from '../components';
import { EVENT_STATUS, EVENT_TYPES, fmtDT, parseJSON, ROLE_NAMES, SEVERITY } from '../util';
import type { ArchiveData } from '../types';

function Bars({ title, data, names }: { title: string; data: Record<string, number>; names?: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <Card title={title}>
      {entries.length === 0 && <Empty text="暂无数据" />}
      {entries.map(([k, v]) => (
        <div className="bar-row" key={k}>
          <span className="bar-label">{names?.[k] || k}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(v / max) * 100}%` }} /></div>
          <span className="bar-num">{v}</span>
        </div>
      ))}
    </Card>
  );
}

export default function Review() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [attractionId, setAttractionId] = useState('');
  const [staff, setStaff] = useState('');

  const attrs = useQuery({ queryKey: ['attractions'], queryFn: api.attractions });
  const review = useQuery({
    queryKey: ['review', from, to, attractionId, staff],
    queryFn: () => api.review({ from, to, attraction_id: attractionId, staff }),
  });

  const stats = review.data?.stats;

  return (
    <div>
      <Card title="安全隐患复盘（按项目 / 时段 / 人员）">
        <div className="row">
          <input type="date" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
          <select style={{ width: 160 }} value={attractionId} onChange={(e) => setAttractionId(e.target.value)}>
            <option value="">全部项目</option>
            {attrs.data?.attractions.filter((a) => !a.is_facility).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <input style={{ width: 160 }} placeholder="涉及人员姓名" value={staff} onChange={(e) => setStaff(e.target.value)} />
          <button className="btn btn-sm" onClick={() => { setFrom(''); setTo(''); setAttractionId(''); setStaff(''); }}>重置</button>
        </div>
      </Card>

      {review.isLoading && <Loading />}
      {stats && (
        <>
          <div className="grid grid-2 mt16">
            <Bars title="按事件类型" data={stats.byType} names={EVENT_TYPES} />
            <Bars title="按项目" data={stats.byAttraction} />
            <Bars title="按时段（小时）" data={stats.byHour} />
            <Card title="处置人员参与度">
              {stats.staff.length === 0 && <Empty text="暂无数据" />}
              <table className="table">
                <thead><tr><th>人员</th><th>角色</th><th>事件线条目数</th></tr></thead>
                <tbody>
                  {stats.staff.map((s) => (
                    <tr key={s.actor_name}>
                      <td><b>{s.actor_name}</b></td>
                      <td><Chip tone="info">{ROLE_NAMES[s.actor_role] || s.actor_role}</Chip></td>
                      <td>{s.c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="mt16" title={`事件档案明细（${review.data!.events.length} 件）`}>
            {review.data!.events.length === 0 && <Empty text="筛选条件下无事件" />}
            {review.data!.events.map((e) => {
              const arch = parseJSON<ArchiveData | null>(e.archive, null);
              return (
                <div className="info-block" key={e.id}>
                  <div className="row spread">
                    <div className="row">
                      <Chip tone="info">{e.code}</Chip>
                      <Chip tone="warn">{EVENT_TYPES[e.type]}</Chip>
                      <Chip tone={SEVERITY[e.severity].tone}>{SEVERITY[e.severity].label}</Chip>
                      <Chip tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Chip>
                      <b>{e.title}</b>
                    </div>
                    <Link className="btn btn-sm" to={`/events/${e.id}`}>查看事件线</Link>
                  </div>
                  <div className="small muted mt8">
                    {fmtDT(e.created_at)} · 项目：{e.attraction_name || '—'} · 儿童：{e.child_name || '—'} · 上报：{e.created_by_name}
                  </div>
                  {arch && (
                    <div className="small mt8">
                      {arch.photos.length > 0 && <span className="tag">📷 照片 {arch.photos.length} 张</span>}
                      {arch.cctv.length > 0 && <span className="tag">🎥 监控 {arch.cctv.length} 段</span>}
                      {arch.parent_signature && <span className="tag">✍️ 家长签字</span>}
                      {arch.compensation && <span className="tag">💰 赔付：{arch.compensation}</span>}
                      {arch.recheck?.result && <span className="tag">🔧 复检：{arch.recheck.result}</span>}
                      {arch.benefit_adjustment && <span className="tag">💳 权益调整 +{arch.benefit_adjustment.add_sessions} 次</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}
