import { useEffect, useMemo, useState } from 'react';
import { normalizeTipoImovel, primeiraFotoImovel, tituloImovel, type BrokerDb, type Imovel } from '../types';
import { formatBrlFull } from '../utils';
import { getBrokerSnapshot } from '../lib/brokerWorkflow';

const CATEGORIAS_FILTRO = ['Todos', 'Apartamento', 'Casa'] as const;

type Props = {
  db: BrokerDb;
  onToggleFavorito: (id: number) => void;
  onAbrirImovel: (i: Imovel) => void;
  onNovoImovel: () => void;
  onRemoverImovel: (id: number) => void;
  /** Abre a agenda com hora e endereço já preenchidos a partir do imóvel */
  onAgendarVisita: (i: Imovel) => void;
  onNovaVisita: () => void;
  onNovoLead: () => void;
  onAbrirAgenda: () => void;
  onAbrirCrm: () => void;
  onAbrirPosVisita: () => void;
};

export function HomeExplore({
  db,
  onToggleFavorito,
  onAbrirImovel,
  onNovoImovel,
  onRemoverImovel,
  onAgendarVisita,
  onNovaVisita,
  onNovoLead,
  onAbrirAgenda,
  onAbrirCrm,
  onAbrirPosVisita,
}: Props) {
  const imoveis = db.imoveis;
  const snapshot = useMemo(() => getBrokerSnapshot(db), [db]);
  const [q, setQ] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<(typeof CATEGORIAS_FILTRO)[number]>('Todos');
  const [sort, setSort] = useState<'preco_asc' | 'preco_desc' | 'quartos' | 'recent'>('recent');
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [detalhe, setDetalhe] = useState<Imovel | null>(null);
  const [detalheFotoI, setDetalheFotoI] = useState(0);

  useEffect(() => {
    setDetalheFotoI(0);
  }, [detalhe?.id]);

  /**
   * Se o filtro de tipo não coincide com nenhum imóvel (ex.: «Casa» com cadastro só Apartamento),
   * repõe «Todos».
   */
  useEffect(() => {
    if (tipoFiltro === 'Todos') return;
    if (imoveis.length === 0) return;
    const match = imoveis.filter((m) => normalizeTipoImovel(m.tipo) === tipoFiltro).length;
    if (match === 0) setTipoFiltro('Todos');
  }, [imoveis, tipoFiltro]);

  /** Todos os imóveis da conta no Início (inclui vendidos/indisponíveis — aparecem com distintivo). */
  const contagemTipo = useMemo(() => {
    let apt = 0;
    let casa = 0;
    for (const m of imoveis) {
      if (normalizeTipoImovel(m.tipo) === 'Casa') casa += 1;
      else apt += 1;
    }
    return { apt, casa, total: imoveis.length };
  }, [imoveis]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = imoveis.filter((m) => {
      if (tipoFiltro !== 'Todos' && normalizeTipoImovel(m.tipo) !== tipoFiltro) return false;
      if (!t) return true;
      const blob = `${m.endereco} ${tituloImovel(m)} ${m.bairro} ${m.cidade}`.toLowerCase();
      return blob.includes(t);
    });
    list = [...list];
    const vendidoRank = (m: Imovel) => (m.disponivel === false ? 1 : 0);
    if (sort === 'preco_asc')
      list.sort((a, b) => vendidoRank(a) - vendidoRank(b) || a.preco - b.preco);
    else if (sort === 'preco_desc')
      list.sort((a, b) => vendidoRank(a) - vendidoRank(b) || b.preco - a.preco);
    else if (sort === 'quartos')
      list.sort((a, b) => vendidoRank(a) - vendidoRank(b) || b.quartos - a.quartos);
    else list.sort((a, b) => vendidoRank(a) - vendidoRank(b) || b.id - a.id);
    return list;
  }, [imoveis, q, tipoFiltro, sort]);

  const favoritosCount = imoveis.filter((m) => m.favorito).length;

  const toggleCompare = (id: number) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) {
        const first = prev[0];
        return first !== undefined ? [first, id] : [id];
      }
      return [...prev, id];
    });
  };

  const imoveisCompare = useMemo(
    () => compareIds.map((id) => imoveis.find((m) => m.id === id)).filter(Boolean) as Imovel[],
    [compareIds, imoveis]
  );

  return (
    <div className="space-y-8 pb-4">
      <section className="overflow-hidden rounded-[2rem] bg-hz-ink text-white shadow-xl border border-white/5">
        <div className="p-5 sm:p-7 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-300">Operação de hoje</p>
              <h2 className="font-display text-3xl leading-tight mt-1">Seu painel de trabalho</h2>
              <p className="text-xs text-white/60 mt-1">O que precisa de atenção agora, sem misturar com o catálogo.</p>
            </div>
            <span className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold tabular-nums">
              {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button type="button" onClick={onAbrirAgenda} className="rounded-2xl bg-white/10 p-3 text-left hover:bg-white/15 transition-colors">
              <strong className="block text-2xl text-emerald-300 tabular-nums">{snapshot.visitasHoje.length}</strong>
              <span className="text-[10px] font-bold uppercase text-white/65">Visitas hoje</span>
            </button>
            <button type="button" onClick={onAbrirPosVisita} className="rounded-2xl bg-white/10 p-3 text-left hover:bg-white/15 transition-colors">
              <strong className="block text-2xl text-amber-300 tabular-nums">{snapshot.followUps.length}</strong>
              <span className="text-[10px] font-bold uppercase text-white/65">Retornos</span>
            </button>
            <button type="button" onClick={onNovoLead} className="rounded-2xl bg-white/10 p-3 text-left hover:bg-white/15 transition-colors">
              <strong className="block text-2xl text-sky-300 tabular-nums">{snapshot.leadsAtivos}</strong>
              <span className="text-[10px] font-bold uppercase text-white/65">Leads ativos</span>
            </button>
            <button type="button" onClick={onAbrirPosVisita} className="rounded-2xl bg-white/10 p-3 text-left hover:bg-white/15 transition-colors">
              <strong className="block text-2xl text-violet-300 tabular-nums">{snapshot.vendasPendentes}</strong>
              <span className="text-[10px] font-bold uppercase text-white/65">Vendas pendentes</span>
            </button>
          </div>

          {snapshot.contatosAtrasados > 0 ? (
            <button
              type="button"
              onClick={onAbrirCrm}
              className="w-full rounded-xl border border-red-300/25 bg-red-400/10 px-4 py-3 text-left text-xs text-red-100"
            >
              <strong>{snapshot.contatosAtrasados} contato{snapshot.contatosAtrasados === 1 ? '' : 's'} atrasado{snapshot.contatosAtrasados === 1 ? '' : 's'}</strong>
              <span className="block text-[10px] text-red-100/65 mt-0.5">Abra o CRM para reorganizar os retornos.</span>
            </button>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={onNovaVisita} className="min-h-[46px] rounded-xl bg-emerald-500 text-xs font-black">+ Visita</button>
            <button type="button" onClick={onNovoLead} className="min-h-[46px] rounded-xl bg-white/10 text-xs font-black">+ Lead</button>
            <button type="button" onClick={onNovoImovel} className="min-h-[46px] rounded-xl bg-white/10 text-xs font-black">+ Imóvel</button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar imóvel por endereço, bairro ou cidade…"
              className="w-full min-h-[48px] pl-11 pr-4 rounded-2xl bg-white dark:bg-neutral-900 text-hz-ink dark:text-white border border-gray-200 dark:border-neutral-700 placeholder:text-gray-400 outline-none focus:ring-2 ring-hz-green/30 text-sm font-semibold"
            />
          </div>
          <button type="button" onClick={onNovoImovel} className="min-h-[48px] px-5 rounded-2xl bg-hz-green text-white font-bold text-sm">
            + Cadastrar imóvel
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-neutral-400">
          Catálogo compartilhado com toda a imobiliária · {snapshot.imoveisDisponiveis} disponível(is)
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIAS_FILTRO.map((c) => {
          const active = tipoFiltro === c;
          const n =
            c === 'Todos'
              ? contagemTipo.total
              : c === 'Apartamento'
                ? contagemTipo.apt
                : contagemTipo.casa;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setTipoFiltro(c)}
              className={
                'px-4 py-2 rounded-full text-xs font-bold border transition-colors ' +
                (active
                  ? 'bg-hz-green text-white border-hz-green'
                  : 'bg-white dark:bg-neutral-800 text-hz-ink/70 dark:text-neutral-200 border-gray-200 dark:border-neutral-600 hover:border-hz-green/40')
              }
            >
              {c}
              <span className="ml-1.5 opacity-80 font-mono tabular-nums">({n})</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl text-hz-ink dark:text-white">Imóveis cadastrados</h3>
          <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
            {imoveis.length} na sua conta · {favoritosCount} favorito
            {favoritosCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 sr-only">
            Ordenar
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="text-xs font-bold bg-white dark:bg-neutral-800 dark:text-white border border-gray-200 dark:border-neutral-600 rounded-xl px-3 py-2 outline-none focus:ring-2 ring-hz-green/30"
          >
            <option value="recent">Mais recentes</option>
            <option value="preco_asc">Menor preço</option>
            <option value="preco_desc">Maior preço</option>
            <option value="quartos">Mais quartos</option>
          </select>
        </div>
      </div>

      {imoveis.length === 0 ? (
        <div className="rounded-[2rem] border-2 border-dashed border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 p-10 text-center">
          <p className="text-hz-ink dark:text-white font-bold text-lg mb-2">Nenhum imóvel cadastrado</p>
          <p className="text-sm text-gray-500 dark:text-neutral-400 mb-6 max-w-sm mx-auto">
            Cadastre o imóvel com endereço e fotos. Depois use
            &quot;Agendar visita&quot; para levar o imóvel direto para a agenda.
          </p>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onNovoImovel}
              className="px-6 py-3 rounded-2xl bg-hz-green text-white font-bold text-sm shadow-md"
            >
              Cadastrar primeiro imóvel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtrados.map((m) => (
            <article
              key={m.id}
              className="group bg-white dark:bg-neutral-900 rounded-[1.75rem] overflow-hidden border border-gray-100 dark:border-neutral-800 shadow-sm hover:shadow-lg transition-shadow"
            >
              <button
                type="button"
                onClick={() => setDetalhe(m)}
                className="block w-full text-left"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-neutral-800">
                  <img
                    src={
                      primeiraFotoImovel(m) ||
                      'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80'
                    }
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                    <span className="px-3 py-1 rounded-full bg-white/95 text-[10px] font-black uppercase tracking-wide text-hz-ink shadow">
                      {normalizeTipoImovel(m.tipo)}
                    </span>
                    {m.disponivel === false ? (
                      <span className="px-3 py-1 rounded-full bg-neutral-900/90 text-[10px] font-black uppercase tracking-wide text-amber-200 shadow">
                        Vendido
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorito(m.id);
                    }}
                    className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/95 flex items-center justify-center shadow text-lg"
                    aria-label={m.favorito ? 'Remover dos favoritos' : 'Favoritar'}
                  >
                    {m.favorito ? '♥' : '♡'}
                  </button>
                </div>
                <div className="p-5">
                  <h4 className="font-bold text-hz-ink dark:text-white text-lg leading-snug line-clamp-2 mb-1">
                    {tituloImovel(m)}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mb-3">
                    {m.bairro}
                    {m.cidade ? ` · ${m.cidade}` : ''}
                  </p>
                  <p className="text-lg font-black text-hz-green">{formatBrlFull(m.preco)}</p>
                  <p className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 font-semibold">
                    {m.quartos} quarto{m.quartos === 1 ? '' : 's'} · {m.banheiros} banheiro
                    {m.banheiros === 1 ? '' : 's'}
                  </p>
                </div>
              </button>
              <div className="px-5 pb-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAgendarVisita(m);
                  }}
                  className="flex-1 min-w-[8rem] py-2.5 rounded-xl bg-hz-green text-white text-xs font-bold shadow-sm"
                >
                  Agendar visita
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAbrirImovel(m);
                  }}
                  className="flex-1 min-w-[5rem] py-2.5 rounded-xl bg-hz-sand dark:bg-neutral-800 text-hz-ink dark:text-white text-xs font-bold"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCompare(m.id);
                  }}
                  className={
                    'flex-1 min-w-[6rem] py-2.5 rounded-xl text-xs font-bold border ' +
                    (compareIds.includes(m.id)
                      ? 'border-hz-green bg-emerald-50 dark:bg-emerald-950/50 text-hz-green dark:text-emerald-300'
                      : 'border-gray-200 dark:border-neutral-600 text-gray-600 dark:text-neutral-300')
                  }
                >
                  {compareIds.includes(m.id) ? 'Na comparação' : 'Comparar'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoverImovel(m.id);
                  }}
                  className="px-3 py-2.5 rounded-xl text-xs font-bold text-red-400 dark:text-red-400 border border-red-100 dark:border-red-900/50"
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {filtrados.length === 0 && imoveis.length > 0 ? (
        <div className="rounded-[1.5rem] border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/25 px-5 py-5 text-center space-y-3">
          <p className="text-sm text-amber-950 dark:text-amber-100 font-semibold leading-snug">
            {imoveis.length > 0 && tipoFiltro !== 'Todos' && contagemTipo.total > 0 ? (
              <>
                Há <strong>{contagemTipo.total === 1 ? '1 imóvel' : `${contagemTipo.total} imóveis`}</strong> na conta,
                mas <strong>nenhum é {tipoFiltro}</strong>
                {tipoFiltro === 'Casa' && contagemTipo.apt > 0 && contagemTipo.casa === 0
                  ? ' — o cadastro é Apartamento.'
                  : tipoFiltro === 'Apartamento' && contagemTipo.casa > 0 && contagemTipo.apt === 0
                    ? ' — o cadastro é Casa.'
                    : '.'}
              </>
            ) : (
              <>Nenhum resultado com a busca ou filtros actuais.</>
            )}
            {q.trim() ? (
              <span className="block text-xs font-normal text-amber-900/80 dark:text-amber-200/90 mt-1">
                Busca: &quot;{q.trim()}&quot;
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {tipoFiltro !== 'Todos' ? (
              <button
                type="button"
                onClick={() => setTipoFiltro('Todos')}
                className="min-h-[44px] px-4 rounded-xl bg-hz-green text-white text-xs font-black uppercase tracking-wide"
              >
                Ver todos ({contagemTipo.total})
              </button>
            ) : null}
            {q.trim() ? (
              <button
                type="button"
                onClick={() => setQ('')}
                className="min-h-[44px] px-4 rounded-xl border border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-100 text-xs font-bold"
              >
                Limpar busca
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {imoveisCompare.length === 2 ? (
        <div
          id="compare-panel"
          className="rounded-[2rem] border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm"
        >
          <div className="bg-hz-cream dark:bg-neutral-800 px-5 py-4 border-b border-gray-100 dark:border-neutral-700">
            <h4 className="font-display text-xl text-hz-ink dark:text-white">Comparativo rápido</h4>
            <p className="text-xs text-gray-500 dark:text-neutral-400">Lado a lado — preço, quartos e tipo</p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-neutral-700">
            {imoveisCompare.map((m) => (
              <div key={m.id} className="p-4 space-y-2 text-sm">
                <div className="aspect-[4/3] rounded-xl overflow-hidden bg-gray-100 dark:bg-neutral-800 mb-3">
                  <img
                    src={
                      primeiraFotoImovel(m) ||
                      'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=600&q=80'
                    }
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="font-bold text-hz-ink dark:text-white line-clamp-2">{tituloImovel(m)}</p>
                <p className="text-hz-green font-black">{formatBrlFull(m.preco)}</p>
                <ul className="text-xs text-gray-600 dark:text-neutral-300 space-y-1">
                  <li>{m.quartos} quarto{m.quartos === 1 ? '' : 's'}</li>
                  <li>{m.banheiros} banheiro{m.banheiros === 1 ? '' : 's'}</li>
                  <li className="text-[10px] uppercase font-bold text-gray-400 dark:text-neutral-500">
                    {normalizeTipoImovel(m.tipo)}
                  </li>
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {compareIds.length === 2 && imoveisCompare.length === 2 ? (
        <div className="fixed bottom-24 left-4 right-4 z-30 max-w-2xl mx-auto">
          <div className="bg-hz-ink text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs font-bold truncate">2 imóveis selecionados para comparar</p>
            <button
              type="button"
              onClick={() => setCompareIds([])}
              className="text-[10px] uppercase font-bold text-white/60 shrink-0"
            >
              Limpar
            </button>
            <button
              type="button"
              className="shrink-0 px-4 py-2 rounded-xl bg-emerald-500 font-bold text-xs"
              onClick={() => {
                document.getElementById('compare-panel')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Ver comparativo
            </button>
          </div>
        </div>
      ) : null}

      {detalhe ? (
        <div className="fixed inset-0 z-[60] modal-overlay flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Fechar"
            onClick={() => setDetalhe(null)}
          />
          <div className="relative bg-white dark:bg-neutral-900 w-full max-w-lg rounded-t-[2rem] sm:rounded-[2rem] max-h-[90vh] overflow-y-auto shadow-2xl dark:text-neutral-100">
            <div className="relative aspect-[16/10] bg-gray-100 dark:bg-neutral-800">
              <img
                src={
                  (detalhe.fotos.length > 0 ? detalhe.fotos[detalheFotoI] : undefined) ||
                  primeiraFotoImovel(detalhe) ||
                  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1000&q=80'
                }
                alt=""
                className="w-full h-full object-cover"
              />
              {detalhe.fotos.length > 1 ? (
                <div className="absolute bottom-3 left-3 right-3 flex gap-1.5 overflow-x-auto pb-1">
                  {detalhe.fotos.map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDetalheFotoI(i)}
                      className={
                        'shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 ' +
                        (i === detalheFotoI ? 'border-white shadow-lg' : 'border-white/40 opacity-80')
                      }
                    >
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setDetalhe(null)}
                className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/95 dark:bg-neutral-800/95 dark:text-white shadow font-bold text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-hz-cream dark:bg-neutral-800 text-[10px] font-black uppercase text-hz-green dark:text-emerald-300">
                  {normalizeTipoImovel(detalhe.tipo)}
                </span>
                {detalhe.disponivel === false ? (
                  <span className="px-3 py-1 rounded-full bg-neutral-800 text-[10px] font-black uppercase text-amber-200">
                    Vendido · fora da vitrine
                  </span>
                ) : null}
                {detalhe.favorito ? (
                  <span className="px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/60 text-[10px] font-black uppercase text-red-500">
                    Favorito
                  </span>
                ) : null}
              </div>
              <h3 className="font-display text-2xl text-hz-ink dark:text-white">{tituloImovel(detalhe)}</h3>
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                {detalhe.bairro}
                {detalhe.cidade ? ` · ${detalhe.cidade}` : ''}
              </p>
              <p className="text-2xl font-black text-hz-green">{formatBrlFull(detalhe.preco)}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-gray-50 dark:bg-neutral-800 p-4 text-sm">
                  <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-neutral-500 mb-1">
                    Quartos
                  </p>
                  <p className="font-bold text-lg dark:text-white">{detalhe.quartos}</p>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-neutral-800 p-4 text-sm">
                  <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-neutral-500 mb-1">
                    Banheiros
                  </p>
                  <p className="font-bold text-lg dark:text-white">{detalhe.banheiros}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onAgendarVisita(detalhe);
                  setDetalhe(null);
                }}
                className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-bold text-sm shadow-md"
              >
                Agendar visita (abre a agenda)
              </button>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onAbrirImovel(detalhe);
                    setDetalhe(null);
                  }}
                  className="flex-1 py-3 rounded-2xl bg-hz-sand dark:bg-neutral-800 text-hz-ink dark:text-white font-bold text-sm"
                >
                  Editar imóvel
                </button>
                <button
                  type="button"
                  onClick={() => onToggleFavorito(detalhe.id)}
                  className="px-5 py-3 rounded-2xl border border-gray-200 dark:border-neutral-600 font-bold text-sm dark:text-white"
                >
                  {detalhe.favorito ? '♥' : '♡'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
