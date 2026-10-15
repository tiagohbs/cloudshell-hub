import React, { useCallback, useEffect, useState } from 'react';
import { ask } from './ask.jsx';

const outsideHome = (d) => !!d && d.trim().startsWith('/');

function DirField({ value, onChange, placeholder }) {
  return (
    <label>Pasta no Cloud Shell <span className="hint">opcional</span>
      <input value={value} onChange={onChange} placeholder={placeholder} spellCheck={false} />
      {outsideHome(value)
        ? <span className="warnline">Fora da pasta pessoal (~): o Cloud Shell apaga isso quando a VM reinicia. Prefira algo dentro de ~.</span>
        : <span className="hint">Use ~ para a pasta pessoal, por exemplo ~/dev/{'<projeto>'}. A mesma pasta vale para todas as contas.</span>}
    </label>
  );
}

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', 'release', '.git', '.cache', '.vite', '.turbo', '.next', 'coverage', '.DS_Store', 'Thumbs.db'];
const DEFAULT_SECRETS = ['.env', '.env.*', '*-keys.json', 'secrets.json', '*.pem', 'id_rsa*', 'id_ed25519*'];

function MirrorFields({ f, set, name }) {
  return (
    <fieldset className="mirrorset">
      <legend>Espelho do PC (cópia direta, sem Git)</legend>
      <label>Pasta do projeto no PC
        <input value={f.local} onChange={set('local')} placeholder="C:\Users\voce\Documents\meu-projeto" spellCheck={false} />
      </label>
      <div className="row2">
        <label>Espelho na nuvem
          <input value={f.mirror} onChange={set('mirror')} placeholder={`~/espelho/${name}`} spellCheck={false} />
        </label>
        <label>Resultados no PC (fora do projeto)
          <input value={f.results} onChange={set('results')} placeholder={`${f.local || 'C:\\...'}-nuvem`} spellCheck={false} />
        </label>
      </div>
      <div className="row2">
        <label>Não enviar (um por linha)
          <textarea rows={5} value={f.exclude} onChange={set('exclude')} spellCheck={false} />
        </label>
        <label>Segredos: nunca enviar por padrão
          <textarea rows={5} value={f.secrets} onChange={set('secrets')} spellCheck={false} />
        </label>
      </div>
    </fieldset>
  );
}

function EditProject({ proj, onClose, onDone, toast }) {
  const M = proj.Mirror || {};
  const [f, setF] = useState({
    dir: proj.Dir, base: proj.Base,
    local: M.local || '', mirror: M.mirror || '', results: M.results || '',
    exclude: (M.exclude || []).join('\n'), secrets: (M.secrets || []).join('\n')
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await window.proj.update(proj.Name, {
      dir: f.dir, base: f.base,
      mirror: { LocalDir: f.local, MirrorDir: f.mirror, ResultsDir: f.results, Exclude: f.exclude, Secrets: f.secrets }
    });
    setBusy(false);
    if (r.ok) { toast('Projeto atualizado'); onDone(); onClose(); } else toast(r.error, 'err');
  };
  const moved = f.dir.trim().replace(/\/+$/, '') !== proj.Dir;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Editar {proj.Name}</h2>
        <DirField value={f.dir} onChange={set('dir')} placeholder={`~/projetos/${proj.Name}`} />
        <label>Branch principal
          <input required value={f.base} onChange={set('base')} />
        </label>
        <MirrorFields f={f} set={set} name={proj.Name} />
        {moved && <p className="note">Mudar a pasta não move os clones que já existem: nas contas já preparadas, use <b>Preparar</b> de novo para clonar no novo lugar. A pasta antiga continua lá até você apagá-la.</p>}
        <div className="actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={busy}>Salvar</button>
        </div>
      </form>
    </div>
  );
}

