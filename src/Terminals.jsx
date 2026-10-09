import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { fmtDur, fmtGB } from './format.jsx';

const THEME = {
  background: 'rgba(0,0,0,0)',
  foreground: '#e6e9ee',
  cursor: '#8ab4f8',
  cursorAccent: '#202124',
  selectionBackground: 'rgba(138,180,248,0.35)',
  black: '#1c232c', brightBlack: '#5c6773',
  red: '#e5604d', brightRed: '#ff7b68',
  green: '#3fb97f', brightGreen: '#5fd69a',
  yellow: '#e0b341', brightYellow: '#f2cc63',
  blue: '#5aa2f0', brightBlue: '#7db8ff',
  magenta: '#c084e0', brightMagenta: '#d6a3f0',
  cyan: '#4cc3c9', brightCyan: '#72dde2',
  white: '#c9d1d9', brightWhite: '#ffffff'
};

// Os dados do ssh podem chegar antes da resposta do "open"; guardamos ate o painel assumir o id.
const owners = new Map();
const buffers = new Map();
const exits = new Map();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  window.term.onData((id, d) => {
    const o = owners.get(id);
    if (o) o.data(d);
    else { if (!buffers.has(id)) buffers.set(id, []); buffers.get(id).push(d); }
  });
  window.term.onExit((id, code) => {
    const o = owners.get(id);
    if (o) { owners.delete(id); o.exit(code); }
    else exits.set(id, code);
  });
}
function claim(id, h) {
  owners.set(id, h);
  (buffers.get(id) || []).forEach(h.data);
  buffers.delete(id);
  if (exits.has(id)) { const c = exits.get(id); exits.delete(id); owners.delete(id); h.exit(c); }
}

