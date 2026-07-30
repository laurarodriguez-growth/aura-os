import { Navigate, Route, Routes } from 'react-router-dom';
import { configProblems } from './lib/config';
import { useAuth } from './context/AuthContext';
import SetupRequired from './components/SetupRequired';
import LoadingScreen from './components/LoadingScreen';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Focus from './pages/Focus';
import LeadFinder from './pages/LeadFinder';
import Leads from './pages/Leads';
import Pipeline from './pages/Pipeline';
import Followups from './pages/Followups';
import CallLog from './pages/CallLog';
import Exports from './pages/Exports';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import DiagnoseHome from './pages/DiagnoseHome';
import DiagnoseNew from './pages/DiagnoseNew';
import Diagnoses from './pages/Diagnoses';
import DiagnosisWorkspace from './pages/DiagnosisWorkspace';
import DiagnosisReport from './pages/DiagnosisReport';
import DiagnoseReports from './pages/DiagnoseReports';

function ProtectedApp() {
  const { session, profile, loading, profileError } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!session) return <Login />;
  if (profileError) return <main className="setup-screen"><section className="setup-card"><h1>No pudimos conectar con el backend.</h1><p className="muted">{profileError}</p><p>Revisa que Render esté activo y que <code>API_BASE_URL</code> sea correcto.</p></section></main>;
  if (!profile) return <LoadingScreen text="Cargando tu perfil…" />;

  const isAdmin = profile.role === 'admin';
  const diagnoseEnabled = profile.features?.diagnose === true;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/focus" replace />} />
        <Route path="/focus" element={<Focus />} />
        <Route path="/finder" element={<LeadFinder />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/pipeline" element={isAdmin ? <Pipeline /> : <Navigate to="/focus" replace />} />
        <Route path="/followups" element={<Followups />} />
        <Route path="/call-log" element={<CallLog />} />
        <Route path="/performance" element={isAdmin ? <Dashboard /> : <Navigate to="/focus" replace />} />
        <Route path="/dashboard" element={<Navigate to="/performance" replace />} />
        <Route path="/exports" element={isAdmin ? <Exports /> : <Navigate to="/focus" replace />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/diagnose" element={diagnoseEnabled ? <DiagnoseHome /> : <Navigate to="/focus" replace />} />
        <Route path="/diagnose/new" element={diagnoseEnabled ? <DiagnoseNew /> : <Navigate to="/focus" replace />} />
        <Route path="/diagnose/list" element={diagnoseEnabled ? <Diagnoses /> : <Navigate to="/focus" replace />} />
        <Route path="/diagnose/reports" element={diagnoseEnabled ? <DiagnoseReports /> : <Navigate to="/focus" replace />} />
        <Route path="/diagnose/:diagnosisId/report/print" element={diagnoseEnabled ? <DiagnosisReport /> : <Navigate to="/focus" replace />} />
        <Route path="/diagnose/:diagnosisId/:section" element={diagnoseEnabled ? <DiagnosisWorkspace /> : <Navigate to="/focus" replace />} />
        <Route path="/diagnose/:diagnosisId" element={diagnoseEnabled ? <DiagnosisWorkspace /> : <Navigate to="/focus" replace />} />
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
