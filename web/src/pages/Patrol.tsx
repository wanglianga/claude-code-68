import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, ErrorBox, Loading, OkBox } from '../components';
import { ATTR_STATUS, fmtDT, PATROL_STATUS } from '../util';

export default function Patrol() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user && ['patrol', 'manager'].includes(user.role);
  const { data, isLoading } = useQuery({ queryKey: ['attractions'], queryFn: api.attractions });
  const logs = useQuery({ queryKey: ['patrolLogs'], queryFn: api.patrolLogs });

  const [area, setArea] = useState('滑梯');
  const [status, setStatus] = useState('正常');
  const [note, setNote] = useState('');
  const [syncDevice, setSyncDevice] = useState(true);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      await api.addPatrolLog(area, status, note);
      // 勾选后把异常/恢复同步到设备开放状态，推荐页实时生效
      if (syncDevice && data) {
        const attr = data.attractions.find((a) => a.name === area && !a.is_facility);
        if (attr) {
          const target = status === '异常' ? 'maintenance' : status === '正常' ? 'open' : null;
          if (target && attr.status !== target) await api.setAttractionStatus(attr.id, target);
        }
      }
    },
    onSuccess: () => {
      setOkMsg('巡场记录已提交');
      setNote('');
      qc.invalidateQueries();
    },
    onError: () => setOkMsg(null),
  });

  const setAttr = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.setAttractionStatus(id, status),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (isLoading) return <Loading />;

  return (
    <div>
      <div className="grid grid-2">
        <Card title="提交巡场记录">
          {!canEdit && <div className="error-box">当前角色仅可查看，巡场记录需「巡场」或「店长」角色提交</div>}
          <label className="field">
            <span className="field-label">区域</span>
            <select value={area} onChange={(e) => setArea(e.target.value)} disabled={!canEdit}>
              {data?.attractions.map((a) => <option key={a.id} value={a.name}>{a.name}{a.is_facility ? '（区域）' : ''}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">状态</span>
            <div className="row">
              {PATROL_STATUS.map((s) => (
                <button key={s} type="button"
                  className={`btn ${status === s ? 'btn-primary' : ''}`}
                  onClick={() => setStatus(s)} disabled={!canEdit}>{s}</button>
              ))}
            </div>
          </label>
          <label className="field">
            <span className="field-label">备注</span>
            <textarea placeholder="如：软包磨损、已局部消毒、补球 200 个…" value={note}
              onChange={(e) => setNote(e.target.value)} disabled={!canEdit} />
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={syncDevice}
              onChange={(e) => setSyncDevice(e.target.checked)} disabled={!canEdit} />
            同步更新设备开放状态（异常→维护中，正常→开放）
          </label>
          <ErrorBox error={submit.error} />
          <OkBox text={okMsg} />
          <button className="btn btn-primary mt8" style={{ width: '100%' }}
            disabled={!canEdit || submit.isPending} onClick={() => submit.mutate()}>
            提交巡场记录
          </button>
        </Card>

        <Card title="设备开放状态控制">
          <div className="patrol-grid">
            {data?.attractions.filter((a) => !a.is_facility).map((a) => {
              const st = ATTR_STATUS[a.status];
              return (
                <div className="patrol-card" key={a.id}>
                  <div className="row spread">
                    <b>{a.name}</b><Chip tone={st.tone}>{st.label}</Chip>
                  </div>
                  <div className="muted small mt8">当前 {data.occupancy[a.name] || 0}/{a.capacity} 人</div>
                  <div className="row mt8">
                    {(['open', 'maintenance', 'emergency_stop'] as const).map((s) => (
                      <button key={s} className="btn btn-sm" disabled={!canEdit || a.status === s || setAttr.isPending}
                        onClick={() => setAttr.mutate({ id: a.id, status: s })}>
                        {ATTR_STATUS[s].label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <ErrorBox error={setAttr.error} />
        </Card>
      </div>

      <Card className="mt16" title="巡场记录流水（滑梯 / 蹦床 / 攀爬网 / 海洋球池 / 卫生间 / 休息区）">
        <table className="table">
          <thead><tr><th>时间</th><th>区域</th><th>状态</th><th>记录人</th><th>备注</th></tr></thead>
          <tbody>
            {logs.data?.map((l) => (
              <tr key={l.id}>
                <td>{fmtDT(l.created_at)}</td>
                <td><b>{l.area}</b></td>
                <td><Chip tone={l.status === '正常' ? 'ok' : l.status === '需关注' ? 'warn' : 'bad'}>{l.status}</Chip></td>
                <td>{l.staff_name}</td>
                <td className="muted">{l.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
