import { useState } from 'react';
import { CheckCircle2, KeyRound, LockKeyhole, Server, ShieldCheck } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { appConfig } from '../lib/config';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const { profile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  const isAdmin = profile?.role === 'admin';

  return (
    <>
      <PageHeader title="Mi cuenta" description="Consulta tu acceso y cambia tu contraseña de Aura Grow cuando lo necesites." />

      <section className="settings-grid">
        <article className="panel settings-card">
          <ShieldCheck />
          <div>
            <p className="eyebrow">USUARIO</p>
            <h2>{profile?.full_name}</h2>
            <p>{profile?.email}</p>
            <span className="status-pill completed"><CheckCircle2 size={14} />{isAdmin ? 'Administradora' : 'Setter Focus'}</span>
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
        <section className="panel security-panel">
          <h2>Regla de seguridad</h2>
          <p>La <strong>publishable key</strong> está en el frontend porque está diseñada para el navegador. La <strong>secret key</strong> y la clave de Google Places permanecen solamente en las variables privadas de Render.</p>
        </section>
      )}
    </>
  );
}
