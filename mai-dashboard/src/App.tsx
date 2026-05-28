import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Overview from './pages/Overview.js';
import ProjectKanban from './pages/ProjectKanban.js';
import EscalationQueue from './pages/EscalationQueue.js';
import AgentActivity from './pages/AgentActivity.js';
import DependencyGraph from './pages/DependencyGraph.js';
import Login from './pages/Login.js';
import { checkAuth, logout } from './api.js';

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth().then(ok => setAuthenticated(ok));
  }, []);

  async function handleLogout() {
    await logout();
    setAuthenticated(false);
    navigate('/');
  }

  if (authenticated === null) return <div className="loading">Loading…</div>;

  if (!authenticated) {
    return <Login onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <>
      <nav>
        <span className="nav-brand">mai</span>
        <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Overview</NavLink>
        <NavLink to="/escalations" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Escalations</NavLink>
        <NavLink to="/agents" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Agents</NavLink>
        <span style={{ flex: 1 }} />
        <button className="btn-muted" style={{ fontSize: 12 }} onClick={() => void handleLogout()}>Logout</button>
      </nav>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/projects/:id" element={<ProjectKanban />} />
        <Route path="/graph/:id" element={<DependencyGraph />} />
        <Route path="/escalations" element={<EscalationQueue />} />
        <Route path="/agents" element={<AgentActivity />} />
      </Routes>
    </>
  );
}
