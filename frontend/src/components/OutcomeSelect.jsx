import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

function groupByCategory(items) {
  return items.reduce((groups, item) => {
    const category = item.category || 'General';
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});
}

export function useOutcomes(context = 'classification', includeInactive = false) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ context });
      if (includeInactive) params.set('include_inactive', 'true');
      setItems(await api(`/api/outcomes?${params}`));
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar la biblioteca de outcomes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [context, includeInactive]);
  return { items, loading, error, reload: load };
}

export default function OutcomeSelect({
  outcomes = [],
  value = '',
  fallbackName = '',
  onChange,
  disabled = false,
  label = 'Outcome',
}) {
  const groups = useMemo(() => groupByCategory(outcomes), [outcomes]);
  const selected = outcomes.find((item) => item.id === value)
    || outcomes.find((item) => item.name === fallbackName)
    || null;

  return (
    <label className="outcome-select-field">{label}
      <select
        value={selected?.id || ''}
        disabled={disabled}
        onChange={(event) => {
          const item = outcomes.find((candidate) => candidate.id === event.target.value) || null;
          onChange(item);
        }}
      >
        <option value="">Selecciona qué pasó</option>
        {Object.entries(groups).map(([category, items]) => (
          <optgroup key={category} label={category}>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </optgroup>
        ))}
      </select>
      {selected && (
        <span className="outcome-select-help">
          <i style={{ backgroundColor: selected.color || '#B6FF2E' }} />
          {selected.recommended_next_step || selected.description || 'Resultado guardado en la biblioteca de Aura.'}
        </span>
      )}
    </label>
  );
}
