export type FunilVisita = 'agendada' | 'realizada' | 'proposta' | 'cancelada';

export type Visita = {
  id: number;
  cliente: string;
  /** Liga ao lead em `clientes` (preenchido ao escolher o cadastro na agenda). */
  clienteId?: number;
  /** YYYY-MM-DD (recomendado para lembretes e roteiro) */
  data?: string;
  hora: string;
  endereco?: string;
  lat?: number;
  lng?: number;
  imovelId?: number;
  /** Onde está a chave (portaria, imobiliária, proprietário…) */
  chave?: string;
  funilEstado?: FunilVisita;
  /** Como foi a visita (texto livre) — preenchido na aba Pós-visita. */
  notasVisita?: string;
  /** Condições e detalhes da proposta apresentada após a visita. */
  propostaVisita?: string;
  /** Utilizador (auth) que criou o registo — visível na vista Equipa (empresa). */
  ownerUserId?: string;
};

export type UrgenciaLead = 'baixa' | 'media' | 'alta';
export type EstagioFunilCliente = 'lead';

export type Cliente = {
  id: number;
  nome: string;
  fone: string;
  /** Estimativa interna no CRM — não entra no VGV (VGV vem só de vendas confirmadas no Pós-visita). */
  valor: number;
  status: string;
  bairrosInteresse?: string;
  quartosDesejados?: number;
  orcamentoMax?: number;
  urgencia?: UrgenciaLead;
  notas?: string;
  estagioFunil?: EstagioFunilCliente;
  /** @deprecated — fecho no separador Pós-visita */
  valorNegocio?: number;
  /** @deprecated */
  comissaoPct?: number;
  /** Imóvel da base ligado ao interesse do lead */
  imovelInteresseId?: number;
  /** Data de cadastro no CRM (YYYY-MM-DD). */
  dataCadastro?: string;
  /** Utilizador que criou o lead. */
  ownerUserId?: string;
};

export type Tarefa = {
  id: number;
  txt: string;
  ownerUserId?: string;
};

export type TipoImovel = 'Casa' | 'Apartamento';

/** Garante `Casa` | `Apartamento` mesmo com dados legados ou minúsculas no JSON. */
export function normalizeTipoImovel(raw: unknown): TipoImovel {
  const u = String(raw ?? '').trim().toLowerCase();
  if (u === 'casa') return 'Casa';
  return 'Apartamento';
}

/** Percentual padrão de comissão sobre o valor de venda (cadastro do imóvel). */
export const COMISSAO_VENDA_PADRAO_PCT = 6;

export type Imovel = {
  id: number;
  endereco: string;
  bairro: string;
  cidade: string;
  preco: number;
  quartos: number;
  banheiros: number;
  tipo: TipoImovel;
  fotos: string[];
  favorito: boolean;
  /** `false` = vendido / fora da vitrine. Omisso = disponível. */
  disponivel?: boolean;
  /** Utilizador que criou o imóvel. */
  ownerUserId?: string;
};

/** Check-in de venda (imóvel da base). VGV só soma quando `vendaConfirmada === true`. */
export type VendaCheckin = {
  id: number;
  imovelId: number;
  /** Valor da venda para o VGV: preço do imóvel e/ou valor acordado — não o campo estimativa do lead. */
  valorVenda: number;
  /** Legado — ignorado na UI */
  comissaoPct?: number;
  /** Data do check-in / fechamento (YYYY-MM-DD) */
  dataCheckin: string;
  comprador?: string;
  /** Lead fechado (cadastro em Clientes) */
  clienteId?: number;
  /** Visita da agenda associada ao fecho (opcional) */
  visitaId?: number;
  /** Só entra no VGV quando explícito `true`. `false` = pendente de confirmação. Omitido = legado (conta como confirmado). */
  vendaConfirmada?: boolean;
  /** Utilizador que registou a venda. */
  ownerUserId?: string;
};

/** Reservado para preferências futuras (extensível no JSON guardado). */
export type AppSettings = Record<string, unknown>;

export type BrokerDb = {
  visitas: Visita[];
  clientes: Cliente[];
  tarefas: Tarefa[];
  imoveis: Imovel[];
  vendasCheckin?: VendaCheckin[];
  settings?: AppSettings;
};

export type AppSection =
  | 'inicio'
  | 'painel'
  | 'agenda'
  | 'clientes'
  | 'calc'
  | 'todo'
  | 'equipa';

export function tituloImovel(m: Imovel): string {
  const e = String(m.endereco ?? '').trim();
  if (e) return e;
  const kind = normalizeTipoImovel(m.tipo);
  const loc = [m.bairro, m.cidade].filter((s) => String(s).trim()).join(' · ');
  return loc ? `${kind} · ${loc}` : kind;
}

export function primeiraFotoImovel(m: Imovel): string | undefined {
  return m.fotos[0];
}

export function pctComissaoVenda(v: Pick<VendaCheckin, 'comissaoPct'>): number {
  const raw = v.comissaoPct;
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.min(100, Math.max(0, Number(raw)));
  }
  return COMISSAO_VENDA_PADRAO_PCT;
}

