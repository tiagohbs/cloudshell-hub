import React, { useCallback, useEffect, useRef, useState } from 'react';
import Workspace from './Terminals.jsx';
import Projects from './Projects.jsx';
import { ask, askChecked, AskHost } from './ask.jsx';
import Help from './Help.jsx';
import { Meter, fmtDur, fmtGB, fmtHours, WEEK_LIMIT_H } from './format.jsx';

export function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '••••••';
  return (u.length <= 2 ? u[0] || '' : u.slice(0, 2)) + '•'.repeat(Math.max(3, Math.min(8, u.length - 2))) + '@' + d;
}
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const VM_LABEL = { RUNNING: 'Ativa', SUSPENDED: 'Suspensa', STARTING: 'Iniciando', DELETING: 'Removendo', ERROR: 'Erro na API', UNKNOWN: 'Desconhecido' };

const MODES = { agydirect: 'agy direto', agy: 'agy no tmux (sem mouse)', shell: 'shell puro', custom: 'comando próprio' };

const FRIENDLY = [
  [/timed out|ETIMEDOUT|ECONNREFUSED|Connection refused/i, 'Não foi possível conectar à VM', 'O Google pode ainda estar ligando a VM. Espere alguns segundos e tente de novo.'],
  [/addPublicKey|HTTP 500|INTERNAL/i, 'O Google recusou a chave de acesso', 'Isso costuma passar sozinho. Tente de novo; se continuar, use "Atualizar endereço" no menu da conta.'],
  [/Permission denied|publickey/i, 'A VM recusou o acesso', 'A chave desta conta ainda não foi aceita. Use "Atualizar endereço" no menu da conta e tente de novo.'],
  [/encerrar as sess/i, 'Não foi possível encerrar a VM', 'A VM não respondeu ao pedido de encerramento. Tente de novo; se continuar, use "Detalhes técnicos" e informe o código.'],
  [/cota|quota/i, 'Problema com a cota do Gemini', 'Veja a cota desta conta e escolha outra se ela estiver esgotada.'],
  [/login|not logged|credential|auth/i, 'A conta precisa de login', 'Faça o login desta conta no gcloud (Editar conta ou Adicionar conta).'],
  [/ENOENT|ssh\.exe|n[aã]o encontrad/i, 'Um programa necessário não foi encontrado', 'Confira se o OpenSSH e o gcloud estão instalados e no PATH do Windows.']
];
function friendly(raw) {
  for (const [re, title, text] of FRIENDLY) if (re.test(raw)) return { title, text };
  const first = String(raw).split(/\r?\n/).find((l) => l.trim()) || 'Algo deu errado';
  return { title: 'Algo deu errado', text: first.length > 180 ? first.slice(0, 180) + '…' : first };
}
const fmtTime = (t) => { try { return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

function useToast() {
  const [toast, setToast] = useState(null);
  const [notes, setNotes] = useState([]);
  const t = useRef();
  const show = useCallback((msg, kind = 'ok') => {
    const raw = String(msg == null ? '' : msg);
    clearTimeout(t.current);
    if (kind === 'ok') {
      setToast({ kind, msg: raw });
      t.current = setTimeout(() => setToast(null), 5000);
      return;
    }
    const m = raw.match(/\s*\(código (CSH-[A-Z]+-\d+)\)\s*$/);
    const code = m ? m[1] : 'CSH-APP-900';
    const clean = m ? raw.slice(0, m.index) : raw;
    const f = friendly(clean);
    const n = { id: Date.now() + Math.random(), kind, title: f.title, text: f.text, raw: clean, code, time: Date.now() };
    setNotes((l) => [n, ...l].slice(0, 50));
    setToast({ kind, note: n });
    if (kind === 'warn') t.current = setTimeout(() => setToast(null), 12000);
  }, []);
  const closeToast = useCallback(() => setToast(null), []);
  const dismiss = useCallback((id) => setNotes((l) => l.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setNotes([]), []);
  return { toast, show, closeToast, notes, dismiss, clear };
}

const Bell = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
);
const X = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const Pencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const Globe = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
);
const Refresh = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>
);
const Sun = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
const Moon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
const Auto = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg>
);


const Gear = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);

function SettingsPop({ onClose }) {
  const [mode, setMode] = useState(null);
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    if (!window.appctl) return undefined;
    window.appctl.getSettings().then((r) => { setMode(r.closeAction); setNotify(r.notifyTasks !== false); });
    return window.appctl.onSettings((x) => { setMode(x.closeAction); setNotify(x.notifyTasks !== false); });
  }, []);
  const change = (m) => { setMode(m); window.appctl.setSettings({ closeAction: m }); };
  const changeNotify = (v) => { setNotify(v); window.appctl.setSettings({ notifyTasks: v }); };
  const ask_ = mode === 'ask';
  return (
    <section className="settingspop" role="dialog" aria-label="Configurações">
      <div className="noteshead"><h3>Ao fechar a janela</h3><button className="xbtn" aria-label="Fechar" onClick={onClose}><X /></button></div>
      <label className="switchrow">
        <span>Sempre perguntar</span>
        <input type="checkbox" role="switch" className="switch" checked={ask_} disabled={mode == null} onChange={(e) => change(e.target.checked ? 'ask' : 'tray')} />
      </label>
      {!ask_ && mode != null && (
        <div className="radiorow">
          <label><input type="radio" name="closeact" checked={mode === 'tray'} onChange={() => change('tray')} /> Minimizar para a bandeja</label>
          <label><input type="radio" name="closeact" checked={mode === 'quit'} onChange={() => change('quit')} /> Fechar de vez</label>
        </div>
      )}
      <p className="hint">Na bandeja, o app continua rodando com os terminais abertos. Para sair de verdade, use o ícone da bandeja e clique em Sair.</p>
      <div className="noteshead" style={{ marginTop: 4 }}><h3>Avisos de tarefas</h3></div>
      <label className="switchrow">
        <span>Avisar no Windows quando uma tarefa terminar ou falhar</span>
        <input type="checkbox" role="switch" className="switch" checked={notify} onChange={(e) => changeNotify(e.target.checked)} />
      </label>
      <button className="ghost" style={{ justifySelf: 'start' }} onClick={() => window.appctl.testNotify()}>Testar aviso</button>
      <p className="hint">O aviso só aparece se o app estiver aberto ou na bandeja. Falhas também ficam no sino, com o código para rastreio.</p>
    </section>
  );
}