function AddProject({ onClose, onDone, toast }) {
  const [f, setF] = useState({ name: '', repo: '', base: 'main', dir: '', local: '', mirror: '', results: '', exclude: DEFAULT_EXCLUDE.join('\n'), secrets: DEFAULT_SECRETS.join('\n') });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onRepo = (e) => {
    const repo = e.target.value;
    const m = repo.trim().match(/\/([\w.-]+?)(?:\.git)?\/?$/);
    setF((x) => ({ ...x, repo, name: x.name || (m ? m[1] : '') }));
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await window.proj.add({
      name: f.name, repo: f.repo, base: f.base, dir: f.dir,
      mirror: { LocalDir: f.local, MirrorDir: f.mirror, ResultsDir: f.results, Exclude: f.exclude, Secrets: f.secrets }
    });
    setBusy(false);
    if (r.ok) { toast('Projeto adicionado'); onDone(); onClose(); } else toast(r.error, 'err');
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Adicionar projeto</h2>
        <p className="hint" style={{ margin: 0 }}>Preencha o Git e, se quiser enviar a pasta direto do PC para a nuvem, o espelho abaixo. O espelho pode ficar em branco e ser configurado depois em Editar projeto.</p>
        <label>Repositório Git
          <input autoFocus required value={f.repo} onChange={onRepo} placeholder="https://github.com/usuario/projeto" />
        </label>
        <div className="row2">
          <label>Nome da pasta
            <input required value={f.name} onChange={set('name')} placeholder="projeto" />
          </label>
          <label>Branch principal
            <input required value={f.base} onChange={set('base')} />
          </label>
        </div>
        <DirField value={f.dir} onChange={set('dir')} placeholder={`~/projetos/${f.name || 'nome'}`} />
        <MirrorFields f={f} set={set} name={f.name || 'nome'} />
        <p className="note">Cada conta clona o repositório em <span className="mono">{f.dir.trim() || `~/projetos/${f.name || 'nome'}`}</span> e trabalha no próprio branch, <span className="mono">agente/&lt;conta&gt;</span>. Para juntar o trabalho no {f.base || 'main'}, use pull requests.</p>
        <div className="actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={busy}>Adicionar</button>
        </div>
      </form>
    </div>
  );
}

function describe(st) {
  if (!st) return { text: '—', tone: 'muted' };
  if (st.loading) return { text: st.loading, tone: 'muted' };
  if (st.asleep) return { text: 'VM suspensa', tone: 'muted' };
  if (!st.ok) return { text: st.error || 'Erro', tone: 'bad' };
  if (!st.cloned) return { text: 'Ainda não preparado', tone: 'muted' };
  const bits = [];
  if (st.branch !== st.expected) bits.push(`no branch ${st.branch}`);
  bits.push(st.dirty ? `${st.dirty} alteração${st.dirty > 1 ? 'ões' : ''} sem salvar` : 'tudo salvo');
  if (st.base) {
    if (st.base.ahead) bits.push(`${st.base.ahead} commit${st.base.ahead > 1 ? 's' : ''} à frente do main`);
    if (st.base.behind) bits.push(`${st.base.behind} atrás do main`);
  }
  if (!st.remote) bits.push('ainda não enviado');
  else if (st.remote.ahead) bits.push(`${st.remote.ahead} não enviado${st.remote.ahead > 1 ? 's' : ''}`);
  const tone = st.dirty || (st.base && st.base.behind) || !st.remote || (st.remote && st.remote.ahead) ? 'warn' : 'ok';
  return { text: bits.join(' · '), tone };
}

