// Codigos de erro para rastreio: CSH-<AREA>-<numero>. O codigo aparece na mensagem, no painel de avisos e no cshub.
const TABLE = [
  // contas
  [/Conta n[aã]o encontrada/i, 'CSH-CONTA-101'],
  [/E-mail inv/i, 'CSH-CONTA-102'],
  [/Apelido:/i, 'CSH-CONTA-103'],
  [/sess[aã]o tmux inv/i, 'CSH-CONTA-104'],
  [/J[aá] existe (uma )?conta/i, 'CSH-CONTA-105'],
  [/Login no gcloud/i, 'CSH-CONTA-106'],
  [/token do gcloud/i, 'CSH-CONTA-107'],
  [/gerar a chave SSH/i, 'CSH-CONTA-108'],
  // VM / API do Cloud Shell
  [/API do Cloud Shell/i, 'CSH-VM-201'],
  [/iniciar o Cloud Shell/i, 'CSH-VM-202'],
  [/n[aã]o ficou ativo/i, 'CSH-VM-203'],
  [/Endere[cç]o da VM/i, 'CSH-VM-204'],
  [/A VM n[aã]o respondeu/i, 'CSH-VM-205'],
  [/encerrar as sess/i, 'CSH-VM-206'],
  // ssh / terminal
  [/recusou a chave SSH/i, 'CSH-SSH-301'],
  [/Terminal embutido indispon/i, 'CSH-SSH-302'],
  [/Falha ao iniciar o ssh/i, 'CSH-SSH-303'],
  // projetos (Git)
  [/Projeto n[aã]o encontrado/i, 'CSH-PROJ-401'],
  [/^Nome:/i, 'CSH-PROJ-402'],
  [/Endere[cç]o do reposit/i, 'CSH-PROJ-403'],
  [/Branch base/i, 'CSH-PROJ-404'],
  [/Pasta (inv|do espelho|no PC|de resultados)|pasta de resultados|pasta escolhida|N[aã]o consegui criar a pasta/i, 'CSH-PROJ-405'],
  [/J[aá] existe um projeto/i, 'CSH-PROJ-406'],
  [/Sem acesso ao reposit/i, 'CSH-PROJ-407'],
  [/clonar o reposit/i, 'CSH-PROJ-408'],
  [/envio \(push\)/i, 'CSH-PROJ-409'],
  [/Conflito ao trazer/i, 'CSH-PROJ-410'],
  [/ainda n[aã]o foi preparado/i, 'CSH-PROJ-411'],
  [/commit falhou|buscar as novidades|trocar para o branch/i, 'CSH-PROJ-412'],
  // espelho
  [/Pouca mem[oó]ria/i, 'CSH-ESPELHO-501'],
  [/Espa[cç]o insuficiente/i, 'CSH-ESPELHO-502'],
  [/Falha ao enviar os arquivos/i, 'CSH-ESPELHO-503'],
  [/linha de base/i, 'CSH-ESPELHO-504'],
  [/espelho ainda n[aã]o existe/i, 'CSH-ESPELHO-505'],
  [/Resposta inesperada da VM/i, 'CSH-ESPELHO-506'],
  [/Falha ao trazer/i, 'CSH-ESPELHO-507'],
  [/Fora do projeto|Caminho com/i, 'CSH-ESPELHO-508'],
  [/Defina a pasta do projeto no PC/i, 'CSH-ESPELHO-509'],
  // tarefas
  [/est[aá] reservada/i, 'CSH-TAREFA-601'],
  [/j[aá] usou/i, 'CSH-TAREFA-602'],
  [/cota do agy nesta conta/i, 'CSH-TAREFA-603'],
  [/medir a cota antes/i, 'CSH-TAREFA-604'],
  [/Cota insuficiente/i, 'CSH-TAREFA-605'],
  [/tarefa est[aá] vazia/i, 'CSH-TAREFA-606'],
  [/Modelo inv|Esfor[cç]o deve/i, 'CSH-TAREFA-607'],
  [/espelho ainda n[aã]o foi enviado/i, 'CSH-TAREFA-608'],
  [/agy n[aã]o est[aá] dispon/i, 'CSH-TAREFA-609'],
  [/gravar a tarefa/i, 'CSH-TAREFA-610'],
  [/agy n[aã]o iniciou/i, 'CSH-TAREFA-611'],
  [/ID de tarefa/i, 'CSH-TAREFA-612'],
  [/Tarefa n[aã]o encontrada/i, 'CSH-TAREFA-613'],
  [/agy parou/i, 'CSH-TAREFA-614'],
  [/Ainda rodando/i, 'CSH-TAREFA-615'],
  [/conex[aã]o caiu/i, 'CSH-TAREFA-616'],
  [/Nao consegui cancelar|N[aã]o consegui cancelar/i, 'CSH-TAREFA-617'],
  // cota
  [/ler o \/usage/i, 'CSH-COTA-701'],
  [/painel \/usage/i, 'CSH-COTA-702'],
  // skill e app
  [/arquivo da skill/i, 'CSH-SKILL-801'],
  [/c[oó]pia n[aã]o bateu/i, 'CSH-SKILL-802'],
  [/Pasta n[aã]o encontrada/i, 'CSH-APP-901']
];
const GERAL = 'CSH-GERAL-900';
const codeFor = (msg) => { const s = String(msg || ''); for (const [re, c] of TABLE) if (re.test(s)) return c; return GERAL; };
// poe o codigo em um resultado de erro ({ok:false,error}) sem mexer nos demais
function tag(r) {
  if (r && typeof r === 'object' && typeof r.error === 'string' && r.ok !== true) {
    if (!r.code) r.code = codeFor(r.error);
    if (!/\(c[oó]digo CSH-/.test(r.error)) r.error = `${r.error} (código ${r.code})`;
  }
  return r;
}
module.exports = { codeFor, tag, TABLE, GERAL };
