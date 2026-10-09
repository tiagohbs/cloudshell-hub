export const WEEK_LIMIT_H = 50;   // limite semanal de uso do Cloud Shell

export function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

export function fmtHours(h) {
  if (h == null) return '—';
  return h.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: h < 10 ? 1 : 0 });
}

export function fmtGB(bytes) {
  if (bytes == null) return '—';
  return (bytes / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

export function level(pct) {
  return pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';
}

export function Meter({ label, pct, text, tone, title }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="meter" title={title}>
      <div className="meterhead"><span>{label}</span><span className="mv">{text}</span></div>
      <div className="track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
        <div className={`fill ${tone || level(p)}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
