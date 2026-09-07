import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { BrokerDb, FunilVisita, Imovel, VendaCheckin, Visita } from '../types';
import {
  COMISSAO_VENDA_PADRAO_PCT,
  comissaoTotalConfirmada,
  tituloImovel,
  valorComissaoVenda,
  vgvTotalConfirmado,
} from '../types';
import { clienteAgendaLabel, formatBrlFull, parseBrlNumber } from '../utils';
import { todayISODate } from '../lib/datetimeAgenda';
import { googleMapsDirectionsUrl, wazeMultiUrl } from '../lib/mapsRoute';
import { downloadIcsForVisitas } from '../lib/calendarLinks';
import { resolveSaleOwner } from '../lib/brokerWorkflow';

type Props = {
  db: BrokerDb;
  setDb: Dispatch<SetStateAction<BrokerDb>>;
  onRegistrarNaAgenda: (venda: VendaCheckin, hora: string) => void;
  /** Auth user id — associa a venda ao corretor (vista Equipa). */
  currentUserId: string;
};

const FUNIL_VISITA: { value: FunilVisita; label: string }[] = [
  { value: 'agendada', label: 'Agendada' },
  { value: 'realizada', label: 'Realizada' },
  { value: 'proposta', label: 'Proposta' },
  { value: 'cancelada', label: 'Cancelada' },
];

function imovelDe(db: BrokerDb, id: number): Imovel | undefined {
  return db.imoveis.find((m) => m.id === id);
}

/** Texto único: situação, notas e proposta (para “resumo automático” da conversa). */
function resumoConversa(v: Visita): string {
  const estado =
    FUNIL_VISITA.find((f) => f.value === (v.funilEstado ?? 'agendada'))?.label ?? '—';
  const notas = (v.notasVisita ?? '').trim();
  const proposta = (v.propostaVisita ?? '').trim();
  const partes = [`Situação: ${estado}.`];
  partes.push(notas ? `Conversa: ${notas.length > 140 ? notas.slice(0, 140) + '…' : notas}.` : 'Sem notas.');
  if (proposta) partes.push(`Proposta: ${proposta.length > 120 ? proposta.slice(0, 120) + '…' : proposta}.`);
  return partes.join(' ');
}

function precoParaCampoValor(m: Imovel): string {
  const p = Number(m.preco);
  if (!Number.isFinite(p) || p <= 0) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(p);
}

