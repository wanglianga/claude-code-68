import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Card, Chip, Empty, ErrorBox, Loading } from '../components';
import SearchAlert from '../components/SearchAlert';
import { ATTR_STATUS, fmtDT, fmtT } from '../util';

export default function Overview() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 15000 });
  const [scanWb, setScanWb] = useState('');
  const [scanZone, setScanZone] = useState('滑梯');

  const scan = useMutation({
    mutationFn: () => api.scanWristband(scanWb, scanZone),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const zones = data.attractions.filter((a) => !a.is_facility).map((a) => a.name);
  const limitPct = Math.min(100, Math.round((data.inside_count / data.daily_limit) * 100));

  return (
    <div>
      <SearchAlert />
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">在场人数 / 当日限流</div>
          <div className="stat-value">{data.inside_count}<small> / {data.daily_limit} 人</small></div>
          <div className="limit-bar mt8"><div style={{ width: `${limitPct}%` }} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">开放项目</div>
          <div className="stat-value">
            {data.attractions.filter((a) => !a.is_facility && a.status === 'open').length}
            <small> / {data.attractions.filter((a) => !a.is_facility).length} 个</small>
          </div>
          <div className="stat-foot">维护/停用项目实时同步推荐</div>
        </div>
        <div className="stat">
          <div className="stat-label">进行中安全事件</div>
          <div className="stat-value" style={{ color: data.open_events + data.processing_events ? 'var(--bad)' : 'inherit' }}>
            {data.open_events + data.processing_events}
          </div>
          <div className="stat-foot">待处理 {data.open_events} · 处理中 {data.processing_events}</div>
        </div>
        <div className="stat">
          <div className="stat-label">今日活动（生日会/托管班）</div>
          <div className="stat-value">{data.today_parties.length}</div>
          <div className="stat-foot">{data.today_parties.map((p) => `${fmtT(p.start_at)} ${p.title}`).join('；') || '今日无活动'}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <Card title="项目与区域实时状态">
          <div className="attr-grid">
            {data.attractions.map((a) => {
              const occ = data.occupancy[a.name] || 0;
              const st = ATTR_STATUS[a.status];
              return (
                <div className="attr-card" key={a.id}>
                  <div className="attr-name">{a.name}<Chip tone={st.tone}>{st.label}</Chip></div>
                  <div className="attr-meta">
                    {a.is_facility ? '巡场区域' : `身高 ${a.min_height ?? 0}–${a.max_height ?? '不限'}cm · 容量 ${a.capacity} 人`}
                  </div>
                  {!a.is_facility && (
                    <>
                      <div className="attr-meta">当前 {occ} 人</div>
                      <div className="occ-bar"><div style={{ width: `${Math.min(100, (occ / a.capacity) * 100)}%` }} /></div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="在场儿童（手环定位）">
          {data.active_checkins.length === 0 ? <Empty text="当前无在场儿童" /> : (
            <table className="table">
              <thead><tr><th>儿童</th><th>手环</th><th>当前位置</th><th>陪同监护人</th><th>入园时间</th></tr></thead>
              <tbody>
                {data.active_checkins.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.child_name}</b></td>
                    <td><Chip tone="info">{c.wristband_no}</Chip></td>
                    <td>
                      {c.zone || '—'}
                      {!!c.lost_frozen && <Chip tone="bad">🚫 出园冻结</Chip>}
                    </td>
                    <td>{c.guardian_name}<div className="muted small">{c.guardian_phone}</div></td>
                    <td>{fmtT(c.checkin_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt16">
            <div className="small muted mb8">模拟手环扫码（更新儿童实时位置，供推荐与事件定位使用）</div>
            <div className="row">
              <select style={{ width: 180 }} value={scanWb} onChange={(e) => setScanWb(e.target.value)}>
                <option value="">选择手环</option>
                {data.active_checkins.map((c) => (
                  <option key={c.id} value={c.wristband_no}>{c.wristband_no}（{c.child_name}）</option>
                ))}
              </select>
              <select style={{ width: 140 }} value={scanZone} onChange={(e) => setScanZone(e.target.value)}>
                {[...zones, '休息区', '卫生间', '医疗点', '入口'].map((z) => <option key={z}>{z}</option>)}
              </select>
              <button className="btn" disabled={!scanWb || scan.isPending} onClick={() => scan.mutate()}>扫码定位</button>
            </div>
            <ErrorBox error={scan.error} />
          </div>
        </Card>
      </div>

      <div className="grid grid-2 mt16">
        <Card title="今日活动安排">
          {data.today_parties.length === 0 ? <Empty text="今日无生日会 / 托管班" /> : data.today_parties.map((p) => (
            <div className="info-block" key={p.id}>
              <div className="row spread">
                <b>{p.type === 'birthday' ? '🎂' : '🎒'} {p.title}</b>
                <Chip tone="info">{fmtT(p.start_at)}–{fmtT(p.end_at)}</Chip>
              </div>
              <div className="small muted mt8">区域：{p.area} · 活动负责人：{p.leader_name} · {p.children?.length ?? 0} 名儿童</div>
            </div>
          ))}
        </Card>
        <Card title="最近巡场记录">
          {data.recent_patrol.length === 0 ? <Empty /> : (
            <table className="table">
              <thead><tr><th>时间</th><th>区域</th><th>状态</th><th>记录人</th><th>备注</th></tr></thead>
              <tbody>
                {data.recent_patrol.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtDT(l.created_at)}</td>
                    <td>{l.area}</td>
                    <td><Chip tone={l.status === '正常' ? 'ok' : l.status === '需关注' ? 'warn' : 'bad'}>{l.status}</Chip></td>
                    <td>{l.staff_name}</td>
                    <td className="muted">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
