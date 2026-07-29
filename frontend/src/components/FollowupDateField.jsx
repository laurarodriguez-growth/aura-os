function localISODate(daysFromToday = 0) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function FollowupDateField({ value = '', onChange, label = 'Próximo seguimiento' }) {
  const choose = (days) => onChange(localISODate(days));
  return (
    <div className="followup-date-field">
      <span className="field-label">{label}</span>
      <div className="followup-quick-actions" aria-label="Fechas rápidas de seguimiento">
        <button type="button" onClick={() => choose(1)}>Mañana</button>
        <button type="button" onClick={() => choose(3)}>En 3 días</button>
        <button type="button" onClick={() => choose(7)}>En 7 días</button>
      </div>
      <label className="followup-custom-date">Elegir fecha
        <input type="date" value={value || ''} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
