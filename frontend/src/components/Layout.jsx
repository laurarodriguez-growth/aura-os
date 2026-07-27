import {
  BarChart3,
  BellRing,
  Blocks,
  BrainCircuit,
  Database,
  Download,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  PhoneCall,
  Search,
  Settings,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const growLinks = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/finder', label: 'Generar leads', icon: Search, adminOnly: true },
  { to: '/leads', label: 'Base de leads', icon: Database },
  { to: '/pipeline', label: 'Pipeline', icon: Target },
  { to: '/followups', label: 'Seguimientos', icon: BellRing },
  { to: '/call-log', label: 'Call Log', icon: PhoneCall },
  { to: '/exports', label: 'Exportaciones', icon: Download },
];

const futureModules = [
  { label: 'AdVision', icon: Megaphone },
  { label: 'Aura Vision', icon: Sparkles },
  { label: 'Aura Flow', icon: Blocks },
  { label: 'Aura Analytics', icon: BarChart3 },
  { label: 'Aura AI', icon: BrainCircuit },
];

export default function Layout({ children }) {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const firstName = profile?.full_name?.split(' ')[0] || 'Laura';

  const close = () => setOpen(false);

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
        <div className="mobile-brand">AURA OS</div>
        <span className="avatar small">{firstName[0]}</span>
      </header>

      {open && <button className="sidebar-backdrop" onClick={close} aria-label="Cerrar menú" />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand-lockup">
            <span className="brand-mark">A</span>
            <div>
              <strong>AURA OS</strong>
              <span>by Laura Rodriguez</span>
            </div>
          </div>
          <button className="icon-button mobile-only" onClick={close} aria-label="Cerrar menú"><X /></button>
        </div>

        <div className="module-title">
          <span className="module-dot" />
          <div><small>MÓDULO ACTIVO</small><strong>Aura Grow</strong></div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-caption">OPERACIÓN</p>
          {growLinks.filter((item) => !item.adminOnly || profile?.role === 'admin').map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={close} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}

          <p className="nav-caption future-caption">PRÓXIMOS MÓDULOS</p>
          {futureModules.map(({ label, icon: Icon }) => (
            <div className="nav-link disabled" key={label} title="Se construirá después de Aura Grow">
              <Icon size={18} />
              <span>{label}</span>
              <em>Próximamente</em>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className="nav-link" onClick={close}><Settings size={18} /><span>Configuración</span></NavLink>
          <div className="user-card">
            <span className="avatar">{firstName[0]}</span>
            <div><strong>{profile?.full_name || 'Usuario'}</strong><small>{profile?.role === 'admin' ? 'Administradora' : 'Agente'}</small></div>
            <button className="icon-button" onClick={signOut} title="Cerrar sesión"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
