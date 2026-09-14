import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal } from '../components';
import { fmtDT, fmtT } from '../util';
import type { Party } from '../types';

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Parties() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user && ['frontdesk', 'manager', 'activity'].includes(user.role);
  const parties = useQuery({ queryKey: ['parties'], queryFn: api.parties });
  const children = useQuery({ queryKey: ['children'], queryFn: api.children });
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });

  const [showCreate, setShowCreate] = useState(false);
  const [addTo, setAddTo] = useState<Party | null>(null);
  const now = new Date();
  const [form, setForm] = useState({
    type: 'birthday', title: '', area: '',
    start_at: toLocalInput(now), end_at: toLocalInput(new Date(now.getTime() + 2 * 3600_000)),
    leader_id: '',
  });
  const [childId, setChildId] = useState('');
  const [guardianId, setGuardianId] = useState('');

  const childDetail = useQuery({
    queryKey: ['child', childId],
    queryFn: () => api.child(Number(childId)),
    enabled: !!childId,
  });

  const create = useMutation({
    mutationFn: () => api.createParty({
      type: form.type, title: form.title, area: form.area,
      start_at: form.start_at, end_at: form.end_at,
      leader_id: form.leader_id ? Number(form.leader_id) : undefined,
    }),
    onSuccess: () => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['parties'] }); },
  });
  const addChild = useMutation({
    mutationFn: () => api.addPartyChild(addTo!.id, Number(childId), Number(guardianId)),
    onSuccess: () => {
      setAddTo(null); setChildId(''); setGuardianId('');
      qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });

  return (
    <div>
      <div className="filter-bar">
        <button className="btn btn-primary" disabled={!canEdit} onClick={() => setShowCreate(true)}>＋ 创建活动</button>
        <span className="muted small">生日会 / 托管班：每个儿童登记对应监护人与活动负责人，事故沟通时直达真正授权人</span>
      </div>

      {parties.isLoading && <Loading />}
      {parties.data?.length === 0 && <Card><Empty text="暂无活动" /></Card>}

      <div className="grid grid-2">
        {parties.data?.map((p) => (
          <Card key={p.id}
            title={<span>{p.type === 'birthday' ? '🎂' : '🎒'} {p.title}</span>}
            extra={<Chip tone="info">{fmtDT(p.start_at)} – {fmtT(p.end_at)}</Chip>}>
            <div className="small muted mb8">
              区域：{p.area || '—'} · 活动负责人：<b style={{ color: 'var(--brand-deep)' }}>{p.leader_name}</b>
            </div>
            {!p.children?.length ? <Empty text="尚未登记儿童" /> : (
              <table className="table">
                <thead><tr><th>儿童</th><th>身高/过敏</th><th>对应监护人（授权人）</th><th>电话</th></tr></thead>
                <tbody>
                  {p.children.map((pc) => (
                    <tr key={pc.child_id}>
                      <td><b>{pc.child_name}</b></td>
                      <td className="small">
                        {pc.height_cm}cm
                        {pc.allergies && pc.allergies !== '无' && <span className="tag tag-bad">⚠ {pc.allergies}</span>}
                      </td>
                      <td>
                        {pc.guardian_name}（{pc.relation}）
                        {pc.is_authorized ? <Chip tone="ok">✓ 授权</Chip> : <Chip tone="bad">未授权</Chip>}
                      </td>
                      <td>{pc.guardian_phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canEdit && (
              <button className="btn btn-sm mt8" onClick={() => { setAddTo(p); setChildId(''); setGuardianId(''); }}>
                ＋ 登记儿童与监护人
              </button>
            )}
          </Card>
        ))}
      </div>

      {showCreate && (
        <Modal title="创建生日会 / 托管班" onClose={() => setShowCreate(false)}>
          <Field label="活动类型">
            <div className="row">
              <button type="button" className={`btn ${form.type === 'birthday' ? 'btn-primary' : ''}`}
                onClick={() => setForm({ ...form, type: 'birthday' })}>🎂 生日会</button>
              <button type="button" className={`btn ${form.type === 'daycare' ? 'btn-primary' : ''}`}
                onClick={() => setForm({ ...form, type: 'daycare' })}>🎒 托管班</button>
            </div>
          </Field>
          <Field label="活动标题">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：张小雨的5岁生日会" />
          </Field>
          <Field label="活动区域">
            <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="如：海洋球池、休息区" />
          </Field>
          <div className="grid grid-2">
            <Field label="开始时间">
              <input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
            </Field>
            <Field label="结束时间">
              <input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
            </Field>
          </div>
          <Field label="活动负责人" hint="不选则默认为当前登录人">
            <select value={form.leader_id} onChange={(e) => setForm({ ...form, leader_id: e.target.value })}>
              <option value="">我（{user?.name}）</option>
              {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <ErrorBox error={create.error} />
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={!form.title || create.isPending} onClick={() => create.mutate()}>
            创建活动
          </button>
        </Modal>
      )}

      {addTo && (
        <Modal title={`登记儿童到「${addTo.title}」`} onClose={() => setAddTo(null)}>
          <Field label="选择儿童">
            <select value={childId} onChange={(e) => { setChildId(e.target.value); setGuardianId(''); }}>
              <option value="">请选择…</option>
              {children.data?.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.card_no} {c.holder_name}）</option>)}
            </select>
          </Field>
          {childId && childDetail.data && (
            <Field label="该儿童本次活动的对应监护人（仅显示已授权陪同人）">
              <select value={guardianId} onChange={(e) => setGuardianId(e.target.value)}>
                <option value="">请选择…</option>
                {childDetail.data.guardians?.filter((g) => g.is_authorized).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}（{g.relation} · {g.phone}）</option>
                ))}
              </select>
              {!childDetail.data.guardians?.some((g) => g.is_authorized) && (
                <span className="field-hint" style={{ color: 'var(--bad)' }}>该儿童无已授权陪同人，请先在会员档案中补录</span>
              )}
            </Field>
          )}
          <ErrorBox error={addChild.error} />
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={!childId || !guardianId || addChild.isPending} onClick={() => addChild.mutate()}>
            登记（儿童 ↔ 监护人 ↔ 负责人 {addTo.leader_name}）
          </button>
        </Modal>
      )}
    </div>
  );
}