function NotesPanel({ notes, onDismiss, onClear, onClose, toast }) {
  const [open, setOpen] = useState(null);
  return (
    <section className="notes" role="dialog" aria-label="Avisos e erros">
      <div className="noteshead">
        <h3>Avisos e erros</h3>
        {notes.length > 0 && <button className="linkish" onClick={onClear}>Limpar tudo</button>}
        <button className="xbtn" aria-label="Fechar painel" onClick={onClose}><X /></button>
      </div>
      <div className="noteslist">
        {notes.length === 0 && <div className="notesempty">Tudo certo por aqui. Nenhum aviso.</div>}
        {notes.map((n) => (
          <div key={n.id} className={`note-item ${n.kind}`}>
            <div className="nkind"><em>{n.kind === 'err' ? 'Erro' : 'Aviso'}</em><span style={{ flex: 1 }} /><span>{fmtTime(n.time)}</span></div>
            <div className="ntitle">{n.title}</div>
            <div className="ntext">{n.text}</div>
            <div className="ncode">Código {n.code}</div>
            {open === n.id && <pre>{n.raw}</pre>}
            <div className="nacts">
              <button onClick={() => setOpen(open === n.id ? null : n.id)}>{open === n.id ? 'Ocultar detalhes' : 'Detalhes técnicos'}</button>
              <button className="ghost" onClick={() => { window.clip.write(`${n.title} [${n.code}]\n${n.text}\n\n${n.raw}`); toast('Copiado'); }}>Copiar</button>
              <span style={{ flex: 1 }} />
              <button className="xbtn" aria-label="Dispensar aviso" onClick={() => onDismiss(n.id)}><X /></button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const BLOCK_H = 47;   // bloqueia quando restam menos de 3 h das 50 h
const BLOCK_Q = 5;    // bloqueia com menos de 5% de cota
function blockers(acc, state, vm, q) {
  const b = [];
  if (acc.Reservada) b.push(String(acc.Reservada).includes('[PC]') ? { t: 'pc', text: 'Em uso no PC' } : { t: 'reserva', text: 'Reservada' });
  if (state === 'nologin') b.push({ t: 'login', text: 'Sem login' });
  const g = q && q.grupos && (q.grupos.find((x) => x.grupo === 'gemini') || q.grupos[0]);
  const vals = g ? [g.semanal, g.cincoHoras].filter(Boolean).map((x) => x.restante) : [];
  if (q && q.esgotada) b.push({ t: 'cota', text: 'Sem cota' });
  else if (vals.length && Math.min(...vals) < BLOCK_Q) b.push({ t: 'cota', text: 'Sem cota' });
  if (vm && vm.weekHours != null && vm.weekHours >= BLOCK_H) b.push({ t: 'horas', text: 'Sem horas de VM' });
  return b;
}
const AVATARS = ['#4285F4', '#EA4335', '#F9AB00', '#34A853', '#A142F4', '#24C1E0'];
const avatarColor = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length]; };

const Eye = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
const EyeOff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 5.4-1.5" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
);

function Dot({ state }) {
  const label = { on: 'VM ativa', sleep: 'VM suspensa (não consome cota)', off: 'Erro ao consultar', nologin: 'Conta não logada no gcloud', check: 'Verificando…' }[state];
  return <span className={`dot ${state}`} title={label} aria-label={label} />;
}

const shellUrl = () => 'https://shell.cloud.google.com/?authuser=0&show=terminal';

// explicação da validação manual (cada conta precisa abrir o Cloud Shell uma vez no navegador)
function ValidInfo() {
  return (
    <div className="validbox">
      <b>Validação manual do Cloud Shell</b>
      <p>Cada conta usa um Chrome só dela, aberto pelo app com perfil separado e sem usuário do Chrome logado. Por isso ela é sempre a conta 0 (<code>authuser=0</code>) e uma conta nunca atrapalha a outra.</p>
      <p>Cada conta nova precisa ser liberada uma vez, à mão: use <b>Abrir no Chrome da conta</b>, entre com a conta (senha e verificação em duas etapas) se o Google pedir, aceite os termos do Cloud Shell e espere o terminal aparecer. Sem isso o app não consegue conectar na VM. Depois disso o login fica salvo naquele perfil.</p>
    </div>
  );
}
function LinkRow({ email, toast }) {
  const url = shellUrl();
  return (
    <span className="linkrow">
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link do Cloud Shell (conta 0)" />
      <button type="button" className="ghost" onClick={() => { window.clip.write(url); toast('Link copiado (cole só no Chrome desta conta)'); }}>Copiar</button>
      {email && <button type="button" className="ghost" onClick={() => window.cs.webShell(email)}>Abrir no Chrome da conta</button>}
    </span>
  );
}

function AddDialog({ onClose, onDone, onBatch, toast }) {
  const [f, setF] = useState({ email: '', name: '', mode: 'agydirect', session: 'agy', command: '', authUser: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await window.cs.add(f);
    setBusy(false);
    if (r.ok) { toast('Conta adicionada'); onDone(); onClose(); }
    else toast(r.error, 'err');
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Adicionar conta</h2>
        <label>E-mail Google
          <input autoFocus required type="email" value={f.email} onChange={set('email')} placeholder="voce@gmail.com" />
        </label>
        <label>Apelido <span className="hint">opcional</span>
          <input value={f.name} onChange={set('name')} placeholder="trabalho" />
        </label>
        <div className="row2">
          <label>Ao conectar
            <select value={f.mode} onChange={set('mode')}>
              {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Sessão tmux
            <input value={f.session} onChange={set('session')} disabled={f.mode !== 'agy'} />
          </label>
        </div>
        {f.mode === 'custom' && (
          <label>Comando remoto
            <input value={f.command} onChange={set('command')} placeholder="cd ~/projeto && bash" />
          </label>
        )}
        <ValidInfo />
        <p className="note">Se a conta ainda não estiver logada no gcloud, o navegador abre para o login do Google. Nenhuma senha passa por este app.</p>
        <div className="actions">
          <button type="button" className="ghost linkish" disabled={busy} onClick={onBatch}>Adicionar várias de uma vez</button>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Aguardando login…' : 'Adicionar'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- adicionar várias contas de uma vez ----------
function parseBatch(text, existing) {
  const emails = new Set(existing.map((a) => String(a.Email).toLowerCase()));
  const names = new Set(existing.map((a) => a.Name));
  const seen = new Set();
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    const email = parts[0];
    const low = email.toLowerCase();
    if (!/^[^\s@"'`$&|;<>()]+@[^\s@"'`$&|;<>()]+\.[^\s@"'`$&|;<>()]+$/.test(email)) { rows.push({ email, name: '', state: 'err', msg: 'e-mail inválido' }); continue; }
    if (emails.has(low)) { rows.push({ email, name: '', state: 'skip', msg: 'já cadastrada' }); continue; }
    if (seen.has(low)) { rows.push({ email, name: '', state: 'skip', msg: 'repetida na lista' }); continue; }
    seen.add(low);
    let name = (parts[1] || email.split('@')[0]).replace(/[^\w.\-]/g, '_').slice(0, 32) || 'conta';
    const base = name;
    for (let n = 2; names.has(name); n++) name = base.slice(0, 29) + '-' + n;
    names.add(name);
    rows.push({ email, name, state: 'wait', msg: '' });
  }
  return rows;
}
const BSTATE = { wait: 'na fila', run: 'aguardando login no navegador…', ok: 'pronta', err: 'falhou', skip: 'ignorada' };

function BatchDialog({ accounts, onClose, onDone, toast }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState('agydirect');
  const [rows, setRows] = useState(null);   // null = ainda editando a lista
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const preview = parseBatch(text, accounts || []);
  const toRun = preview.filter((r) => r.state === 'wait').length;

  const upd = (i, p) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const go = async (list) => {
    stop.current = false;
    setBusy(true);
    let ok = 0; let bad = 0;
    for (let i = 0; i < list.length; i++) {
      if (stop.current) break;
      const r = list[i];
      if (r.state !== 'wait' && r.state !== 'err') continue;
      if (r.state === 'err' && !r.name) continue;   // e-mail inválido não tem como repetir
      upd(i, { state: 'run', msg: '' });
      const res = await window.cs.add({ email: r.email, name: r.name, mode, session: 'agy', command: '' });
      if (res.ok) { ok++; upd(i, { state: 'ok', msg: '' }); }
      else { bad++; upd(i, { state: 'err', msg: stop.current ? 'cancelada' : res.error }); }
    }
    setBusy(false);
    onDone();
    toast(`${ok} conta(s) adicionada(s)${bad ? `, ${bad} com falha` : ''}${stop.current ? ' (interrompido)' : ''}`, bad ? 'err' : undefined);
  };
  const start = () => { const list = preview; setRows(list); setTimeout(() => go(list), 0); };
  const again = () => { const list = rows.map((r) => (r.state === 'err' && r.name ? { ...r, state: 'wait' } : r)); setRows(list); setTimeout(() => go(list), 0); };
  const halt = () => { stop.current = true; window.cs.cancelLogin(); };

  const done = rows && !busy;
  const failed = rows ? rows.filter((r) => r.state === 'err' && r.name).length : 0;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog batch" role="dialog" aria-label="Adicionar várias contas">
        <h2>Adicionar várias contas</h2>
        {!rows && (
          <>
            <label>Um e-mail por linha <span className="hint">opcional: apelido depois do e-mail</span>
              <textarea autoFocus rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={'ana@gmail.com\nbruno@gmail.com  bruno\ncarla@gmail.com;carla'} spellCheck={false} />
            </label>
            <label>Ao conectar
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {Object.entries(MODES).filter(([k]) => k !== 'custom').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <ValidInfo />
            <p className="note">
              {preview.length ? `${toRun} para adicionar${preview.length - toRun ? ` · ${preview.length - toRun} ignorada(s) ou inválida(s)` : ''}. ` : ''}
              O app abre um Chrome separado para cada conta (perfil próprio, sempre a conta 0), uma por vez; em cada uma você entra e aprova. Contas que já estão logadas no gcloud entram na hora. Nenhuma senha passa por este app.
            </p>
          </>
        )}
        {rows && <ValidInfo />}
        {rows && (
          <ul className="batchlist">
            {rows.map((r, i) => (
              <li key={r.email + i} className={`b-${r.state}`}>
                <span className="bdot" />
                <span className="bmail">{r.email}{r.name && r.name !== r.email.split('@')[0] ? <em> · {r.name}</em> : null}</span>
                <span className="bstate">{r.msg ? `${BSTATE[r.state]}: ${r.msg}` : BSTATE[r.state]}</span>
                {r.state === 'ok' && (
                  <span className="bnum">
                    <button type="button" className="ghost" onClick={() => window.cs.webShell(r.email)}>Abrir no Chrome da conta</button>
                    <button type="button" className="ghost" onClick={() => { window.clip.write(shellUrl()); toast('Link copiado (cole só no Chrome desta conta)'); }}>Copiar link</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          {!rows && <><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button type="button" className="primary" disabled={!toRun} onClick={start}>{toRun ? `Adicionar ${toRun} conta(s)` : 'Adicionar'}</button></>}
          {busy && <button type="button" className="ghost" onClick={halt}>Parar</button>}
          {done && failed > 0 && <button type="button" className="ghost" onClick={again}>Tentar de novo as {failed} que falharam</button>}
          {done && <button type="button" className="primary" onClick={onClose}>Fechar</button>}
        </div>
      </div>
    </div>
  );
}

function EditDialog({ acc, onClose, onDone, toast, onRenamed }) {
  const [f, setF] = useState({ name: acc.Name, reserved: acc.Reservada || '', mode: acc.Mode || 'agydirect', session: acc.Session || 'agy', command: acc.Command || '', authUser: acc.AuthUser || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await window.cs.update(acc.Name, { Name: f.name.trim(), Reserved: f.reserved, Mode: f.mode, Session: f.session.trim(), Command: f.command });
    setBusy(false);
    if (r.ok) {
      if (r.name && r.name !== acc.Name && onRenamed) onRenamed(acc.Name, r.name);
      toast('Conta atualizada'); onDone(); onClose();
    }
    else toast(r.error || 'Falhou', 'err');
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Editar {acc.Name}</h2>
        <label>Apelido
          <input autoFocus required maxLength={32} value={f.name} onChange={set('name')} />
        </label>
        <div className="row2">
          <label>Ao conectar
            <select value={f.mode} onChange={set('mode')}>
              {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Sessão tmux
            <input value={f.session} onChange={set('session')} disabled={f.mode !== 'agy'} />
          </label>
        </div>
        {f.mode === 'custom' && (
          <label>Comando remoto
            <input value={f.command} onChange={set('command')} placeholder="cd ~/projeto && bash" />
          </label>
        )}
        <label>Reservada para <span className="hint">opcional</span>
          <input value={f.reserved} onChange={set('reserved')} maxLength={160} placeholder="ex.: Arauto e Vidente (cota do Gemini compartilhada)" />
          <span className="hint">Conta reservada não recebe tarefas do cshub sem liberação explícita.</span>
        </label>
        <LinkRow email={acc.Email} toast={toast} />
        <ValidInfo />
        <p className="note">O e-mail não muda: para usar outra conta Google, adicione uma conta nova.</p>
        <div className="actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={busy}>Salvar</button>
        </div>
      </form>
    </div>
  );
}

const renovaTxt = (m) => (m == null ? '' : m >= 120 ? `renova em ${Math.round(m / 60)} h` : `renova em ${m} min`);
const qTone = (v) => (v < 10 ? 'bad' : v < 30 ? 'warn' : 'blue');
const pctTxt = (v) => String(v).replace('.', ',') + '%';
function QuotaBlock({ q, busy, onMeasure }) {
  const g = q && q.grupos && (q.grupos.find((x) => x.grupo === 'gemini') || q.grupos[0]);
  const when = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };
  return (
    <>
      {q && q.esgotada && <p className="warnline bad">Cota do agy esgotada até {when(q.esgotada.ate)}: não delegue tarefas para esta conta.</p>}
      {g && g.cincoHoras && <Meter label="Gemini · 5 horas" pct={g.cincoHoras.restante} text={pctTxt(g.cincoHoras.restante)} tone={qTone(g.cincoHoras.restante)} title={renovaTxt(g.cincoHoras.renovaEmMin)} />}
      {g && g.semanal && <Meter label="Gemini · semana" pct={g.semanal.restante} text={pctTxt(g.semanal.restante)} tone={qTone(g.semanal.restante)} title={renovaTxt(g.semanal.renovaEmMin)} />}
      <button className="linkish" disabled={busy} onClick={onMeasure}>
        {busy ? 'Lendo /usage do agy…' : g ? `Medida há ${q.idadeMin ?? 0} min · medir agora` : 'Medir a cota do Gemini (agy)'}
      </button>
    </>
  );
}

function Card({ acc, state, vm, met, quota: q, blocks, onQuota, onChanged, toast, onCheck, onEmbed, onStop, onMetrics, showEmail, onToggleEmail, onRenamed }) {
  const [busy, setBusy] = useState('');
  const [sessions, setSessions] = useState(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nick, setNick] = useState('');

  const startRename = () => { setNick(acc.Name); setRenaming(true); };
  const finishRename = async () => {
    setRenaming(false);
    const n = nick.trim();
    if (!n || n === acc.Name) return;
    const r = await window.cs.update(acc.Name, { Name: n });
    if (r && r.ok) { if (onRenamed) onRenamed(acc.Name, r.name || n); toast('Apelido atualizado'); onChanged(); }
    else toast((r && r.error) || 'Não consegui trocar o apelido', 'err');
  };

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    const r = await fn();
    setBusy('');
    if (r && r.ok === false) toast(r.error || 'Falhou', 'err');
    else if (okMsg) toast(okMsg);
    onCheck(acc.Name);
    return r;
  };

  const running = vm && vm.state === 'RUNNING';
  const powerBusy = busy === 'stop' || busy === 'wake' || state === 'check' || (vm && vm.state === 'STARTING');
  const togglePower = async () => {
    if (running) {
      if (!(await ask({ title: `Encerrar tudo na VM de "${acc.Name}"?`, text: 'Fecha os terminais desta conta no app e encerra agy, tmux e shells abertos na nuvem. O que não foi salvo nesses programas se perde.', ok: 'Encerrar VM', danger: true }))) return;
      setBusy('stop'); await onStop(acc.Name); setBusy('');
    } else {
      await act('wake', () => window.cs.refresh(acc.Name), `${acc.Name}: VM ligada`);
      onChanged();
    }
  };

  const open = async (o) => { const r = await act('open', () => window.cs.open(acc.Name, o)); if (r && r.ok) onChanged(); };
  const loadSessions = async () => {
    const r = await act('tmux', () => window.cs.tmux(acc.Name));
    if (r && r.ok) setSessions(r.sessions);
  };

  return (
    <article className="card acc">
      <header>
        <div className="avatar" style={{ background: avatarColor(acc.Name) }} aria-hidden="true">{String(acc.Name).charAt(0).toUpperCase()}</div>
        <div className="who">
          {renaming ? (
            <input className="nameedit" autoFocus maxLength={32} aria-label="Apelido da conta" value={nick} onChange={(e) => setNick(e.target.value)} onBlur={finishRename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setNick(acc.Name); setRenaming(false); } }} />
          ) : (
            <h3><span className="nm" title={acc.Name}>{acc.Name}</span><button className="pencil" aria-label="Editar apelido" title="Editar apelido" onClick={startRename}><Pencil /></button></h3>
          )}
          <p className="email">
            <span>{showEmail ? acc.Email : maskEmail(acc.Email)}</span>
            <button className="eye" onClick={onToggleEmail} aria-label={showEmail ? 'Ocultar e-mail' : 'Mostrar e-mail'} title={showEmail ? 'Ocultar e-mail' : 'Mostrar e-mail'}>
              {showEmail ? <EyeOff /> : <Eye />}
            </button>
          </p>
        </div>
        <span className={`statechip ${!blocks || blocks.length === 0 ? 'ok' : blocks[0].t === 'pc' ? 'blue' : blocks[0].t === 'horas' ? 'warn' : 'bad'}`} title={blocks && blocks.length ? blocks.map((b) => b.text).join(', ') : 'Livre para receber tarefas da nuvem'}>
          {!blocks || blocks.length === 0 ? 'Livre' : blocks[0].text}
        </span>
        <div className="menuwrap">
          <button className="icon" aria-label="Mais opções" onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { setMenu(false); setEditing(true); }}>Editar conta…</button>
              <button onClick={() => { setMenu(false); open({}); }}>Abrir em janela externa</button>
              <button onClick={() => { setMenu(false); act('copy', () => window.cs.copy(acc.Name, {}), 'Comando copiado — cole no painel do Maestri'); }}>Copiar comando</button>
              <button onClick={() => { setMenu(false); act('refresh', () => window.cs.refresh(acc.Name), 'Endereço atualizado').then(onChanged); }}>Atualizar endereço</button>
              <button onClick={() => { setMenu(false); loadSessions(); }}>Ver sessões tmux</button>
              <button onClick={async () => {
                setMenu(false);
                const r = await window.cs.liveTask(acc.Name);
                if (r && r.ok) onEmbed(acc, { command: r.command, label: r.label });
                else toast((r && r.error) || 'Não consegui abrir o acompanhamento', 'warn');
              }}>Ver tarefa ao vivo</button>
              <button className="danger" onClick={async () => {
                setMenu(false);
                const a = await ask({ title: `Remover "${acc.Name}"?`, text: `${showEmail ? acc.Email : maskEmail(acc.Email)}\n\nVocê pode tirar a conta só da lista (o login no gcloud continua) ou também revogar o login.`, ok: 'Remover e revogar login', extra: 'Só da lista', danger: true });
                if (!a) return;
                await window.cs.remove(acc.Name, a === true);
                onChanged();
              }}>Remover…</button>
            </div>
          )}
        </div>
      </header>

      <div className="meters">
        <QuotaBlock q={q} busy={busy === 'quota'} onMeasure={async () => {
          if (vm && vm.state !== 'RUNNING' && !(await ask({ title: 'Ligar a VM para medir a cota?', text: 'A VM desta conta está suspensa. Medir a cota vai ligá-la, e isso conta no uso do Cloud Shell.', ok: 'Ligar e medir' }))) return;
          setBusy('quota'); await onQuota(acc.Name); setBusy('');
        }} />
        <Meter
          label="Horas de VM"
          pct={vm && vm.weekHours != null ? (vm.weekHours / WEEK_LIMIT_H) * 100 : 0}
          text={`${fmtHours(vm && vm.weekHours)} de ${WEEK_LIMIT_H} h`}
          title="Uso nos últimos 7 dias (estimado)"
        />
      </div>

      <div className="vmline">
        <Dot state={state} />
        <span>{vm && vm.state ? VM_LABEL[vm.state] || vm.state : '…'}{vm && vm.state === 'RUNNING' && met && met.uptime != null ? ` · ligada há ${fmtDur(met.uptime + (Date.now() - met.at) / 1000)}` : ''}{vm && vm.state === 'RUNNING' && met && met.ok && met.ncpu >= 4 ? ' · Boost' : ''}</span>
        <span className="spacer" />
        {running && (met && met.ok
          ? <span className="mono">CPU {met.cpu ?? '—'}% · RAM {fmtGB(met.memUsed)}/{fmtGB(met.memTotal)} GB</span>
          : <button className="linkish" disabled={busy === 'met'} onClick={async () => { setBusy('met'); await onMetrics(acc.Name); setBusy(''); }}>{busy === 'met' ? 'Lendo…' : (met && met.error ? 'Tentar de novo' : 'Ver CPU e RAM')}</button>)}
        <button className={`pwr${running ? ' on' : ''}${powerBusy ? ' busy' : ''}`} disabled={powerBusy} onClick={togglePower}
          aria-label={running ? 'Encerrar a VM' : 'Ligar a VM'} title={busy === 'wake' ? 'Ligando a VM…' : busy === 'stop' ? 'Encerrando…' : running ? 'Encerrar a VM (para de gastar horas)' : 'Ligar a VM'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v9" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></svg>
        </button>
      </div>

      <details className="more">
        <summary>Detalhes</summary>
        <dl>
          <div><dt>Modo</dt><dd>{MODES[acc.Mode] || acc.Mode}{acc.Mode === 'agy' ? ` · ${acc.Session}` : ''}</dd></div>
          <div><dt>Endereço</dt><dd className="mono">{acc.Host ? `${acc.Host}:${acc.Port}` : 'ainda não buscado'}</dd></div>
          {vm && vm.state === 'RUNNING' && met && met.ok && met.diskTotal ? <div><dt>Disco ($HOME)</dt><dd className="mono">{fmtGB(met.diskUsed)} / {fmtGB(met.diskTotal)} GB</dd></div> : null}
        </dl>
      </details>

      <div className="btns cardacts">
        <button className="primary" disabled={!!busy} onClick={() => onEmbed(acc, {})}>Abrir no app</button>
        <button disabled={!!busy} onClick={() => onEmbed(acc, { mode: 'shell' })}>Shell</button>
        {vm && vm.state === 'RUNNING' && met && met.ok && met.ncpu != null && met.ncpu < 4 && (
          <button disabled={!!busy} title="Abre o Cloud Shell desta conta no navegador para ativar o Boost" onClick={async () => {
            if (!(await ask({ title: `Ativar Boost em "${acc.Name}"?`, text: 'O Boost só pode ser ligado pelo menu do Cloud Shell no navegador. Vou abrir o Cloud Shell desta conta: clique no menu (⋮ ou "Mais") e escolha Ativar modo Boost / Enable Boost Mode.\n\nAtenção: o Cloud Shell reinicia numa máquina maior. Os terminais abertos desta conta caem, e um agy aberto em modo direto perde a conversa. O Boost dura 24 horas.', ok: 'Abrir Cloud Shell' }))) return;
            window.cs.webShell(acc.Email);
          }}>Boost</button>
        )}
      </div>

      {sessions && (
        <div className="sessions">
          <h4>Sessões tmux</h4>
          {sessions.length === 0 && <p className="empty">Nenhuma sessão ativa.</p>}
          {sessions.map((s) => (
            <div key={s.name} className="sess">
              <span className="mono">{s.name}</span>
              <span className="muted">{s.info}</span>
              <button disabled={!!busy} onClick={() => onEmbed(acc, { command: `tmux new -A -s ${s.name}`, label: 'tmux ' + s.name })}>Anexar</button>
            </div>
          ))}
        </div>
      )}
      {editing && <EditDialog acc={acc} onClose={() => setEditing(false)} onDone={onChanged} toast={toast} onRenamed={onRenamed} />}
    </article>
  );
}

function SkillCard({ toast }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setS(await window.skill.status()); };
  useEffect(() => { load(); }, []);
  if (!s) return null;
  const ok = s.estado === 'atualizada';
  const label = { atualizada: 'Skill instalada e atualizada', desatualizada: 'Skill desatualizada', ausente: 'Skill não instalada', 'sem-origem': 'Arquivo da skill não encontrado' }[s.estado];
  const tone = ok ? 'on' : s.estado === 'desatualizada' ? 'nologin' : 'off';
  const install = async () => {
    setBusy(true);
    const r = await window.skill.install();
    setBusy(false);
    if (r && r.ok) { toast('Skill instalada. Reinicie a sessão do Claude no Maestri.'); load(); }
    else toast((r && r.error) || 'Falhou', 'err');
  };
  const copy = (t) => { window.clip.write(t); toast('Copiado'); };
  const manual = 'Copy-Item "' + s.pastaOrigem + '" (New-Item -ItemType Directory -Force (Split-Path "' + s.caminho + '")).FullName -Force';
  return (
    <section className={'skillcard ' + (ok ? 'ok' : 'warn')}>
      <div className="skillhead">
        <span className={'dot ' + tone} aria-hidden="true" />
        <strong>{label}</strong>
        <span className="muted small">para o Claude do Maestri usar o cshub</span>
        <span className="spacer" />
        {!ok && s.estado !== 'sem-origem' && <button className="primary" disabled={busy} onClick={install}>{s.estado === 'ausente' ? 'Instalar skill' : 'Atualizar skill'}</button>}
        <button className="mini" onClick={load}>Verificar de novo</button>
      </div>
      {!s.cshubNoPath && <p className="small warnline">O comando <code>cshub</code> não foi encontrado no PATH. O Claude do Maestri vai precisar do caminho completo (já está dentro da skill), ou adicione a pasta do app ao PATH.</p>}
      {!ok && (
        <details className="skillhelp" open={s.estado === 'ausente'}>
          <summary>Como instalar</summary>
          <ol>
            <li>Clique em <b>{s.estado === 'ausente' ? 'Instalar skill' : 'Atualizar skill'}</b>. O app copia o arquivo para <code>{s.caminho}</code> (e guarda uma cópia <code>.bak</code> da versão anterior).</li>
            <li>No Maestri, <b>reinicie a sessão do Claude</b> (ou abra uma nova) para ela reler as skills.</li>
            <li>Teste: peça ao Claude <i>“use a skill cloudshell-hub para listar as contas”</i> ou rode <code>cshub contas</code> no PowerShell.</li>
            <li>Sempre que trocar a conta do agy no Maestri, rode <code>cshub local &lt;e-mail&gt;</code>.</li>
          </ol>
          <p className="small">Sem o botão, no PowerShell: <button className="mini" onClick={() => copy(manual)}>Copiar comando</button></p>
        </details>
      )}
    </section>
  );
}

let paneSeq = 0;

export default function App() {
  const [accounts, setAccounts] = useState(null);
  const [states, setStates] = useState({});
  const [adding, setAdding] = useState(false);
  const [batch, setBatch] = useState(false);
  const [tab, setTab] = useState('contas');
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!window.appctl) return undefined;
    return window.appctl.onCloseAsk(async () => {
      const r = await ask({ title: 'Fechar o Cloud Shell Hub?', text: 'Minimizar para a bandeja deixa o app em segundo plano, com os terminais abertos. Fechar de vez encerra o app e os terminais.', ok: 'Minimizar para a bandeja', extra: 'Fechar de vez', extraDanger: true, check: { label: 'Sempre perguntar', value: true } });
      if (!r) return;
      const choice = r === true ? 'tray' : 'quit';
      if (!askChecked()) await window.appctl.setSettings({ closeAction: choice });
      window.appctl.closeChoice(choice);
    });
  }, []);
  const [help, setHelp] = useState(null);   // null = fechada; senão o tópico
  useEffect(() => { setHelp((h) => (h ? tab : h)); }, [tab]);
  const [panes, setPanes] = useState([]);
  const [vms, setVms] = useState({});
  const [mets, setMets] = useState({});
  const [quotas, setQuotas] = useState({});
  const [, setTick] = useState(0);
  const [hideAll, setHideAll] = useState(() => store.get('cs.hideEmails', false));
  const [emailOv, setEmailOv] = useState(() => store.get('cs.emailOverrides', {}));
  const { toast, show: showToast, closeToast, notes, dismiss: dismissNote, clear: clearNotes } = useToast();
  useEffect(() => {
    if (!window.appctl || !window.appctl.onAviso) return undefined;
    return window.appctl.onAviso((a) => showToast(a.msg, a.kind));
  }, [showToast]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [theme, setTheme] = useState(() => store.get('cs.theme', 'auto'));

  useEffect(() => {
    store.set('cs.theme', theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const nextTheme = { auto: 'light', light: 'dark', dark: 'auto' };
  const themeLabel = { auto: 'Tema: automático (segue o Windows)', light: 'Tema: claro', dark: 'Tema: escuro' }[theme];

  // erros inesperados tambem viram aviso
  useEffect(() => {
    const onErr = (e) => showToast((e && e.message) || 'Erro inesperado', 'err');
    const onRej = (e) => showToast(String((e && e.reason && (e.reason.message || e.reason)) || 'Erro inesperado'), 'err');
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, [showToast]);

  useEffect(() => store.set('cs.hideEmails', hideAll), [hideAll]);
  useEffect(() => store.set('cs.emailOverrides', emailOv), [emailOv]);
  const showEmail = (name) => (name in emailOv ? emailOv[name] : !hideAll);
  const toggleEmail = (name) => setEmailOv((o) => ({ ...o, [name]: !showEmail(name) }));
  const toggleAll = () => { setHideAll(!hideAll); setEmailOv({}); };
  const renamed = (from, to) => {
    const mv = (o) => { if (!(from in o)) return o; const n = { ...o, [to]: o[from] }; delete n[from]; return n; };
    setPanes((p) => p.map((x) => (x.name === from ? { ...x, name: to } : x)));
    setEmailOv(mv); setStates(mv); setVms(mv); setMets(mv); setQuotas(mv);
  };

  const check = useCallback(async (name, quiet) => {
    if (!quiet) setStates((s) => ({ ...s, [name]: 'check' }));
    const r = await window.cs.status(name);
    const st = !r.logged ? 'nologin' : r.state === 'RUNNING' ? 'on' : r.state === 'SUSPENDED' ? 'sleep' : r.state === 'STARTING' ? 'check' : 'off';
    setStates((s) => ({ ...s, [name]: st }));
    setVms((v) => ({ ...v, [name]: { state: r.state, weekHours: r.weekHours, error: r.error } }));
    if (r.state !== 'RUNNING') setMets((m) => { const n = { ...m }; delete n[name]; return n; });
    const qc = await window.cs.quotaCached(name);
    setQuotas((q) => ({ ...q, [name]: qc && qc.ok !== false ? qc : null }));
  }, []);

  const loadQuota = useCallback(async (name) => {
    const r = await window.cs.quota(name);
    if (r && r.ok) setQuotas((q) => ({ ...q, [name]: { ...r, idadeMin: 0 } }));
    else showToast((r && r.error) || 'Não consegui medir a cota', 'err');
  }, [showToast]);

  const loadMetrics = useCallback(async (name) => {
    const r = await window.cs.metrics(name);
    setMets((m) => ({ ...m, [name]: r.ok ? r : { ok: false, error: r.error } }));
    if (r.ok) setVms((v) => ({ ...v, [name]: { ...(v[name] || {}), weekHours: r.weekHours } }));
  }, []);

  const reload = useCallback(async () => {
    const l = await window.cs.list();
    setAccounts(l);
    for (const a of l) await check(a.Name);   // em sequência, para não abrir vários ssh de uma vez
  }, [check]);

  useEffect(() => { reload(); }, [reload]);

  // estado das VMs pela API a cada 60 s (nao acorda a VM)
  const accRef = useRef([]);
  accRef.current = accounts || [];
  useEffect(() => {
    const t = setInterval(async () => { for (const a of accRef.current) await check(a.Name, true); }, 60000);
    return () => clearInterval(t);
  }, [check]);

  // recursos a cada 30 s, so das contas com terminal aberto no app
  const openNames = [...new Set(panes.map((p) => p.name))].join('|');
  useEffect(() => {
    const names = openNames ? openNames.split('|') : [];
    if (!names.length) return undefined;
    const run = async () => { for (const n of names) await loadMetrics(n); };
    const first = setTimeout(run, 4000);
    const t = setInterval(run, 30000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [openNames, loadMetrics]);

  // relogios na tela
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const stopVm = async (name) => {
    setPanes((p) => p.filter((x) => x.name !== name));
    const r = await window.cs.stop(name);
    if (r.ok) showToast(r.note || 'Encerrado');
    else showToast(r.error || 'Falhou', 'err');
    await check(name);
  };

  const embed = (acc, o) => {
    const mode = o.mode || acc.Mode;
    setPanes((p) => [...p, { key: ++paneSeq, name: acc.Name, mode: o.mode, command: o.command, label: o.label || MODES[mode] || mode }]);
    setTab('term');
  };
  const reorderPanes = (fromKey, toKey) => setPanes((p) => {
    const a = p.findIndex((x) => x.key === fromKey);
    const b = p.findIndex((x) => x.key === toKey);
    if (a < 0 || b < 0 || a === b) return p;
    const n = p.slice();
    const [m] = n.splice(a, 1);
    n.splice(b, 0, m);
    return n;
  });
  const closePane = (key) => {
    setPanes((p) => p.filter((x) => x.key !== key));
    reload();
  };

  return (
    <div className="shell">
      <header className="bar">
        <div className="brand">
          <span className="logo" aria-hidden="true"><svg viewBox="0 0 64 64" width="26" height="26"><rect x="4" y="6" width="56" height="15" rx="5" fill="#4285F4" /><rect x="4" y="24.5" width="56" height="15" rx="5" fill="#EA4335" /><rect x="4" y="43" width="56" height="15" rx="5" fill="#34A853" /><g fill="#fff"><circle cx="14" cy="13.5" r="3" /><circle cx="14" cy="32" r="3" /><circle cx="14" cy="50.5" r="3" /></g><g fill="#fff" opacity=".75"><rect x="24" y="12" width="22" height="3.4" rx="1.7" /><rect x="24" y="30.3" width="22" height="3.4" rx="1.7" /><rect x="24" y="48.8" width="22" height="3.4" rx="1.7" /></g></svg></span>
          <h1>Cloud Shell Hub</h1>
        </div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'contas'} className={tab === 'contas' ? 'on' : ''} onClick={() => setTab('contas')}>Contas</button>
          <button role="tab" aria-selected={tab === 'proj'} className={tab === 'proj' ? 'on' : ''} onClick={() => setTab('proj')}>Projetos</button>
          <button role="tab" aria-selected={tab === 'term'} className={tab === 'term' ? 'on' : ''} onClick={() => setTab('term')}>
            Terminais{panes.length ? <span className="count">{panes.length}</span> : null}
          </button>
        </nav>
        <div className="topbtns">
          {tab === 'contas' && <>
            <button className="round" onClick={toggleAll} aria-pressed={hideAll} aria-label={hideAll ? 'Mostrar e-mails' : 'Ocultar e-mails'} title={hideAll ? 'Mostrar e-mails' : 'Ocultar e-mails'}>{hideAll ? <Eye /> : <EyeOff />}</button>
            <button className="round" onClick={() => window.cs.webShell()} aria-label="Abrir o Cloud Shell no navegador" title="Abrir o Cloud Shell no navegador"><Globe /></button>
            <button className="round" onClick={reload} aria-label="Verificar todas as contas" title="Verificar todas as contas"><Refresh /></button>
          </>}
          <button className={`round${help ? ' on' : ''}`} onClick={() => setHelp(help ? null : tab)} aria-label="Ajuda desta aba" title="Ajuda desta aba" aria-expanded={!!help}><b style={{ fontSize: 17, fontWeight: 600 }}>?</b></button>
          <button className="round" onClick={() => setTheme(nextTheme[theme])} aria-label={themeLabel} title={themeLabel}>{theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Auto />}</button>
          <button className={`round${settingsOpen ? ' on' : ''}`} onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Configurações" title="Configurações" aria-expanded={settingsOpen}><Gear /></button>
          <button className={`round${notesOpen ? ' on' : ''}`} onClick={() => setNotesOpen(!notesOpen)} aria-label="Avisos e erros" title="Avisos e erros" aria-expanded={notesOpen}>
            <Bell />
            {notes.length > 0 && <span className="bellbadge">{notes.length}</span>}
          </button>
          <button className="primary" onClick={() => setAdding(true)}>+ Adicionar conta</button>
        </div>
      </header>
      {settingsOpen && <SettingsPop onClose={() => setSettingsOpen(false)} />}
      {notesOpen && <NotesPanel notes={notes} onDismiss={dismissNote} onClear={clearNotes} onClose={() => setNotesOpen(false)} toast={showToast} />}

      <div className="page" hidden={tab !== 'contas'}>
        <div className="pagehead">
          <h2>Contas</h2>
          <p>Quem está livre para receber trabalho agora, com cota do Gemini e horas de VM.</p>
        </div>
        {accounts && accounts.length > 0 && (() => {
          const bl = accounts.map((a) => blockers(a, states[a.Name], vms[a.Name], quotas[a.Name]));
          const nFree = bl.filter((b) => b.length === 0).length;
          const nPc = bl.filter((b) => b.some((x) => x.t === 'pc')).length;
          const nOn = accounts.filter((a) => states[a.Name] === 'on').length;
          const nLow = bl.filter((b) => b.some((x) => x.t === 'cota' || x.t === 'horas')).length;
          return (
            <div className="summary">
              <div className="tile ok"><span className="ti"><i /></span><div><b>{nFree}</b><span>Livres para a nuvem</span></div></div>
              <div className="tile blue"><span className="ti"><i /></span><div><b>{nPc}</b><span>Em uso no PC</span></div></div>
              <div className="tile warn"><span className="ti"><i /></span><div><b>{nOn}</b><span>VMs ativas</span></div></div>
              <div className="tile bad"><span className="ti"><i /></span><div><b>{nLow}</b><span>Sem cota ou sem horas</span></div></div>
            </div>
          );
        })()}
        <SkillCard toast={showToast} />
        {accounts === null && <p className="muted pad">Carregando…</p>}

        {accounts && accounts.length === 0 && (
          <section className="emptystate">
            <h2>Nenhuma conta ainda</h2>
            <p>Adicione a primeira conta Google. O login é feito pelo navegador, pelo próprio gcloud.</p>
            <button className="primary" onClick={() => setAdding(true)}>+ Adicionar conta</button>
          </section>
        )}

        <main className="grid">
          {accounts && accounts.map((a) => (
            <Card key={a.Name} acc={a} blocks={blockers(a, states[a.Name], vms[a.Name], quotas[a.Name])} state={states[a.Name] || 'check'} vm={vms[a.Name]} met={mets[a.Name]} quota={quotas[a.Name]} onQuota={loadQuota} onChanged={reload} onCheck={check} toast={showToast} onEmbed={embed} onStop={stopVm} onMetrics={loadMetrics} showEmail={showEmail(a.Name)} onToggleEmail={() => toggleEmail(a.Name)} onRenamed={renamed} />
          ))}
        </main>
      </div>

      <div className="page" hidden={tab !== 'proj'}>
        <Projects accounts={accounts || []} vms={vms} onEmbed={embed} toast={showToast} />
      </div>

      <div className="wswrap" hidden={tab !== 'term'}>
        <Workspace panes={panes} mets={mets} onClose={closePane} onReorder={reorderPanes} onGoAccounts={() => setTab('contas')} />
      </div>

      <AskHost />
      {help && <Help topic={help} onClose={() => setHelp(null)} />}
      {adding && <AddDialog onClose={() => setAdding(false)} onDone={reload} onBatch={() => { setAdding(false); setBatch(true); }} toast={showToast} />}
      {batch && <BatchDialog accounts={accounts} onClose={() => setBatch(false)} onDone={reload} toast={showToast} />}
      {toast && toast.note && (
        <div className={`toast ${toast.kind}`} role="alert">
          <span className="ticon" aria-hidden="true">!</span>
          <div className="tbody">
            <div className="ttitle">{toast.note.title}</div>
            <div className="ttext">{toast.note.text}</div>
            <div className="tcode">Código {toast.note.code}</div>
            <div className="tacts"><button onClick={() => { closeToast(); setNotesOpen(true); }}>Ver detalhes</button></div>
          </div>
          <button className="xbtn" aria-label="Fechar aviso" onClick={closeToast}><X /></button>
        </div>
      )}
      {toast && !toast.note && (
        <div className={`toast ${toast.kind}`} role="status">
          <span className="ticon" aria-hidden="true">✓</span>
          <div className="tbody"><div className="ttext" style={{ marginTop: 0 }}>{toast.msg}</div></div>
          <button className="xbtn" aria-label="Fechar" onClick={closeToast}><X /></button>
        </div>
      )}
    </div>
  );
}
