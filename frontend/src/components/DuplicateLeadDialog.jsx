import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, GitMerge, MapPin, MessageCircle, X } from 'lucide-react';
import { api } from '../lib/api';

function distanceLabel(value) {
  if (value === null || value === undefined) return 'Distancia no disponible';
  if (value < 1) return `${Math.round(value * 1000)} m de distancia`;
  return `${Number(value).toLocaleString('es-PA', { maximumFractionDigits: 1 })} km de distancia`;
}

export default function DuplicateLeadDialog({ lead, onClose, onMerged }) {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api(`/api/leads/${lead.id}/duplicate-candidates`);
        if (!cancelled) setItems(data.items || []);
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [lead.id]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId), [items, selectedId]);

  const merge = async () => {
    if (!selected || !confirmed) return;
    setSaving(true);
    setError('');
    try {
      const result = await api(`/api/leads/${lead.id}/merge-duplicate`, {
        method: 'POST',
        body: JSON.stringify({ target_lead_id: selected.id }),
      });
      onMerged(result, selected);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="duplicate-layer" role="dialog" aria-modal="true" aria-label="Consolidar lead duplicado">
      <button type="button" className="duplicate-backdrop" onClick={onClose} aria-label="Cerrar" />
      <section className="panel duplicate-dialog">
        <header className="duplicate-dialog-header">
          <div>
            <p className="eyebrow">CONTROL DE DUPLICADOS</p>
            <h2>¿Este negocio ya existe?</h2>
            <p>Compara la dirección y la distancia. El mismo nombre puede corresponder a otra sucursal.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={saving}><X size={20} /></button>
        </header>

        <div className="duplicate-source">
          <Building2 size={18} />
          <div><small>FICHA QUE SE DESCARTARÁ</small><strong>{lead.business_name}</strong><span>{lead.address || 'Dirección no disponible'}</span></div>
        </div>

        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="duplicate-loading">Buscando negocios con el mismo nombre y ordenándolos por cercanía…</div>
        ) : items.length === 0 ? (
          <div className="duplicate-empty">
            <Building2 size={24} />
            <strong>No encontramos coincidencias seguras</strong>
            <p>Conserva esta ficha. Aura no descartará nada automáticamente.</p>
          </div>
        ) : (
          <div className="duplicate-candidates" role="radiogroup" aria-label="Leads que se pueden conservar">
            {items.map((item) => {
              const active = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={active ? 'active' : ''}
                  onClick={() => { setSelectedId(item.id); setConfirmed(false); }}
                  aria-pressed={active}
                >
                  <span className="duplicate-radio">{active && <span />}</span>
                  <span className="duplicate-candidate-copy">
                    <strong>{item.business_name}</strong>
                    <span><MapPin size={14} />{item.address || item.city || 'Dirección no disponible'}</span>
                    <small>{distanceLabel(item.distance_km)} · {item.location_hint}</small>
                  </span>
                  <span className="duplicate-history">
                    <b>{item.status || 'Nuevo'}</b>
                    <small><MessageCircle size={13} />{item.response_count || 0} respuestas · {item.history_count || 0} actividades</small>
                    <small>{item.outcome || 'Sin outcome previo'}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="duplicate-confirmation">
            <div className="duplicate-warning">
              <AlertTriangle size={18} />
              <p><strong>Se conservará “{selected.business_name}”.</strong> La ficha actual se archivará; sus contactos, notas y actividades se concatenarán con el historial seleccionado.</p>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              Revisé la dirección y confirmo que quiero consolidar estas fichas.
            </label>
          </div>
        )}

        <footer className="duplicate-dialog-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="button primary" onClick={merge} disabled={!selected || !confirmed || saving}>
            <GitMerge size={17} />{saving ? 'Consolidando…' : 'Consolidar y descartar actual'}
          </button>
        </footer>
      </section>
    </div>
  );
}
