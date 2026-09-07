import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { BrokerDb, Imovel, VendaCheckin, Visita } from "../types";
import {
  COMISSAO_VENDA_PADRAO_PCT,
  comissaoTotalConfirmada,
  tituloImovel,
  valorComissaoVenda,
  vgvTotalConfirmado,
} from "../types";
import {
  clienteAgendaLabel,
  formatBrlFull,
  maskBrlWhole,
  parseBrlNumber,
} from "../utils";
import { todayISODate } from "../lib/datetimeAgenda";
import { resolveSaleOwner } from "../lib/brokerWorkflow";

type Props = {
  db: BrokerDb;
  setDb: Dispatch<SetStateAction<BrokerDb>>;
  currentUserId: string;
};
type Tab = "acompanhamento" | "fechamentos" | "comissoes";
type Draft = { notas: string; proposta: string };

const brDate = (iso?: string) => {
  if (!iso) return "Sem data";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

function propertyById(db: BrokerDb, id: number): Imovel | undefined {
  return db.imoveis.find((item) => item.id === id);
}

function clientIdFromVisit(db: BrokerDb, visit: Visita): number | undefined {
  if (visit.clienteId != null) return visit.clienteId;
  return db.clientes.find(
    (client) => clienteAgendaLabel(client) === visit.cliente.trim(),
  )?.id;
}

export function PosVisitaPanel({ db, setDb, currentUserId }: Props) {
  const sales = db.vendasCheckin ?? [];
  const [tab, setTab] = useState<Tab>("acompanhamento");
  const [openVisitId, setOpenVisitId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [search, setSearch] = useState("");
  const [visitId, setVisitId] = useState<number | "">("");
  const [propertyId, setPropertyId] = useState<number | "">("");
  const [saleValue, setSaleValue] = useState("");
  const [saleDate, setSaleDate] = useState(todayISODate());
  const [buyer, setBuyer] = useState("");

  const soldVisitIds = useMemo(
    () =>
      new Set(sales.map((sale) => sale.visitaId).filter((id) => id != null)),
    [sales],
  );
  const soldPropertyIds = useMemo(
    () => new Set(sales.map((sale) => sale.imovelId)),
    [sales],
  );

  const followUps = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...db.visitas]
      .filter(
        (visit) =>
          (visit.funilEstado === "realizada" ||
            visit.funilEstado === "proposta") &&
          !soldVisitIds.has(visit.id),
      )
      .filter((visit) => {
        if (!term) return true;
        const property =
          visit.imovelId != null ? propertyById(db, visit.imovelId) : undefined;
        return `${visit.cliente} ${visit.notasVisita ?? ""} ${visit.propostaVisita ?? ""} ${property ? tituloImovel(property) : ""}`
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) =>
        `${b.data ?? ""}${b.hora}`.localeCompare(`${a.data ?? ""}${a.hora}`),
      );
  }, [db, search, soldVisitIds]);

  const eligibleVisits = useMemo(
    () =>
      [...db.visitas]
        .filter(
          (visit) =>
            (visit.funilEstado === "realizada" ||
              visit.funilEstado === "proposta") &&
            !soldVisitIds.has(visit.id),
        )
        .sort((a, b) =>
          `${b.data ?? ""}${b.hora}`.localeCompare(`${a.data ?? ""}${a.hora}`),
        ),
    [db.visitas, soldVisitIds],
  );

  const selectedVisit =
    visitId === ""
      ? null
      : (db.visitas.find((visit) => visit.id === visitId) ?? null);
  const availableProperties = useMemo(
    () =>
      db.imoveis.filter(
        (property) =>
          property.disponivel !== false && !soldPropertyIds.has(property.id),
      ),
    [db.imoveis, soldPropertyIds],
  );
  const pendingSales = sales.filter((sale) => sale.vendaConfirmada === false);
  const confirmedSales = sales.filter((sale) => sale.vendaConfirmada !== false);
  const vgv = vgvTotalConfirmado(sales);
  const commission = comissaoTotalConfirmada(sales);
  const pendingCommission = pendingSales.reduce(
    (sum, sale) => sum + valorComissaoVenda(sale),
    0,
  );
  const pendingVgv = pendingSales.reduce(
    (sum, sale) => sum + sale.valorVenda,
    0,
  );
  const proposals = followUps.filter(
    (visit) => visit.funilEstado === "proposta",
  ).length;
  const sortedSales = [...sales].sort(
    (a, b) => b.dataCheckin.localeCompare(a.dataCheckin) || b.id - a.id,
  );

  const draftFor = (visit: Visita): Draft =>
    drafts[visit.id] ?? {
      notas: visit.notasVisita ?? "",
      proposta: visit.propostaVisita ?? "",
    };
  const updateDraft = (visit: Visita, patch: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [visit.id]: { ...draftFor(visit), ...patch },
    }));

  const saveFollowUp = (visit: Visita, stage: "realizada" | "proposta") => {
    const draft = draftFor(visit);
    if (stage === "proposta" && !draft.proposta.trim()) {
      alert("Descreva as condições da proposta antes de avançar.");
      return;
    }
    setDb((current) => ({
      ...current,
      visitas: current.visitas.map((item) =>
        item.id === visit.id
          ? {
              ...item,
              funilEstado: stage,
              notasVisita: draft.notas.trim() || undefined,
              propostaVisita: draft.proposta.trim() || undefined,
            }
          : item,
      ),
    }));
    setDrafts((current) => {
      const next = { ...current };
      delete next[visit.id];
      return next;
    });
    setOpenVisitId(null);
  };

  const cancelVisit = (visit: Visita) => {
    if (
      !confirm("Cancelar esta visita? O cliente continuará disponível no CRM.")
    )
      return;
    setDb((current) => ({
      ...current,
      visitas: current.visitas.map((item) =>
        item.id === visit.id ? { ...item, funilEstado: "cancelada" } : item,
      ),
    }));
    setOpenVisitId(null);
  };

  const selectVisit = (raw: string) => {
    if (!raw) {
      setVisitId("");
      setPropertyId("");
      setSaleValue("");
      setBuyer("");
      return;
    }
    const id = Number(raw);
    const visit = db.visitas.find((item) => item.id === id);
    if (!visit) return;
    setVisitId(id);
    setBuyer((visit.cliente.split("(")[0] ?? visit.cliente).trim());
    if (visit.imovelId != null) {
      const property = propertyById(db, visit.imovelId);
      setPropertyId(visit.imovelId);
      setSaleValue(property?.preco ? maskBrlWhole(property.preco) : "");
    } else {
      setPropertyId("");
      setSaleValue("");
    }
  };

  const prepareSaleFromVisit = (visit: Visita) => {
    const draft = draftFor(visit);
    setDb((current) => ({
      ...current,
      visitas: current.visitas.map((item) =>
        item.id === visit.id
          ? {
              ...item,
              funilEstado: draft.proposta.trim() ? "proposta" : item.funilEstado,
              notasVisita: draft.notas.trim() || item.notasVisita,
              propostaVisita: draft.proposta.trim() || item.propostaVisita,
            }
          : item,
      ),
    }));
    setTab("fechamentos");
    selectVisit(String(visit.id));
  };

  const createSale = () => {
    if (!selectedVisit) {
      alert("Selecione uma visita realizada ou com proposta.");
      return;
    }
    const finalPropertyId =
      propertyId === "" ? selectedVisit.imovelId : Number(propertyId);
    if (finalPropertyId == null || !Number.isFinite(finalPropertyId)) {
      alert("Selecione o imóvel negociado.");
      return;
    }
    if (soldPropertyIds.has(finalPropertyId)) {
      alert("Este imóvel já possui um fechamento registrado.");
      return;
    }
    const value = parseBrlNumber(saleValue);
    if (value <= 0) {
      alert("Informe o valor final da venda.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
      alert("Informe uma data válida.");
      return;
    }
    const sale: VendaCheckin = {
      id: Date.now(),
      imovelId: finalPropertyId,
      valorVenda: value,
      comissaoPct: COMISSAO_VENDA_PADRAO_PCT,
      dataCheckin: saleDate,
      comprador: buyer.trim() || undefined,
      clienteId: clientIdFromVisit(db, selectedVisit),
      visitaId: selectedVisit.id,
      vendaConfirmada: false,
      ownerUserId: resolveSaleOwner(selectedVisit, currentUserId),
    };
    setDb((current) => ({
      ...current,
      vendasCheckin: [...(current.vendasCheckin ?? []), sale],
    }));
    setVisitId("");
    setPropertyId("");
    setSaleValue("");
    setBuyer("");
  };

  const confirmSale = (id: number) => {
    if (!confirm("Confirmar no VGV e retirar o imóvel dos disponíveis?"))
      return;
    setDb((current) => {
      const sale = (current.vendasCheckin ?? []).find((item) => item.id === id);
      return {
        ...current,
        vendasCheckin: (current.vendasCheckin ?? []).map((item) =>
          item.id === id ? { ...item, vendaConfirmada: true } : item,
        ),
        imoveis: sale
          ? current.imoveis.map((property) =>
              property.id === sale.imovelId
                ? { ...property, disponivel: false }
                : property,
            )
          : current.imoveis,
      };
    });
  };

  const deleteSale = (id: number) => {
    if (
      !confirm(
        "Excluir este fechamento e recalcular a disponibilidade do imóvel?",
      )
    )
      return;
    setDb((current) => {
      const removed = (current.vendasCheckin ?? []).find(
        (item) => item.id === id,
      );
      const vendasCheckin = (current.vendasCheckin ?? []).filter(
        (item) => item.id !== id,
      );
      const stillSold = removed
        ? vendasCheckin.some(
            (item) =>
              item.imovelId === removed.imovelId &&
              item.vendaConfirmada !== false,
          )
        : false;
      return {
        ...current,
        vendasCheckin,
        imoveis:
          removed && !stillSold
            ? current.imoveis.map((property) =>
                property.id === removed.imovelId
                  ? { ...property, disponivel: true }
                  : property,
              )
            : current.imoveis,
      };
    });
  };

  return (
    <section className="space-y-6" aria-labelledby="business-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-400">
          Operações comerciais
        </p>
        <h2
          id="business-title"
          className="text-3xl sm:text-4xl font-black tracking-tight mt-1"
        >
          Negócios
        </h2>
        <p className="text-sm text-gray-500 dark:text-neutral-400 mt-2 max-w-2xl">
          Da visita à comissão: acompanhe, proponha e feche sem repetir
          informações.
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <button
          onClick={() => setTab("acompanhamento")}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">Aguardando retorno</span>
          <strong className="crm-metric-value text-amber-600">
            {followUps.length}
          </strong>
          <small>{proposals} em proposta</small>
        </button>
        <button
          onClick={() => setTab("fechamentos")}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">Vendas pendentes</span>
          <strong className="crm-metric-value text-blue-600">
            {pendingSales.length}
          </strong>
          <small>{formatBrlFull(pendingVgv)} para confirmar</small>
        </button>
        <button
          onClick={() => setTab("fechamentos")}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">VGV confirmado</span>
          <strong className="block text-xl sm:text-2xl font-black text-emerald-600 mt-3 truncate">
            {formatBrlFull(vgv)}
          </strong>
          <small>{confirmedSales.length} venda(s)</small>
        </button>
        <button
          onClick={() => setTab("comissoes")}
          className="crm-metric-card text-left"
        >
          <span className="crm-metric-label">Comissão</span>
          <strong className="block text-xl sm:text-2xl font-black text-violet-600 mt-3 truncate">
            {formatBrlFull(commission)}
          </strong>
          <small>{formatBrlFull(pendingCommission)} pendente</small>
        </button>
      </div>

      <div
        className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1"
        role="tablist"
      >
        {(
          [
            ["acompanhamento", "1. Acompanhamento"],
            ["fechamentos", "2. Fechamentos"],
            ["comissoes", "3. Comissões"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`shrink-0 flex-1 min-w-[145px] min-h-[44px] rounded-lg px-4 text-xs font-black ${tab === id ? "bg-brand-dark text-brand-gold dark:bg-neutral-800" : "text-gray-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "acompanhamento" ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h3 className="font-black text-lg">Retorno das visitas</h3>
              <p className="text-xs text-gray-500">
                Use rascunho e salve apenas quando terminar.
              </p>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente ou imóvel"
              className="crm-field sm:max-w-xs"
            />
          </div>
          {followUps.length === 0 ? (
            <p className="crm-empty">
              Nenhuma visita aguardando acompanhamento.
            </p>
          ) : (
            <div className="grid xl:grid-cols-2 gap-3">
              {followUps.map((visit) => {
                const open = openVisitId === visit.id;
                const draft = draftFor(visit);
                const property =
                  visit.imovelId != null
                    ? propertyById(db, visit.imovelId)
                    : undefined;
                return (
                  <article
                    key={visit.id}
                    className="crm-panel !p-0 overflow-hidden"
                  >
                    <button
                      onClick={() => setOpenVisitId(open ? null : visit.id)}
                      className="w-full p-4 flex items-start justify-between gap-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex gap-2 items-center flex-wrap">
                          <strong className="truncate">{visit.cliente}</strong>
                          <span
                            className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase ${visit.funilEstado === "proposta" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700"}`}
                          >
                            {visit.funilEstado === "proposta"
                              ? "Proposta"
                              : "Pós-visita"}
                          </span>
                        </span>
                        <small className="block text-gray-400 mt-1">
                          {brDate(visit.data)} às {visit.hora}
                          {property ? ` · ${tituloImovel(property)}` : ""}
                        </small>
                      </span>
                      <span className="text-xl text-gray-400">
                        {open ? "−" : "+"}
                      </span>
                    </button>
                    {open ? (
                      <div className="border-t border-gray-100 dark:border-neutral-800 p-4 space-y-3">
                        <div>
                          <label className="crm-field-label">
                            Como foi a visita
                          </label>
                          <textarea
                            className="crm-field"
                            rows={4}
                            value={draft.notas}
                            onChange={(e) =>
                              updateDraft(visit, { notas: e.target.value })
                            }
                            placeholder="Interesse, objeções e próximo passo…"
                          />
                        </div>
                        <div>
                          <label className="crm-field-label">
                            Proposta concreta
                          </label>
                          <textarea
                            className="crm-field"
                            rows={4}
                            value={draft.proposta}
                            onChange={(e) =>
                              updateDraft(visit, { proposta: e.target.value })
                            }
                            placeholder="Valor, entrada, prazo e condições…"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => saveFollowUp(visit, "realizada")}
                            className="business-button bg-amber-500 text-white"
                          >
                            Salvar retorno
                          </button>
                          <button
                            onClick={() => saveFollowUp(visit, "proposta")}
                            className="business-button bg-violet-600 text-white"
                          >
                            Avançar proposta
                          </button>
                          <button
                            onClick={() => prepareSaleFromVisit(visit)}
                            className="business-button bg-emerald-600 text-white"
                          >
                            Registrar venda
                          </button>
                          <button
                            onClick={() => cancelVisit(visit)}
                            className="business-button ml-auto text-red-500"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === "fechamentos" ? (
        <div className="grid xl:grid-cols-[minmax(340px,.85fr)_minmax(0,1.4fr)] gap-5 items-start">
          <div className="crm-panel space-y-4 xl:sticky xl:top-6">
            <div>
              <h3 className="font-black text-lg">Registrar fechamento</h3>
              <p className="text-xs text-gray-500">
                Os dados são puxados da visita automaticamente.
              </p>
            </div>
            <div>
              <label className="crm-field-label">
                Visita realizada / proposta
              </label>
              <select
                value={visitId}
                onChange={(e) => selectVisit(e.target.value)}
                className="crm-field"
              >
                <option value="">Selecione…</option>
                {eligibleVisits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {brDate(visit.data)} · {visit.cliente.slice(0, 45)}
                  </option>
                ))}
              </select>
            </div>
            {selectedVisit ? (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs">
                <strong className="text-emerald-700">
                  Oportunidade vinculada
                </strong>
                <span className="block mt-1">{selectedVisit.cliente}</span>
              </div>
            ) : null}
            <div>
              <label className="crm-field-label">Imóvel</label>
              <select
                disabled={!selectedVisit}
                value={propertyId}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : "";
                  setPropertyId(id);
                  const property =
                    typeof id === "number" ? propertyById(db, id) : undefined;
                  setSaleValue(
                    property?.preco ? maskBrlWhole(property.preco) : "",
                  );
                }}
                className="crm-field disabled:opacity-50"
              >
                <option value="">Selecione…</option>
                {availableProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {tituloImovel(property)} · {formatBrlFull(property.preco)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="crm-field-label">Comprador</label>
              <input
                disabled={!selectedVisit}
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
                className="crm-field disabled:opacity-50"
              />
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-1 gap-3">
              <div>
                <label className="crm-field-label">Valor final</label>
                <input
                  disabled={!selectedVisit}
                  inputMode="numeric"
                  value={saleValue}
                  onChange={(e) => setSaleValue(maskBrlWhole(e.target.value))}
                  placeholder="R$ 850.000"
                  className="crm-field disabled:opacity-50"
                />
              </div>
              <div>
                <label className="crm-field-label">Data</label>
                <input
                  disabled={!selectedVisit}
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="crm-field disabled:opacity-50"
                />
              </div>
            </div>
            <div className="rounded-xl bg-violet-50 dark:bg-violet-950/20 p-3 text-xs text-violet-700">
              Comissão prevista:{" "}
              <strong>
                {formatBrlFull(
                  (parseBrlNumber(saleValue) * COMISSAO_VENDA_PADRAO_PCT) / 100,
                )}
              </strong>
            </div>
            <button
              disabled={!selectedVisit}
              onClick={createSale}
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-40"
            >
              Registrar venda pendente
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="font-black text-lg">Fechamentos</h3>
              <p className="text-xs text-gray-500">
                Confirme para incluir no VGV e retirar o imóvel dos disponíveis.
              </p>
            </div>
            {sortedSales.length === 0 ? (
              <p className="crm-empty">Nenhuma venda registrada.</p>
            ) : (
              sortedSales.map((sale) => {
                const property = propertyById(db, sale.imovelId);
                const confirmed = sale.vendaConfirmada !== false;
                return (
                  <article
                    key={sale.id}
                    className="crm-panel flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex gap-2 flex-wrap">
                        <strong>
                          {property
                            ? tituloImovel(property)
                            : `Imóvel #${sale.imovelId}`}
                        </strong>
                        <span
                          className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase ${confirmed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                        >
                          {confirmed ? "Confirmada" : "Pendente"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {brDate(sale.dataCheckin)}
                        {sale.comprador ? ` · ${sale.comprador}` : ""}
                      </p>
                      <p className="text-lg font-black text-emerald-600 mt-2">
                        {formatBrlFull(sale.valorVenda)}
                      </p>
                      <p className="text-xs font-bold text-violet-600">
                        Comissão: {formatBrlFull(valorComissaoVenda(sale))}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {!confirmed ? (
                        <button
                          onClick={() => confirmSale(sale.id)}
                          className="business-button bg-emerald-600 text-white"
                        >
                          Confirmar VGV
                        </button>
                      ) : null}
                      <button
                        onClick={() => deleteSale(sale.id)}
                        className="business-button text-red-500"
                      >
                        Excluir
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {tab === "comissoes" ? (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="crm-panel">
              <span className="crm-metric-label">Confirmada</span>
              <strong className="business-value text-violet-600">
                {formatBrlFull(commission)}
              </strong>
            </div>
            <div className="crm-panel">
              <span className="crm-metric-label">Pendente</span>
              <strong className="business-value text-amber-600">
                {formatBrlFull(pendingCommission)}
              </strong>
            </div>
            <div className="crm-panel">
              <span className="crm-metric-label">Taxa aplicada</span>
              <strong className="business-value">
                {COMISSAO_VENDA_PADRAO_PCT}%
              </strong>
            </div>
          </div>
          <div className="crm-panel overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead>
                <tr className="border-b text-left text-[10px] uppercase text-gray-500">
                  <th className="py-3">Data</th>
                  <th>Comprador / imóvel</th>
                  <th className="text-right">Venda</th>
                  <th className="text-right">Comissão</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="border-b border-gray-100 dark:border-neutral-800"
                  >
                    <td className="py-3">{brDate(sale.dataCheckin)}</td>
                    <td className="font-bold">
                      {sale.comprador ||
                        propertyById(db, sale.imovelId)?.endereco ||
                        `Imóvel #${sale.imovelId}`}
                    </td>
                    <td className="text-right font-bold">
                      {formatBrlFull(sale.valorVenda)}
                    </td>
                    <td className="text-right font-black text-violet-600">
                      {formatBrlFull(valorComissaoVenda(sale))}
                    </td>
                    <td
                      className={`text-right font-bold ${sale.vendaConfirmada === false ? "text-amber-600" : "text-emerald-600"}`}
                    >
                      {sale.vendaConfirmada === false
                        ? "Pendente"
                        : "Confirmada"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedSales.length === 0 ? (
              <p className="crm-empty mt-4">Nenhuma comissão calculada.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
