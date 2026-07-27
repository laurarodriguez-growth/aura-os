export default function LoadingScreen({ text = 'Preparando Aura Grow…' }) {
  return (
    <main className="loading-screen">
      <div className="loader" />
      <p>{text}</p>
    </main>
  );
}
