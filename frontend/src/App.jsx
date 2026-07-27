import { Navigate, Route, Routes } from 'react-router-dom';
import { configProblems } from './lib/config';
import { useAuth } from './context/AuthContext';
import SetupRequired from './components/SetupRequired';
import LoadingScreen from './components/LoadingScreen';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import LeadFinder from './pages/LeadFinder';
import Leads from './pages/Leads';
import Pipeline from './pages/Pipeline';
import Followups from './pages/Followups';
import CallLog from './pages/CallLog';
import Exports from './pages/Exports';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

function ProtectedApp() {
  const { session, profile, loading, profileError } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!session) return <Login />;
  if (profileError) return <main className="setup-screen"><section className="setup-card"><h1>No pudimos conectar con el backend.</h1><p className="muted">{profileError}</p><p>Revisa que Render esté activo y que <code>API_BASE_URL</code> sea correcto.</p></section></main>;
  if (!profile) return <LoadingScreen text="Cargando tu perfil…" />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/finder" element={profile.role === 'admin' ? <LeadFinder /> : <Navigate to="/" replace />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/followups" element={<Followups />} />
        <Route path="/call-log" element={<CallLog />} />
        <Route path="/exports" element={<Exports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  return <ProtectedApp />;
}
