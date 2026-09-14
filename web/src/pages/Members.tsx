import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Card, Chip, Empty, ErrorBox, Loading } from '../components';
import { ageOf, ATTR_KEY_NAMES, fmtD, MEMBER_TYPE, parseJSON } from '../util';
import type { Member } from '../types';

export default function Members() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const list = useQuery({ queryKey: ['members', q], queryFn: () => api.members(q) });
  const detail = useQuery({
    queryKey: ['member', selected],
    queryFn: () => api.member(selected!),
    enabled: selected != null,
  });

  const benefitsOf = (m: Member) => Object.entries(parseJSON<Record<string, string>>(m.benefits, {}));

  return (
    <div className="member-layout">
      <Card title="会员检索" extra={<span className="muted small">{list.data?.length ?? 0} 位会员</span>}>
        <input placeholder="搜索卡号 / 持卡人 / 手机号" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt16">
          {list.isLoading && <Loading />}
          {list.data?.length === 0 && <Empty text="未找到会员" />}
          {list.data?.map((m) => (
            <div key={m.id} className={`member-item ${selected === m.id ? 'active' : ''}`} onClick={() => setSelected(m.id)}>
              <div className="row spread">
                <b>{m.holder_name}</b>
                <Chip tone={m.type === 'member' ? 'info' : 'warn'}>{MEMBER_TYPE[m.type]}</Chip>
              </div>
              <div className="small muted mt8">
                {m.card_no} · {m.phone}
              </div>
              <div className="small">
                {m.type === 'punch'
                  ? <span className={m.remaining_sessions <= 1 ? 'tag tag-bad' : 'tag'}>剩余 {m.remaining_sessions} 次</span>
                  : <span className="tag">不限次</span>}
                {(m.children || []).map((c) => <span key={c.id} className="tag">{c.name}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div>
        {!selected && <Card><Empty text="选择左侧会员查看儿童档案、监护人与剩余权益" /></Card>}
        {selected && detail.isLoading && <Loading />}
        {detail.error && <ErrorBox error={detail.error} />}
        {detail.data && (
          <>
            <Card title={`会员卡 ${detail.data.card_no}`} extra={
              <Chip tone={detail.data.status === 'active' ? 'ok' : 'bad'}>
                {detail.data.status === 'active' ? '正常' : detail.data.status}
              </Chip>
            }>
              <dl className="kv">
                <dt>持卡人</dt><dd>{detail.data.holder_name}（{detail.data.phone}）</dd>
                <dt>卡类型</dt><dd>{MEMBER_TYPE[detail.data.type]}</dd>
                <dt>有效期至</dt><dd>{fmtD(detail.data.valid_until)}</dd>
                {detail.data.type === 'punch' && <>
                  <dt>剩余次数</dt>
                  <dd><b style={{ color: detail.data.remaining_sessions <= 1 ? 'var(--bad)' : 'inherit' }}>{detail.data.remaining_sessions}</b> 次</dd>
                </>}
                <dt>剩余权益</dt>
                <dd>{benefitsOf(detail.data).map(([k, v]) => <span key={k} className="tag">{k}：{v}</span>)}</dd>
              </dl>
            </Card>

            {(detail.data.children || []).map((c) => (
              <Card key={c.id} className="mt16" title={`${c.name}（${c.gender} · ${ageOf(c.birth_date)}）`}
                extra={<Chip tone="info">身高 {c.height_cm} cm</Chip>}>
                <dl className="kv">
                  <dt>出生日期</dt><dd>{c.birth_date}</dd>
                  <dt>过敏史</dt>
                  <dd>{c.allergies && c.allergies !== '无'
                    ? <span className="tag tag-bad">⚠ {c.allergies}</span> : '无'}</dd>
                  <dt>禁玩项目</dt>
                  <dd>{parseJSON<string[]>(c.banned, []).length
                    ? parseJSON<string[]>(c.banned, []).map((b) => <span key={b} className="tag tag-warn">🚫 {ATTR_KEY_NAMES[b] || b}</span>)
                    : '无'}</dd>
                  {c.notes && <><dt>备注</dt><dd>{c.notes}</dd></>}
                </dl>
                <h4 className="mt16 mb8" style={{ fontSize: 13 }}>监护人与紧急联系人</h4>
                <table className="table">
                  <thead><tr><th>姓名</th><th>关系</th><th>电话</th><th>可陪同（授权）</th><th>紧急联系人</th></tr></thead>
                  <tbody>
                    {(c.guardians || []).map((g) => (
                      <tr key={g.id}>
                        <td><b>{g.name}</b></td>
                        <td>{g.relation}</td>
                        <td>{g.phone}</td>
                        <td>{g.is_authorized ? <Chip tone="ok">✓ 已授权</Chip> : <Chip tone="muted">未授权</Chip>}</td>
                        <td>{g.is_emergency ? <Chip tone="info">✓</Chip> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
