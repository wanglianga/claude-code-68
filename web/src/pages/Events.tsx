import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal } from '../components';
import { EVENT_STATUS, EVENT_TYPES, fmtDT, SEVERITY } from '../util';

export default function Events() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const events = useQuery({ queryKey: ['events', status, type], queryFn: () => api.events(status, type) });
  const children = useQuery({ queryKey: ['children'], queryFn: api.children });
  const attrs = useQuery({ queryKey: ['attractions'], queryFn: api.attractions });

  const [form, setForm] = useState({ type: 'fall', title: '', description: '', child_id: '', attraction_id: '', severity: 'medium' });
  const create = useMutation({
    mutationFn: () => api.createEvent({
      type: form.type, title: form.title, description: form.description,
      child_id: form.child_id ? Number(form.child_id) : null,
      attraction_id: form.attraction_id ? Number(form.attraction_id) : null,
      severity: form.severity,
    }),
    onSuccess: (r) => {
      setShowCreate(false);
      setForm({ type: 'fall', title: '', description: '', child_id: '', attraction_id: '', severity: 'medium' });
      qc.invalidateQueries({ queryKey: ['events'] });
      nav(`/events/${r.id}`);
    },
  });

  return (
    <div>
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>＋ 上报事件</button>
        <span className="muted small">状态：</span>
        {[{ v: '', l: '全部' }, ...Object.entries(EVENT_STATUS).map(([v, s]) => ({ v, l: s.label }))].map((s) => (
          <button key={s.v} className={`btn btn-sm ${status === s.v ? 'btn-primary' : ''}`} onClick={() => setStatus(s.v)}>{s.l}</button>
        ))}
        <span className="muted small">类型：</span>
        <select style={{ width: 160 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(EVENT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <Card>
        {events.isLoading && <Loading />}
        {events.data?.length === 0 && <Empty text="暂无事件" />}
        {!!events.data?.length && (
          <table className="table">
            <thead><tr><th>编号</th><th>类型</th><th>事件</th><th>关联儿童</th><th>项目</th><th>严重度</th><th>状态</th><th>上报</th><th></th></tr></thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td className="muted small">{e.code}</td>
                  <td><Chip tone="info">{EVENT_TYPES[e.type]}</Chip></td>
                  <td><b>{e.title}</b></td>
                  <td>{e.child_name || '—'}</td>
                  <td>{e.attraction_name || '—'}</td>
                  <td><Chip tone={SEVERITY[e.severity].tone}>{SEVERITY[e.severity].label}</Chip></td>
                  <td><Chip tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Chip></td>
                  <td className="small">{e.created_by_name}<div className="muted">{fmtDT(e.created_at)}</div></td>
                  <td><Link className="btn btn-sm" to={`/events/${e.id}`}>处置</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showCreate && (
        <Modal title="上报安全/运营事件" onClose={() => setShowCreate(false)}>
          <Field label="事件类型">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(EVENT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="标题">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如：张小雨在海洋球池摔倒擦伤" />
          </Field>
          <Field label="经过描述">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-2">
            <Field label="关联儿童（可选）">
              <select value={form.child_id} onChange={(e) => setForm({ ...form, child_id: e.target.value })}>
                <option value="">不关联</option>
                {children.data?.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.card_no}）</option>)}
              </select>
            </Field>
            <Field label="关联项目（可选）">
              <select value={form.attraction_id} onChange={(e) => setForm({ ...form, attraction_id: e.target.value })}>
                <option value="">不关联</option>
                {attrs.data?.attractions.filter((a) => !a.is_facility).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="严重度">
            <div className="row">
              {Object.entries(SEVERITY).map(([v, s]) => (
                <button key={v} type="button" className={`btn ${form.severity === v ? 'btn-primary' : ''}`}
                  onClick={() => setForm({ ...form, severity: v })}>{s.label}</button>
              ))}
            </div>
          </Field>
          <ErrorBox error={create.error} />
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={!form.title || create.isPending} onClick={() => create.mutate()}>
            创建事件并进入处置
          </button>
        </Modal>
      )}
    </div>
  );
}
