import type { BrokerDb, Cliente, FunilVisita, VendaCheckin, Visita } from '../types';
import { comissaoTotalConfirmada, valorComissaoVenda, vgvTotalConfirmado } from '../types';
import { todayISODate } from './datetimeAgenda';

export function ownerMatches(rowOwner: string | undefined, userId: string): boolean {
  const owner = (rowOwner ?? '').trim().toLowerCase();
  const user = userId.trim().toLowerCase();
  return Boolean(owner && user && owner === user);
}

/** O CRM é pessoal; o catálogo de imóveis pertence à imobiliária inteira. */
export function filterDbForOwner(db: BrokerDb, ownerId: string): BrokerDb {
  return {
    ...db,
    visitas: db.visitas.filter((item) => ownerMatches(item.ownerUserId, ownerId)),
    clientes: db.clientes.filter((item) => ownerMatches(item.ownerUserId, ownerId)),
    tarefas: db.tarefas.filter((item) => ownerMatches(item.ownerUserId, ownerId)),
    vendasCheckin: (db.vendasCheckin ?? []).filter((item) =>
      ownerMatches(item.ownerUserId, ownerId)
    ),
    // Imóveis são compartilhados dentro da empresa para evitar catálogos duplicados.
    imoveis: db.imoveis,
  };
}

export const VISIT_STATUS_LABEL: Record<FunilVisita, string> = {
  agendada: 'Agendada',
  realizada: 'Realizada',
  proposta: 'Proposta',
  cancelada: 'Cancelada',
};

export type ClientCrmStage =
  | 'novo'
  | 'contato'
  | 'qualificado'
  | 'visita'
  | 'pos_visita'
  | 'proposta'
  | 'venda'
  | 'perdido';

export const CRM_STAGE_LABEL: Record<ClientCrmStage, string> = {
  novo: 'Novo lead',
  contato: 'Em contato',
  qualificado: 'Qualificado',
  visita: 'Visita',
  pos_visita: 'Pós-visita',
  proposta: 'Proposta',
  venda: 'Venda',
  perdido: 'Perdido',
};

export const CRM_STAGE_DESCRIPTION: Record<ClientCrmStage, string> = {
  novo: 'Aguardando o primeiro contato',
  contato: 'Conversa iniciada; entender a necessidade',
  qualificado: 'Perfil, região e orçamento validados',
  visita: 'Visita agendada para um imóvel',
  pos_visita: 'Visita feita; registrar retorno',
  proposta: 'Condições apresentadas ao cliente',
  venda: 'Negócio registrado no VGV',
  perdido: 'Oportunidade encerrada sem venda',
};

export const CRM_STAGE_ORDER: ClientCrmStage[] = [
  'novo',
  'contato',
  'qualificado',
  'visita',
  'pos_visita',
  'proposta',
  'venda',
  'perdido',
];

function visitBelongsToClient(visita: Visita, cliente: Cliente): boolean {
  if (visita.clienteId != null) return visita.clienteId === cliente.id;
  const visitaNome = (visita.cliente.split('(')[0] ?? '').trim().toLocaleLowerCase('pt-BR');
  return Boolean(visitaNome && visitaNome === cliente.nome.trim().toLocaleLowerCase('pt-BR'));
}

/**
 * A etapa do CRM vem dos acontecimentos reais, não de um seletor manual que pode ficar desatualizado.
 * Uma visita cancelada não encerra o lead: ele volta à etapa Lead até existir nova atividade.
 */
export function getClientCrmStage(db: BrokerDb, cliente: Cliente): ClientCrmStage {
  const visitas = db.visitas.filter((visita) => visitBelongsToClient(visita, cliente));
  const visitaIds = new Set(visitas.map((visita) => visita.id));
  const vendas = db.vendasCheckin ?? [];
  if (
    vendas.some(
      (venda) =>
        venda.clienteId === cliente.id ||
        (venda.visitaId != null && visitaIds.has(venda.visitaId))
    )
  ) {
    return 'venda';
  }

  if (cliente.etapaCrmManual === 'perdido') return 'perdido';

  if (visitas.some((visita) => visita.funilEstado === 'proposta')) return 'proposta';
  if (visitas.some((visita) => visita.funilEstado === 'realizada')) return 'pos_visita';
  if (visitas.some((visita) => (visita.funilEstado ?? 'agendada') === 'agendada')) return 'visita';
  if (cliente.etapaCrmManual === 'qualificado') return 'qualificado';
  if (cliente.etapaCrmManual === 'contato') return 'contato';
  return 'novo';
}

