import React, { useEffect, useRef, useState } from 'react';

// Substitui confirm() do navegador por uma janela no tema do app.
// ask({ title, text, ok, cancel, danger, extra }) -> Promise: true | 'extra' | false
let push = null;
export function ask(opts) {
  return new Promise((resolve) => {
    if (!push) { resolve(false); return; }
    push({ ...opts, resolve });
  });
}

export function AskHost() {
  const [q, setQ] = useState(null);
  const okRef = useRef();
  useEffect(() => { push = (o) => setQ(o); return () => { push = null; }; }, []);
  useEffect(() => { if (q && okRef.current) okRef.current.focus(); }, [q]);
  const done = (v) => { const r = q.resolve; setQ(null); r(v); };
  useEffect(() => {
    if (!q) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { const r = q.resolve; setQ(null); r(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q]);
  if (!q) return null;
  return (
    <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className="dialog askbox" role="alertdialog" aria-modal="true" aria-label={q.title}>
        <h2>{q.title || 'Confirmar'}</h2>
        {q.text && <div className="asktext">{q.text}</div>}
        <div className="actions askacts">
          <button onClick={() => done(false)}>{q.cancel || 'Cancelar'}</button>
          {q.extra && <button onClick={() => done('extra')}>{q.extra}</button>}
          <button ref={okRef} className={q.danger ? 'primary danger' : 'primary'} onClick={() => done(true)}>{q.ok || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