export function valorComissaoVenda(v: Pick<VendaCheckin, 'valorVenda' | 'comissaoPct'>): number {
  const val = Math.max(0, Number(v.valorVenda) || 0);
  const pct = pctComissaoVenda(v);
  return (val * pct) / 100;
}

/** Soma comissões (6% ou `comissaoPct`) só em vendas confirmadas. */
export function comissaoTotalConfirmada(vendas: VendaCheckin[]): number {
  return vendas
    .filter((v) => v.vendaConfirmada !== false)
    .reduce((s, v) => s + valorComissaoVenda(v), 0);
}

/** Soma valores de vendas que entram no VGV (confirmadas ou legado sem flag). */
export function vgvTotalConfirmado(vendas: VendaCheckin[]): number {
  return vendas
    .filter((v) => v.vendaConfirmada !== false)
    .reduce((s, v) => s + Math.max(0, Number(v.valorVenda) || 0), 0);
}

function mapFunilVisita(raw: unknown): FunilVisita | undefined {
  const rawValue = String(raw || '').trim();
  // Migração de dados antigos: fechamento agora pertence à venda/VGV, não à visita.
  if (rawValue === 'fechado') return 'proposta';
  const u = rawValue as FunilVisita;
  const ok: FunilVisita[] = ['agendada', 'realizada', 'proposta', 'cancelada'];
  return ok.includes(u) ? u : undefined;
}

export const emptyDb = (): BrokerDb => ({
  visitas: [],
  clientes: [],
  tarefas: [],
  imoveis: [],
  vendasCheckin: [],
  settings: {},
});

function coerceSettings(x: unknown): AppSettings {
  if (!x || typeof x !== 'object') return {};
  return { ...(x as Record<string, unknown>) };
}

function coerceVisita(x: unknown): Visita | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const imId = o.imovelId != null ? Number(o.imovelId) : undefined;
  const dataRaw = o.data != null ? String(o.data).trim() : '';
  const data = /^\d{4}-\d{2}-\d{2}$/.test(dataRaw) ? dataRaw : undefined;
  return {
    id,
    cliente: String(o.cliente ?? ''),
    data,
    hora: String(o.hora ?? ''),
    endereco: o.endereco != null && String(o.endereco).trim() ? String(o.endereco) : undefined,
    lat: o.lat != null && Number.isFinite(Number(o.lat)) ? Number(o.lat) : undefined,
    lng: o.lng != null && Number.isFinite(Number(o.lng)) ? Number(o.lng) : undefined,
    imovelId: imId != null && Number.isFinite(imId) ? imId : undefined,
    chave: o.chave != null && String(o.chave).trim() ? String(o.chave) : undefined,
    funilEstado: mapFunilVisita(o.funilEstado),
    clienteId:
      o.clienteId != null && Number.isFinite(Number(o.clienteId))
        ? Number(o.clienteId)
        : undefined,
    notasVisita:
      o.notasVisita != null && String(o.notasVisita).trim() ? String(o.notasVisita) : undefined,
    propostaVisita:
      o.propostaVisita != null && String(o.propostaVisita).trim()
        ? String(o.propostaVisita)
        : undefined,
    ownerUserId:
      o.ownerUserId != null && String(o.ownerUserId).trim()
        ? String(o.ownerUserId).trim()
        : undefined,
  };
}

function coerceImovel(x: unknown): Imovel | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const tipo = normalizeTipoImovel(o.tipo ?? 'Apartamento');
  const fotos: string[] = [];
  if (Array.isArray(o.fotos)) {
    for (const u of o.fotos) {
      const s = String(u).trim();
      if (s.startsWith('data:') || s.startsWith('http')) fotos.push(s);
    }
  }
  const leg = String(o.imagemUrl ?? '').trim();
  if (fotos.length === 0 && leg && (leg.startsWith('http') || leg.startsWith('data:'))) {
    fotos.push(leg);
  }
  return {
    id,
    endereco: String(o.endereco ?? ''),
    bairro: String(o.bairro ?? ''),
    cidade: String(o.cidade ?? ''),
    preco: Number(o.preco) || 0,
    quartos: Math.max(0, Number(o.quartos) || 0),
    banheiros: Math.max(0, Number(o.banheiros) || 0),
    tipo,
    fotos,
    favorito: Boolean(o.favorito),
    disponivel:
      o.disponivel === false
        ? false
        : o.disponivel === true
          ? true
          : undefined,
    ownerUserId:
      o.ownerUserId != null && String(o.ownerUserId).trim()
        ? String(o.ownerUserId).trim()
        : undefined,
  };
}