export function getCrmStageCounts(db: BrokerDb): Record<ClientCrmStage, number> {
  const counts: Record<ClientCrmStage, number> = {
    novo: 0,
    contato: 0,
    qualificado: 0,
    visita: 0,
    pos_visita: 0,
    proposta: 0,
    venda: 0,
    perdido: 0,
  };
  for (const cliente of db.clientes) counts[getClientCrmStage(db, cliente)] += 1;
  return counts;
}

export function getBrokerSnapshot(db: BrokerDb, today = todayISODate()) {
  const vendas = db.vendasCheckin ?? [];
  const vendasPendentes = vendas.filter((v) => v.vendaConfirmada === false);
  const visitasHoje = db.visitas
    .filter((v) => v.data === today && v.funilEstado !== 'cancelada')
    .sort((a, b) => a.hora.localeCompare(b.hora));
  const visitasComVenda = new Set(vendas.map((v) => v.visitaId).filter((id) => id != null));
  const followUps = db.visitas.filter(
    (v) =>
      (v.funilEstado === 'realizada' || v.funilEstado === 'proposta') &&
      !visitasComVenda.has(v.id)
  );

  return {
    visitasHoje,
    followUps,
    leadsAtivos: db.clientes.filter((cliente) => {
      const etapa = getClientCrmStage(db, cliente);
      return etapa !== 'venda' && etapa !== 'perdido';
    }).length,
    contatosAtrasados: db.clientes.filter((cliente) => {
      const etapa = getClientCrmStage(db, cliente);
      return (
        etapa !== 'venda' &&
        etapa !== 'perdido' &&
        Boolean(cliente.proximoContatoEm && cliente.proximoContatoEm < today)
      );
    }).length,
    tarefas: db.tarefas.length,
    imoveisDisponiveis: db.imoveis.filter((m) => m.disponivel !== false).length,
    vendasPendentes: vendasPendentes.length,
    vgvConfirmado: vgvTotalConfirmado(vendas),
    comissaoConfirmada: comissaoTotalConfirmada(vendas),
    comissaoPendente: vendasPendentes.reduce((total, venda) => total + valorComissaoVenda(venda), 0),
  };
}

/** Uma venda pertence ao responsável original da visita, mesmo quando o master opera a tela. */
export function resolveSaleOwner(visita: Visita, fallbackUserId: string): string {
  return visita.ownerUserId?.trim() || fallbackUserId.trim();
}

export type TeamSalesRow = {
  uid: string;
  nome: string;
  role?: 'empresa' | 'corretor';
  count: number;
  pendingCount: number;
  vgv: number;
  commission: number;
  pendingCommission: number;
};

export type SalesTeamMember = {
  id: string;
  role: 'empresa' | 'corretor';
  nome_exibicao: string | null;
};

export function buildTeamSalesReport(vendas: VendaCheckin[], team: SalesTeamMember[]) {
  const ownerIds = new Set(team.map((member) => member.id));
  for (const venda of vendas) ownerIds.add(venda.ownerUserId?.trim() || '__sem__');

  const rows: TeamSalesRow[] = [...ownerIds].map((uid) => {
    const membro = team.find((member) => member.id === uid);
    const list = vendas.filter((venda) => (venda.ownerUserId?.trim() || '__sem__') === uid);
    const confirmadas = list.filter((venda) => venda.vendaConfirmada !== false);
    const pendentes = list.filter((venda) => venda.vendaConfirmada === false);
    return {
      uid,
      nome:
        membro?.nome_exibicao?.trim() ||
        (uid === '__sem__' ? 'Sem responsável (registros antigos)' : 'Usuário não listado'),
      role: membro?.role,
      count: confirmadas.length,
      pendingCount: pendentes.length,
      vgv: vgvTotalConfirmado(confirmadas),
      commission: comissaoTotalConfirmada(confirmadas),
      pendingCommission: pendentes.reduce((total, venda) => total + valorComissaoVenda(venda), 0),
    };
  });

  rows.sort(
    (a, b) =>
      b.commission - a.commission || b.vgv - a.vgv || a.nome.localeCompare(b.nome, 'pt-BR')
  );

  return {
    rows,
    totalVgv: rows.reduce((total, row) => total + row.vgv, 0),
    totalN: rows.reduce((total, row) => total + row.count, 0),
    totalCommission: rows.reduce((total, row) => total + row.commission, 0),
    totalPendingCommission: rows.reduce((total, row) => total + row.pendingCommission, 0),
  };
}