export function PosVisitaPanel({ db, setDb, onRegistrarNaAgenda, currentUserId }: Props) {
  const hoje = todayISODate();
  const vendas = db.vendasCheckin ?? [];

  const [sóApartamentos, setSóApartamentos] = useState(true);
  const [imovelIdForm, setImovelIdForm] = useState<number | ''>('');
  const [valorVendaStr, setValorVendaStr] = useState('');
  const [dataCheckin, setDataCheckin] = useState(hoje);
  const [comprador, setComprador] = useState('');
  const [selVisitaId, setSelVisitaId] = useState<number | ''>('');

  const [agendaModal, setAgendaModal] = useState<VendaCheckin | null>(null);
  const [agendaHora, setAgendaHora] = useState('10:00');
  const [aba, setAba] = useState<'venda' | 'comissao'>('venda');
  const [visitaAbertaId, setVisitaAbertaId] = useState<number | null>(null);

  const imoveisVendidosIds = useMemo(() => new Set(vendas.map((v) => v.imovelId)), [vendas]);

  const apartamentosDisponiveis = useMemo(() => {
    return db.imoveis.filter((m) => {
      if (m.disponivel === false) return false;
      if (imoveisVendidosIds.has(m.id)) return false;
      if (sóApartamentos && m.tipo !== 'Apartamento') return false;
      return true;
    });
  }, [db.imoveis, imoveisVendidosIds, sóApartamentos]);

  const visitasParaVincular = useMemo(
    () =>
      [...db.visitas]
        .filter(
          (v) =>
            v.funilEstado !== 'cancelada' &&
            !vendas.some((venda) => venda.visitaId === v.id)
        )
        .sort((a, b) => {
          const da = a.data || '';
          const db_ = b.data || '';
          if (da !== db_) return db_.localeCompare(da);
          return a.hora.localeCompare(b.hora);
        }),
    [db.visitas, vendas]
  );

  const visitaSelecionada = useMemo(() => {
    if (selVisitaId === '') return null;
    return db.visitas.find((v) => v.id === selVisitaId) ?? null;
  }, [selVisitaId, db.visitas]);

  const clienteIdDaVisita = (vis: Visita): number | undefined => {
    if (vis.clienteId != null && Number.isFinite(vis.clienteId)) return vis.clienteId;
    const match = db.clientes.find((c) => clienteAgendaLabel(c) === vis.cliente.trim());
    return match?.id;
  };

  /** Pós-visita editável enquanto estiver realizada ou em proposta. */
  const visitasFollowUp = useMemo(() => {
    return [...db.visitas]
      .filter((v) => v.funilEstado === 'realizada' || v.funilEstado === 'proposta')
      .sort((a, b) => {
        const da = a.data || '';
        const db_ = b.data || '';
        if (da !== db_) return db_.localeCompare(da);
        return b.hora.localeCompare(a.hora);
      });
  }, [db.visitas]);

  const vgv = useMemo(() => vgvTotalConfirmado(vendas), [vendas]);
  const pendentesValor = useMemo(
    () =>
      vendas
        .filter((v) => v.vendaConfirmada === false)
        .reduce((s, v) => s + Math.max(0, v.valorVenda), 0),
    [vendas]
  );
  const comissaoConfirmada = useMemo(() => comissaoTotalConfirmada(vendas), [vendas]);
  const comissaoPendente = useMemo(
    () =>
      vendas
        .filter((v) => v.vendaConfirmada === false)
        .reduce((s, v) => s + valorComissaoVenda(v), 0),
    [vendas]
  );

  const previewComissaoForm = useMemo(() => {
    const v = parseBrlNumber(valorVendaStr);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return (v * COMISSAO_VENDA_PADRAO_PCT) / 100;
  }, [valorVendaStr]);

  const visitasHoje = useMemo(
    () => db.visitas.filter((v) => v.data === hoje && v.funilEstado !== 'cancelada'),
    [db.visitas, hoje]
  );
  const rotaGoogle = googleMapsDirectionsUrl(visitasHoje);
  const rotaWaze = wazeMultiUrl(visitasHoje);

  const patchVisita = (id: number, patch: Partial<Visita>) => {
    setDb((d) => ({
      ...d,
      visitas: d.visitas.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));
  };

  const salvarVenda = () => {
    if (selVisitaId === '') {
      alert('Escolha a visita na agenda — a venda fica ligada ao lead dessa visita.');
      return;
    }
    const vis = db.visitas.find((x) => x.id === selVisitaId);
    if (!vis) return;
    if (vendas.some((venda) => venda.visitaId === vis.id)) {
      alert('Esta visita já possui uma venda registrada. Remova o registro existente antes de criar outro.');
      return;
    }
    let imovelIdNum: number;
    if (imovelIdForm !== '') {
      imovelIdNum = Number(imovelIdForm);
    } else if (vis.imovelId != null && Number.isFinite(vis.imovelId)) {
      imovelIdNum = vis.imovelId;
    } else {
      alert('Escolha o imóvel vendido (esta visita não tinha imóvel na agenda).');
      return;
    }
    const valorVenda = parseBrlNumber(valorVendaStr);
    if (!Number.isFinite(valorVenda) || valorVenda <= 0) {
      alert('Indique o valor da venda.');
      return;
    }
    if (vendas.some((venda) => venda.imovelId === imovelIdNum)) {
      alert('Este imóvel já possui uma venda registrada. Verifique a lista de vendas antes de continuar.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataCheckin)) {
      alert('Data inválida.');
      return;
    }
    const cid = clienteIdDaVisita(vis);
    const novo: VendaCheckin = {
      id: Date.now(),
      imovelId: imovelIdNum,
      valorVenda,
      comissaoPct: COMISSAO_VENDA_PADRAO_PCT,
      dataCheckin,
      comprador: comprador.trim() || undefined,
      clienteId: cid,
      visitaId: Number(selVisitaId),
      vendaConfirmada: false,
      ownerUserId: resolveSaleOwner(vis, currentUserId),
    };
    setDb((d) => ({
      ...d,
      vendasCheckin: [...(d.vendasCheckin ?? []), novo],
    }));
    setImovelIdForm('');
    setValorVendaStr('');
    setComprador('');
    setSelVisitaId('');
  };

  const confirmarVendaNoVgv = (id: number) => {
    setDb((d) => {
      const venda = (d.vendasCheckin ?? []).find((x) => x.id === id);
      const vendasCheckin = (d.vendasCheckin ?? []).map((v) =>
        v.id === id ? { ...v, vendaConfirmada: true } : v
      );
      const imoveis =
        venda != null
          ? d.imoveis.map((m) =>
              m.id === venda.imovelId ? { ...m, disponivel: false } : m
            )
          : d.imoveis;
      return { ...d, vendasCheckin, imoveis };
    });
  };

  const removerVenda = (id: number) => {
    if (!confirm('Remover este registo de venda?')) return;
    setDb((d) => {
      const rem = (d.vendasCheckin ?? []).find((x) => x.id === id);
      const vendasCheckin = (d.vendasCheckin ?? []).filter((x) => x.id !== id);
      if (!rem) return { ...d, vendasCheckin };
      const aindaTemConfirmada = vendasCheckin.some(
        (x) => x.imovelId === rem.imovelId && x.vendaConfirmada !== false
      );
      const imoveis = aindaTemConfirmada
        ? d.imoveis
        : d.imoveis.map((m) =>
            m.id === rem.imovelId ? { ...m, disponivel: true } : m
          );
      return { ...d, vendasCheckin, imoveis };
    });
  };

  return (
    <section className="space-y-8 pb-4" aria-labelledby="heading-posvisita">
      <div>
        <h2
          id="heading-posvisita"
          className="text-2xl font-bold tracking-tighter italic text-brand-dark dark:text-white"
        >
          Central de <span className="text-brand-gold not-italic">negócios</span>
        </h2>
        <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
          Marque na agenda a visita como <strong className="text-brand-dark dark:text-white">Realizada</strong> para
          aparecer em “como foi”. O <strong>VGV</strong> soma só vendas confirmadas aqui — valor ao preço do imóvel ou
          valor acordado na venda, nunca o campo de estimativa do lead.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-gray-100 dark:border-neutral-800 shadow-sm col-span-2 sm:col-span-1">
          <p className="text-[9px] font-black uppercase text-gray-400 dark:text-neutral-500">VGV confirmado</p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{formatBrlFull(vgv)}</p>
          <p className="text-[10px] text-gray-400 dark:text-neutral-500 mt-1 leading-tight">
            Soma dos valores registados e confirmados (imóvel ou acordo).
          </p>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-gray-100 dark:border-neutral-800 shadow-sm">
          <p className="text-[9px] font-black uppercase text-gray-400 dark:text-neutral-500">Pendente confirmação</p>
          <p className="text-xl font-black text-amber-600 dark:text-amber-400">{formatBrlFull(pendentesValor)}</p>
        </div>
      </div>

      <div
        className="flex rounded-2xl border border-gray-200 dark:border-neutral-700 p-1 gap-1 bg-gray-50/80 dark:bg-neutral-900/50"
        role="tablist"
        aria-label="Secções: venda e comissão"
      >
        <button
          type="button"
          role="tab"
          id="tab-pos-venda"
          aria-selected={aba === 'venda'}
          aria-controls="panel-pos-venda"
          onClick={() => setAba('venda')}
          className={`flex-1 min-h-[48px] py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${
            aba === 'venda'
              ? 'bg-white dark:bg-neutral-800 text-brand-dark dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-neutral-400'
          }`}
        >
          Venda
        </button>
        <button
          type="button"
          role="tab"
          id="tab-pos-comissao"
          aria-selected={aba === 'comissao'}
          aria-controls="panel-pos-comissao"
          onClick={() => setAba('comissao')}
          className={`flex-1 min-h-[48px] py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${
            aba === 'comissao'
              ? 'bg-white dark:bg-neutral-800 text-brand-dark dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-neutral-400'
          }`}
        >
          Comissão ({COMISSAO_VENDA_PADRAO_PCT}%)
        </button>
      </div>

      {aba === 'venda' ? (
        <div id="panel-pos-venda" role="tabpanel" aria-labelledby="tab-pos-venda" className="space-y-8">
      <div className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/25 dark:to-neutral-900 rounded-[2rem] p-6 border border-emerald-200/60 dark:border-emerald-800/40 space-y-4">
        <h3 className="font-bold text-brand-dark dark:text-white">Nova venda (entra no VGV após confirmar)</h3>
        <p className="text-[11px] text-gray-500 dark:text-neutral-400">
          Escolha <strong className="text-brand-dark dark:text-white">uma visita da agenda</strong> — o lead, o imóvel
          (se já estiver na visita) e o valor sugerido vêm daí. Ajuste só o valor se for negócio diferente do preço de
          tabela.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
              Visita na agenda (obrigatório)
            </label>
            <select
              value={selVisitaId === '' ? '' : String(selVisitaId)}
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                  setSelVisitaId('');
                  setImovelIdForm('');
                  setValorVendaStr('');
                  setComprador('');
                  return;
                }
                const id = Number(raw);
                const vis = db.visitas.find((x) => x.id === id);
                if (!vis) return;
                setSelVisitaId(id);
                if (vis.imovelId != null && Number.isFinite(vis.imovelId)) {
                  setImovelIdForm(vis.imovelId);
                  const im = imovelDe(db, vis.imovelId);
                  if (im) setValorVendaStr(precoParaCampoValor(im));
                } else {
                  setImovelIdForm('');
                  setValorVendaStr('');
                }
                const nomeCurto = (vis.cliente.split('(')[0] ?? vis.cliente).trim();
                setComprador(nomeCurto);
              }}
              className="w-full mt-1 p-4 rounded-2xl bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-700 font-semibold outline-none min-h-[48px]"
            >
              <option value="">Escolha data/hora e lead…</option>
              {visitasParaVincular.map((v) => (
                <option key={v.id} value={v.id}>
                  {(v.data ?? '')} {v.hora} · {v.cliente.slice(0, 42)}
                  {v.cliente.length > 42 ? '…' : ''}
                </option>
              ))}
            </select>
          </div>

          {visitaSelecionada ? (
            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-800/50 bg-white/80 dark:bg-neutral-900/80 px-4 py-3 space-y-2 text-sm">
              <p className="text-[10px] font-black uppercase text-emerald-800 dark:text-emerald-200 tracking-wide">
                Dados da visita (agenda → lead)
              </p>
              <p className="text-brand-dark dark:text-white">
                <span className="text-gray-500 dark:text-neutral-400 font-semibold">Lead:</span>{' '}
                {visitaSelecionada.cliente}
              </p>
              {comprador ? (
                <p className="text-xs text-gray-600 dark:text-neutral-300">
                  <span className="text-gray-500 font-semibold">Comprador (nome curto):</span> {comprador}
                </p>
              ) : null}
              {visitaSelecionada.imovelId != null && imovelDe(db, visitaSelecionada.imovelId) ? (
                <p className="text-xs text-gray-700 dark:text-neutral-200">
                  <span className="text-gray-500 font-semibold">Imóvel na agenda:</span>{' '}
                  {tituloImovel(imovelDe(db, visitaSelecionada.imovelId)!)}
                </p>
              ) : (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Esta visita não tem imóvel ligado na agenda — escolha o imóvel vendido abaixo.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {visitaSelecionada && (visitaSelecionada.imovelId == null || !Number.isFinite(visitaSelecionada.imovelId)) ? (
          <>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={sóApartamentos}
                onChange={(e) => setSóApartamentos(e.target.checked)}
                className="rounded border-gray-300 text-hz-green focus:ring-hz-green"
              />
              Só apartamentos na lista (desmarque para casas)
            </label>
            <div>
              <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
                Imóvel vendido
              </label>
              <select
                value={imovelIdForm === '' ? '' : String(imovelIdForm)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw) {
                    setImovelIdForm('');
                    setValorVendaStr('');
                    return;
                  }
                  const id = Number(raw);
                  setImovelIdForm(id);
                  const m = db.imoveis.find((x) => x.id === id);
                  if (m) setValorVendaStr(precoParaCampoValor(m));
                }}
                className="w-full mt-1 p-4 rounded-2xl bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-700 font-semibold outline-none min-h-[48px]"
              >
                <option value="">Selecione…</option>
                {apartamentosDisponiveis.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.tipo === 'Apartamento' ? '🏢' : '🏠'} {tituloImovel(m)} — {formatBrlFull(m.preco)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
              Valor da venda (R$) — imóvel ou acordado
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={valorVendaStr}
              onChange={(e) => {
                const value = parseBrlNumber(e.target.value);
                setValorVendaStr(
                  value > 0
                    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value)
                    : ''
                );
              }}
              placeholder="Vem do imóvel; altere só se o valor acordado for outro"
              className="w-full mt-1 p-4 rounded-2xl bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-700 font-bold outline-none min-h-[48px]"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
              Data do fecho / check-in
            </label>
            <input
              type="date"
              value={dataCheckin}
              onChange={(e) => setDataCheckin(e.target.value)}
              className="w-full mt-1 p-4 rounded-2xl bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-700 font-bold outline-none min-h-[48px]"
            />
          </div>
        </div>
        <p className="text-[11px] text-violet-800 dark:text-violet-200 bg-violet-50 dark:bg-violet-950/30 rounded-xl px-3 py-2 border border-violet-200/60 dark:border-violet-800/50">
          Comissão estimada ({COMISSAO_VENDA_PADRAO_PCT}% sobre o valor acima):{' '}
          <strong>{formatBrlFull(previewComissaoForm)}</strong>
        </p>
        <p className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3 border border-amber-200/60">
          Esta venda fica <strong>pendente</strong> até tocar em <strong>Confirmar no VGV</strong> na lista abaixo; ao
          confirmar, o imóvel sai da vitrine.
        </p>
        <button
          type="button"
          onClick={salvarVenda}
          className="w-full py-4 rounded-2xl bg-hz-green text-white font-black text-sm uppercase tracking-widest shadow-lg"
        >
          Registar venda (pendente)
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="font-bold text-brand-dark dark:text-white">Vendas e confirmação no VGV</h3>
        {vendas.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-neutral-400 py-6 text-center border border-dashed border-gray-200 dark:border-neutral-700 rounded-2xl">
            Ainda não há vendas registadas.
          </p>
        ) : (
          <ul className="space-y-3">
            {[...vendas]
              .sort((a, b) => b.dataCheckin.localeCompare(a.dataCheckin) || b.id - a.id)
              .map((v) => {
                const im = imovelDe(db, v.imovelId);
                const confirmada = v.vendaConfirmada !== false;
                return (
                  <li
                    key={v.id}
                    className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-gray-100 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-sm text-brand-dark dark:text-white truncate">
                        {im ? tituloImovel(im) : `Imóvel #${v.imovelId}`}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                        {v.dataCheckin}
                        {v.comprador ? ` · ${v.comprador}` : ''}
                      </p>
                      <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                        {formatBrlFull(v.valorVenda)}
                        {confirmada ? (
                          <span className="ml-2 text-emerald-600">· no VGV</span>
                        ) : (
                          <span className="ml-2 text-amber-600">· pendente</span>
                        )}
                      </p>
                      <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 mt-1">
                        Comissão {COMISSAO_VENDA_PADRAO_PCT}%: {formatBrlFull(valorComissaoVenda(v))}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {!confirmada ? (
                        <button
                          type="button"
                          onClick={() => confirmarVendaNoVgv(v.id)}
                          className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black"
                        >
                          Confirmar no VGV
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setAgendaModal(v);
                          setAgendaHora('10:00');
                        }}
                        className="px-4 py-2.5 rounded-xl bg-brand-gold text-white text-xs font-black"
                      >
                        Na agenda
                      </button>
                      <button
                        type="button"
                        onClick={() => removerVenda(v.id)}
                        className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-neutral-600 text-xs font-bold text-red-500 dark:text-red-400"
                      >
                        Apagar
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-[2rem] p-6 border border-gray-100 dark:border-neutral-800 space-y-4">
        <h3 className="font-bold text-brand-dark dark:text-white">Visitas — como foi</h3>
        <p className="text-[11px] text-gray-500 dark:text-neutral-400">
          As visitas realizadas permanecem aqui para você salvar e reabrir quando quiser. Registre separadamente como
          foi a visita e as condições da proposta. O fechamento pertence à venda/VGV.
        </p>
        {visitasFollowUp.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center border border-dashed rounded-2xl">
            Nenhuma visita nesta fase. Marque uma visita como <strong>Realizada</strong> na Agenda.
          </p>
        ) : (
          <ul className="space-y-2 max-h-[min(520px,60vh)] overflow-y-auto pr-1">
            {visitasFollowUp.map((v) => {
              const aberta = visitaAbertaId === v.id;
              return (
                <li
                  key={v.id}
                  className="rounded-2xl border border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-800/30 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setVisitaAbertaId(aberta ? null : v.id)}
                    className="w-full p-4 flex items-center justify-between gap-3 text-left"
                    aria-expanded={aberta}
                  >
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-brand-dark dark:text-white truncate">{v.cliente}</span>
                      <span className="block text-[11px] text-gray-500 mt-0.5">
                        {(v.data ?? '')} {v.hora} · {v.funilEstado === 'proposta' ? 'Proposta' : 'Realizada'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {(v.notasVisita ?? '').trim() ? <span className="text-emerald-600 text-xs">✓ notas</span> : null}
                      {(v.propostaVisita ?? '').trim() ? <span className="text-brand-gold text-xs">✓ proposta</span> : null}
                      <span className="text-gray-400 text-lg" aria-hidden>{aberta ? '−' : '+'}</span>
                    </span>
                  </button>
                  {aberta ? (
                    <div className="border-t border-gray-100 dark:border-neutral-700 p-4 space-y-2">
                      <p className="text-xs text-gray-600 dark:text-neutral-300 bg-white/60 dark:bg-neutral-900/40 rounded-lg p-2.5 border border-gray-100 dark:border-neutral-700 leading-snug">
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">Resumo: </span>
                        {resumoConversa(v)}
                      </p>
                      <label className="text-[9px] font-black uppercase text-gray-400">Como foi a visita</label>
                      <textarea
                        value={v.notasVisita ?? ''}
                        onChange={(e) => patchVisita(v.id, { notasVisita: e.target.value || undefined })}
                        placeholder="Ex.: cliente gostou da localização e pediu uma segunda visita…"
                        rows={3}
                        className="w-full p-3 rounded-xl bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-700 text-sm resize-y min-h-[72px]"
                      />
                      <label className="text-[9px] font-black uppercase text-gray-400">Proposta</label>
                      <textarea
                        value={v.propostaVisita ?? ''}
                        onChange={(e) => patchVisita(v.id, { propostaVisita: e.target.value || undefined })}
                        placeholder="Ex.: R$ 780.000, entrada de R$ 200.000 e saldo financiado…"
                        rows={3}
                        className="w-full p-3 rounded-xl bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-700 text-sm resize-y min-h-[72px]"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            patchVisita(v.id, { funilEstado: 'realizada' });
                            setVisitaAbertaId(null);
                          }}
                          className="min-h-[44px] rounded-xl bg-emerald-600 text-white text-xs font-black"
                        >
                          Salvar realizada
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            patchVisita(v.id, { funilEstado: 'proposta' });
                            setVisitaAbertaId(null);
                          }}
                          className="min-h-[44px] rounded-xl bg-brand-gold text-white text-xs font-black"
                        >
                          Marcar proposta
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            patchVisita(v.id, { funilEstado: 'cancelada' });
                            setVisitaAbertaId(null);
                          }}
                          className="min-h-[44px] rounded-xl border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-black"
                        >
                          Cancelar visita
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

        </div>
      ) : (
        <div
          id="panel-pos-comissao"
          role="tabpanel"
          aria-labelledby="tab-pos-comissao"
          className="space-y-6"
        >
          <p className="text-[11px] text-gray-500 dark:text-neutral-400">
            Comissão de <strong>{COMISSAO_VENDA_PADRAO_PCT}%</strong> calculada sobre o valor de venda (preço do imóvel),
            independentemente do orçamento do lead no CRM.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-gray-100 dark:border-neutral-800 shadow-sm">
              <p className="text-[9px] font-black uppercase text-gray-400 dark:text-neutral-500">Comissão confirmada</p>
              <p className="text-2xl font-black text-violet-600 dark:text-violet-400">
                {formatBrlFull(comissaoConfirmada)}
              </p>
            </div>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-gray-100 dark:border-neutral-800 shadow-sm">
              <p className="text-[9px] font-black uppercase text-gray-400 dark:text-neutral-500">Comissão pendente</p>
              <p className="text-xl font-black text-amber-600 dark:text-amber-400">
                {formatBrlFull(comissaoPendente)}
              </p>
            </div>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-[2rem] p-6 border border-gray-100 dark:border-neutral-800 space-y-3">
            <h3 className="font-bold text-brand-dark dark:text-white">Por registo de venda</h3>
            {vendas.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-neutral-400 py-6 text-center border border-dashed border-gray-200 dark:border-neutral-700 rounded-2xl">
                Ainda não há vendas.
              </p>
            ) : (
              <ul className="space-y-3 max-h-[min(480px,55vh)] overflow-y-auto pr-1">
                {[...vendas]
                  .sort((a, b) => b.dataCheckin.localeCompare(a.dataCheckin) || b.id - a.id)
                  .map((v) => {
                    const im = imovelDe(db, v.imovelId);
                    const confirmada = v.vendaConfirmada !== false;
                    return (
                      <li
                        key={v.id}
                        className="rounded-2xl border border-violet-100 dark:border-violet-900/40 p-4 bg-violet-50/30 dark:bg-violet-950/10"
                      >
                        <p className="font-bold text-sm text-brand-dark dark:text-white">
                          {im ? tituloImovel(im) : `Imóvel #${v.imovelId}`}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                          {v.dataCheckin}
                          {confirmada ? (
                            <span className="text-emerald-600 dark:text-emerald-400"> · confirmada</span>
                          ) : (
                            <span className="text-amber-600"> · pendente confirmação VGV</span>
                          )}
                        </p>
                        <p className="text-xs mt-2">
                          <span className="text-gray-500 dark:text-neutral-400">Valor venda: </span>
                          <span className="font-bold text-emerald-700 dark:text-emerald-300">
                            {formatBrlFull(v.valorVenda)}
                          </span>
                        </p>
                        <p className="text-sm font-black text-violet-700 dark:text-violet-300 mt-1">
                          Comissão {COMISSAO_VENDA_PADRAO_PCT}%: {formatBrlFull(valorComissaoVenda(v))}
                        </p>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      )}

      {agendaModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center modal-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-agenda-venda-titulo"
        >
          <div className="bg-white dark:bg-neutral-900 rounded-t-3xl max-w-md w-full p-6 shadow-2xl dark:text-white border border-gray-100 dark:border-neutral-800">
            <h4 id="modal-agenda-venda-titulo" className="font-black text-lg mb-2">
              Colocar na agenda
            </h4>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mb-4">
              Compromisso no dia do check-in com o imóvel e o valor no nome.
            </p>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Hora</label>
            <input
              type="time"
              value={agendaHora}
              onChange={(e) => setAgendaHora(e.target.value)}
              className="w-full mt-1 mb-4 p-3 rounded-xl bg-gray-50 dark:bg-neutral-800 border-0 font-bold"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAgendaModal(null)}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-neutral-600 text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onRegistrarNaAgenda(agendaModal, agendaHora);
                  setAgendaModal(null);
                }}
                className="flex-1 py-3 rounded-xl bg-brand-dark text-brand-gold text-xs font-black"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="bg-white dark:bg-neutral-900 rounded-[2rem] p-6 border border-gray-100 dark:border-neutral-800 space-y-3"
        aria-labelledby="heading-roteiro-hoje"
      >
        <h3 id="heading-roteiro-hoje" className="font-bold text-brand-dark dark:text-white">
          Roteiro de hoje
        </h3>
        <p className="text-xs text-gray-500 dark:text-neutral-400" role="status">
          {visitasHoje.length} visita{visitasHoje.length === 1 ? '' : 's'} hoje.
        </p>
        <div className="flex flex-wrap gap-2">
          {rotaGoogle ? (
            <a
              href={rotaGoogle}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold"
            >
              Google Maps
            </a>
          ) : (
            <span className="text-xs text-gray-400 py-2">Sem rota para hoje (falta local nos cartões)</span>
          )}
          {rotaWaze ? (
            <a
              href={rotaWaze}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-3 rounded-xl bg-sky-500 text-white text-xs font-bold"
            >
              Waze
            </a>
          ) : null}
          <button
            type="button"
            onClick={() =>
              downloadIcsForVisitas(
                [...visitasHoje].sort((a, b) => a.hora.localeCompare(b.hora)),
                `visitas-${hoje}`
              )
            }
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-3 rounded-xl border border-gray-200 dark:border-neutral-600 text-xs font-bold dark:text-white"
          >
            Descarregar .ics (hoje)
          </button>
        </div>
      </div>
    </section>
  );
}