function TermPane({ pane, met, hidden, maximized, onToggleMax, onClose, dnd }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const idRef = useRef(null);
  const aliveRef = useRef(true);
  const [status, setStatus] = useState('connecting');
  const [host, setHost] = useState('');
  const [since, setSince] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const connect = async (refresh = false) => {
    const t = termRef.current;
    if (!t) return;
    setStatus('connecting');
    t.write(`\x1b[90m${refresh ? 'Buscando o endereço de novo e conectando' : 'Conectando'} ${pane.name}…\x1b[0m\r\n`);
    try { fitRef.current.fit(); } catch {}
    const r = await window.term.open(pane.name, { mode: pane.mode, command: pane.command, cols: t.cols, rows: t.rows, refresh });
    if (!aliveRef.current) { if (r && r.ok) window.term.kill(r.id); return; }
    if (!r || !r.ok) {
      setStatus('closed');
      t.write(`\x1b[31m${String((r && r.error) || 'Falhou').replace(/\r?\n/g, '\r\n')}\x1b[0m\r\n`);
      return;
    }
    idRef.current = r.id;
    setHost(`${r.host}:${r.port}`);
    setStatus('open');
    setSince(Date.now());
    claim(r.id, {
      data: (d) => t.write(d),
      exit: (code) => {
        idRef.current = null;
        if (!aliveRef.current) return;
        setStatus('closed');
        setSince(null);
        t.write(`\r\n\x1b[90m[conexão encerrada${code ? ' — código ' + code : ''}]\x1b[0m\r\n`);
      }
    });
    window.term.resize(r.id, t.cols, t.rows);
    t.focus();
  };

  useEffect(() => {
    wire();
    aliveRef.current = true;
    const t = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: THEME
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(hostRef.current);
    termRef.current = t;
    fitRef.current = fit;
    try { fit.fit(); } catch {}

    const d1 = t.onData((d) => { if (idRef.current) window.term.write(idRef.current, d); });
    const d2 = t.onResize(({ cols, rows }) => { if (idRef.current) window.term.resize(idRef.current, cols, rows); });

    // Ctrl+C com selecao copia; Ctrl+Shift+C copia; Ctrl+V / Ctrl+Shift+V cola
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && (e.shiftKey || t.hasSelection())) {
        e.preventDefault();
        if (t.hasSelection()) { window.clip.write(t.getSelection()); t.clearSelection(); }
        return false;
      }
      if (k === 'v') {
        e.preventDefault();
        window.clip.read().then((txt) => { if (txt) t.paste(txt); });
        return false;
      }
      return true;
    });

    // botao direito: copia se houver selecao, senao cola (como no Windows Terminal)
    const el = hostRef.current;
    const onCtx = (e) => {
      e.preventDefault();
      if (t.hasSelection()) { window.clip.write(t.getSelection()); t.clearSelection(); }
      else window.clip.read().then((txt) => { if (txt) t.paste(txt); });
    };
    el.addEventListener('contextmenu', onCtx);

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) { try { fit.fit(); } catch {} }
    });
    ro.observe(el);

    connect();

    return () => {
      aliveRef.current = false;
      ro.disconnect();
      el.removeEventListener('contextmenu', onCtx);
      d1.dispose();
      d2.dispose();
      if (idRef.current) { owners.delete(idRef.current); window.term.kill(idRef.current); }
      t.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = { connecting: 'Conectando…', open: 'Conectado', closed: 'Desconectado' }[status];

  return (
    <section
      className={`pane${hidden ? ' hide' : ''}${dnd.dragging ? ' dragging' : ''}${dnd.over ? ' dropover' : ''}`}
      onMouseDown={() => termRef.current && termRef.current.focus()}
      onDragOver={dnd.onOver}
      onDragLeave={dnd.onLeave}
      onDrop={dnd.onDrop}
    >
      <header className="panehead" draggable={!maximized} onDragStart={dnd.onStart} onDragEnd={dnd.onEnd} title={maximized ? undefined : 'Arraste para reorganizar'}>
        {!maximized && <span className="grip" aria-hidden="true"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" /><circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="3" cy="13" r="1.4" /><circle cx="9" cy="13" r="1.4" /></svg></span>}
        <span className={`dot ${status === 'open' ? 'on' : status === 'closed' ? 'off' : 'check'}`} title={label} aria-label={label} />
        <strong className="panename" title={pane.name}>{pane.name}</strong>
        <span className="panemeta">{pane.label}{host ? ` · ${host}` : ''}</span>
        {since && <span className="chip paneinfo" title="Tempo desta sessão">{fmtDur((Date.now() - since) / 1000)}</span>}
        {met && met.ok && (
          <span className="chip paneinfo" title={`VM ligada há ${fmtDur(met.uptime)}`}>
            CPU {met.cpu ?? '—'}% · RAM {fmtGB(met.memUsed)}/{fmtGB(met.memTotal)} GB
          </span>
        )}
        <span className="spacer" />
        <span className="paneacts">
        {status === 'closed' && (
          <>
            <button className="mini" onClick={() => connect(false)}>Reconectar</button>
            <button className="mini" title="Busca IP e porta de novo antes de conectar" onClick={() => connect(true)}>Novo endereço</button>
          </>
        )}
        <button className="mini icon" title={maximized ? 'Voltar ao lado a lado' : 'Maximizar'} aria-label={maximized ? 'Restaurar' : 'Maximizar'} onClick={onToggleMax}>{maximized ? '⤡' : '⤢'}</button>
        <button className="mini icon" title="Fechar terminal" aria-label="Fechar terminal" onClick={onClose}>✕</button>
        </span>
      </header>
      <div className="xhost" ref={hostRef} />
      <footer className="panefoot">
        {met && met.ok ? <><span>CPU {met.cpu ?? '—'}%</span><span>RAM {fmtGB(met.memUsed)}/{fmtGB(met.memTotal)} GB</span></> : <span>{label}</span>}
        <span className="spacer" />
        {since && <span>sessão há {fmtDur((Date.now() - since) / 1000)}</span>}
      </footer>
    </section>
  );
}

export default function Workspace({ panes, mets = {}, onClose, onGoAccounts, onReorder }) {
  const [max, setMax] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  useEffect(() => { if (max && !panes.some((p) => p.key === max)) setMax(null); }, [panes, max]);

  if (panes.length === 0) {
    return (
      <section className="wsempty">
        <h2>Nenhum terminal aberto</h2>
        <p>Abra uma conta pelo botão <b>Abrir no app</b>. Cada conta vira um painel aqui, lado a lado.</p>
        <button className="primary" onClick={onGoAccounts}>Ir para as contas</button>
      </section>
    );
  }

  const visible = max ? 1 : panes.length;
  const cols = visible <= 3 ? visible : visible === 4 ? 2 : 3;
  const rows = Math.ceil(visible / cols);

  return (
    <div className="workspace" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(240px, 1fr))` }}>
      {panes.map((p) => (
        <TermPane
          key={p.key}
          pane={p}
          met={mets[p.name]}
          hidden={!!max && max !== p.key}
          maximized={max === p.key}
          onToggleMax={() => setMax(max === p.key ? null : p.key)}
          onClose={() => onClose(p.key)}
          dnd={{
            dragging: dragKey === p.key,
            over: overKey === p.key && dragKey != null && dragKey !== p.key,
            onStart: (e) => { setDragKey(p.key); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(p.key)); } catch {} },
            onEnd: () => { setDragKey(null); setOverKey(null); },
            onOver: (e) => { if (dragKey == null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overKey !== p.key) setOverKey(p.key); },
            onLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget) && overKey === p.key) setOverKey(null); },
            onDrop: (e) => { if (dragKey == null) return; e.preventDefault(); if (dragKey !== p.key && onReorder) onReorder(dragKey, p.key); setDragKey(null); setOverKey(null); }
          }}
        />
      ))}
    </div>
  );
}
