import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { defaultOutcomesFor } from '../lib/outcomeDefaults';

function outcomeKey(item) {
  const code = String(item?.code || '').trim().toLocaleLowerCase('es');
  if (code) return `code:${code}`;
  return `name:${String(item?.name || '').trim().toLocaleLowerCase('es')}`;
}

function mergeOperationalDefaults(rows, context) {
  const remoteRows = Array.isArray(rows) ? rows : [];
  const seen = new Set(remoteRows.map(outcomeKey));
  const missingDefaults = defaultOutcomesFor(context).filter((item) => !seen.has(outcomeKey(item)));
  return [...remoteRows, ...missingDefaults].sort((left, right) => {
    const orderDifference = Number(left.sort_order || 9999) - Number(right.sort_order || 9999);
    if (orderDifference !== 0) return orderDifference;
    return String(left.name || '').localeCompare(String(right.name || ''), 'es');
  });
}

function groupByCategory(items) {
  return items.reduce((groups, item) => {
    const category = item.category || 'General';
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});
}

export function useOutcomes(context = 'classification', includeInactive = false, allowLocalFallback = !includeInactive) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingLocalFallback, setUsingLocalFallback] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    setUsingLocalFallback(false);
    try {
      const params = new URLSearchParams({ context });
      if (includeInactive) params.set('include_inactive', 'true');
      const rows = await api(`/api/outcomes?${params}`);
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('La biblioteca de outcomes todavía no tiene opciones disponibles.');
      }
      if (allowLocalFallback) {
        const mergedRows = mergeOperationalDefaults(rows, context);
        setItems(mergedRows);
        setUsingLocalFallback(mergedRows.some((item) => item.is_local_fallback));
      } else {
        setItems(rows);
      }
    } catch (loadError) {
      if (allowLocalFallback) {
        setItems(defaultOutcomesFor(context));
        setUsingLocalFallback(true);
      } else {
        setItems([]);
        setError(loadError.message || 'No se pudo cargar la biblioteca de outcomes.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [context, includeInactive, allowLocalFallback]);
  return { items, loading, error, reload: load, usingLocalFallback };
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
        disabled={disabled || outcomes.length === 0}
        onChange={(event) => {
          const item = outcomes.find((candidate) => candidate.id === event.target.value) || null;
          onChange(item);
        }}
      >
        <option value="">{outcomes.length ? 'Selecciona qué pasó' : 'Cargando outcomes…'}</option>
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
