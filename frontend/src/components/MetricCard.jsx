import { ArrowUpRight } from 'lucide-react';

export default function MetricCard({ label, value, note, icon: Icon, onClick, active = false }) {
  const content = (
    <>
      <div className="metric-card-top">
        <div className="metric-icon">{Icon && <Icon size={19} />}</div>
        {onClick && <ArrowUpRight className="metric-card-arrow" size={17} />}
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`metric-card metric-card-button${active ? ' active' : ''}`}
        onClick={onClick}
        aria-pressed={active}
      >
        {content}
      </button>
    );
  }

  return <article className="metric-card">{content}</article>;
}
