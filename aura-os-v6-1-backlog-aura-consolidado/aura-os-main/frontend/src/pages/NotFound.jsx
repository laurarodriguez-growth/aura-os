import { Link } from 'react-router-dom';
export default function NotFound() { return <div className="panel not-found"><p className="eyebrow">404</p><h1>Esta sección no existe.</h1><Link className="button primary" to="/">Volver al dashboard</Link></div>; }
