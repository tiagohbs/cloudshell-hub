import React, { useEffect, useRef, useState } from 'react';

const TOPICS = {
  inicio: {
    nome: 'Primeiros passos',
    passos: [
      { t: 'Para que serve o app', p: 'O Cloud Shell Hub liga várias contas do Google Cloud Shell, abre terminais nelas e deixa o Maestri mandar tarefas para os agentes (agy/Gemini) que rodam na nuvem.' },
      { t: '1. Adicione suas contas', p: 'Na aba Contas, clique em "+ Adicionar conta". O app faz o login no gcloud e guarda o endereço da VM de cada conta.' },
      { t: '2. Cadastre um projeto', p: 'Na aba Projetos, clique em "+ Adicionar projeto", informe o repositório Git e, se quiser, a pasta do PC para enviar por espelho.' },
      { t: '3. Prepare e envie', p: 'No projeto, use Preparar em cada conta (clona o repositório) ou Enviar do PC (espelho). Só contas com a VM ligada recebem arquivos.' },
      { t: '4. Trabalhe', p: 'Abra um terminal pela conta (Abrir no app ou Shell) ou deixe o Maestri delegar tarefas com o comando cshub. Os terminais ficam na aba Terminais.' },
      { t: 'Esta janela', p: 'Você pode arrastar esta janela pelo título e continuar clicando no app: ela não fecha sozinha. Use o botão ? em cada aba para ver a ajuda daquela tela.' }
    ]
  },
  contas: {
    nome: 'Aba Contas',
    passos: [
      { t: 'O cartão da conta', p: 'Cada cartão mostra o estado da VM (Ativa, Suspensa…), a cota do Gemini, as horas de VM usadas na semana e o apelido da conta.' },
      { t: 'Editar o apelido', p: 'Clique no lápis ao lado do nome para trocar o apelido. O e-mail continua o mesmo; o apelido é só para você reconhecer a conta.' },
      { t: 'Ligar e desligar a VM', p: 'O botão de ligar, ao lado do endereço da VM, liga a máquina. Com ela ligada, o mesmo botão encerra agy, tmux e shells abertos na nuvem (pede confirmação).' },
      { t: 'Cota e horas', p: 'As barras mostram quanto ainda resta de cota do Gemini e de horas de VM (limite de 50 h por semana). Para medir a cota, a VM precisa estar ligada.' },
      { t: 'Bloqueios', p: 'Uma conta fica bloqueada quando está em uso no PC pelo Maestri, está sem login, sem cota do Gemini ou com menos de 3 h de VM. O motivo aparece no cartão.' },
      { t: 'Abrir no app, Shell e Boost', p: 'Abrir no app inicia o agy num terminal; Shell abre um terminal comum. Boost abre o Cloud Shell no navegador para ativar a máquina maior (24 h).' },
      { t: 'Menu ⋯', p: 'Tem Janela externa, Copiar comando, Editar conta, Atualizar endereço (use se der erro de conexão), Ver sessões tmux e Remover.' },
      { t: 'Barra do topo', p: 'Os ícones ocultam e-mails, abrem o Cloud Shell no navegador, verificam todas as contas, trocam o tema e mostram avisos e erros (sino).' },
      { t: 'Skill do Maestri', p: 'O cartão da skill mostra se a habilidade cloudshell-hub está instalada neste PC. Se não estiver, use Instalar skill e reinicie a sessão do Claude no Maestri.' }
    ]
  },
  proj: {
    nome: 'Aba Projetos',
    passos: [
      { t: 'Lista de projetos', p: 'À esquerda ficam os projetos cadastrados; ao clicar em um, os detalhes aparecem à direita.' },
      { t: 'Adicionar projeto', p: 'Informe o endereço do repositório, o nome da pasta e o branch principal. A pasta do Cloud Shell deve ficar dentro de ~ para não ser apagada quando a VM reiniciar.' },
      { t: 'Espelho do PC (opcional)', p: 'Copia a pasta do PC direto para a nuvem, sem Git. Preencha a pasta do projeto no PC; as listas Não enviar e Segredos já vêm com valores padrão.' },
      { t: 'Preparar cada conta', p: 'Preparar clona o repositório na VM e cria o branch agente/<conta>. Faça isso uma vez por conta, com a VM ligada.' },
      { t: 'Enviar do PC', p: 'Manda o que mudou no PC para o espelho da conta. Com segredos só se a tarefa precisar de login; o app pede confirmação duas vezes.' },
      { t: 'Trazer resultados', p: 'Traz para o PC o que o agente criou ou alterou, numa pasta separada fora do projeto, junto com um arquivo mudancas.txt.' },
      { t: 'Sincronizar Git', p: 'Faz commit do que estiver pendente, traz as novidades do branch principal e envia o branch do agente. Para juntar o trabalho no main, use pull requests.' },
      { t: 'Editar e remover', p: 'Editar projeto muda pastas, branch e espelho. Remover da lista não apaga os clones nas VMs nem o repositório no GitHub.' }
    ]
  },
  term: {
    nome: 'Aba Terminais',
    passos: [
      { t: 'Abrir um terminal', p: 'Terminais abertos pelo cartão da conta (Abrir no app ou Shell) aparecem aqui, lado a lado. O número na aba mostra quantos estão abertos.' },
      { t: 'Reordenar', p: 'Arraste o terminal pela barra do título (o ícone de pontos) e solte sobre outro para trocar a ordem.' },
      { t: 'Fechar um terminal', p: 'O X no canto fecha o terminal no app. Isso não para a VM: para economizar horas, use o botão de ligar/desligar no cartão da conta.' },
      { t: 'Janela externa', p: 'Abre o terminal em uma janela separada, útil para usar em outro monitor.' },
      { t: 'Muitos terminais', p: 'Quando há vários, os controles do cabeçalho encolhem para só ícones, mas o X de fechar sempre fica visível.' }
    ]
  }
};

