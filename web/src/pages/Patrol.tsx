import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, ErrorBox, Field, Loading, Modal, OkBox } from '../components';
import { ATTR_STATUS, fmtDT, MARKER_TYPES, PATROL_STATUS } from '../util';

export default function Patrol() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user && ['patrol', 'manager'].includes(user.role);
  const { data, isLoading } = useQuery({ queryKey: ['attractions'], queryFn: api.attractions });
  const logs = useQuery({ queryKey: ['patrolLogs'], queryFn: api.patrolLogs });
  const followups = useQuery({ queryKey: ['patrolTasks', 'open'], queryFn: () => api.patrolTasks('open') });

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

  // 设备临停/恢复：走处理单流程（停止生成处理单，恢复需复检+负责人确认）
  const [stopTarget, setStopTarget] = useState<{ id: number; name: string; status: string } | null>(null);
  const [stopReason, setStopReason] = useState('');
  const stop = useMutation({
    mutationFn: () => api.stopAttraction(stopTarget!.id, stopReason, stopTarget!.status),
    onSuccess: () => { setStopTarget(null); setStopReason(''); qc.invalidateQueries(); },
  });
  const reopen = useMutation({
    mutationFn: (id: number) => api.reopenAttraction(id),
    onSuccess: () => qc.invalidateQueries(),
  });

  // 复盘巡场待办核验（动线/站位/盲区整改，完成后由店长解除限制开放）
  const [taskNote, setTaskNote] = useState<Record<number, string>>({});
  const doneTask = useMutation({
    mutationFn: (id: number) => api.donePatrolTask(id, taskNote[id] || ''),
    onSuccess: () => { setTaskNote({}); qc.invalidateQueries(); },
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

        <Card title="设备开放状态控制（临停/恢复走处理单流程）">
          <div className="patrol-grid">
            {data?.attractions.filter((a) => !a.is_facility).map((a) => {
              const st = ATTR_STATUS[a.status];
              const restricted = a.control_status === 'restricted';
              return (
                <div className={`patrol-card ${restricted ? 'patrol-restricted' : ''}`} key={a.id}>
                  <div className="row spread">
                    <b>{a.name}</b>
                    <span className="row">
                      {restricted && <Chip tone="bad">⛔ 限制开放</Chip>}
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </span>
                  </div>
                  <div className="muted small mt8">当前 {data.occupancy[a.name] || 0}/{a.capacity} 人</div>
                  {restricted && <div className="small mt8" style={{ color: 'var(--bad)' }}>{a.control_rule}</div>}
                  <div className="row mt8">
                    {a.status === 'open' && (
                      <>
                        <button className="btn btn-sm" disabled={!canEdit}
                          onClick={() => setStopTarget({ id: a.id, name: a.name, status: 'maintenance' })}>临停</button>
                        <button className="btn btn-sm" disabled={!canEdit}
                          onClick={() => setStopTarget({ id: a.id, name: a.name, status: 'emergency_stop' })}>急停</button>
                      </>
                    )}
                    {['maintenance', 'emergency_stop'].includes(a.status) && (
                      <button className="btn btn-sm" disabled={!canEdit || reopen.isPending}
                        onClick={() => reopen.mutate(a.id)}>恢复开放</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <ErrorBox error={stop.error} />
          <ErrorBox error={reopen.error} />
          {reopen.isError && (
            <div className="small mt8">前往 <Link to="/tickets">设备临停分流</Link> 完成检修照片与负责人确认后再恢复开放。</div>
          )}
        </Card>
      </div>

      <Card className="mt16"
        title={`复盘巡场待办 · 下一次巡场依据（${followups.data?.length || 0} 项待核验）`}
        extra={<Link className="btn btn-sm" to="/injuries">查看受伤赔付协商</Link>}>
        {!followups.data?.length ? (
          <div className="small muted">暂无待核验的复盘整改项。受伤复盘会标记的项目动线、员工站位、家长视线盲区整改会自动汇总到这里。</div>
        ) : (
          <table className="table">
            <thead><tr><th>项目</th><th>类型</th><th>待办 / 整改要求</th><th>来源</th><th>核验记录</th><th></th></tr></thead>
            <tbody>
              {followups.data.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.attraction_name || '全场'}</b></td>
                  <td><Chip tone="warn">{MARKER_TYPES[t.marker_type ?? '']?.icon || '•'} {MARKER_TYPES[t.marker_type ?? '']?.label || t.marker_type}</Chip></td>
                  <td style={{ maxWidth: 320 }}>{t.title}<div className="muted small">{t.detail}</div></td>
                  <td className="small muted">{t.injury_code}{t.child_name ? ` · ${t.child_name}` : ''}</td>
                  <td>
                    <input style={{ width: 200 }} placeholder="现场核验情况/照片编号"
                      value={taskNote[t.id] || ''} disabled={!canEdit}
                      onChange={(e) => setTaskNote({ ...taskNote, [t.id]: e.target.value })} />
                  </td>
                  <td>
                    <button className="btn btn-sm btn-primary" disabled={!canEdit || doneTask.isPending}
                      onClick={() => doneTask.mutate(t.id)}>核验完成</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ErrorBox error={doneTask.error} />
        <div className="small muted mt8">全部待办核验完成后，由店长在「受伤赔付协商」单确认解除限制开放，项目恢复按原规则开放。</div>
      </Card>

      {stopTarget && (
        <Modal title={`${stopTarget.name} · 发起${stopTarget.status === 'maintenance' ? '临停（维护中）' : '急停'}`}
          onClose={() => setStopTarget(null)}>
          <Field label="临停原因">
            <textarea autoFocus value={stopReason} onChange={(e) => setStopReason(e.target.value)}
              placeholder="如：弹簧区域异响，临时检修" />
          </Field>
          <div className="muted small mb8">确认后将自动生成临停处理单：快照受影响儿童与排队，可登记分流、补券与安全复检。</div>
          <ErrorBox error={stop.error} />
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={stop.isPending} onClick={() => stop.mutate()}>
            确认临停并生成处理单
          </button>
        </Modal>
      )}

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
