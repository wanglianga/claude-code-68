import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth';
import { ROLE_NAMES } from './util';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Members from './pages/Members';
import Checkin from './pages/Checkin';
import Recommend from './pages/Recommend';
import Patrol from './pages/Patrol';
import Tickets from './pages/Tickets';
import Events from './pages/Events';
import EventDetail from './pages/EventDetail';
import Injuries from './pages/Injuries';
import InjuryDetail from './pages/InjuryDetail';
import Parties from './pages/Parties';
import Review from './pages/Review';

const NAV = [
  { to: '/', label: '运营概览', icon: '📊', end: true },
  { to: '/members', label: '会员与儿童档案', icon: '👨‍👩‍👧' },
  { to: '/checkin', label: '入园核验', icon: '🎫' },
  { to: '/recommend', label: '游玩推荐', icon: '🧭' },
  { to: '/patrol', label: '巡场记录', icon: '🧹' },
  { to: '/tickets', label: '设备临停分流', icon: '🛠️' },
  { to: '/events', label: '事件中心', icon: '🚨' },
  { to: '/injuries', label: '受伤赔付协商', icon: '🤝' },
  { to: '/parties', label: '生日会 / 托管班', icon: '🎂' },
  { to: '/review', label: '安全复盘', icon: '🔍', roles: ['manager'] },
];

function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand-logo">🎡</span>
          <div>
            <div className="brand-name">童趣安</div>
            <div className="brand-sub">会员入园 · 安全处置</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.filter((n) => !n.roles || n.roles.includes(user.role)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end as boolean | undefined}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">城市儿童游乐场安全运营平台</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">城市儿童游乐场 · 会员入园与安全事故处置</div>
          <div className="topbar-user">
            <span className="role-badge">{ROLE_NAMES[user.role] || user.role}</span>
            <span className="user-name">{user.name}</span>
            <button className="btn btn-ghost" onClick={() => { logout(); nav('/login'); }}>退出</button>
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/members" element={<Members />} />
            <Route path="/checkin" element={<Checkin />} />
            <Route path="/recommend" element={<Recommend />} />
            <Route path="/patrol" element={<Patrol />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/injuries" element={<Injuries />} />
            <Route path="/injuries/:id" element={<InjuryDetail />} />
            <Route path="/parties" element={<Parties />} />
            <Route path="/review" element={<Review />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<RequireAuth><Layout /></RequireAuth>} />
    </Routes>
  );
}
