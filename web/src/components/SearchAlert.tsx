import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtT } from '../util';

/** 走失寻人风险提示横幅：前台与门口安保看到同一看板（查找期间手环出园已冻结） */
export default function SearchAlert() {
  const { data } = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 10000 });
  if (!data?.length) return null;
  return (
    <div className="alert-banner">
      <span className="alert-icon">🚨</span>
      <div>
        <b>走失寻人进行中（{data.length}）</b> —— 相关儿童手环出园已自动冻结，前台与门口安保请勿放行：
        {data.map((a) => (
          <span key={a.event_id} className="alert-item">
            <Link to={`/events/${a.event_id}`}>{a.code}</Link>
            {` ${a.child_name}（手环 ${a.wristband_no || '无'} · 最后位置 ${a.last_zone || '未知'} · ${fmtT(a.created_at)} 发起）`}
          </span>
        ))}
      </div>
    </div>
  );
}
