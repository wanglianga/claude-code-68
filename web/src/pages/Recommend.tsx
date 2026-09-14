import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Card, Chip, Empty, ErrorBox, Loading } from '../components';
import { ageOf, ATTR_KEY_NAMES } from '../util';

export default function Recommend() {
  const [childId, setChildId] = useState<number | ''>('');
  const active = useQuery({ queryKey: ['activeCheckins'], queryFn: api.activeCheckins });
  const rec = useQuery({
    queryKey: ['recommend', childId],
    queryFn: () => api.recommend(Number(childId)),
    enabled: childId !== '',
  });

  return (
    <div>
      <Card title="游玩顺序推荐" extra={<span className="muted small">综合场内人数 · 身高限制 · 设备状态 · 生日活动安排</span>}>
        <div className="row">
          <select style={{ width: 320 }} value={childId} onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">选择在场儿童…</option>
            {active.data?.list.map((c) => (
              <option key={c.id} value={c.child_id}>{c.child_name}（手环 {c.wristband_no}）</option>
            ))}
          </select>
          {rec.data && (
            <span className="muted small">
              {rec.data.child.name} · {ageOf(rec.data.child.birth_date)} · {rec.data.child.height_cm}cm
              {rec.data.child.allergies && rec.data.child.allergies !== '无' && <span className="tag tag-bad">⚠ {rec.data.child.allergies}</span>}
            </span>
          )}
        </div>
      </Card>

      {childId !== '' && rec.isLoading && <Loading />}
      {rec.error && <ErrorBox error={rec.error} />}
      {rec.data && (
        <div className="grid grid-2 mt16">
          <Card title={`推荐游玩顺序（${rec.data.eligible.length} 项）`}>
            {rec.data.eligible.length === 0 && <Empty text="当前无可玩项目" />}
            <div className="rec-order">
              {rec.data.eligible.map((e, i) => (
                <div className="rec-item" key={e.attraction.id}>
                  <div className="rec-rank">{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div className="row spread">
                      <b>{e.attraction.name}</b>
                      <Chip tone={e.ratio < 0.5 ? 'ok' : e.ratio < 0.85 ? 'warn' : 'bad'}>
                        {e.occupancy}/{e.attraction.capacity} 人
                      </Chip>
                    </div>
                    <ul className="rec-reasons">
                      {e.reasons.map((r, j) => <li key={j}>{r}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title={`暂不可玩（${rec.data.blocked.length} 项）`}>
            {rec.data.blocked.length === 0 && <Empty text="无限制项目" />}
            {rec.data.blocked.map((b) => (
              <div className="info-block" key={b.attraction.id}>
                <b>{b.attraction.name}</b>
                <ul className="rec-reasons">
                  {b.reasons.map((r, j) => <li key={j} style={{ color: 'var(--bad)' }}>{r}</li>)}
                </ul>
              </div>
            ))}
            <div className="muted small mt8">
              禁玩项目（家长登记）：{rec.data.child.banned.length
                ? rec.data.child.banned.map((b) => (
                    <span key={b} className="tag tag-warn">🚫 {ATTR_KEY_NAMES[b] || b}</span>
                  ))
                : '无'}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
