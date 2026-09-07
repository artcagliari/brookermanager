import { useMemo } from "react";
import type { BrokerDb } from "../types";
import {
  CRM_STAGE_DESCRIPTION,
  CRM_STAGE_LABEL,
  CRM_STAGE_ORDER,
  getBrokerSnapshot,
  getClientCrmStage,
  getCrmStageCounts,
} from "../lib/brokerWorkflow";
import { formatBrlFull } from "../utils";
import { todayISODate } from "../lib/datetimeAgenda";

type Props = {
  db: BrokerDb;
  nome: string;
  onOpenCrm: () => void;
  onOpenAgenda: () => void;
  onOpenNegocios: () => void;
  onNewLead: () => void;
  onNewVisit: () => void;
  onNewProperty: () => void;
};

export function CrmDashboard({
  db,
  nome,
  onOpenCrm,
  onOpenAgenda,
  onOpenNegocios,
  onNewLead,
  onNewVisit,
  onNewProperty,
}: Props) {
  const snapshot = useMemo(() => getBrokerSnapshot(db), [db]);
  const counts = useMemo(() => getCrmStageCounts(db), [db]);
  const contatosPendentes = useMemo(
    () =>
      db.clientes
        .filter((cliente) => {
          const stage = getClientCrmStage(db, cliente);
          return (
            stage !== "venda" &&
            stage !== "perdido" &&
            Boolean(
              cliente.proximoContatoEm &&
                cliente.proximoContatoEm <= todayISODate(),
            )
          );
        })
        .sort((a, b) =>
          (a.proximoContatoEm ?? "").localeCompare(b.proximoContatoEm ?? ""),
        )
        .slice(0, 5),
    [db],
  );

  return (
    <section className="space-y-6" aria-labelledby="dashboard-title">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-hz-green dark:text-emerald-400 uppercase tracking-[0.18em]">
            Visão geral
          </p>
          <h2
            id="dashboard-title"
            className="text-3xl sm:text-4xl font-black tracking-tight text-hz-ink dark:text-white mt-1"
          >
            Bom trabalho, {nome || "corretor"}.
          </h2>
          <p className="text-sm text-gray-500 dark:text-neutral-400 mt-2">
            Prioridades comerciais e próximos passos em um só lugar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onNewLead}
            className="min-h-[44px] px-4 rounded-xl bg-brand-dark text-brand-gold text-xs font-black"
          >
            + Lead
          </button>
          <button
            type="button"
            onClick={onNewVisit}
            className="min-h-[44px] px-4 rounded-xl bg-hz-green text-white text-xs font-black"
          >
            + Visita
          </button>
          <button
            type="button"
            onClick={onNewProperty}
            className="min-h-[44px] px-4 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-black"
          >
            + Imóvel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={onOpenCrm}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">Oportunidades ativas</span>
          <strong className="crm-metric-value text-hz-green dark:text-emerald-400">
            {snapshot.leadsAtivos}
          </strong>
          <small>{snapshot.contatosAtrasados} contato(s) atrasado(s)</small>
        </button>
        <button
          type="button"
          onClick={onOpenAgenda}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">Agenda de hoje</span>
          <strong className="crm-metric-value text-blue-600 dark:text-blue-400">
            {snapshot.visitasHoje.length}
          </strong>
          <small>{snapshot.followUps.length} retorno(s) pendente(s)</small>
        </button>
        <button
          type="button"
          onClick={onOpenNegocios}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">VGV confirmado</span>
          <strong className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-3 truncate">
            {formatBrlFull(snapshot.vgvConfirmado)}
          </strong>
          <small>
            {snapshot.vendasPendentes} venda(s) aguardando confirmação
          </small>
        </button>
        <button
          type="button"
          onClick={onOpenNegocios}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">Comissão confirmada</span>
          <strong className="text-xl sm:text-2xl font-black text-violet-600 dark:text-violet-400 mt-3 truncate">
            {formatBrlFull(snapshot.comissaoConfirmada)}
          </strong>
          <small>{formatBrlFull(snapshot.comissaoPendente)} pendente</small>
        </button>
      </div>

      <div className="crm-panel">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-black text-hz-ink dark:text-white">
              Funil comercial
            </h3>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
              A etapa avança conforme as atividades registradas.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCrm}
            className="text-xs font-black text-hz-green dark:text-emerald-400"
          >
            Abrir CRM →
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {CRM_STAGE_ORDER.filter((stage) => stage !== "perdido").map(
            (stage) => (
              <button
                key={stage}
                type="button"
                onClick={onOpenCrm}
                className="min-w-[148px] flex-1 rounded-xl border border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800/50 p-3 text-left"
              >
                <strong className="block text-2xl text-hz-ink dark:text-white">
                  {counts[stage]}
                </strong>
                <span className="block text-[10px] font-black uppercase mt-2">
                  {CRM_STAGE_LABEL[stage]}
                </span>
                <small className="block text-[10px] text-gray-400 mt-1 leading-snug">
                  {CRM_STAGE_DESCRIPTION[stage]}
                </small>
              </button>
            ),
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="crm-panel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black">Agenda de hoje</h3>
            <button
              type="button"
              onClick={onOpenAgenda}
              className="text-xs font-black text-blue-600 dark:text-blue-400"
            >
              Ver agenda
            </button>
          </div>
          {snapshot.visitasHoje.length ? (
            <ul className="space-y-2">
              {snapshot.visitasHoje.slice(0, 5).map((visita) => (
                <li
                  key={visita.id}
                  className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-neutral-800/50 p-3"
                >
                  <span className="rounded-lg bg-brand-dark px-2.5 py-2 text-xs font-black text-brand-gold">
                    {visita.hora}
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm truncate">
                      {visita.cliente}
                    </strong>
                    <small className="block text-gray-400 truncate mt-0.5">
                      {visita.endereco || "Local pelo imóvel cadastrado"}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="crm-empty">Nenhuma visita para hoje.</p>
          )}
        </div>

        <div className="crm-panel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black">Contatos para fazer</h3>
            <button
              type="button"
              onClick={onOpenCrm}
              className="text-xs font-black text-hz-green dark:text-emerald-400"
            >
              Ver CRM
            </button>
          </div>
          {contatosPendentes.length ? (
            <ul className="space-y-2">
              {contatosPendentes.map((cliente) => (
                <li
                  key={cliente.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 dark:bg-neutral-800/50 p-3"
                >
                  <span className="min-w-0">
                    <strong className="block text-sm truncate">
                      {cliente.nome}
                    </strong>
                    <small className="text-gray-400">
                      Retorno em {cliente.proximoContatoEm}
                    </small>
                  </span>
                  <span
                    className={`text-[9px] font-black uppercase rounded-lg px-2 py-1 ${cliente.proximoContatoEm! < todayISODate() ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"}`}
                  >
                    {cliente.proximoContatoEm! < todayISODate()
                      ? "Atrasado"
                      : "Hoje"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="crm-empty">
              Nenhum contato vencido ou marcado para hoje.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