const POS_KEY = 'cs.help.pos';
const loadPos = () => { try { const p = JSON.parse(localStorage.getItem(POS_KEY)); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p; } catch { /* ignora */ } return null; };

export default function Help({ topic: initial, onClose }) {
  const [topic, setTopic] = useState(initial);
  const [i, setI] = useState(0);
  const [pos, setPos] = useState(() => loadPos() || { x: Math.max(16, window.innerWidth - 400), y: 80 });
  const drag = useRef(null);
  const T = TOPICS[topic] || TOPICS.inicio;
  const s = T.passos[Math.min(i, T.passos.length - 1)];

  useEffect(() => { setTopic(initial); setI(0); }, [initial]);
  useEffect(() => { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignora */ } }, [pos]);

  const clamp = (x, y) => ({
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 120)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 60))
  });
  const onDown = (e) => {
    if (e.target.closest('button')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => { if (drag.current) setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy)); };
  const onUp = () => { drag.current = null; };

  return (
    <aside className="helpwin" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Ajuda">
      <div className="helphead" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title="Arraste para mover">
        <span className="helpgrip" aria-hidden="true">⠿</span>
        <strong>{T.nome}</strong>
        <span style={{ flex: 1 }} />
        <button className="xbtn" aria-label="Fechar ajuda" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="helptopics">
        {Object.entries(TOPICS).map(([k, v]) => (
          <button key={k} className={k === topic ? 'on' : ''} onClick={() => { setTopic(k); setI(0); }}>{k === 'inicio' ? 'Início' : v.nome.replace('Aba ', '')}</button>
        ))}
      </div>
      <div className="helpbody">
        <div className="helpstep">Passo {i + 1} de {T.passos.length}</div>
        <h3>{s.t}</h3>
        <p>{s.p}</p>
      </div>
      <div className="helpfoot">
        <div className="helpdots">
          {T.passos.map((_, n) => <button key={n} className={n === i ? 'on' : ''} aria-label={`Ir ao passo ${n + 1}`} onClick={() => setI(n)} />)}
        </div>
        <span style={{ flex: 1 }} />
        <button disabled={i === 0} onClick={() => setI(i - 1)}>Anterior</button>
        {i < T.passos.length - 1
          ? <button className="primary" onClick={() => setI(i + 1)}>Próximo</button>
          : <button className="primary" onClick={onClose}>Concluir</button>}
      </div>
    </aside>
  );
}
