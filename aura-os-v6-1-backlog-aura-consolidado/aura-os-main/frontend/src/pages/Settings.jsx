import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  ScanSearch,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { appConfig } from '../lib/config';
import { getSupabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import OutcomeLibraryManager from '../components/OutcomeLibraryManager';

const emptyNewUser = {
  full_name: '',
  email: '',
  password: '',
  role: 'setter',
  diagnose_enabled: false,
};

function readableDate(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return new Intl.DateTimeFormat('es-PA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function roleLabel(role) {
  if (role === 'admin') return 'Administradora';
  if (role === 'setter') return 'Setter Focus';
  return 'Agente';
}

export default function Settings() {
  const { profile, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [userBusy, setUserBusy] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [userError, setUserError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState(emptyNewUser);

  const isAdmin = profile?.role === 'admin';

  const hydrateUsers = (rows) => {
    setUsers(rows);
    setDrafts(Object.fromEntries(rows.map((item) => [item.id, {
      full_name: item.full_name || '',
      role: item.role || 'agent',
      password: '',
      diagnose_enabled: Boolean(item.diagnose_enabled),
    }])));
  };

  const loadUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    setUserError('');
    try {
      hydrateUsers(await api('/api/admin/users'));
    } catch (loadError) {
      setUserError(loadError.message || 'No se pudieron cargar los usuarios.');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  const changePassword = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (password.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await getSupabase().auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setConfirmation('');
      setMessage('Contraseña actualizada correctamente. Úsala la próxima vez que inicies sesión.');
    } catch (updateError) {
      setError(updateError.message || 'No se pudo actualizar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  const createUser = async (event) => {
    event.preventDefault();
    setUserError('');
    setUserMessage('');
    if (newUser.password.length < 8) {
      setUserError('La contraseña temporal debe tener al menos 8 caracteres.');
      return;
    }
    setUserBusy('create');
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setNewUser(emptyNewUser);
      setShowCreate(false);
      setUserMessage('Usuario creado y confirmado. Ya puede iniciar sesión.');
      await loadUsers();
    } catch (createError) {
      setUserError(createError.message || 'No se pudo crear el usuario.');
    } finally {
      setUserBusy('');
    }
  };

  const updateDraft = (id, field, value) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], [field]: value },
    }));
  };

  const saveUser = async (id) => {
    const draft = drafts[id];
    if (!draft) return;
    setUserBusy(id);
    setUserError('');
    setUserMessage('');
    try {
      const payload = {
        full_name: draft.full_name,
        role: draft.role,
        diagnose_enabled: Boolean(draft.diagnose_enabled),
      };
      if (draft.password) payload.password = draft.password;
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setUserMessage(draft.password
        ? 'Usuario actualizado y contraseña temporal reemplazada.'
        : 'Usuario actualizado correctamente.');
      await loadUsers();
      if (id === profile?.id) await refreshProfile();
    } catch (saveError) {
      setUserError(saveError.message || 'No se pudo actualizar el usuario.');
    } finally {
      setUserBusy('');
    }
  };

  const toggleUser = async (item) => {
    const action = item.is_active ? 'deactivate' : 'reactivate';
    const verb = item.is_active ? 'desactivar' : 'reactivar';
    if (item.is_active && !window.confirm(`¿Desactivar el acceso de ${item.full_name}? Su historial se conservará.`)) return;
    setUserBusy(item.id);
    setUserError('');
    setUserMessage('');
    try {
      await api(`/api/admin/users/${item.id}/${action}`, { method: 'POST' });
      setUserMessage(`Acceso ${verb === 'desactivar' ? 'desactivado' : 'reactivado'} correctamente.`);
      await loadUsers();
    } catch (toggleError) {
      setUserError(toggleError.message || `No se pudo ${verb} el usuario.`);
    } finally {
      setUserBusy('');
    }
  };

  const deleteUser = async (item) => {
    const confirmationText = window.prompt(
      `Eliminar permanentemente a ${item.full_name} solo está permitido si no tiene historial. Escribe ELIMINAR para continuar.`,
    );
    if (confirmationText !== 'ELIMINAR') return;
    setUserBusy(item.id);
    setUserError('');
    setUserMessage('');
    try {
      await api(`/api/admin/users/${item.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: confirmationText }),
      });
      setUserMessage('Usuario eliminado permanentemente.');
      await loadUsers();
    } catch (deleteError) {
      setUserError(deleteError.message || 'No se pudo eliminar el usuario.');
    } finally {
      setUserBusy('');
    }
  };

  return (
    <>
      <PageHeader title="Mi cuenta" description="Administra tu acceso y la operación del equipo de Aura Grow." />

      <section className="settings-grid">
        <article className="panel settings-card">
          <ShieldCheck />
          <div>
            <p className="eyebrow">USUARIO</p>
            <h2>{profile?.full_name}</h2>
            <p>{profile?.email}</p>
            <span className="status-pill completed"><CheckCircle2 size={14} />{roleLabel(profile?.role)}</span>
          </div>
        </article>
        <article className="panel settings-card">
          <Server />
          <div><p className="eyebrow">BACKEND</p><h2>Aura Grow API</h2><p>{appConfig.apiBaseUrl}</p></div>
        </article>
        <article className="panel settings-card">
          <Server />
          <div><p className="eyebrow">BASE DE DATOS</p><h2>Supabase</h2><p>{appConfig.supabaseUrl}</p></div>
        </article>
      </section>

      <section className="panel password-panel">
        <div className="password-panel-heading">
          <span className="password-icon"><LockKeyhole size={20} /></span>
          <div>
            <p className="eyebrow">SEGURIDAD</p>
            <h2>Cambiar contraseña</h2>
            <p>Este cambio afecta solamente tu usuario. Tu contraseña nunca se guarda en Aura Grow.</p>
          </div>
        </div>

        <form className="password-form" onSubmit={changePassword}>
          <label>Nueva contraseña
            <input
              type="password"
              minLength="8"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>Confirmar nueva contraseña
            <input
              type="password"
              minLength="8"
              autoComplete="new-password"
              placeholder="Repite la contraseña"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button className="button primary" type="submit" disabled={busy || !password || !confirmation}>
            <KeyRound size={16} />{busy ? 'Actualizando…' : 'Actualizar contraseña'}
          </button>
        </form>

        {error && <div className="form-error">{error}</div>}
        {message && <div className="success-box">{message}</div>}
      </section>

      {isAdmin && (
        <section className="panel user-management-panel">
          <header className="user-management-heading">
            <div className="user-management-title">
              <span className="password-icon"><Users size={20} /></span>
              <div>
                <p className="eyebrow">ADMINISTRACIÓN</p>
                <h2>Gestión de usuarios</h2>
                <p>Crea accesos, cambia roles y habilita funciones de forma individual para cada persona.</p>
              </div>
            </div>
            <div className="user-management-actions">
              <button className="button secondary" onClick={loadUsers} disabled={usersLoading}><RefreshCw size={16} />Actualizar</button>
              <button className="button primary" onClick={() => setShowCreate((value) => !value)}><UserPlus size={16} />Crear usuario</button>
            </div>
          </header>

          {showCreate && (
            <form className="user-create-form" onSubmit={createUser}>
              <label>Nombre completo
                <input required minLength="2" value={newUser.full_name} onChange={(event) => setNewUser({ ...newUser, full_name: event.target.value })} placeholder="Ej. Maikol Brown" />
              </label>
              <label>Correo
                <input required type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="usuario@email.com" />
              </label>
              <label>Contraseña temporal
                <input required type="password" minLength="8" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="Mínimo 8 caracteres" />
              </label>
              <label>Rol
                <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  <option value="setter">Setter Focus</option>
                  <option value="agent">Agente</option>
                  <option value="admin">Administradora</option>
                </select>
              </label>
              <label className="feature-access-control create-feature-access">
                <input
                  type="checkbox"
                  checked={newUser.diagnose_enabled}
                  onChange={(event) => setNewUser({ ...newUser, diagnose_enabled: event.target.checked })}
                />
                <span className="feature-access-copy">
                  <ScanSearch size={17} />
                  <span><strong>Habilitar Diagnose</strong><small>Acceso individual, independiente del rol.</small></span>
                </span>
              </label>
              <button className="button primary" type="submit" disabled={userBusy === 'create'}>
                <UserPlus size={16} />{userBusy === 'create' ? 'Creando…' : 'Crear y confirmar'}
              </button>
            </form>
          )}

          {userError && <div className="form-error user-feedback">{userError}</div>}
          {userMessage && <div className="success-box user-feedback">{userMessage}</div>}

          {usersLoading ? (
            <div className="user-loading">Cargando usuarios…</div>
          ) : (
            <div className="user-list">
              {users.map((item) => {
                const draft = drafts[item.id] || {};
                const isSelf = item.id === profile?.id;
                return (
                  <article className={`user-admin-card ${item.is_active ? '' : 'inactive'}`} key={item.id}>
                    <div className="user-admin-summary">
                      <span className="avatar">{(item.full_name || item.email || 'U')[0].toUpperCase()}</span>
                      <div>
                        <div className="user-name-line">
                          <strong>{item.full_name}</strong>
                          {isSelf && <span className="self-badge">Tu cuenta</span>}
                          <span className={`user-status ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'Activo' : 'Desactivado'}</span>
                          {item.diagnose_enabled && <span className="diagnose-access-badge"><ScanSearch size={12} />Diagnose</span>}
                        </div>
                        <p>{item.email}</p>
                        <small>Último acceso: {readableDate(item.last_sign_in_at)}</small>
                      </div>
                    </div>

                    <div className="user-admin-fields">
                      <label>Nombre
                        <input value={draft.full_name || ''} onChange={(event) => updateDraft(item.id, 'full_name', event.target.value)} />
                      </label>
                      <label>Rol
                        <select value={draft.role || 'agent'} disabled={isSelf} onChange={(event) => updateDraft(item.id, 'role', event.target.value)}>
                          <option value="setter">Setter Focus</option>
                          <option value="agent">Agente</option>
                          <option value="admin">Administradora</option>
                        </select>
                      </label>
                      <label>Nueva contraseña temporal
                        <input type="password" minLength="8" value={draft.password || ''} onChange={(event) => updateDraft(item.id, 'password', event.target.value)} placeholder="Déjala vacía para no cambiarla" />
                      </label>
                      <label className="feature-access-control user-feature-access">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.diagnose_enabled)}
                          onChange={(event) => updateDraft(item.id, 'diagnose_enabled', event.target.checked)}
                        />
                        <span className="feature-access-copy">
                          <ScanSearch size={17} />
                          <span><strong>Diagnose</strong><small>Habilitar solo para esta persona.</small></span>
                        </span>
                      </label>
                    </div>

                    <div className="user-activity-row">
                      <span>{item.call_logs} contactos</span>
                      <span>{item.assigned_leads} leads asignados</span>
                      <span>{item.search_jobs} búsquedas</span>
                    </div>

                    <div className="user-admin-buttons">
                      <button className="button secondary" onClick={() => saveUser(item.id)} disabled={userBusy === item.id}>
                        <Save size={15} />Guardar cambios
                      </button>
                      <button className="button ghost" onClick={() => toggleUser(item)} disabled={isSelf || userBusy === item.id}>
                        {item.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                        {item.is_active ? 'Desactivar acceso' : 'Reactivar acceso'}
                      </button>
                      <button className="button danger-ghost" onClick={() => deleteUser(item)} disabled={isSelf || !item.can_delete || userBusy === item.id} title={item.can_delete ? 'Eliminar usuario sin historial' : 'Desactívalo: tiene historial que debe conservarse'}>
                        <Trash2 size={15} />Eliminar
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="user-safety-note">
            <AlertTriangle size={18} />
            <p><strong>Desactivar conserva el historial.</strong> Eliminar solo se permite cuando el usuario todavía no tiene llamadas, leads asignados ni búsquedas.</p>
          </div>
        </section>
      )}


      {isAdmin && <OutcomeLibraryManager />}

      {isAdmin && (
        <section className="panel security-panel">
          <h2>Regla de seguridad</h2>
          <p>La <strong>publishable key</strong> está en el frontend porque está diseñada para el navegador. La <strong>secret key</strong> y la clave de Google Places permanecen solamente en las variables privadas de Render.</p>
        </section>
      )}
    </>
  );
}
