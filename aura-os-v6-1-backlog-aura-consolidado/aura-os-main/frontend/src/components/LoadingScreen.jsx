import AuraLogo from './AuraLogo';

export default function LoadingScreen({ text = 'Preparando Aura Grow…' }) {
  return (
    <main className="loading-screen">
      <div className="loader aura-loader"><AuraLogo /></div>
      <p>{text}</p>
    </main>
  );
}
