import type { BrokerDb, FunilVisita, VendaCheckin, Visita } from '../types';
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
    leadsAtivos: db.clientes.length,
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
