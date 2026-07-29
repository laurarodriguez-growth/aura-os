function localISODate(daysFromToday = 0) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const QUICK_DATES = [
  [0, 'Hoy'],
  [1, 'Mañana'],
  [3, 'En 3 días'],
  [7, 'En 7 días'],
];

export default function FollowupDateField({ value = '', onChange, label = 'Próximo seguimiento' }) {
  const choose = (days) => onChange(localISODate(days));
  return (
    <div className="followup-date-field">
      <span className="field-label">{label}</span>
      <div className="followup-quick-actions" aria-label="Fechas rápidas de seguimiento">
        {QUICK_DATES.map(([days, text]) => {
          const dateValue = localISODate(days);
          const selected = value === dateValue;
          return (
            <button
              key={days}
              type="button"
              className={selected ? 'active' : ''}
              aria-pressed={selected}
              onClick={() => choose(days)}
            >
              {text}
            </button>
          );
        })}
      </div>
      <label className="followup-custom-date">Elegir fecha
        <input type="date" value={value || ''} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
