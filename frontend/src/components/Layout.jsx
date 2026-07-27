import {
  BarChart3,
  BellRing,
  Database,
  Download,
  ListTodo,
  LogOut,
  Menu,
  PhoneCall,
  Search,
  Settings,
  Target,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const executionLinks = [
  { to: '/focus', label: 'Hoy', icon: ListTodo },
  { to: '/finder', label: 'Generar leads', icon: Search },
  { to: '/leads', label: 'Base de leads', icon: Database },
  { to: '/pipeline', label: 'Pipeline', icon: Target },
  { to: '/followups', label: 'Seguimientos', icon: BellRing },
  { to: '/call-log', label: 'Call Log', icon: PhoneCall },
];

const adminLinks = [
  { to: '/performance', label: 'Rendimiento', icon: BarChart3 },
  { to: '/exports', label: 'Exportaciones', icon: Download },
];

function NavItem({ to, label, icon: Icon, close }) {
  return (
    <NavLink to={to} onClick={close} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const firstName = profile?.full_name?.split(' ')[0] || 'Laura';
  const isAdmin = profile?.role === 'admin';

  const close = () => setOpen(false);

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
        <div className="mobile-brand">AURA GROW</div>
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
          <div><small>AURA GROW</small><strong>Focus</strong></div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-caption">EJECUCIÓN COMERCIAL</p>
          {executionLinks.map((item) => <NavItem key={item.to} {...item} close={close} />)}

          {isAdmin && (
            <>
              <p className="nav-caption admin-caption">CONTROL Y MEDICIÓN</p>
              {adminLinks.map((item) => <NavItem key={item.to} {...item} close={close} />)}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className="nav-link" onClick={close}><Settings size={18} /><span>Mi cuenta</span></NavLink>
          <div className="user-card">
            <span className="avatar">{firstName[0]}</span>
            <div><strong>{profile?.full_name || 'Usuario'}</strong><small>{isAdmin ? 'Administradora' : 'Setter Focus'}</small></div>
            <button className="icon-button" onClick={signOut} title="Cerrar sesión"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Navegación móvil de Focus">
        <NavLink to="/focus" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><ListTodo size={19} /><span>Hoy</span></NavLink>
        <NavLink to="/finder" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><Search size={19} /><span>Generar</span></NavLink>
        <NavLink to="/leads" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><Database size={19} /><span>Leads</span></NavLink>
        <NavLink to="/followups" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><BellRing size={19} /><span>Seguimientos</span></NavLink>
        <NavLink to="/call-log" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><PhoneCall size={19} /><span>Call Log</span></NavLink>
      </nav>
    </div>
  );
}
