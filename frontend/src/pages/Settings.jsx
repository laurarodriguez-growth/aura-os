import { CheckCircle2, Server, ShieldCheck } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { appConfig } from '../lib/config';
import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const { profile } = useAuth();
  return (
    <>
      <PageHeader title="Configuración" description="Información básica de la instalación actual. Las claves secretas nunca se muestran en esta pantalla." />
      <section className="settings-grid">
        <article className="panel settings-card"><ShieldCheck /><div><p className="eyebrow">USUARIO</p><h2>{profile?.full_name}</h2><p>{profile?.email}</p><span className="status-pill completed"><CheckCircle2 size={14} />{profile?.role}</span></div></article>
        <article className="panel settings-card"><Server /><div><p className="eyebrow">BACKEND</p><h2>Aura Grow API</h2><p>{appConfig.apiBaseUrl}</p></div></article>
        <article className="panel settings-card"><Server /><div><p className="eyebrow">BASE DE DATOS</p><h2>Supabase</h2><p>{appConfig.supabaseUrl}</p></div></article>
      </section>
      <section className="panel security-panel"><h2>Regla de seguridad</h2><p>La <strong>publishable key</strong> está en el frontend porque está diseñada para el navegador. La <strong>secret key</strong> y la clave de Google Places deben permanecer solamente en las variables privadas de Render.</p></section>
    </>
  );
}
