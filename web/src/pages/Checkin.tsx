import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Card, Chip, Empty, ErrorBox, OkBox } from '../components';
import { ageOf, fmtT, MEMBER_TYPE, parseJSON } from '../util';
import type { Child, Guardian, Member } from '../types';

export default function Checkin() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [wristband, setWristband] = useState('');
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['members', q], queryFn: () => api.members(q) });
  const memberDetail = useQuery({
    queryKey: ['member', member?.id],
    queryFn: () => api.member(member!.id),
    enabled: !!member,
  });
  const active = useQuery({ queryKey: ['activeCheckins'], queryFn: api.activeCheckins, refetchInterval: 10000 });
  const nextWb = useQuery({ queryKey: ['nextWb'], queryFn: api.nextWristband });

  useEffect(() => { if (nextWb.data && !wristband) setWristband(nextWb.data.wristband_no); }, [nextWb.data]);

  const detail = memberDetail.data;
  const guardians: Guardian[] = useMemo(
    () => (detail?.children || []).find((c) => c.id === child?.id)?.guardians || [],
    [detail, child],
  );

  // 核验链预检（与服务端一致的提示）
  const checks = useMemo(() => {
    if (!detail || !child) return [];
    const m = detail;
    const list: { ok: boolean; text: string }[] = [];
    list.push({ ok: m.status === 'active', text: `会员卡状态：${m.status === 'active' ? '正常' : '异常（冻结/过期）'}` });
    list.push({ ok: m.valid_until >= new Date().toISOString(), text: `有效期至 ${m.valid_until.slice(0, 10)}` });
    if (m.type === 'punch') list.push({ ok: m.remaining_sessions > 0, text: `次卡剩余 ${m.remaining_sessions} 次（入园扣减 1 次）` });
    else list.push({ ok: true, text: '会员卡不限次入园' });
    if (guardian) list.push({ ok: !!guardian.is_authorized, text: guardian.is_authorized ? `陪同人 ${guardian.name} 已获授权` : `陪同人 ${guardian.name} 未获授权（仅紧急联系人）` });
    if (active.data) list.push({ ok: active.data.inside_count < active.data.daily_limit, text: `当日限流：在场 ${active.data.inside_count}/${active.data.daily_limit} 人` });
    if (active.data) list.push({ ok: !active.data.list.some((c) => c.child_id === child.id), text: '该儿童当前不在场内' });
    return list;
  }, [detail, child, guardian, active.data]);

  const allPass = checks.length > 0 && checks.every((c) => c.ok);

  const doCheckin = useMutation({
    mutationFn: () => api.checkin(child!.id, guardian!.id, wristband),
    onSuccess: (r) => {
      setOkMsg(r.message);
      setChild(null); setGuardian(null); setWristband('');
      qc.invalidateQueries();
    },
    onError: () => setOkMsg(null),
  });
  const doCheckout = useMutation({
    mutationFn: (id: number) => api.checkout(id),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="checkin-layout">
      <Card title="入园核验（会员 → 儿童 → 陪同人授权 → 限流 → 手环）">
        <div className="step-title"><span className="step-no">1</span>核验会员</div>
        <input placeholder="搜索卡号 / 持卡人 / 手机号" value={q} onChange={(e) => { setQ(e.target.value); }} />
        <div className="mt8" style={{ maxHeight: 180, overflowY: 'auto' }}>
          {members.data?.map((m) => (
            <div key={m.id} className={`pick ${member?.id === m.id ? 'active' : ''}`}
              onClick={() => { setMember(m); setChild(null); setGuardian(null); setOkMsg(null); }}>
              <b>{m.holder_name}</b> <span className="muted small">{m.card_no} · {MEMBER_TYPE[m.type]}
                {m.type === 'punch' ? ` · 剩余 ${m.remaining_sessions} 次` : ''}</span>
            </div>
          ))}
        </div>

        {detail && (
          <>
            <div className="step-title"><span className="step-no">2</span>选择儿童（身份核验）</div>
            {(detail.children || []).map((c) => (
              <div key={c.id} className={`pick ${child?.id === c.id ? 'active' : ''}`}
                onClick={() => { setChild(c); setGuardian(null); }}>
                <b>{c.name}</b> <span className="muted small">{ageOf(c.birth_date)} · {c.height_cm}cm</span>
                {c.allergies && c.allergies !== '无' && <span className="tag tag-bad">⚠ {c.allergies}</span>}
                {parseJSON<string[]>(c.banned, []).length > 0 && <span className="tag tag-warn">有禁玩项目</span>}
              </div>
            ))}
          </>
        )}

        {child && (
          <>
            <div className="step-title"><span className="step-no">3</span>陪同监护人授权核验</div>
            {guardians.map((g) => (
              <div key={g.id}
                className={`pick ${guardian?.id === g.id ? 'active' : ''} ${!g.is_authorized ? 'disabled' : ''}`}
                onClick={() => g.is_authorized && setGuardian(g)}>
                <b>{g.name}</b> <span className="muted small">{g.relation} · {g.phone}</span>
                {g.is_authorized
                  ? <Chip tone="ok">✓ 已授权陪同</Chip>
                  : <Chip tone="muted">未授权 · 仅紧急联系</Chip>}
              </div>
            ))}
            <div className="step-title"><span className="step-no">4</span>分配手环</div>
            <div className="row">
              <input style={{ width: 180 }} value={wristband} onChange={(e) => setWristband(e.target.value)} placeholder="手环号" />
              <button className="btn btn-sm" onClick={() => nextWb.refetch()}>自动分配</button>
            </div>

            <div className="step-title"><span className="step-no">5</span>系统核验结果</div>
            <ul className="check-list">
              {checks.map((c, i) => (
                <li key={i} style={{ color: c.ok ? 'var(--ok)' : 'var(--bad)' }}>{c.ok ? '✓' : '✗'} {c.text}</li>
              ))}
            </ul>
            <ErrorBox error={doCheckin.error} />
            <OkBox text={okMsg} />
            <button className="btn btn-primary mt8" style={{ width: '100%' }}
              disabled={!allPass || !guardian || !wristband || doCheckin.isPending}
              onClick={() => doCheckin.mutate()}>
              {doCheckin.isPending ? '核验中…' : '核验通过，放行入园'}
            </button>
          </>
        )}
      </Card>

      <Card title={`在场名单（${active.data?.inside_count ?? 0}/${active.data?.daily_limit ?? '-'}）`}>
        {active.data && (
          <div className="mb16">
            <div className="limit-bar">
              <div style={{ width: `${Math.min(100, (active.data.inside_count / active.data.daily_limit) * 100)}%` }} />
            </div>
          </div>
        )}
        {!active.data?.list.length ? <Empty text="当前无在场儿童" /> : (
          <table className="table">
            <thead><tr><th>儿童</th><th>手环</th><th>位置</th><th>陪同人</th><th>入园</th><th></th></tr></thead>
            <tbody>
              {active.data.list.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.child_name}</b><div className="muted small">{c.card_no}</div></td>
                  <td><Chip tone="info">{c.wristband_no}</Chip></td>
                  <td>{c.zone || '—'}</td>
                  <td>{c.guardian_name}</td>
                  <td>{fmtT(c.checkin_at)}</td>
                  <td>
                    <button className="btn btn-sm" disabled={doCheckout.isPending}
                      onClick={() => doCheckout.mutate(c.id)}>离场</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