function ProjectCard({ proj, accounts, vms, onEmbed, toast, onRemoved }) {
  const [editing, setEditing] = useState(false);
  const [st, setSt] = useState({});
  const [busy, setBusy] = useState({});
  const setRow = (n, v) => setSt((s) => ({ ...s, [n]: v }));
  const mark = (n, v) => setBusy((b) => ({ ...b, [n]: v }));

  const refresh = useCallback(async (name) => {
    setRow(name, { loading: 'Verificando…' });
    setRow(name, await window.proj.status(proj.Name, name));
  }, [proj.Name]);

  // ao abrir, verifica so as contas com VM ativa (nao acorda VMs suspensas)
  const running = accounts.filter((a) => vms[a.Name] && vms[a.Name].state === 'RUNNING').map((a) => a.Name).join('|');
  useEffect(() => {
    (async () => { for (const n of running ? running.split('|') : []) await refresh(n); })();
  }, [running, refresh]);

  const act = async (name, label, fn, okMsg) => {
    mark(name, label);
    setRow(name, { loading: label });
    const r = await fn();
    mark(name, '');
    if (r && r.ok) { if (okMsg) toast(okMsg); await refresh(name); }
    else { setRow(name, { ok: false, error: (r && r.error) || 'Falhou', kind: r && r.kind }); toast((r && r.error) || 'Falhou', 'err'); }
    return r;
  };

  const [mres, setMres] = useState({});
  const M = proj.Mirror || {};
  const hasMirror = !!M.local;
  const sendMirror = async (n, opts = {}) => {
    mark(n, 'Enviando do PC…');
    let r = await window.mirror.send(proj.Name, n, opts);
    if (!r.ok && r.lowMemory && (await ask({ title: 'Pouca memória na VM', text: r.error, ok: 'Enviar mesmo assim' }))) r = await window.mirror.send(proj.Name, n, { ...opts, force: true });
    mark(n, '');
    if (r.ok) {
      const mb = (r.bytes / 1048576).toFixed(1).replace('.', ',');
      const msg = `${n}: ${r.sent} arquivo(s), ${mb} MB${r.removed ? `, ${r.removed} removido(s)` : ''}${r.full ? ' (completo)' : ''}${r.withSecrets ? ' — COM segredos' : ''}`;
      setMres((m) => ({ ...m, [n]: { kind: 'sent', text: 'Enviado agora · ' + msg.split(': ')[1] } }));
      toast(msg);
    } else if (r.error) { setMres((m) => ({ ...m, [n]: { kind: 'err', text: r.error } })); toast(r.error, 'err'); }
  };
  const sendSecrets = async (n) => {
    const list = (M.secrets || []).join(', ');
    if (!(await ask({ title: `Enviar segredos para "${n}"?`, text: `${list}\n\nUse só quando a tarefa precisar de login. Os arquivos ficam na VM até você apagá-los.`, ok: 'Enviar com segredos', danger: true }))) return;
    if (!(await ask({ title: 'Confirmar envio dos segredos', text: 'Tem certeza? Os segredos vão para a nuvem.', ok: 'Sim, enviar', danger: true }))) return;
    sendMirror(n, { withSecrets: true });
  };
  const fetchMirror = async (n) => {
    mark(n, 'Trazendo resultados…');
    const r = await window.mirror.fetch(proj.Name, n);
    mark(n, '');
    if (!r.ok) { setMres((m) => ({ ...m, [n]: { kind: 'err', text: r.error } })); toast(r.error, 'err'); return; }
    if (r.none) { setMres((m) => ({ ...m, [n]: { kind: 'none', text: 'Nada mudou no espelho desde o último envio' } })); toast(`${n}: nada mudou na nuvem`); return; }
    setMres((m) => ({ ...m, [n]: { kind: 'got', dest: r.dest, text: `Trazido: ${r.added} novo(s), ${r.modified} alterado(s), ${r.deleted} apagado(s) na nuvem` } }));
    toast(`${n}: resultados em ${r.dest}`);
  };
  const mirrorPane = async (acc, kind) => {
    const r = await window.mirror.pane(proj.Name, kind);
    if (r.ok) onEmbed(acc, { command: r.command, label: `${proj.Name} · espelho · ${kind}` });
    else toast(r.error, 'err');
  };

  const setup = (n) => act(n, 'Preparando (pode acordar a VM)…', () => window.proj.setup(proj.Name, n), `${proj.Name} pronto em ${n}`);
  const sync = (n) => act(n, 'Sincronizando…', () => window.proj.sync(proj.Name, n), `${n}: trabalho salvo e enviado`);
  const openPane = async (acc, kind) => {
    const r = await window.proj.pane(proj.Name, acc.Name, kind);
    if (r.ok) onEmbed(acc, { command: r.command, label: `${proj.Name} · ${kind === 'agy' ? 'agy' : 'shell'}` });
    else toast(r.error, 'err');
  };
  const github = async (acc) => {
    const r = await window.proj.github();
    onEmbed(acc, { command: r.command, label: 'conectar GitHub' });
  };
  const setupAll = async () => { for (const a of accounts) await setup(a.Name); };
  const syncAll = async () => {
    if (!(await ask({ title: 'Sincronizar todas as contas?', text: 'Em cada uma: faz commit do que estiver pendente, traz as novidades do ' + proj.Base + ' e envia o branch do agente.', ok: 'Sincronizar' }))) return;
    for (const a of accounts) await sync(a.Name);
  };

  // ---- dados da tabela (igual ao desenho) ----
  const [last, setLast] = useState({});
  const [tasksN, setTasksN] = useState({});
  const [menu, setMenu] = useState(null);
  const loadLast = useCallback(async () => {
    const o = {};
    for (const a of accounts) o[a.Name] = await window.mirror.last(proj.Name, a.Name);
    setLast(o);
  }, [accounts, proj.Name]);
  useEffect(() => { if (hasMirror) loadLast(); }, [hasMirror, loadLast]);
  useEffect(() => {
    (async () => {
      const r = await window.cs.overview();
      if (Array.isArray(r)) setTasksN(Object.fromEntries(r.map((x) => [x.conta, x.rodando])));
    })();
  }, [running]);
  const ago = (t) => {
    if (!t) return 'nunca enviado';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 2880 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`;
  };
  const mbTxt = (b) => (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
  const liveAccounts = accounts.filter((a) => vms[a.Name] && vms[a.Name].state === 'RUNNING');
  const sendAll = async () => {
    if (!liveAccounts.length) { toast('Nenhuma VM ativa. Ligue uma conta primeiro (botão de ligar no cartão da conta).', 'warn'); return; }
    if (!(await ask({ title: 'Enviar para as contas com VM ativa?', text: `${liveAccounts.map((a) => a.Name).join('\n')}\n\nO envio é em sequência para não pesar no PC. Só envie com a árvore parada (nenhum agente editando).`, ok: 'Enviar' }))) return;
    for (const a of liveAccounts) await sendMirror(a.Name);
    loadLast();
  };
  const fetchAll = async () => {
    if (!liveAccounts.length) { toast('Nenhuma VM ativa para trazer resultados.', 'warn'); return; }
    for (const a of liveAccounts) await fetchMirror(a.Name);
    loadLast();
  };
  const Dots = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>);

  return (
    <section className="pdetail">
      <div className="pdhead">
        <div>
          <h2>{proj.Name}</h2>
          <p className="muted">{hasMirror ? 'A pasta do projeto no PC é copiada para cada VM, sem Git. O que a nuvem produz volta para uma pasta separada.' : 'Mesmo repositório em todas as contas, um branch por agente.'}</p>
          <p className="muted small mono">{proj.Repo} · {proj.Base} · {proj.Dir}{!proj.InsideHome && ' (fora de ~, apagada quando a VM reinicia)'}</p>
        </div>
        <div className="pdbtns">
          {hasMirror && <button onClick={fetchAll}>Trazer resultados</button>}
          {hasMirror && <button className="primary" onClick={sendAll}>Enviar para a nuvem</button>}
          <div className="menuwrap">
            <button className="round" aria-label="Mais ações do projeto" title="Mais ações" onClick={() => setMenu(menu === 'proj' ? null : 'proj')}><Dots /></button>
            {menu === 'proj' && (
              <div className="menu" onMouseLeave={() => setMenu(null)}>
                <button onClick={() => { setMenu(null); setEditing(true); }}>Editar projeto…</button>
                <button onClick={() => { setMenu(null); (async () => { for (const a of accounts) await refresh(a.Name); loadLast(); })(); }}>Atualizar estado</button>
                <button onClick={() => { setMenu(null); setupAll(); }}>Preparar Git em todas</button>
                <button onClick={() => { setMenu(null); syncAll(); }}>Sincronizar Git de todas</button>
                <button className="danger" onClick={async () => {
                  setMenu(null);
                  if (!(await ask({ title: `Tirar "${proj.Name}" da lista?`, text: 'Os clones nas VMs e o repositório no GitHub não são apagados.', ok: 'Tirar da lista', danger: true }))) return;
                  await window.proj.remove(proj.Name); onRemoved();
                }}>Remover da lista…</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {!hasMirror && <p className="pdir muted small">Espelho do PC desativado: defina a pasta do projeto no PC em <b>Editar</b> para enviar o trabalho sem Git.</p>}

      {hasMirror && (
        <div className="flow" aria-label="Caminho do espelho: PC, VM, resultados">
          <div className="fbox"><span className="flab blue"><i />PC · origem</span><code>{M.local}</code><small>Pasta do projeto (worktree da rodada)</small></div>
          <svg className="farrow" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          <div className="fbox"><span className="flab warn"><i />VM · espelho</span><code>{M.mirror}</code><small>Cópia incremental, só o que mudou</small></div>
          <svg className="farrow" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          <div className="fbox"><span className="flab ok"><i />PC · resultados</span><code>{M.results}</code><small>Fora do worktree, revisão manual</small></div>
        </div>
      )}

      <div className="ptab" role="table" aria-label={`Contas no projeto ${proj.Name}`}>
        <div className="ptabhead" role="row">
          <div>Conta</div><div>Último envio</div><div>Arquivos</div><div>Tamanho</div><div>Tarefas</div><div />
        </div>
        {accounts.map((a) => {
          const s = st[a.Name];
          const d = describe(s);
          const b = busy[a.Name];
          const cloned = s && s.ok && s.cloned;
          const L = last[a.Name];
          const nrun = tasksN[a.Name];
          return (
            <div className="ptabrow" role="row" key={a.Name}>
              <div className="pacc" role="cell">
                <strong>{a.Name}</strong>
                <span className={`small pgit ${d.tone}`}>{b || (hasMirror && d.text === 'Ainda não preparado' ? '' : d.text)}</span>
              </div>
              <div role="cell">{L && L.at ? ago(L.at) : 'nunca enviado'}</div>
              <div role="cell">{L && L.total ? L.total.toLocaleString('pt-BR') : '—'}</div>
              <div role="cell">{L && L.total ? mbTxt(L.bytes) : '—'}</div>
              <div role="cell"><span className={`tchip ${nrun ? 'warn' : ''}`}>{nrun ? `${nrun} rodando` : 'nenhuma'}</span></div>
              <div className="prowacts" role="cell">
                {hasMirror && <button disabled={!!b} onClick={async () => { await sendMirror(a.Name); loadLast(); }}>{b === 'Enviando do PC…' ? 'Enviando…' : 'Enviar'}</button>}
                {hasMirror && <button disabled={!!b} onClick={async () => { await fetchMirror(a.Name); loadLast(); }}>{b === 'Trazendo resultados…' ? 'Trazendo…' : 'Trazer'}</button>}
                <div className="menuwrap">
                  <button className="round" aria-label={`Mais ações de ${a.Name}`} title="Mais ações" onClick={() => setMenu(menu === a.Name ? null : a.Name)}><Dots /></button>
                  {menu === a.Name && (
                    <div className="menu" onMouseLeave={() => setMenu(null)}>
                      {hasMirror && <button onClick={() => { setMenu(null); mirrorPane(a, 'agy'); }}>agy no espelho</button>}
                      {hasMirror && <button onClick={() => { setMenu(null); mirrorPane(a, 'shell'); }}>Shell no espelho</button>}
                      {hasMirror && <button className="danger" onClick={() => { setMenu(null); sendSecrets(a.Name); }}>Enviar com segredos…</button>}
                      {!cloned && <button onClick={() => { setMenu(null); setup(a.Name); }}>Preparar Git</button>}
                      {cloned && <button onClick={() => { setMenu(null); openPane(a, 'agy'); }}>Abrir agy (Git)</button>}
                      {cloned && <button onClick={() => { setMenu(null); openPane(a, 'shell'); }}>Shell (Git)</button>}
                      {cloned && <button onClick={() => { setMenu(null); sync(a.Name); }}>Sincronizar Git</button>}
                      {cloned && <button onClick={async () => { setMenu(null); const r = await window.proj.pr(proj.Name, a.Name); if (!r.ok) toast(r.error, 'err'); }}>Abrir PR</button>}
                      <button onClick={() => { setMenu(null); github(a); }}>Conectar GitHub</button>
                    </div>
                  )}
                </div>
              </div>
              {mres[a.Name] && (
                <span className={`pmsg ${mres[a.Name].kind}`} style={{ gridColumn: '1 / -1' }}>
                  {mres[a.Name].text}
                  {mres[a.Name].dest && <>{" · "}<button className="linkish" onClick={() => window.mirror.openDir(mres[a.Name].dest)}>abrir pasta</button></>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {hasMirror && (
        <div className="pchips">
          <div className="pchipcard">
            <h4>Não enviar</h4>
            <p className="muted small">Pastas que ficam no PC</p>
            <div className="chiprow">{(M.exclude || []).map((e) => <code key={e} className="cc">{e}</code>)}</div>
          </div>
          <div className="pchipcard">
            <h4>Segredos</h4>
            <p className="muted small">Nunca vão sem autorização explícita</p>
            <div className="chiprow">{(M.secrets || []).map((e) => <code key={e} className="cc bad">{e}</code>)}</div>
          </div>
        </div>
      )}
      {editing && <EditProject proj={proj} onClose={() => setEditing(false)} onDone={onRemoved} toast={toast} />}
    </section>
  );
}

export default function Projects({ accounts, vms, onEmbed, toast }) {
  const [projects, setProjects] = useState(null);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState(null);
  const reload = useCallback(async () => setProjects(await window.proj.list()), []);
  useEffect(() => { reload(); }, [reload]);
  const list = projects || [];
  const cur = list.find((p) => p.Name === sel) || list[0];

  return (
    <>
      {projects && projects.length === 0 && (
        <section className="emptystate">
          <h2>Nenhum projeto ainda</h2>
          <p>Adicione o endereço do repositório no GitHub. Na primeira vez, use <b>Conectar GitHub</b> em cada conta para o Cloud Shell poder clonar e enviar.</p>
          <button className="primary" onClick={() => setAdding(true)}>+ Adicionar projeto</button>
        </section>
      )}

      {list.length > 0 && (
        <div className="projlayout">
          <aside className="projside">
            <div className="sidelabel">Projetos</div>
            {list.map((p) => (
              <button key={p.Name} className={`sideitem${cur && cur.Name === p.Name ? ' on' : ''}`} onClick={() => setSel(p.Name)}>
                <strong>{p.Name}</strong>
                <span>{p.Mirror && p.Mirror.local ? 'Espelho do PC' : 'Git por conta'} · {accounts.length} conta{accounts.length === 1 ? '' : 's'}</span>
              </button>
            ))}
            <button className="ghost addproj" onClick={() => setAdding(true)}>+ Adicionar projeto</button>
          </aside>
          {cur && <ProjectCard key={cur.Name + '|' + cur.Dir + '|' + cur.Base} proj={cur} accounts={accounts} vms={vms} onEmbed={onEmbed} toast={toast} onRemoved={reload} />}
        </div>
      )}

      {adding && <AddProject onClose={() => setAdding(false)} onDone={reload} toast={toast} />}
    </>
  );
}
