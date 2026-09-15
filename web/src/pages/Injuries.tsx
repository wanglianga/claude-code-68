import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Chip, Empty, Loading } from '../components';
import { fmtDT, INJURY_PLANS, MEMBER_TYPE } from '../util';

const TABS = [
  { v: '', l: '全部' },
  { v: 'collecting', l: '待店长决策' },
  { v: 'decided', l: '协商进行中' },
  { v: 'done', l: '已闭环' },
];

function stageOf(c: { plan: string | null; parent_confirmed: number; reviewed: number }) {
  if (!c.plan) return { label: '收集中 · 待决策', tone: 'warn' };
  if (!c.parent_confirmed) return { label: '待家长确认', tone: 'info' };
  if (!c.reviewed) return { label: '待员工复盘', tone: 'info' };
  return { label: '待巡场整改/闭环', tone: 'ok' };
}

export default function Injuries() {
  const [tab, setTab] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['injuries', tab],
    queryFn: () => api.injuries(tab),
  });

  return (
    <div>
      <div className="filter-bar">
        <span className="muted small">
          受伤赔付协商（擦伤 / 扭伤 …）：信息收集（项目 · 动作 · 陪同人位置 · 急救处理 · 家长诉求）→ 店长决策 → 会员卡权益与事故复盘同步 → 家长确认 → 员工复盘 → 巡场整改
        </span>
      </div>
      <div className="filter-bar">
        {TABS.map((t) => (
          <button key={t.v} className={`btn btn-sm ${tab === t.v ? 'btn-primary' : ''}`} onClick={() => setTab(t.v)}>{t.l}</button>
        ))}
      </div>

      <Card>
        {isLoading && <Loading />}
        {data?.length === 0 && <Empty text="暂无受伤赔付协商单" />}
        {!!data?.length && (
          <table className="table">
            <thead>
              <tr><th>编号</th><th>伤情</th><th>儿童 / 会员卡</th><th>项目</th><th>店长方案</th><th>家长确认</th><th>员工复盘</th><th>阶段</th><th></th></tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const st = stageOf(c);
                const closed = !!c.plan && c.parent_confirmed === 1 && c.reviewed === 1 && tab === 'done';
                return (
                  <tr key={c.id}>
                    <td className="muted small">{c.code}<div className="muted">{fmtDT(c.created_at)}</div></td>
                    <td><Chip tone="bad">{c.injury_type}</Chip></td>
                    <td><b>{c.child_name || '—'}</b>{c.card_no && <div className="muted small">{c.card_no}（{MEMBER_TYPE[c.card_type || 'member']}）</div>}</td>
                    <td>{c.attraction_name || c.play_item || '—'}</td>
                    <td>{c.plan
                      ? <span>{INJURY_PLANS[c.plan]?.icon} {c.plan_label}{c.plan === 'class_compensation' ? ` ${c.class_sessions}节` : c.plan === 'medical_reimburse' ? ` ¥${Number(c.medical_fee).toFixed(2)}` : ''}</span>
                      : <span className="muted">未决策</span>}</td>
                    <td>{c.parent_confirmed ? <Chip tone="ok">已确认</Chip> : c.plan ? <Chip tone="warn">待确认</Chip> : '—'}</td>
                    <td>{c.reviewed ? <Chip tone="ok">已复盘</Chip> : c.parent_confirmed ? <Chip tone="warn">待复盘</Chip> : '—'}</td>
                    <td><Chip tone={closed ? 'ok' : st.tone}>{closed ? '已闭环' : st.label}</Chip></td>
                    <td><Link className="btn btn-sm" to={`/injuries/${c.id}`}>进入协商</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
