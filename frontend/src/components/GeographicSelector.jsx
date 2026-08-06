import { useEffect, useRef, useState } from 'react';
import { Check, LocateFixed, MapPin, Search, X } from 'lucide-react';
import { api } from '../lib/api';

function newSessionToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function AutocompleteField({
  label,
  placeholder,
  countryCode,
  placeType,
  bias,
  value,
  onSelect,
  disabled,
}) {
  const [query, setQuery] = useState(value?.name || '');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const tokenRef = useRef(newSessionToken());
  const fieldRef = useRef(null);

  useEffect(() => { setQuery(value?.name || ''); }, [value?.place_id, value?.name]);

  useEffect(() => {
    const closeSuggestions = (event) => {
      if (!fieldRef.current?.contains(event.target)) setSuggestions([]);
    };
    document.addEventListener('pointerdown', closeSuggestions);
    return () => document.removeEventListener('pointerdown', closeSuggestions);
  }, []);

  useEffect(() => {
    if (disabled || query.trim().length < 2 || (value && query === value.name)) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          input: query.trim(),
          country_code: countryCode,
          place_type: placeType,
          session_token: tokenRef.current,
        });
        if (bias?.latitude != null && bias?.longitude != null) {
          params.set('latitude', String(bias.latitude));
          params.set('longitude', String(bias.longitude));
        }
        const data = await api(`/api/places/autocomplete?${params}`);
        if (!cancelled) setSuggestions(data.suggestions || []);
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'No se pudieron cargar las ubicaciones.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, countryCode, placeType, bias?.latitude, bias?.longitude, disabled, value]);

  const choose = async (suggestion) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ session_token: tokenRef.current, country_code: countryCode });
      const details = await api(`/api/places/details/${encodeURIComponent(suggestion.place_id)}?${params}`);
      onSelect(details);
      setQuery('');
      setSuggestions([]);
      tokenRef.current = newSessionToken();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo seleccionar la ubicación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="places-field" data-place-type={placeType} ref={fieldRef}>
      <label>{label}
        <span className="places-input-wrap">
          <MapPin size={17} />
          <input
            value={query}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            aria-expanded={suggestions.length > 0}
            aria-haspopup="listbox"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSuggestions([]);
                event.currentTarget.blur();
              }
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              if (value) onSelect(null);
            }}
          />
          {loading && <span className="places-spinner" aria-label="Buscando" />}
        </span>
      </label>
      {suggestions.length > 0 && (
        <div className="places-suggestions" role="listbox">
          {suggestions.map((suggestion) => (
            <button key={suggestion.place_id} type="button" onClick={() => choose(suggestion)} role="option">
              <Search size={15} />
              <span><strong>{suggestion.name}</strong><small>{suggestion.secondary_text || suggestion.description}</small></span>
            </button>
          ))}
          <div className="google-attribution"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
        </div>
      )}
      {error && <small className="places-error">{error}</small>}
    </div>
  );
}

export default function GeographicSelector({
  countries,
  countryCode,
  onCountryChange,
  baseCity,
  onBaseCityChange,
  zones,
  onZonesChange,
  searchMode,
  onSearchModeChange,
  radiusKm,
  onRadiusChange,
  disabled = false,
}) {
  const addZone = (place) => {
    if (!place || zones.some((item) => item.place_id === place.place_id)) return;
    onZonesChange([...zones, place]);
  };

  return (
    <section className="geographic-selector" aria-label="Mercado geográfico">
      <div className="geographic-heading">
        <span><LocateFixed size={18} /></span>
        <div><strong>Mercado geográfico</strong><small>Ubicaciones reales de Google Maps, sin catálogos manuales.</small></div>
      </div>

      <div className="form-grid two geographic-primary-fields">
        <label>País
          <select value={countryCode} disabled={disabled} onChange={(event) => onCountryChange(event.target.value)}>
            {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
        <AutocompleteField
          label="Ciudad base"
          placeholder="Empieza a escribir una ciudad…"
          countryCode={countryCode}
          placeType="city"
          value={baseCity}
          onSelect={onBaseCityChange}
          disabled={disabled}
        />
      </div>

      <div className="search-area-modes" role="radiogroup" aria-label="Modo de búsqueda geográfica">
        <button type="button" className={searchMode === 'zones' ? 'active' : ''} onClick={() => onSearchModeChange('zones')} disabled={disabled}>
          <span className="mode-check">{searchMode === 'zones' && <Check size={13} />}</span>
          <span><strong>Zonas objetivo</strong><small>Barrios, comunas, sectores o localidades.</small></span>
        </button>
        <button type="button" className={searchMode === 'radius' ? 'active' : ''} onClick={() => onSearchModeChange('radius')} disabled={disabled}>
          <span className="mode-check">{searchMode === 'radius' && <Check size={13} />}</span>
          <span><strong>Radio desde la ciudad</strong><small>Ideal para territorios amplios.</small></span>
        </button>
      </div>

      {searchMode === 'zones' ? (
        <>
          <AutocompleteField
            label="Zonas objetivo"
            placeholder={baseCity ? 'Empieza a escribir una zona…' : 'Selecciona primero la ciudad base'}
            countryCode={countryCode}
            placeType="zone"
            bias={baseCity}
            value={null}
            onSelect={addZone}
            disabled={disabled || !baseCity || zones.length >= 12}
          />
          {zones.length > 0 && (
            <div className="location-chips" aria-label="Zonas seleccionadas">
              {zones.map((zone) => (
                <span className="location-chip" key={zone.place_id} title={zone.formatted_address}>
                  <MapPin size={14} />{zone.name}
                  <button type="button" aria-label={`Quitar ${zone.name}`} onClick={() => onZonesChange(zones.filter((item) => item.place_id !== zone.place_id))}><X size={14} /></button>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <label>Radio de búsqueda
          <select value={radiusKm} disabled={disabled || !baseCity} onChange={(event) => onRadiusChange(Number(event.target.value))}>
            {[5, 10, 25, 50].map((value) => <option key={value} value={value}>{value} km</option>)}
          </select>
          <small>El centro será {baseCity?.name || 'la ciudad base seleccionada'}.</small>
        </label>
      )}

    </section>
  );
}
