export default function MetricCard({ label, value, note, icon: Icon }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{Icon && <Icon size={19} />}</div>
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}
