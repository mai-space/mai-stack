import { Routes, Route, NavLink } from 'react-router-dom';
import Overview from './pages/Overview.js';
import ProjectKanban from './pages/ProjectKanban.js';
import EscalationQueue from './pages/EscalationQueue.js';
import AgentActivity from './pages/AgentActivity.js';

export default function App() {
  return (
    <>
      <nav>
        <span className="nav-brand">mai</span>
        <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Overview</NavLink>
        <NavLink to="/escalations" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Escalations</NavLink>
        <NavLink to="/agents" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Agents</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/projects/:id" element={<ProjectKanban />} />
        <Route path="/escalations" element={<EscalationQueue />} />
        <Route path="/agents" element={<AgentActivity />} />
      </Routes>
    </>
  );
}
