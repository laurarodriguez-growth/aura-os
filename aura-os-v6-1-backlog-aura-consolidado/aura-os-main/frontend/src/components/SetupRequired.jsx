import { AlertTriangle, FileCode2 } from 'lucide-react';
import AuraLogo from './AuraLogo';

export default function SetupRequired({ problems }) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <span className="brand-mark"><AuraLogo /></span>
        <p className="eyebrow">AURA OS · CONFIGURACIÓN</p>
        <h1>Faltan tres datos para encender la aplicación.</h1>
        <p className="muted">
          Abre <code>frontend/public/config.js</code> en GitHub y reemplaza los textos de ejemplo.
          La publishable key sí puede vivir en el navegador. La secret key nunca se coloca aquí.
        </p>
        <div className="warning-box">
          <AlertTriangle size={20} />
          <div>
            {problems.map((problem) => <p key={problem}>{problem}</p>)}
          </div>
        </div>
        <div className="code-box">
          <FileCode2 size={20} />
          <pre>{`window.AURA_CONFIG = {
  SUPABASE_URL: "https://...supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_...",
  API_BASE_URL: "https://aura-grow-api.onrender.com"
};`}</pre>
        </div>
      </section>
    </main>
  );
}