function coerceCliente(x: unknown): Cliente | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const urg = String(o.urgencia ?? '');
  const urgOk: UrgenciaLead[] = ['baixa', 'media', 'alta'];
  const est = String(o.estagioFunil ?? '');
  const estOk: EstagioFunilCliente[] = ['lead'];
  return {
    id,
    nome: String(o.nome ?? ''),
    fone: String(o.fone ?? ''),
    valor: Number(o.valor) || 0,
    // O fechamento pertence ao Pós-visita/VGV. Aqui o status representa somente prioridade.
    status: String(o.status ?? 'Quente') === 'Fechado' ? 'Quente' : String(o.status ?? 'Quente'),
    bairrosInteresse:
      o.bairrosInteresse != null && String(o.bairrosInteresse).trim()
        ? String(o.bairrosInteresse)
        : undefined,
    quartosDesejados:
      o.quartosDesejados != null && Number.isFinite(Number(o.quartosDesejados))
        ? Math.max(0, Number(o.quartosDesejados))
        : undefined,
    orcamentoMax:
      o.orcamentoMax != null && Number.isFinite(Number(o.orcamentoMax))
        ? Math.max(0, Number(o.orcamentoMax))
        : undefined,
    urgencia: urgOk.includes(urg as UrgenciaLead) ? (urg as UrgenciaLead) : undefined,
    notas: o.notas != null && String(o.notas).trim() ? String(o.notas) : undefined,
    estagioFunil: estOk.includes(est as EstagioFunilCliente)
      ? (est as EstagioFunilCliente)
      : undefined,
    valorNegocio:
      o.valorNegocio != null && Number.isFinite(Number(o.valorNegocio))
        ? Math.max(0, Number(o.valorNegocio))
        : undefined,
    comissaoPct:
      o.comissaoPct != null && Number.isFinite(Number(o.comissaoPct))
        ? Math.min(100, Math.max(0, Number(o.comissaoPct)))
        : undefined,
    imovelInteresseId:
      o.imovelInteresseId != null && Number.isFinite(Number(o.imovelInteresseId))
        ? Number(o.imovelInteresseId)
        : undefined,
    dataCadastro:
      o.dataCadastro != null && /^\d{4}-\d{2}-\d{2}$/.test(String(o.dataCadastro).trim())
        ? String(o.dataCadastro).trim()
        : undefined,
    ownerUserId:
      o.ownerUserId != null && String(o.ownerUserId).trim()
        ? String(o.ownerUserId).trim()
        : undefined,
  };
}

function coerceVendaCheckin(x: unknown): VendaCheckin | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const imovelId = Number(o.imovelId);
  if (!Number.isFinite(imovelId)) return null;
  const dataRaw = o.dataCheckin != null ? String(o.dataCheckin).trim() : '';
  const dataCheckin = /^\d{4}-\d{2}-\d{2}$/.test(dataRaw) ? dataRaw : '';
  if (!dataCheckin) return null;
  const valorVenda = Math.max(0, Number(o.valorVenda) || 0);
  const comissaoPctRaw = o.comissaoPct;
  const comissaoPct =
    comissaoPctRaw != null && Number.isFinite(Number(comissaoPctRaw))
      ? Math.min(100, Math.max(0, Number(comissaoPctRaw)))
      : undefined;
  const clienteId =
    o.clienteId != null && Number.isFinite(Number(o.clienteId)) ? Number(o.clienteId) : undefined;
  const visitaId =
    o.visitaId != null && Number.isFinite(Number(o.visitaId)) ? Number(o.visitaId) : undefined;
  const vendaConfirmada =
    o.vendaConfirmada === false
      ? false
      : o.vendaConfirmada === true
        ? true
        : undefined;
  return {
    id,
    imovelId,
    valorVenda,
    comissaoPct,
    dataCheckin,
    comprador:
      o.comprador != null && String(o.comprador).trim() ? String(o.comprador).trim() : undefined,
    clienteId,
    visitaId,
    vendaConfirmada,
    ownerUserId:
      o.ownerUserId != null && String(o.ownerUserId).trim()
        ? String(o.ownerUserId).trim()
        : undefined,
  };
}

function coerceTarefa(x: unknown): Tarefa | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    txt: String(o.txt ?? ''),
    ownerUserId:
      o.ownerUserId != null && String(o.ownerUserId).trim()
        ? String(o.ownerUserId).trim()
        : undefined,
  };
}

export function normalizeDb(raw: unknown): BrokerDb {
  if (!raw || typeof raw !== 'object') return emptyDb();
  const o = raw as Record<string, unknown>;
  const imRaw = Array.isArray(o.imoveis) ? o.imoveis : [];
  const imoveis = imRaw.map(coerceImovel).filter((x): x is Imovel => x != null);
  const visRaw = Array.isArray(o.visitas) ? o.visitas : [];
  const visitasCoerced = visRaw.map(coerceVisita).filter((x): x is Visita => x != null);
  const cliRaw = Array.isArray(o.clientes) ? o.clientes : [];
  const clientes = cliRaw.map(coerceCliente).filter((x): x is Cliente => x != null);
  const vendRaw = Array.isArray(o.vendasCheckin) ? o.vendasCheckin : [];
  const vendasCheckin = vendRaw.map(coerceVendaCheckin).filter((x): x is VendaCheckin => x != null);
  const tarRaw = Array.isArray(o.tarefas) ? o.tarefas : [];
  const tarefas = tarRaw.map(coerceTarefa).filter((x): x is Tarefa => x != null);
  return {
    visitas: visitasCoerced,
    clientes,
    tarefas,
    imoveis,
    vendasCheckin,
    settings: coerceSettings(o.settings),
  };
}
