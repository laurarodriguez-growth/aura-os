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
  { to: '/followups', label: 'Seguimientos', icon: BellRing },
  { to: '/call-log', label: 'Call Log', icon: PhoneCall },
];

const adminLinks = [
  { to: '/pipeline', label: 'Pipeline comercial', icon: Target },
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
    <NavLink
      end={end}
      to={to}
      onClick={close}
      title={label}
      aria-label={label}
      data-sidebar-tooltip={label}
      className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="sidebar-label">{label}</span>
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('aura-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const firstName = profile?.full_name?.split(' ')[0] || 'Usuario';
  const isAdmin = profile?.role === 'admin';
  const diagnoseEnabled = profile?.features?.diagnose === true;
  const diagnoseMode = diagnoseEnabled && location.pathname.startsWith('/diagnose');

  const closeMobile = () => setMobileOpen(false);
  const closeAccount = () => setAccountOpen(false);
  const openMainMenu = () => {
    closeAccount();
    if (window.matchMedia('(max-width: 900px)').matches) {
      setMobileOpen(true);
      return;
    }
    setCollapsed((current) => !current);
  };
  const toggleAccount = () => {
    closeMobile();
    setAccountOpen((current) => !current);
  };
  const handleSignOut = async () => {
    closeMobile();
    closeAccount();
    await signOut();
  };
  const toggleCollapsed = () => setCollapsed((current) => !current);

  useEffect(() => {
    closeMobile();
    closeAccount();
  }, [location.pathname]);

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 900px)').matches;
    const shouldLock = compactViewport && (mobileOpen || accountOpen);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = shouldLock ? 'hidden' : previousOverflow;
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, accountOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem('aura-sidebar-collapsed', String(collapsed));
    } catch {
      // Aura sigue funcionando aunque el navegador bloquee localStorage.
    }
  }, [collapsed]);

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  return (
    <div
      className={`app-shell ${diagnoseMode ? 'diagnose-mode' : 'focus-mode'} ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'} ${mobileOpen ? 'mobile-menu-open' : ''} ${accountOpen ? 'mobile-account-open' : ''}`}
    >
      <header className="mobile-header global-app-header">
        <button
          type="button"
          className="mobile-menu-trigger global-menu-trigger"
          onClick={openMainMenu}
          aria-label="Abrir o compactar el menú principal"
        >
          <Menu size={22} aria-hidden="true" />
          <span>Menú</span>
        </button>
        <div className="mobile-brand">
          <AuraLogo className="mobile-brand-logo" />
          <span>AURA GROW · {diagnoseMode ? 'DIAGNOSE' : 'FOCUS'}</span>
        </div>
        <button
          type="button"
          className="mobile-account-trigger global-account-trigger"
          onClick={toggleAccount}
          aria-label="Abrir opciones de cuenta"
          aria-expanded={accountOpen}
        >
          <span className="avatar small">{firstName[0]}</span>
        </button>
      </header>

      {mobileOpen && <button className="sidebar-backdrop" onClick={closeMobile} aria-label="Cerrar menú" />}

      {accountOpen && (
        <>
          <button className="account-backdrop" onClick={closeAccount} aria-label="Cerrar opciones de cuenta" />
          <section className="mobile-account-sheet global-account-panel" aria-label="Opciones de cuenta">
            <div className="mobile-account-identity">
              <span className="avatar">{firstName[0]}</span>
              <div>
                <strong>{profile?.full_name || 'Usuario'}</strong>
                <small>{isAdmin ? 'Administradora' : 'Setter Focus'}</small>
              </div>
              <button type="button" className="icon-button" onClick={closeAccount} aria-label="Cerrar opciones de cuenta">
                <X size={20} />
              </button>
            </div>
            <NavLink to="/settings" className="mobile-account-action" onClick={closeAccount}>
              <Settings size={20} />
              <span>Mi cuenta</span>
            </NavLink>
            <button type="button" className="mobile-account-action danger" onClick={handleSignOut}>
              <LogOut size={20} />
              <span>Cerrar sesión</span>
            </button>
          </section>
        </>
      )}

      <aside className={`sidebar sidebar-v3 ${mobileOpen ? 'open' : ''}`} aria-label="Navegación principal">
        <div className="sidebar-top sidebar-top-v3">
          <NavLink
            to={diagnoseMode ? '/diagnose' : '/focus'}
            className="brand-lockup"
            onClick={closeMobile}
            title="Aura OS"
            aria-label="Ir al inicio de Aura Grow"
          >
            <span className="brand-mark"><AuraLogo /></span>
            <div className="brand-copy sidebar-label">
              <strong>AURA OS</strong>
              <span>by Laura Rodriguez</span>
            </div>
          </NavLink>

          <div className="sidebar-top-actions">
            <button
              type="button"
              className="sidebar-toggle-v3 desktop-only"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expandir menú principal' : 'Compactar menú principal'}
              aria-expanded={!collapsed}
              title={`${collapsed ? 'Expandir' : 'Compactar'} menú · Ctrl+B`}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <button className="icon-button mobile-only" onClick={closeMobile} aria-label="Cerrar menú">
              <X />
            </button>
          </div>
        </div>

        <div className="module-switcher" aria-label="Cambiar experiencia de Aura Grow">
          <NavLink
            to="/focus"
            onClick={closeMobile}
            title="Focus"
            aria-label="Focus"
            data-sidebar-tooltip="Focus"
            className={!diagnoseMode ? 'module-option active focus-option' : 'module-option focus-option'}
          >
            <ListChecks size={18} aria-hidden="true" />
            <div className="sidebar-label"><small>AURA GROW</small><strong>Focus</strong></div>
          </NavLink>

          {diagnoseEnabled && (
            <NavLink
              to="/diagnose"
              onClick={closeMobile}
              title="Diagnose"
              aria-label="Diagnose"
              data-sidebar-tooltip="Diagnose"
              className={diagnoseMode ? 'module-option active diagnose-option' : 'module-option diagnose-option'}
            >
              <BrainCircuit size={18} aria-hidden="true" />
              <div className="sidebar-label"><small>AURA GROW</small><strong>Diagnose</strong></div>
            </NavLink>
          )}
        </div>

        <nav className="sidebar-nav">
          {diagnoseMode ? (
            <>
              <p className="nav-caption diagnose-caption">ANÁLISIS Y ESTRATEGIA</p>
              {diagnoseLinks.map((item) => <NavItem key={item.to} {...item} close={closeMobile} />)}
            </>
          ) : (
            <>
              <p className="nav-caption">EJECUCIÓN COMERCIAL</p>
              {executionLinks.map((item) => <NavItem key={item.to} {...item} close={closeMobile} />)}
              {isAdmin && (
                <>
                  <p className="nav-caption admin-caption">CONTROL Y MEDICIÓN</p>
                  {adminLinks.map((item) => <NavItem key={item.to} {...item} close={closeMobile} />)}
                </>
              )}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <NavLink
            to="/settings"
            className="nav-link"
            onClick={closeMobile}
            title="Mi cuenta"
            aria-label="Mi cuenta"
            data-sidebar-tooltip="Mi cuenta"
          >
            <Settings size={18} aria-hidden="true" />
            <span className="sidebar-label">Mi cuenta</span>
          </NavLink>

          <div className="user-card">
            <span className="avatar">{firstName[0]}</span>
            <div className="sidebar-label">
              <strong>{profile?.full_name || 'Usuario'}</strong>
              <small>{isAdmin ? 'Administradora' : 'Setter Focus'}</small>
            </div>
            <button className="icon-button desktop-only" onClick={handleSignOut} title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut size={17} />
            </button>
          </div>

          <button type="button" className="sidebar-signout-button mobile-only" onClick={handleSignOut}>
            <LogOut size={19} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      {diagnoseMode ? (
        <nav className="mobile-bottom-nav diagnose-mobile-nav" aria-label="Navegación móvil de Diagnose">
          <NavLink end to="/diagnose" className={({ isActive }) => (isActive ? 'active' : '')}><LayoutDashboard size={19} /><span>Inicio</span></NavLink>
          <NavLink to="/diagnose/new" className={({ isActive }) => (isActive ? 'active' : '')}><ClipboardPlus size={19} /><span>Nuevo</span></NavLink>
          <NavLink to="/diagnose/list" className={({ isActive }) => (isActive ? 'active' : '')}><FileSearch size={19} /><span>Diagnósticos</span></NavLink>
          <NavLink to="/diagnose/reports" className={({ isActive }) => (isActive ? 'active' : '')}><FileText size={19} /><span>Informes</span></NavLink>
        </nav>
      ) : (
        <nav className="mobile-bottom-nav" aria-label="Navegación móvil de Focus">
          <NavLink to="/focus" className={({ isActive }) => (isActive ? 'active' : '')}><ListTodo size={19} /><span>Hoy</span></NavLink>
          <NavLink to="/finder" className={({ isActive }) => (isActive ? 'active' : '')}><Search size={19} /><span>Generar</span></NavLink>
          <NavLink to="/leads" className={({ isActive }) => (isActive ? 'active' : '')}><Database size={19} /><span>Leads</span></NavLink>
          <NavLink to="/followups" className={({ isActive }) => (isActive ? 'active' : '')}><BellRing size={19} /><span>Seguimientos</span></NavLink>
          <NavLink to="/call-log" className={({ isActive }) => (isActive ? 'active' : '')}><PhoneCall size={19} /><span>Call Log</span></NavLink>
        </nav>
      )}
    </div>
  );
}
