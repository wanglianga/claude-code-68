import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorBox } from '../components';
import { ROLE_NAMES } from '../util';

const DEMO = [
  { u: 'frontdesk', p: 'fd123456', desc: '入园核验 / 家长沟通' },
  { u: 'patrol', p: 'pt123456', desc: '巡场记录 / 走失查找' },
  { u: 'manager', p: 'mg123456', desc: '事件归档 / 安全复盘' },
  { u: 'medical', p: 'md123456', desc: '急救处置 / 标记解决' },
  { u: 'activity', p: 'ac123456', desc: '生日会 / 托管班负责人' },
  { u: 'security', p: 'sc123456', desc: '门口安保 / 出园风险提示' },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('frontdesk');
  const [password, setPassword] = useState('fd123456');
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await login(username.trim(), password);
      nav('/');
    } catch (ex) {
      setErr(ex as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="logo">🎡</div>
          <h1>童趣安 · 安全运营平台</h1>
          <p>城市儿童游乐场会员入园与安全事故处置系统</p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">账号</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <ErrorBox error={err} />
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? '登录中…' : '登 录'}
          </button>
        </form>
        <div className="demo-accounts">
          {DEMO.map((d) => (
            <button key={d.u} type="button" className="demo-account"
              onClick={() => { setUsername(d.u); setPassword(d.p); }}>
              <b>{ROLE_NAMES[d.u] || d.u}</b>
              {d.u} / {d.p}
              <div className="muted">{d.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
