import {
  BarChart3,
  BellRing,
  BrainCircuit,
  ClipboardPlus,
  Database,
  Download,
  FileSearch,
  FileText,
  FolderSearch,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Search,
  Settings,
  Target,
  X,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AuraLogo from './AuraLogo';

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

const diagnoseLinks = [
  { to: '/diagnose', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/diagnose/new', label: 'Nuevo diagnóstico', icon: ClipboardPlus },
  { to: '/diagnose/list', label: 'Diagnósticos', icon: FolderSearch },
  { to: '/diagnose/reports', label: 'Informes', icon: FileText },
];

function NavItem({ to, label, icon: Icon, close, end = false }) {
  return (
    <NavLink end={end} to={to} onClick={close} title={label} aria-label={label} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem('aura-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const firstName = profile?.full_name?.split(' ')[0] || 'Laura';
  const isAdmin = profile?.role === 'admin';
  const diagnoseEnabled = profile?.features?.diagnose === true;
  const diagnoseMode = diagnoseEnabled && location.pathname.startsWith('/diagnose');

  const close = () => setOpen(false);

  useEffect(() => {
    try { window.localStorage.setItem('aura-sidebar-collapsed', String(collapsed)); } catch { /* El navegador puede bloquear almacenamiento local. */ }
  }, [collapsed]);

  const toggleCollapsed = () => setCollapsed((value) => !value);

  return (
    <div className={`app-shell ${diagnoseMode ? 'diagnose-mode' : 'focus-mode'} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
        <div className="mobile-brand"><AuraLogo className="mobile-brand-logo" /><span>AURA GROW · {diagnoseMode ? 'DIAGNOSE' : 'FOCUS'}</span></div>
        <span className="avatar small">{firstName[0]}</span>
      </header>

      {open && <button className="sidebar-backdrop" onClick={close} aria-label="Cerrar menú" />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <button
          type="button"
          className="sidebar-collapse-button desktop-only"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expandir menú principal' : 'Ocultar menú principal'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expandir menú' : 'Ocultar menú'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <div className="sidebar-top">
          <div className="brand-lockup">
            <span className="brand-mark"><AuraLogo /></span>
            <div>
              <strong>AURA OS</strong>
              <span>by Laura Rodriguez</span>
            </div>
          </div>
          <button className="icon-button mobile-only" onClick={close} aria-label="Cerrar menú"><X /></button>
        </div>

        <div className="module-switcher" aria-label="Cambiar experiencia de Aura Grow">
          <NavLink to="/focus" onClick={close} title="Focus" aria-label="Focus" className={!diagnoseMode ? 'module-option active focus-option' : 'module-option focus-option'}>
            <ListChecks size={17} />
            <div><small>AURA GROW</small><strong>Focus</strong></div>
          </NavLink>
          {diagnoseEnabled && (
            <NavLink to="/diagnose" onClick={close} title="Diagnose" aria-label="Diagnose" className={diagnoseMode ? 'module-option active diagnose-option' : 'module-option diagnose-option'}>
              <BrainCircuit size={17} />
              <div><small>AURA GROW</small><strong>Diagnose</strong></div>
            </NavLink>
          )}
        </div>

        <nav className="sidebar-nav">
          {diagnoseMode ? (
            <>
              <p className="nav-caption diagnose-caption">ANÁLISIS Y ESTRATEGIA</p>
              {diagnoseLinks.map((item) => <NavItem key={item.to} {...item} close={close} />)}
            </>
          ) : (
            <>
              <p className="nav-caption">EJECUCIÓN COMERCIAL</p>
              {executionLinks.map((item) => <NavItem key={item.to} {...item} close={close} />)}
              {isAdmin && (
                <>
                  <p className="nav-caption admin-caption">CONTROL Y MEDICIÓN</p>
                  {adminLinks.map((item) => <NavItem key={item.to} {...item} close={close} />)}
                </>
              )}
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

      {diagnoseMode ? (
        <nav className="mobile-bottom-nav diagnose-mobile-nav" aria-label="Navegación móvil de Diagnose">
          <NavLink end to="/diagnose" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><LayoutDashboard size={19} /><span>Inicio</span></NavLink>
          <NavLink to="/diagnose/new" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><ClipboardPlus size={19} /><span>Nuevo</span></NavLink>
          <NavLink to="/diagnose/list" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><FileSearch size={19} /><span>Diagnósticos</span></NavLink>
          <NavLink to="/diagnose/reports" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><FileText size={19} /><span>Informes</span></NavLink>
        </nav>
      ) : (
        <nav className="mobile-bottom-nav" aria-label="Navegación móvil de Focus">
          <NavLink to="/focus" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><ListTodo size={19} /><span>Hoy</span></NavLink>
          <NavLink to="/finder" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><Search size={19} /><span>Generar</span></NavLink>
          <NavLink to="/leads" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><Database size={19} /><span>Leads</span></NavLink>
          <NavLink to="/followups" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><BellRing size={19} /><span>Seguimientos</span></NavLink>
          <NavLink to="/call-log" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}><PhoneCall size={19} /><span>Call Log</span></NavLink>
        </nav>
      )}
    </div>
  );
}
