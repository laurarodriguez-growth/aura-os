import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuraLogo from '../components/AuraLogo';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e.message === 'Invalid login credentials' ? 'El correo o la contraseña no coinciden.' : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <div className="login-neon-field" aria-hidden="true">
        <span className="neon-orb neon-orb-cyan" />
        <span className="neon-orb neon-orb-magenta" />
        <span className="neon-orb neon-orb-lime" />
        <span className="neon-grid" />
      </div>
      <section className="login-copy">
        <div className="brand-lockup large">
          <span className="brand-mark login-brand-mark"><AuraLogo /></span>
          <div><strong>AURA OS</strong><span>by Laura Rodriguez</span></div>
        </div>
        <p className="eyebrow">CRECIMIENTO · IA · AUTOMATIZACIÓN</p>
        <h1>Un sistema claro para que ninguna oportunidad se pierda después del primer contacto.</h1>
        <p>Aura Grow conecta generación de leads, clasificación, seguimiento y métricas en un solo espacio.</p>
        <div className="login-promise"><span>01</span><p><strong>Encuentra</strong> negocios con señales reales de oportunidad.</p></div>
        <div className="login-promise"><span>02</span><p><strong>Organiza</strong> cada conversación y próximo paso.</p></div>
        <div className="login-promise"><span>03</span><p><strong>Mide</strong> qué leads, mensajes y agentes convierten.</p></div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-icon"><AuraLogo /></div>
          <p className="eyebrow">ACCESO PRIVADO</p>
          <h2>Bienvenida a Aura Grow</h2>
          <p className="muted">Usa el usuario que creaste en Supabase.</p>
          {error && <div className="form-error">{error}</div>}
          <label>Correo electrónico<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          <button className="button primary full login-submit" disabled={loading}>{loading ? 'Entrando…' : <>Entrar <ArrowRight size={17} /></>}</button>
          <small className="security-note">Tu contraseña es gestionada por Supabase Auth y no se guarda en el código.</small>
        </form>
      </section>
    </main>
  );
}
