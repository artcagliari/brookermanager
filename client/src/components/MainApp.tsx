import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  comissaoTotalConfirmada,
  normalizeDb,
  tituloImovel,
  vgvTotalConfirmado,
  type AppSection,
  type BrokerDb,
  type Cliente,
  type FunilVisita,
  type Imovel,
  type TipoImovel,
  type Visita,
  type VendaCheckin,
} from '../types';
import type { BrokerProfile, TeamMemberProfile } from '../api';
import { fetchTeamProfiles, putData } from '../api';
import { isLikelyImageFile } from '../lib/imageGuess';
import { fileToResizedDataUrl } from '../lib/imageResize';
import { uploadImovelFotoPublica } from '../lib/storageImovel';
import { getCurrentPlaceDescription } from '../lib/geolocation';
import { simulateSac } from '../lib/sacSimulate';
import {
  clienteAgendaLabel,
  enderecoParaVisitaDeImovel,
  formatBrlFull,
  maskBrlWhole,
  maskPhoneBr,
  mapsUrlForVisita,
  onlyDigits,
  parseBrlNumber,
} from '../utils';
import { APP_KICKER_APP, APP_KICKER_INICIO, APP_NAME, appNameParts, appSlugForFiles } from '../branding';
import { ThemeToggle } from '../ThemeContext';
import { googleCalendarUrl, outlookCalendarUrl, downloadIcsForVisitas } from '../lib/calendarLinks';
import { todayISODate, visitaSortKey } from '../lib/datetimeAgenda';
import { googleMapsDirectionsUrl } from '../lib/mapsRoute';
import { matchImoveisParaCliente } from '../lib/matchImoveis';
import { msgLembrete24h, msgLembrete2h, msgPosVisita, whatsappLink } from '../lib/whatsappTemplates';
import {
  CRM_STAGE_LABEL,
  CRM_STAGE_DESCRIPTION,
  CRM_STAGE_ORDER,
  filterDbForOwner,
  getClientCrmStage,
  getCrmStageCounts,
  type ClientCrmStage,
} from '../lib/brokerWorkflow';
import { AgendaAssistantChat } from './AgendaAssistantChat';
import { HomeExplore } from './HomeExplore';
import { ImovelSearchPicker } from './ImovelSearchPicker';
import { EmpresaEquipaPanel } from './EmpresaEquipaPanel';
import { PosVisitaPanel } from './PosVisitaPanel';
import { PropostaOverlay, type PropostaDetalhes } from './PropostaOverlay';
import { CrmDashboard } from './CrmDashboard';
import { CrmNavigation, type CrmNavItem } from './CrmNavigation';

type Props = {
  db: BrokerDb;
  setDb: React.Dispatch<React.SetStateAction<BrokerDb>>;
  onLogout: () => void;
  markSkipNextPersist: () => void;
  empresaId: string;
  profile: BrokerProfile;
  userEmail: string;
};

const ABAS_AGENDA: { value: 'todas' | FunilVisita; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'agendada', label: 'Agendadas' },
  { value: 'realizada', label: 'Realizadas' },
  { value: 'proposta', label: 'Propostas' },
  { value: 'cancelada', label: 'Canceladas' },
];

const CRM_STAGE_STYLE: Record<ClientCrmStage, string> = {
  novo: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  contato: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300',
  qualificado: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  visita: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  pos_visita: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  proposta: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  venda: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  perdido: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
};

/** Para ordenar/filtrar; leads antigos sem campo usam data inferida do `id` (timestamp) ou 1970-01-01. */
function dataCadastroEfetiva(c: Cliente): string {
  const raw = c.dataCadastro?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const id = Number(c.id);
  if (Number.isFinite(id) && id > 1_000_000_000_000) {
    try {
      return new Date(id).toISOString().slice(0, 10);
    } catch {
      /* ignore */
    }
  }
  return '1970-01-01';
}

function formatDataCadastroBr(iso: string): string {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function isoDaysAgoLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function primeiroDiaMesLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function foneParaClienteVisita(clienteVisita: string, clientes: Cliente[]): string | null {
  const inside = clienteVisita.match(/\(([^)]+)\)/);
  if (inside?.[1]) {
    const d = onlyDigits(inside[1]);
    if (d.length >= 10) return d;
  }
  const base = (clienteVisita.split('(')[0] ?? '').trim();
  const hit = clientes.find((c) => c.nome.trim().toLowerCase() === base.toLowerCase());
  if (hit?.fone) return onlyDigits(hit.fone);
  return null;
}

export function MainApp({ db, setDb, onLogout, markSkipNextPersist, empresaId, profile, userEmail }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const imovelFotosRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<AppSection>('inicio');

  const [modalVisita, setModalVisita] = useState(false);
  const [editVisitaId, setEditVisitaId] = useState<number | null>(null);
  const [vCliente, setVCliente] = useState('');
  const [vClienteId, setVClienteId] = useState<number | ''>('');
  const [vHora, setVHora] = useState('');
  const [vEndereco, setVEndereco] = useState('');
  const [vLat, setVLat] = useState<number | undefined>();
  const [vLng, setVLng] = useState<number | undefined>();
  const [vData, setVData] = useState('');
  const [vChave, setVChave] = useState('');
  const [vFunilEstado, setVFunilEstado] = useState<FunilVisita>('agendada');
  const [loadingGpsVisita, setLoadingGpsVisita] = useState(false);
  const [vImovelId, setVImovelId] = useState<number | undefined>(undefined);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [agendaBusca, setAgendaBusca] = useState('');
  const [agendaEtapa, setAgendaEtapa] = useState<'todas' | FunilVisita>('todas');
  const [leadsBusca, setLeadsBusca] = useState('');
  const [crmEtapa, setCrmEtapa] = useState<'todas' | ClientCrmStage>('todas');
  const [leadsCadastroDe, setLeadsCadastroDe] = useState('');
  const [leadsCadastroAte, setLeadsCadastroAte] = useState('');

  const [modalCliente, setModalCliente] = useState(false);
  const [editClienteId, setEditClienteId] = useState<number | null>(null);
  const [cNome, setCNome] = useState('');
  const [cFone, setCFone] = useState('');
  const [cStatus, setCStatus] = useState('Quente');
  const [cBairros, setCBairros] = useState('');
  const [cQuartos, setCQuartos] = useState('');
  const [cOrcMax, setCOrcMax] = useState('');
  const [cNotas, setCNotas] = useState('');
  const [cEtapaCrmManual, setCEtapaCrmManual] = useState<'novo' | 'contato' | 'qualificado' | 'perdido'>('novo');
  const [cProximoContatoEm, setCProximoContatoEm] = useState('');
  const [cImovelInteresseId, setCImovelInteresseId] = useState<number | undefined>(undefined);

  const [fValor, setFValor] = useState('');
  const [fEntrada, setFEntrada] = useState('');
  const [fParcelas, setFParcelas] = useState('360');
  const [fTaxaAa, setFTaxaAa] = useState('10.5');
  const [resCalcOpen, setResCalcOpen] = useState(false);
  const [simulationDetails, setSimulationDetails] = useState<PropostaDetalhes | null>(null);
  const [prData, setPrData] = useState('');
  const [propostaOpen, setPropostaOpen] = useState(false);

  const [todoInput, setTodoInput] = useState('');
  const [teamProfiles, setTeamProfiles] = useState<TeamMemberProfile[]>([]);
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  /** Persona empresa: filtra toda a app como se fosse a conta do corretor escolhido na Equipa. */
  const [equipaVistaCorretorId, setEquipaVistaCorretorId] = useState<string | null>(null);

  const [modalImovel, setModalImovel] = useState(false);
  const [editImovelId, setEditImovelId] = useState<number | null>(null);
  const [iEndereco, setIEndereco] = useState('');
  const [iBairro, setIBairro] = useState('');
  const [iCidade, setICidade] = useState('');
  const [iPreco, setIPreco] = useState('');
  const [iQuartos, setIQuartos] = useState('3');
  const [iBanheiros, setIBanheiros] = useState('2');
  const [iTipo, setITipo] = useState<TipoImovel>('Apartamento');
  const [iFotos, setIFotos] = useState<string[]>([]);
  const [iFotosLoading, setIFotosLoading] = useState(false);
  /** Mensagem curta após cada foto (some sozinha). */
  const [iFotoFeedback, setIFotoFeedback] = useState<string | null>(null);
  /** Linhas de log para testar erros de upload / preview. */
  const [iFotoDebugLog, setIFotoDebugLog] = useState<string[]>([]);
  const [loadingGpsImovel, setLoadingGpsImovel] = useState(false);
  const pendingImovelRef = useRef<null | 'novo' | Imovel>(null);
  /** Sincronizado com `iFotos` para o loop async de uploads saber o total sem estado obsoleto. */
  const iFotosRef = useRef<string[]>([]);

  /** Empresa sem “vista” vê tudo; empresa na vista de corretor ou corretor vê só `ownerUserId` próprio. */
  const dbVisao = useMemo(() => {
    if (profile.role === 'empresa' && equipaVistaCorretorId) {
      return filterDbForOwner(db, equipaVistaCorretorId);
    }
    if (profile.role === 'corretor') {
      return filterDbForOwner(db, profile.id);
    }
    return db;
  }, [db, profile.role, profile.id, equipaVistaCorretorId]);

  /** Novos registos: na vista de corretor, ficam atribuídos a esse utilizador. */
  const effectiveOwnerUserId = useMemo(
    () =>
      profile.role === 'empresa' && equipaVistaCorretorId ? equipaVistaCorretorId : profile.id,
    [profile.role, profile.id, equipaVistaCorretorId]
  );

  // Mantido para compatibilidade do cabeçalho legado oculto durante a transição visual.
  const vgvCabecalho = useMemo(
    () => vgvTotalConfirmado(dbVisao.vendasCheckin ?? []),
    [dbVisao.vendasCheckin]
  );
  const comissaoCabecalho = useMemo(
    () => comissaoTotalConfirmada(dbVisao.vendasCheckin ?? []),
    [dbVisao.vendasCheckin]
  );

  const resetNovoImovelFields = useCallback(() => {
    setEditImovelId(null);
    setIEndereco('');
    setIBairro('');
    setICidade('');
    setIPreco('');
    setIQuartos('3');
    setIBanheiros('2');
    setITipo('Apartamento');
    setIFotos([]);
  }, []);

  const aplicarImovelNoForm = useCallback((m: Imovel) => {
    setEditImovelId(m.id);
    setIEndereco(m.endereco ?? '');
    setIBairro(m.bairro);
    setICidade(m.cidade);
    setIPreco(m.preco ? maskBrlWhole(m.preco) : '');
    setIQuartos(String(m.quartos));
    setIBanheiros(String(m.banheiros));
    setITipo(m.tipo);
    setIFotos(m.fotos.length ? [...m.fotos] : []);
  }, []);

  useEffect(() => {
    iFotosRef.current = iFotos;
  }, [iFotos]);

  useEffect(() => {
    if (modalImovel && section !== 'imoveis') setModalImovel(false);
  }, [section, modalImovel]);

  useEffect(() => {
    if (!iFotoFeedback) return;
    const t = window.setTimeout(() => setIFotoFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [iFotoFeedback]);

  useEffect(() => {
    if (profile.role !== 'empresa') {
      setTeamProfiles([]);
      setTeamLoadError(null);
      setTeamLoading(false);
      return;
    }
    let cancelled = false;
    setTeamLoading(true);
    setTeamLoadError(null);
    void fetchTeamProfiles(empresaId)
      .then((rows) => {
        if (!cancelled) setTeamProfiles(rows);
      })
      .catch((e) => {
        if (!cancelled) setTeamLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.role, empresaId]);

  useEffect(() => {
    if (profile.role !== 'empresa' && section === 'equipa') setSection('inicio');
  }, [profile.role, section]);

  useEffect(() => {
    if (profile.role !== 'empresa') setEquipaVistaCorretorId(null);
  }, [profile.role]);

  const nomeVistaCorretor = useMemo(() => {
    if (!equipaVistaCorretorId) return '';
    const m = teamProfiles.find((t) => t.id === equipaVistaCorretorId);
    return m?.nome_exibicao?.trim() || 'Corretor';
  }, [equipaVistaCorretorId, teamProfiles]);

  const handleEntrarVistaCorretor = useCallback((userId: string) => {
    setEquipaVistaCorretorId(userId);
    setSection('agenda');
  }, []);

  const appendFotoLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString();
    const entry = `${ts} ${line}`;
    console.log('[fotos]', entry);
    setIFotoDebugLog((prev) => [...prev.slice(-24), entry]);
  }, []);

  useEffect(() => {
    if (section !== 'imoveis') return;
    const p = pendingImovelRef.current;
    if (p == null) return;
    pendingImovelRef.current = null;
    if (p === 'novo') resetNovoImovelFields();
    else aplicarImovelNoForm(p);
    setModalImovel(true);
  }, [section, resetNovoImovelFields, aplicarImovelNoForm]);

  const openNovaVisita = useCallback(() => {
    setEditVisitaId(null);
    setVCliente('');
    setVClienteId('');
    setVHora('');
    setVData(todayISODate());
    setVChave('');
    setVFunilEstado('agendada');
    setVEndereco('');
    setVLat(undefined);
    setVLng(undefined);
    setVImovelId(undefined);
    setModalVisita(true);
  }, []);

  const openNovaVisitaForCliente = useCallback(
    (cliente: Cliente) => {
      openNovaVisita();
      setVCliente(clienteAgendaLabel(cliente));
      setVClienteId(cliente.id);
      const imovel =
        cliente.imovelInteresseId != null
          ? db.imoveis.find((item) => item.id === cliente.imovelInteresseId)
          : undefined;
      if (imovel) {
        setVImovelId(imovel.id);
        setVEndereco(enderecoParaVisitaDeImovel(imovel));
      }
      setSection('agenda');
    },
    [db.imoveis, openNovaVisita]
  );

  const openEditVisita = useCallback((v: Visita) => {
    setEditVisitaId(v.id);
    setVCliente(v.cliente);
    setVClienteId(v.clienteId != null && Number.isFinite(v.clienteId) ? v.clienteId : '');
    setVHora(v.hora);
    setVData(v.data || todayISODate());
    setVChave(v.chave ?? '');
    setVFunilEstado(v.funilEstado ?? 'agendada');
    setVEndereco(v.endereco ?? '');
    setVLat(v.lat);
    setVLng(v.lng);
    setVImovelId(v.imovelId);
    setModalVisita(true);
  }, []);

  const agendarVisitaComImovel = useCallback((m: Imovel) => {
    setEditVisitaId(null);
    setVCliente('');
    setVClienteId('');
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    setVHora(String(d.getHours()).padStart(2, '0') + ':00');
    setVEndereco(enderecoParaVisitaDeImovel(m));
    setVLat(undefined);
    setVLng(undefined);
    setVImovelId(m.id);
    setVData(todayISODate());
    setVChave('');
    setVFunilEstado('agendada');
    setSection('agenda');
    setModalVisita(true);
  }, []);

  const fillVisitaGps = useCallback(async () => {
    setLoadingGpsVisita(true);
    try {
      const { address, lat, lng } = await getCurrentPlaceDescription();
      setVEndereco(address);
      setVLat(lat);
      setVLng(lng);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível obter a localização.');
    } finally {
      setLoadingGpsVisita(false);
    }
  }, []);

  const registrarVendaNaAgenda = useCallback(
    (venda: VendaCheckin, hora: string) => {
      const im = db.imoveis.find((i) => i.id === venda.imovelId);
      const comp = venda.comprador?.trim();
      const cliente = comp
        ? `Venda · ${comp} · ${formatBrlFull(venda.valorVenda)}`
        : `Venda · ${formatBrlFull(venda.valorVenda)}`;
      const payload: Omit<Visita, 'id'> = {
        cliente,
        clienteId: venda.clienteId,
        hora: hora.trim() || '10:00',
        data: venda.dataCheckin,
        endereco: im ? enderecoParaVisitaDeImovel(im) : undefined,
        imovelId: venda.imovelId,
        funilEstado: 'realizada',
        ownerUserId: venda.ownerUserId,
      };
      setDb((d) => ({ ...d, visitas: [...d.visitas, { ...payload, id: Date.now() }] }));
      setSection('agenda');
    },
    [db.imoveis, setDb]
  );

  const addVisitasFromAssistant = useCallback(
    (items: Omit<Visita, 'id'>[]) => {
      const base = Date.now();
      setDb((d) => ({
        ...d,
        visitas: [
          ...d.visitas,
          ...items.map((it, i) => ({
            ...it,
            id: base + i,
            data: it.data || todayISODate(),
            funilEstado: it.funilEstado ?? 'agendada',
            ownerUserId: effectiveOwnerUserId,
          })),
        ],
      }));
    },
    [setDb, effectiveOwnerUserId]
  );

  const saveVisita = useCallback(() => {
    const cliente = vCliente.trim();
    const hora = vHora;
    if (!cliente || !hora) {
      alert('Mínimo: Cliente e Hora.');
      return;
    }
    const payload: Omit<Visita, 'id'> = {
      cliente,
      clienteId: vClienteId === '' ? undefined : Number(vClienteId),
      hora,
      data: vData.trim() && /^\d{4}-\d{2}-\d{2}$/.test(vData.trim()) ? vData.trim() : todayISODate(),
      chave: vChave.trim() || undefined,
      funilEstado: vFunilEstado,
      endereco: vEndereco.trim() || undefined,
      lat: vLat,
      lng: vLng,
      imovelId: vImovelId,
    };
    if (editVisitaId != null) {
      setDb((d) => ({
        ...d,
        visitas: d.visitas.map((x) => (x.id === editVisitaId ? { ...x, ...payload } : x)),
      }));
    } else {
      setDb((d) => ({
        ...d,
        visitas: [...d.visitas, { id: Date.now(), ...payload, ownerUserId: effectiveOwnerUserId }],
      }));
    }
    setModalVisita(false);
    setVImovelId(undefined);
    setVClienteId('');
  }, [
    editVisitaId,
    vCliente,
    vClienteId,
    vHora,
    vData,
    vChave,
    vFunilEstado,
    vEndereco,
    vLat,
    vLng,
    vImovelId,
    effectiveOwnerUserId,
    setDb,
  ]);

  const atualizarEtapaVisita = useCallback(
    (visita: Visita, etapa: FunilVisita) => {
      setDb((d) => ({
        ...d,
        visitas: d.visitas.map((v) =>
          v.id === visita.id ? { ...v, funilEstado: etapa } : v
        ),
      }));
    },
    [setDb]
  );

  const openNovoCliente = useCallback(() => {
    setEditClienteId(null);
    setCNome('');
    setCFone('');
    setCStatus('Quente');
    setCBairros('');
    setCQuartos('');
    setCOrcMax('');
    setCNotas('');
    setCEtapaCrmManual('novo');
    setCProximoContatoEm('');
    setCImovelInteresseId(undefined);
    setModalCliente(true);
  }, []);

  const openEditCliente = useCallback((c: Cliente) => {
    setEditClienteId(c.id);
    setCNome(c.nome);
    setCFone(maskPhoneBr(c.fone ?? ''));
    setCStatus(c.status);
    setCBairros(c.bairrosInteresse ?? '');
    setCQuartos(c.quartosDesejados != null ? String(c.quartosDesejados) : '');
    setCOrcMax(c.orcamentoMax != null ? maskBrlWhole(c.orcamentoMax) : '');
    setCNotas(c.notas ?? '');
    setCEtapaCrmManual(c.etapaCrmManual ?? 'novo');
    setCProximoContatoEm(c.proximoContatoEm ?? '');
    setCImovelInteresseId(c.imovelInteresseId);
    setModalCliente(true);
  }, []);

  const saveCliente = useCallback(() => {
    const nome = cNome.trim();
    if (!nome) {
      alert('Nome obrigatório.');
      return;
    }
    const phoneDigits = onlyDigits(cFone);
    if (
      phoneDigits.length >= 10 &&
      dbVisao.clientes.some(
        (cliente) => cliente.id !== editClienteId && onlyDigits(cliente.fone) === phoneDigits
      )
    ) {
      alert('Já existe um lead cadastrado com este telefone. Abra o cadastro existente para evitar duplicidade.');
      return;
    }
    const qd = parseInt(cQuartos, 10);
    const existing = editClienteId != null ? db.clientes.find((c) => c.id === editClienteId) : undefined;
    const dataCadastro = existing ? dataCadastroEfetiva(existing) : todayISODate();

    const data: Omit<Cliente, 'id'> = {
      nome,
      fone: cFone.trim(),
      valor: existing?.valor ?? 0,
      status: cStatus,
      bairrosInteresse: cBairros.trim() || undefined,
      quartosDesejados: Number.isFinite(qd) && qd > 0 ? qd : undefined,
      orcamentoMax: parseBrlNumber(cOrcMax) > 0 ? parseBrlNumber(cOrcMax) : undefined,
      urgencia: existing?.urgencia,
      notas: cNotas.trim() || undefined,
      estagioFunil: 'lead',
      etapaCrmManual: cEtapaCrmManual,
      ultimoContatoEm:
        cEtapaCrmManual === 'contato' || cEtapaCrmManual === 'qualificado'
          ? existing?.ultimoContatoEm ?? todayISODate()
          : existing?.ultimoContatoEm,
      proximoContatoEm:
        cProximoContatoEm && /^\d{4}-\d{2}-\d{2}$/.test(cProximoContatoEm)
          ? cProximoContatoEm
          : undefined,
      imovelInteresseId:
        cImovelInteresseId != null && Number.isFinite(cImovelInteresseId)
          ? cImovelInteresseId
          : undefined,
      dataCadastro,
    };
    if (editClienteId != null) {
      setDb((d) => ({
        ...d,
        clientes: d.clientes.map((x) =>
          x.id === editClienteId
            ? { ...x, ...data, valorNegocio: undefined, comissaoPct: undefined }
            : x
        ),
      }));
    } else {
      setDb((d) => ({
        ...d,
        clientes: [...d.clientes, { id: Date.now(), ...data, ownerUserId: effectiveOwnerUserId }],
      }));
    }
    setModalCliente(false);
  }, [
    editClienteId,
    db.clientes,
    dbVisao.clientes,
    cNome,
    cFone,
    cStatus,
    cBairros,
    cQuartos,
    cOrcMax,
    cNotas,
    cEtapaCrmManual,
    cProximoContatoEm,
    cImovelInteresseId,
    effectiveOwnerUserId,
    setDb,
  ]);

  const atualizarEtapaManualCliente = useCallback(
    (clienteId: number, etapa: 'novo' | 'contato' | 'qualificado' | 'perdido') => {
      const hoje = todayISODate();
      setDb((current) => ({
        ...current,
        clientes: current.clientes.map((cliente) =>
          cliente.id === clienteId
            ? {
                ...cliente,
                etapaCrmManual: etapa,
                ultimoContatoEm:
                  etapa === 'contato' || etapa === 'qualificado'
                    ? hoje
                    : cliente.ultimoContatoEm,
                proximoContatoEm: etapa === 'perdido' ? undefined : cliente.proximoContatoEm,
              }
            : cliente
        ),
      }));
    },
    [setDb]
  );

  const openNovoImovel = useCallback(() => {
    if (section !== 'imoveis') {
      pendingImovelRef.current = 'novo';
      setSection('imoveis');
      return;
    }
    resetNovoImovelFields();
    setModalImovel(true);
  }, [section, resetNovoImovelFields]);

  const openEditImovel = useCallback(
    (m: Imovel) => {
      if (section !== 'imoveis') {
        pendingImovelRef.current = m;
        setSection('imoveis');
        return;
      }
      aplicarImovelNoForm(m);
      setModalImovel(true);
    },
    [section, aplicarImovelNoForm]
  );

  const fillImovelGps = useCallback(async () => {
    setLoadingGpsImovel(true);
    try {
      const { address } = await getCurrentPlaceDescription();
      setIEndereco(address);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível obter a localização.');
    } finally {
      setLoadingGpsImovel(false);
    }
  }, []);

  const saveImovel = useCallback(() => {
    const bairro = iBairro.trim();
    const cidade = iCidade.trim();
    if (!bairro || !cidade) {
      alert('Preencha bairro e cidade.');
      return;
    }
    const base: Omit<Imovel, 'id' | 'favorito'> = {
      endereco: iEndereco.trim(),
      bairro,
      cidade,
      preco: parseBrlNumber(iPreco),
      quartos: Math.max(0, parseInt(iQuartos, 10) || 0),
      banheiros: Math.max(0, parseInt(iBanheiros, 10) || 0),
      tipo: iTipo,
      fotos: [...iFotos],
    };
    if (editImovelId != null) {
      setDb((d) => ({
        ...d,
        imoveis: d.imoveis.map((x) =>
          x.id === editImovelId
            ? {
                ...x,
                ...base,
                favorito: x.favorito,
                ownerUserId: x.ownerUserId ?? effectiveOwnerUserId,
              }
            : x
        ),
      }));
    } else {
      setDb((d) => ({
        ...d,
        imoveis: [...d.imoveis, { id: Date.now(), ...base, favorito: false, ownerUserId: effectiveOwnerUserId }],
      }));
    }
    setModalImovel(false);
  }, [editImovelId, iEndereco, iBairro, iCidade, iPreco, iQuartos, iBanheiros, iTipo, iFotos, effectiveOwnerUserId, setDb]);

  const onPickImovelFotos = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      // IMPORTANTE: copiar ficheiros ANTES de limpar o input — senão o FileList pode ficar vazio (Safari/iOS).
      const fileArr = e.target.files?.length ? Array.from(e.target.files) : [];
      e.target.value = '';
      appendFotoLog(`onChange: ${fileArr.length} ficheiro(s) recebido(s)`);
      if (!fileArr.length) {
        appendFotoLog('Lista vazia — nada a processar (tente escolher de novo)');
        return;
      }
      setIFotosLoading(true);
      setIFotoFeedback(null);
      let ignoradas = 0;
      let tentadas = 0;
      try {
        for (let i = 0; i < fileArr.length; i++) {
          if (iFotosRef.current.length >= 8) {
            appendFotoLog('LIMITE: já existem 8 fotos no formulário.');
            setIFotoFeedback('Limite de 8 fotos atingido.');
            break;
          }
          const f = fileArr[i];
          if (!f) continue;
          if (!isLikelyImageFile(f)) {
            ignoradas++;
            appendFotoLog(`IGNORADO (não reconhecido como imagem): ${f.name || 'sem nome'} type="${f.type}"`);
            continue;
          }
          tentadas++;
          const label = f.name || 'foto';
          try {
            const url = await uploadImovelFotoPublica(empresaId, f);
            let novoTotal = 0;
            setIFotos((prev) => {
              if (prev.length >= 8) return prev;
              if (prev.includes(url)) return prev;
              const next = [...prev, url];
              novoTotal = next.length;
              iFotosRef.current = next;
              return next;
            });
            if (novoTotal > 0) {
              appendFotoLog(`OK Storage: ${label} → total ${novoTotal}/8`);
              setIFotoFeedback(`Foto adicionada — ${novoTotal} de 8 (Supabase)`);
            }
          } catch (uploadErr) {
            const uploadMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
            appendFotoLog(`Storage falhou: ${label} → ${uploadMsg}`);
            try {
              const data = await fileToResizedDataUrl(f);
              let novoTotal = 0;
              setIFotos((prev) => {
                if (prev.length >= 8) return prev;
                if (prev.includes(data)) return prev;
                const next = [...prev, data];
                novoTotal = next.length;
                iFotosRef.current = next;
                return next;
              });
              if (novoTotal > 0) {
                appendFotoLog(`OK base64 (fallback): ${label} → total ${novoTotal}/8`);
                setIFotoFeedback(`Foto adicionada — ${novoTotal} de 8 (local)`);
              }
            } catch {
              appendFotoLog(`ERRO total: ${label}`);
              alert(
                `Não foi possível usar esta foto.\n\n${uploadMsg}\n\n` +
                  'Confirme no Supabase: Storage → bucket "imovel-fotos" (público) e políticas RLS; no SQL Editor execute as migrações 002 e 006. ' +
                  'Em iPhone, prefira JPEG em vez de HEIC nas definições da câmara.'
              );
            }
          }
        }
        if (fileArr.length > 0 && ignoradas === fileArr.length && tentadas === 0) {
          appendFotoLog('Nenhum ficheiro aceite como imagem.');
          setIFotoFeedback('Nenhuma foto reconhecida — tente outro ficheiro ou recarregue a página (⌘R).');
          alert(
            'Nenhuma foto foi aceite. Em telemóveis, a galeria por vezes não envia o tipo MIME — recarregue a página (⌘R) ou escolha "Ficheiros".'
          );
        }
      } finally {
        setIFotosLoading(false);
      }
    },
    [empresaId, appendFotoLog]
  );

  const removerFotoImovel = useCallback((index: number) => {
    setIFotos((prev) => {
      const next = prev.filter((_, i) => i !== index);
      iFotosRef.current = next;
      return next;
    });
  }, []);

  const toggleFavoritoImovel = useCallback((id: number) => {
    setDb((d) => ({
      ...d,
      imoveis: d.imoveis.map((m) => (m.id === id ? { ...m, favorito: !m.favorito } : m)),
    }));
  }, [setDb]);

  const remover = useCallback(
    (key: keyof Pick<BrokerDb, 'visitas' | 'clientes' | 'tarefas' | 'imoveis'>, id: number) => {
      if (key === 'imoveis' && (db.vendasCheckin ?? []).some((v) => v.imovelId === id)) {
        alert('Este imóvel possui uma venda ligada. Remova primeiro o registro de venda no Pós-visita para preservar o histórico financeiro.');
        return;
      }
      const nome = key === 'visitas' ? 'esta visita' : key === 'clientes' ? 'este lead' : key === 'imoveis' ? 'este imóvel' : 'esta tarefa';
      if (!confirm(`Deseja remover ${nome}? Os vínculos relacionados serão ajustados automaticamente.`)) return;
      setDb((d) => {
        if (key === 'visitas') {
          return {
            ...d,
            visitas: d.visitas.filter((item) => item.id !== id),
            vendasCheckin: (d.vendasCheckin ?? []).map((venda) =>
              venda.visitaId === id ? { ...venda, visitaId: undefined } : venda
            ),
          };
        }
        if (key === 'clientes') {
          return {
            ...d,
            clientes: d.clientes.filter((item) => item.id !== id),
            visitas: d.visitas.map((visita) =>
              visita.clienteId === id ? { ...visita, clienteId: undefined } : visita
            ),
            vendasCheckin: (d.vendasCheckin ?? []).map((venda) =>
              venda.clienteId === id ? { ...venda, clienteId: undefined } : venda
            ),
          };
        }
        if (key === 'imoveis') {
          return {
            ...d,
            imoveis: d.imoveis.filter((item) => item.id !== id),
            visitas: d.visitas.map((visita) =>
              visita.imovelId === id ? { ...visita, imovelId: undefined } : visita
            ),
            clientes: d.clientes.map((cliente) =>
              cliente.imovelInteresseId === id ? { ...cliente, imovelInteresseId: undefined } : cliente
            ),
          };
        }
        return { ...d, tarefas: d.tarefas.filter((item) => item.id !== id) };
      });
    },
    [db.vendasCheckin, setDb]
  );

  const calcular = useCallback(() => {
    const valor = parseBrlNumber(fValor);
    const entrada = Math.max(0, parseBrlNumber(fEntrada));
    const parcelas = parseInt(String(fParcelas).replace(/\D/g, ''), 10) || 0;
    const taxaAa = parseFloat(String(fTaxaAa).replace(',', '.'));
    if (!valor || valor <= 0) {
      alert('Indique o valor do imóvel.');
      return;
    }
    if (entrada >= valor) {
      alert('A entrada tem de ser menor que o valor do imóvel.');
      return;
    }
    if (!Number.isFinite(taxaAa) || taxaAa < 0) {
      alert('Indique uma taxa de juros anual válida (ex.: 10,5).');
      return;
    }
    const r = simulateSac({ valorImovel: valor, entrada, parcelas, taxaAnualPercent: taxaAa });
    if (!r) {
      alert('Número de parcelas inválido (use entre 1 e 600 meses).');
      return;
    }
    const anos = parcelas / 12;
    const anosFmt =
      anos % 1 === 0 ? String(anos) : anos.toFixed(1).replace('.', ',');
    const taxaMensalPct = (taxaAa / 12).toFixed(3).replace('.', ',');
    const details: PropostaDetalhes = {
      valorImovelFmt: formatBrlFull(valor),
      entradaFmt: formatBrlFull(entrada),
      financiadoFmt: formatBrlFull(r.principal),
      parcelasLabel: `${parcelas} meses (~${anosFmt} ano${anos === 1 ? '' : 's'})`,
      taxaAaFmt: `${taxaAa.toFixed(2).replace('.', ',')}% a.a. (nominal ~${taxaMensalPct}% a.m.)`,
      amortizacaoFmt: formatBrlFull(r.amortizacaoMensal),
      primeiraFmt: formatBrlFull(r.primeiraParcela),
      ultimaFmt: formatBrlFull(r.ultimaParcela),
      totalJurosFmt: formatBrlFull(r.totalJuros),
      custoTotalFmt: formatBrlFull(r.custoTotal),
    };
    setSimulationDetails(details);
    setPrData(
      new Date().toLocaleString('pt-BR', {
        dateStyle: 'long',
        timeStyle: 'short',
      })
    );
    setResCalcOpen(true);
  }, [fValor, fEntrada, fParcelas, fTaxaAa]);

  const exportar = useCallback(() => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = appSlugForFiles() + '_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [db]);

  const importar = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const text = await file.text();
      try {
        const next = normalizeDb(JSON.parse(text) as unknown);
        if (!confirm('Substituir todos os dados desta conta pelos dados do arquivo?')) return;
        await putData(next, empresaId);
        markSkipNextPersist();
        setDb(next);
        alert('Backup importado e salvo na nuvem.');
      } catch {
        alert('Arquivo inválido.');
      }
    },
    [setDb, markSkipNextPersist]
  );

  const addTodo = useCallback(() => {
    const txt = todoInput.trim();
    if (!txt) return;
    setDb((d) => ({
      ...d,
      tarefas: [...d.tarefas, { id: Date.now(), txt, ownerUserId: effectiveOwnerUserId }],
    }));
    setTodoInput('');
  }, [todoInput, effectiveOwnerUserId, setDb]);

  const sortedVisitas = useMemo(
    () =>
      [...dbVisao.visitas].sort((a, b) =>
        visitaSortKey(a.data, a.hora).localeCompare(visitaSortKey(b.data, b.hora))
      ),
    [dbVisao.visitas]
  );

  const visitasFiltradas = useMemo(() => {
    const t = agendaBusca.trim().toLowerCase();
    return sortedVisitas.filter((v) => {
      if (agendaEtapa !== 'todas' && (v.funilEstado ?? 'agendada') !== agendaEtapa) return false;
      if (!t) return true;
      const im = v.imovelId != null ? db.imoveis.find((i) => i.id === v.imovelId) : undefined;
      const blob = [
        v.cliente,
        v.endereco,
        v.chave,
        v.data,
        v.hora,
        im ? tituloImovel(im) : '',
        im?.bairro,
        im?.cidade,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(t);
    });
  }, [sortedVisitas, agendaBusca, agendaEtapa, db.imoveis]);

  const contagemEtapasAgenda = useMemo(() => {
    const counts: Record<'todas' | FunilVisita, number> = {
      todas: sortedVisitas.length,
      agendada: 0,
      realizada: 0,
      proposta: 0,
      cancelada: 0,
    };
    for (const visita of sortedVisitas) counts[visita.funilEstado ?? 'agendada'] += 1;
    return counts;
  }, [sortedVisitas]);

  const clientesFiltrados = useMemo(() => {
    const t = leadsBusca.trim().toLowerCase();
    let list = [...dbVisao.clientes];

    if (crmEtapa !== 'todas') {
      list = list.filter((cliente) => getClientCrmStage(dbVisao, cliente) === crmEtapa);
    }

    if (t) {
      list = list.filter((c) => {
        const im =
          c.imovelInteresseId != null
            ? db.imoveis.find((i) => i.id === c.imovelInteresseId)
            : undefined;
        const blob = [
          c.nome,
          c.fone,
          c.status,
          c.bairrosInteresse,
          c.notas,
          im ? tituloImovel(im) : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return blob.includes(t);
      });
    }

    const de = leadsCadastroDe.trim();
    const ate = leadsCadastroAte.trim();
    if (de || ate) {
      list = list.filter((c) => {
        const dc = dataCadastroEfetiva(c);
        if (de && dc < de) return false;
        if (ate && dc > ate) return false;
        return true;
      });
    }

    list.sort((a, b) => {
      const da = dataCadastroEfetiva(a);
      const db_ = dataCadastroEfetiva(b);
      if (da !== db_) return db_.localeCompare(da);
      return b.id - a.id;
    });

    return list;
  }, [dbVisao, db.imoveis, leadsBusca, leadsCadastroDe, leadsCadastroAte, crmEtapa]);

  const crmStageCounts = useMemo(() => getCrmStageCounts(dbVisao), [dbVisao]);

  const visitasHojePainel = useMemo(
    () => dbVisao.visitas.filter((v) => v.data === todayISODate() && v.funilEstado !== 'cancelada'),
    [dbVisao.visitas]
  );
  const rotaDiaUrl = googleMapsDirectionsUrl(visitasHojePainel);

  const navItems = useMemo((): CrmNavItem[] => {
    const start: CrmNavItem[] = [
      [
        'inicio',
        'Visão geral',
        'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
      ],
      [
        'clientes',
        'CRM e funil',
        'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
      ],
      ['agenda', 'Agenda', 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'],
      ['imoveis', 'Imóveis', 'M3 21h18M5 21V9l7-6 7 6v12M9 21v-6h6v6'],
      ['painel', 'Negócios', 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01'],
      ['todo', 'Tarefas', 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'],
      ['calc', 'Simulador', 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z'],
    ];
    if (profile.role === 'empresa') {
      start.push([
        'equipa',
        'Equipa',
        'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a6.375 6.375 0 11-12.75 0 6.375 6.375 0 0112.75 0zm8.25 2.25a6.375 6.375 0 11-12.75 0 6.375 6.375 0 0112.75 0z',
      ]);
    }
    return start;
  }, [profile.role]);

  const headerLight = section === 'inicio';
  const brandTitle = useMemo(() => appNameParts(APP_NAME), []);

  return (
    <div
      className={
        'min-h-screen text-brand-dark dark:text-neutral-100 ' +
        (headerLight ? 'bg-hz-cream dark:bg-neutral-950' : 'bg-brand-light dark:bg-neutral-950')
      }
    >
      <a href="#conteudo-principal" className="skip-link">
        Ir para o conteúdo principal
      </a>
      <CrmNavigation
        items={navItems}
        active={section}
        nome={profile.nome_exibicao?.trim() || ''}
        role={profile.role === 'empresa' ? 'empresa' : 'corretor'}
        email={userEmail}
        onNavigate={setSection}
        onImport={() => importRef.current?.click()}
        onExport={exportar}
        onLogout={onLogout}
      />
      <header
        className={
          'hidden no-print p-6 sm:p-8 rounded-b-[2.5rem] sm:rounded-b-[3rem] shadow-2xl ' +
          (headerLight
            ? 'bg-white text-hz-ink border-b border-gray-100 shadow-md dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-800'
            : 'bg-brand-dark text-white dark:bg-neutral-950')
        }
      >
        <div className="flex justify-between items-start gap-3 mb-6">
          <div className="min-w-0">
            <p
              className={
                'text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ' +
                (headerLight ? 'text-hz-green' : 'text-brand-gold')
              }
            >
              {headerLight ? APP_KICKER_INICIO : APP_KICKER_APP}
            </p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
              {brandTitle.tail ? (
                <>
                  {brandTitle.head}{' '}
                  <span
                    className={headerLight ? 'text-hz-green font-light' : 'text-brand-gold font-light'}
                  >
                    {brandTitle.tail}
                  </span>
                </>
              ) : (
                <span className={headerLight ? 'text-hz-green' : 'text-brand-gold'}>{brandTitle.head}</span>
              )}
            </h1>
            <p
              className={
                'text-[10px] mt-2 font-semibold truncate max-w-[14rem] sm:max-w-md ' +
                (headerLight ? 'text-gray-500 dark:text-neutral-400' : 'text-white/55')
              }
            >
              <span className="uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                {profile.role === 'empresa' ? 'Master da empresa' : 'Corretor'}
              </span>
              {profile.nome_exibicao ? ` · ${profile.nome_exibicao}` : ''}
              {userEmail ? (
                <span className="block font-normal opacity-90 truncate">{userEmail}</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-2 items-center">
            <ThemeToggle variant={headerLight ? 'lightHeader' : 'darkHeader'} />
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className={
                'p-3 rounded-2xl border active:scale-95 transition-transform touch-manipulation ' +
                (headerLight
                  ? 'bg-hz-cream border-gray-200 text-gray-500 dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-300'
                  : 'bg-white/5 border-white/10')
              }
              aria-label="Importar backup"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </button>
            <input
              ref={importRef}
              type="file"
              className="hidden"
              accept=".json,application/json"
              onChange={(ev) => void importar(ev)}
            />
            <button
              type="button"
              onClick={exportar}
              className={
                'p-3 rounded-2xl border active:scale-95 transition-transform touch-manipulation ' +
                (headerLight
                  ? 'bg-hz-cream border-gray-200 text-hz-green dark:bg-neutral-800 dark:border-neutral-600 dark:text-emerald-400'
                  : 'bg-white/5 border-white/10')
              }
              aria-label="Exportar backup"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className={
                'px-3 py-3 rounded-2xl border text-[10px] font-black uppercase tracking-tighter active:scale-95 touch-manipulation ' +
                (headerLight
                  ? 'border-gray-200 text-hz-ink/70 bg-white dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-200'
                  : 'border-white/10 text-white/70 bg-white/5')
              }
              aria-label="Sair da conta"
            >
              Sair
            </button>
          </div>
        </div>

        <div
          className={
            'grid gap-3 sm:gap-4 text-center ' +
            (headerLight ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')
          }
        >
          <div
            className={
              'p-4 sm:p-5 rounded-[1.75rem] sm:rounded-[2rem] border ' +
              (headerLight
                ? 'bg-hz-cream border-gray-100 dark:bg-neutral-800 dark:border-neutral-700'
                : 'bg-white/5 border-white/10')
            }
          >
            <span
              className={
                'block text-2xl font-bold mb-1 ' +
                (headerLight ? 'text-hz-green dark:text-emerald-400' : 'text-brand-gold')
              }
            >
              {dbVisao.clientes.length}
            </span>
            <span
              className={
                'text-[9px] uppercase font-bold tracking-widest ' +
                (headerLight ? 'text-gray-500 dark:text-neutral-400' : 'text-gray-400')
              }
            >
              Clientes no CRM
            </span>
          </div>
          <div
            className={
              'p-4 sm:p-5 rounded-[1.75rem] sm:rounded-[2rem] border overflow-hidden ' +
              (headerLight
                ? 'bg-hz-cream border-gray-100 dark:bg-neutral-800 dark:border-neutral-700'
                : 'bg-white/5 border-white/10')
            }
          >
            <span
              className={
                'block text-lg font-bold mb-1 truncate ' +
                (headerLight ? 'text-hz-ink dark:text-white' : 'text-white')
              }
            >
              {formatBrlFull(vgvCabecalho)}
            </span>
            <span
              className={
                'text-[9px] uppercase font-bold tracking-widest ' +
                (headerLight ? 'text-gray-500 dark:text-neutral-400' : 'text-gray-400')
              }
            >
              VGV confirmado
            </span>
            <span
              className={
                'block text-[8px] mt-1 leading-tight ' +
                (headerLight ? 'text-gray-400 dark:text-neutral-500' : 'text-gray-500')
              }
            >
              Central de negócios
            </span>
          </div>
          <div
            className={
              'p-4 sm:p-5 rounded-[1.75rem] sm:rounded-[2rem] border overflow-hidden ' +
              (headerLight
                ? 'bg-hz-cream border-gray-100 dark:bg-neutral-800 dark:border-neutral-700'
                : 'bg-white/5 border-white/10')
            }
          >
            <span
              className={
                'block text-lg font-bold mb-1 truncate ' +
                (headerLight ? 'text-violet-700 dark:text-violet-400' : 'text-violet-300')
              }
            >
              {formatBrlFull(comissaoCabecalho)}
            </span>
            <span
              className={
                'text-[9px] uppercase font-bold tracking-widest ' +
                (headerLight ? 'text-gray-500 dark:text-neutral-400' : 'text-gray-400')
              }
            >
              Comissão total
            </span>
          </div>
          {headerLight ? (
            <div className="p-4 sm:p-5 rounded-[1.75rem] sm:rounded-[2rem] border border-gray-100 bg-hz-cream dark:bg-neutral-800 dark:border-neutral-700">
              <span className="block text-2xl font-bold text-hz-green dark:text-emerald-400 mb-1">
                {dbVisao.imoveis.length}
              </span>
              <span className="text-[9px] uppercase text-gray-500 dark:text-neutral-400 font-bold tracking-widest">
                Imóveis
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {profile.role === 'empresa' && equipaVistaCorretorId ? (
        <div className="px-4 sm:px-6 lg:pl-[17.5rem] pt-4 max-w-[96rem] mx-auto no-print">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-gold/50 bg-brand-gold/10 dark:bg-brand-gold/15 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-brand-dark dark:text-white">
                Vista: <span className="text-brand-gold">{nomeVistaCorretor}</span>
              </p>
              <p className="text-[10px] text-gray-600 dark:text-neutral-400 mt-0.5 leading-snug">
                Agenda, leads, pós-visita e tarefas mostram o responsável selecionado. O catálogo de imóveis continua compartilhado pela imobiliária.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEquipaVistaCorretorId(null)}
              className="shrink-0 min-h-[44px] px-4 rounded-xl bg-brand-dark dark:bg-neutral-900 text-brand-gold text-[10px] font-black uppercase tracking-wide"
            >
              Sair da vista
            </button>
          </div>
        </div>
      ) : null}

      <main
        id="conteudo-principal"
        tabIndex={-1}
        className="px-4 sm:px-6 lg:pl-[17.5rem] py-6 lg:py-8 max-w-[96rem] mx-auto no-print outline-none scroll-mt-24"
      >
        {section === 'inicio' ? (
          <CrmDashboard
            db={dbVisao}
            nome={profile.nome_exibicao?.trim() || ''}
            onOpenCrm={() => setSection('clientes')}
            onOpenAgenda={() => setSection('agenda')}
            onOpenNegocios={() => setSection('painel')}
            onNewLead={openNovoCliente}
            onNewVisit={openNovaVisita}
            onNewProperty={openNovoImovel}
          />
        ) : null}

        {section === 'imoveis' ? (
          <HomeExplore
            db={dbVisao}
            onToggleFavorito={toggleFavoritoImovel}
            onAbrirImovel={openEditImovel}
            onNovoImovel={openNovoImovel}
            onRemoverImovel={(id) => remover('imoveis', id)}
            onAgendarVisita={agendarVisitaComImovel}
          />
        ) : null}

        {section === 'painel' ? (
          <PosVisitaPanel
            db={dbVisao}
            setDb={setDb}
            onRegistrarNaAgenda={registrarVendaNaAgenda}
            currentUserId={effectiveOwnerUserId}
          />
        ) : null}

        {section === 'equipa' ? (
          <EmpresaEquipaPanel
            db={db}
            team={teamProfiles}
            loadError={teamLoadError}
            loading={teamLoading}
            vistaCorretorAtivoId={equipaVistaCorretorId}
            onAbrirVistaCorretor={handleEntrarVistaCorretor}
          />
        ) : null}

        {section === 'agenda' ? (
          <section className="space-y-6" aria-labelledby="heading-agenda">
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
              <div className="min-w-0">
                <h2
                  id="heading-agenda"
                  className="text-2xl font-bold tracking-tighter italic text-brand-dark dark:text-white"
                >
                  Minha <br />
                  <span className="text-brand-gold not-italic">Agenda</span>
                </h2>
                <p className="text-sm text-gray-600 dark:text-neutral-400 mt-2 max-w-md leading-relaxed">
                  Filtre por etapa e altere o andamento diretamente no cartão, sem precisar abrir a edição.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center items-stretch gap-2 shrink-0">
                {rotaDiaUrl ? (
                  <a
                    href={rotaDiaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center min-h-[48px] px-4 py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white text-center"
                  >
                    Rota de hoje
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={openNovaVisita}
                  className="inline-flex items-center justify-center min-h-[48px] bg-brand-gold text-white px-5 py-3 rounded-2xl text-xs font-bold shadow-xl shadow-brand-gold/20 active:scale-95 transition-all"
                >
                  + Agendar visita
                </button>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(true)}
                  className="inline-flex items-center justify-center min-h-[48px] bg-brand-dark text-brand-gold px-4 py-3 rounded-2xl text-xs font-bold shadow-lg shadow-black/10 active:scale-95 transition-all min-w-[7.5rem] dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-700"
                  aria-label="Abrir assistente de agenda"
                >
                  Assistente
                </button>
              </div>
            </div>
            <div
              className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
              role="tablist"
              aria-label="Etapas das visitas"
            >
              {ABAS_AGENDA.map((aba) => {
                const ativa = agendaEtapa === aba.value;
                return (
                  <button
                    key={aba.value}
                    type="button"
                    role="tab"
                    aria-selected={ativa}
                    onClick={() => setAgendaEtapa(aba.value)}
                    className={
                      'shrink-0 min-h-[42px] rounded-xl px-3.5 text-xs font-black transition-colors ' +
                      (ativa
                        ? 'bg-brand-dark text-brand-gold dark:bg-brand-gold dark:text-neutral-950'
                        : 'bg-white dark:bg-neutral-900 text-gray-500 dark:text-neutral-300 border border-gray-200 dark:border-neutral-700')
                    }
                  >
                    {aba.label} <span className="opacity-60">{contagemEtapasAgenda[aba.value]}</span>
                  </button>
                );
              })}
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-neutral-400 mb-1.5 ml-0.5" htmlFor="agenda-busca">
                Pesquisar na agenda
              </label>
              <input
                id="agenda-busca"
                value={agendaBusca}
                onChange={(e) => setAgendaBusca(e.target.value)}
                placeholder="Nome do lead, endereço, bairro…"
                autoComplete="off"
                className="w-full min-h-[48px] p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-sm font-semibold text-hz-ink dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-neutral-400" role="status" aria-live="polite">
              {visitasFiltradas.length === 0
                ? agendaBusca.trim()
                  ? 'Nenhuma visita corresponde à pesquisa.'
                  : agendaEtapa === 'todas'
                    ? 'Nenhuma visita na lista.'
                    : `Nenhuma visita na etapa ${ABAS_AGENDA.find((aba) => aba.value === agendaEtapa)?.label.toLowerCase()}.`
                : `${visitasFiltradas.length} visita${visitasFiltradas.length === 1 ? '' : 's'} na lista.`}
            </p>
            <div className="space-y-4">
              {visitasFiltradas.length === 0 && !agendaBusca.trim() && agendaEtapa === 'todas' ? (
                <p className="text-center text-sm text-gray-500 dark:text-neutral-400 py-8 rounded-2xl border border-dashed border-gray-200 dark:border-neutral-700 px-4">
                  Comece por <strong className="text-hz-ink dark:text-white">+ Agendar visita</strong> ou pelo{' '}
                  <strong className="text-hz-ink dark:text-white">Assistente</strong>.
                </p>
              ) : null}
              {visitasFiltradas.length === 0 && agendaBusca.trim() ? (
                <p className="text-center text-sm text-gray-500 dark:text-neutral-400 py-8">
                  Nenhuma visita corresponde à pesquisa. Limpe o campo ou altere o texto.
                </p>
              ) : null}
              {visitasFiltradas.length === 0 && !agendaBusca.trim() && agendaEtapa !== 'todas' ? (
                <p className="text-center text-sm text-gray-500 dark:text-neutral-400 py-8 rounded-2xl border border-dashed border-gray-200 dark:border-neutral-700 px-4">
                  Nenhuma visita nesta etapa.
                </p>
              ) : null}
              {visitasFiltradas.map((v) => {
                const mapHref = mapsUrlForVisita(v);
                const imCadastrado =
                  v.imovelId != null ? db.imoveis.find((i) => i.id === v.imovelId) : undefined;
                const fe = v.funilEstado ?? 'agendada';
                const foneW = foneParaClienteVisita(v.cliente, dbVisao.clientes);
                const wa24 = foneW ? whatsappLink(foneW, msgLembrete24h(v)) : null;
                const wa2 = foneW ? whatsappLink(foneW, msgLembrete2h(v)) : null;
                const waPos = foneW ? whatsappLink(foneW, msgPosVisita(v)) : null;
                return (
                  <article
                    key={v.id}
                    aria-labelledby={`visita-nome-${v.id}`}
                    className="bg-white dark:bg-neutral-900 p-5 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] shadow-sm border border-gray-100 dark:border-neutral-800 flex flex-col sm:flex-row sm:justify-between gap-4"
                  >
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="bg-brand-dark text-brand-gold font-black p-3 sm:p-4 rounded-3xl text-xs shrink-0 text-center leading-tight min-w-[4.5rem]">
                        <span className="block">{v.hora}</span>
                        <span className="block text-[8px] font-bold opacity-80 mt-1">
                          {v.data || '—'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 id={`visita-nome-${v.id}`} className="font-black text-base text-brand-dark dark:text-white truncate">
                            {v.cliente}
                          </h3>
                          <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-300 shrink-0">
                            {fe}
                          </span>
                          {imCadastrado ? (
                            <span className="text-[8px] font-black uppercase tracking-wide text-white bg-hz-green px-2 py-0.5 rounded-full shrink-0">
                              Imóvel cadastrado
                            </span>
                          ) : null}
                        </div>
                        {v.chave?.trim() ? (
                          <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold mt-1">
                            Chave: {v.chave}
                          </p>
                        ) : null}
                        <p className="text-[10px] text-gray-500 dark:text-neutral-400 font-semibold truncate mt-1">
                          {imCadastrado ? (
                            <>
                              <span className="text-hz-green">{tituloImovel(imCadastrado)}</span>
                              <span className="text-gray-300 dark:text-neutral-600 mx-1">·</span>
                              <span className="text-gray-500 dark:text-neutral-400">
                                {[imCadastrado.bairro, imCadastrado.cidade].filter(Boolean).join(', ')}
                              </span>
                            </>
                          ) : v.endereco?.trim() ? (
                            <span className="uppercase tracking-wide text-gray-400 dark:text-neutral-500">
                              {v.endereco}
                            </span>
                          ) : v.lat != null && v.lng != null ? (
                            <span className="uppercase tracking-wide text-gray-400 dark:text-neutral-500">
                              Localização (GPS)
                            </span>
                          ) : (
                            <span className="uppercase tracking-wide text-gray-400 dark:text-neutral-500">
                              Consultar
                            </span>
                          )}
                        </p>
                        <details className="mt-3 group">
                          <summary className="cursor-pointer list-none inline-flex min-h-[36px] items-center rounded-xl border border-gray-200 dark:border-neutral-700 px-3 text-[10px] font-black uppercase text-gray-500 dark:text-neutral-400">
                            Lembretes e calendário <span className="ml-2 group-open:rotate-180 transition-transform">⌄</span>
                          </summary>
                          <div role="group" aria-label="Calendário e WhatsApp" className="flex flex-wrap gap-1.5 mt-2">
                          <a
                            href={googleCalendarUrl(v)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-[10px] font-bold uppercase text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50"
                          >
                            Google
                          </a>
                          <a
                            href={outlookCalendarUrl(v)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-[10px] font-bold uppercase text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border border-sky-100 dark:border-sky-900/50"
                          >
                            Outlook
                          </a>
                          <button
                            type="button"
                            onClick={() => downloadIcsForVisitas([v], `visita-${v.id}`)}
                            className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-[10px] font-bold uppercase text-gray-700 dark:text-neutral-300 bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-600"
                          >
                            Descarregar .ics
                          </button>
                          {wa24 ? (
                            <a
                              href={wa24}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40"
                            >
                              WhatsApp 24h
                            </a>
                          ) : null}
                          {wa2 ? (
                            <a
                              href={wa2}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40"
                            >
                              WhatsApp 2h
                            </a>
                          ) : null}
                          {waPos ? (
                            <a
                              href={waPos}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40"
                            >
                              WhatsApp pós-visita
                            </a>
                          ) : null}
                          </div>
                        </details>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0 self-end sm:self-center items-center justify-end">
                      <label className="sr-only" htmlFor={`etapa-visita-${v.id}`}>
                        Alterar etapa de {v.cliente}
                      </label>
                      <select
                        id={`etapa-visita-${v.id}`}
                        value={fe}
                        onChange={(e) => atualizarEtapaVisita(v, e.target.value as FunilVisita)}
                        className="min-h-[48px] px-3 rounded-2xl bg-brand-dark text-brand-gold dark:bg-neutral-800 border border-brand-gold/30 text-xs font-black outline-none"
                        aria-label={`Etapa da visita de ${v.cliente}`}
                      >
                        <option value="agendada">Agendada</option>
                        <option value="realizada">Realizada</option>
                        <option value="proposta">Proposta</option>
                        <option value="cancelada">Cancelada</option>
                      </select>
                      {mapHref ? (
                        <a
                          href={mapHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] px-3 bg-gray-50 dark:bg-neutral-800 text-blue-600 dark:text-blue-300 rounded-2xl touch-manipulation text-xs font-bold border border-gray-200 dark:border-neutral-600"
                          aria-label={`Abrir localização no mapa para ${v.cliente}`}
                        >
                          Mapa
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openEditVisita(v)}
                        className="inline-flex items-center justify-center min-h-[48px] px-4 bg-gray-50 dark:bg-neutral-800 text-gray-700 dark:text-neutral-200 rounded-2xl touch-manipulation text-xs font-bold border border-gray-200 dark:border-neutral-600"
                        aria-label={`Editar visita de ${v.cliente}`}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => remover('visitas', v.id)}
                        className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] px-3 bg-gray-50 dark:bg-neutral-800 text-red-600 dark:text-red-400 rounded-2xl font-bold touch-manipulation text-lg leading-none border border-red-100 dark:border-red-900/40"
                        aria-label={`Eliminar visita de ${v.cliente}`}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {section === 'clientes' ? (
          <section className="space-y-6" aria-labelledby="heading-leads">
            <div className="flex justify-between items-center gap-3">
              <h2
                id="heading-leads"
                className="text-2xl font-bold tracking-tighter italic text-brand-dark dark:text-white"
              >
                CRM <br />
                <span className="text-brand-gold not-italic">Comercial</span>
              </h2>
              <button
                type="button"
                onClick={openNovoCliente}
                className="bg-brand-dark text-white px-5 py-3 rounded-2xl text-xs font-bold shadow-lg shadow-black/20 shrink-0"
              >
                + Novo lead
              </button>
            </div>
            <div className="rounded-[1.5rem] border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
              <div className="flex items-center justify-between gap-3 px-1 pb-3">
                <div>
                  <p className="text-xs font-black text-brand-dark dark:text-white">Funil comercial</p>
                  <p className="text-[10px] text-gray-500 dark:text-neutral-400 mt-0.5">Etapas atualizadas pelas visitas e vendas</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCrmEtapa('todas')}
                  className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-black uppercase ${
                    crmEtapa === 'todas'
                      ? 'bg-brand-dark text-brand-gold'
                      : 'bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-300'
                  }`}
                >
                  Todos {dbVisao.clientes.length}
                </button>
              </div>
              <div className="grid grid-cols-8 gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Etapas do CRM">
                {CRM_STAGE_ORDER.map((etapa, index) => {
                  const active = crmEtapa === etapa;
                  const clientesDaEtapa = dbVisao.clientes.filter(
                    (cliente) => getClientCrmStage(dbVisao, cliente) === etapa
                  );
                  return (
                    <button
                      key={etapa}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setCrmEtapa(etapa)}
                      className={`relative min-w-[10.5rem] min-h-[178px] rounded-xl p-2.5 text-left border transition-colors ${
                        active
                          ? 'border-brand-gold ring-2 ring-brand-gold/20 bg-brand-gold/5'
                          : 'border-gray-100 dark:border-neutral-800 bg-gray-50/70 dark:bg-neutral-800/50'
                      }`}
                    >
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-lg px-1.5 text-[10px] font-black ${CRM_STAGE_STYLE[etapa]}`}>
                        {crmStageCounts[etapa]}
                      </span>
                      <span className="block text-[9px] font-black uppercase leading-tight text-brand-dark dark:text-neutral-200 mt-2">
                        {CRM_STAGE_LABEL[etapa]}
                      </span>
                      <span className="block text-[9px] leading-tight text-gray-500 dark:text-neutral-400 mt-1">
                        {CRM_STAGE_DESCRIPTION[etapa]}
                      </span>
                      <span className="block mt-3 space-y-1.5">
                        {clientesDaEtapa.slice(0, 3).map((cliente) => (
                          <span key={cliente.id} className="block truncate rounded-lg bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-700 px-2 py-1.5 text-[10px] font-bold text-hz-ink dark:text-white shadow-sm">
                            {cliente.nome}
                          </span>
                        ))}
                        {clientesDaEtapa.length > 3 ? (
                          <span className="block text-[9px] font-bold text-gray-400 px-1">+ {clientesDaEtapa.length - 3} oportunidade(s)</span>
                        ) : null}
                      </span>
                      {index < CRM_STAGE_ORDER.length - 1 ? (
                        <span className="absolute -right-2 top-1/2 z-10 hidden sm:block text-gray-300 dark:text-neutral-600" aria-hidden>›</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label
                className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-neutral-400 mb-1.5 ml-0.5"
                htmlFor="leads-busca"
              >
                Pesquisar leads
              </label>
              <input
                id="leads-busca"
                value={leadsBusca}
                onChange={(e) => setLeadsBusca(e.target.value)}
                placeholder="Pesquisar no CRM por nome, telefone ou imóvel…"
                autoComplete="off"
                className="w-full min-h-[48px] p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-sm font-semibold text-hz-ink dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500"
              />
            </div>
            <details className="rounded-2xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 group">
              <summary className="cursor-pointer list-none p-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-neutral-400 flex justify-between gap-3">
                Filtros por data
                <span className="group-open:rotate-180 transition-transform">⌄</span>
              </summary>
              <div className="border-t border-gray-100 dark:border-neutral-800 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="leads-cadastro-de"
                    className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1"
                  >
                    A partir de
                  </label>
                  <input
                    id="leads-cadastro-de"
                    type="date"
                    value={leadsCadastroDe}
                    onChange={(e) => setLeadsCadastroDe(e.target.value)}
                    className="w-full min-h-[48px] p-3 rounded-xl bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-600 text-sm font-semibold text-hz-ink dark:text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="leads-cadastro-ate"
                    className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1"
                  >
                    Até
                  </label>
                  <input
                    id="leads-cadastro-ate"
                    type="date"
                    value={leadsCadastroAte}
                    onChange={(e) => setLeadsCadastroAte(e.target.value)}
                    className="w-full min-h-[48px] p-3 rounded-xl bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-600 text-sm font-semibold text-hz-ink dark:text-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const h = todayISODate();
                    setLeadsCadastroDe(h);
                    setLeadsCadastroAte(h);
                  }}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-200"
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const h = todayISODate();
                    setLeadsCadastroDe(isoDaysAgoLocal(7));
                    setLeadsCadastroAte(h);
                  }}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-200"
                >
                  Últimos 7 dias
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const h = todayISODate();
                    setLeadsCadastroDe(primeiroDiaMesLocal());
                    setLeadsCadastroAte(h);
                  }}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-200"
                >
                  Este mês
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLeadsCadastroDe('');
                    setLeadsCadastroAte('');
                  }}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase border border-gray-200 dark:border-neutral-600 text-gray-500 dark:text-neutral-400"
                >
                  Limpar datas
                </button>
              </div>
              </div>
            </details>
            <div className="space-y-4">
              {clientesFiltrados.length === 0 ? (
                <p className="text-center text-sm text-gray-500 dark:text-neutral-400 py-8">
                  {leadsBusca.trim() || leadsCadastroDe.trim() || leadsCadastroAte.trim() || crmEtapa !== 'todas'
                    ? 'Nenhum cliente corresponde aos filtros do CRM.'
                    : 'Nenhum lead ainda.'}
                </p>
              ) : null}
              {clientesFiltrados.map((c) => {
                const digits = onlyDigits(c.fone);
                const wa = digits ? whatsappLink(c.fone, '') : null;
                const crmStage = getClientCrmStage(dbVisao, c);
                const matches = matchImoveisParaCliente(c, db.imoveis).slice(0, 2);
                const imLead =
                  c.imovelInteresseId != null
                    ? db.imoveis.find((i) => i.id === c.imovelInteresseId)
                    : undefined;
                return (
                  <div
                    key={c.id}
                    className="bg-white dark:bg-neutral-900 rounded-2xl shadow-sm border border-gray-100 dark:border-neutral-800 overflow-hidden"
                  >
                    <div className="p-4 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-black text-lg truncate dark:text-white">{c.nome}</h4>
                        <span className={`text-[9px] px-2.5 py-1 rounded-full font-black uppercase shrink-0 ${CRM_STAGE_STYLE[crmStage]}`}>
                          {CRM_STAGE_LABEL[crmStage]}
                        </span>
                        <span className="text-[8px] bg-brand-gold/10 text-brand-gold px-2 py-0.5 rounded-full font-black uppercase shrink-0">
                          {c.status}
                        </span>
                        {c.urgencia ? (
                          <span className="text-[8px] text-amber-700 dark:text-amber-300 font-black uppercase shrink-0">
                            urg. {c.urgencia}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-neutral-400 mt-0.5">
                        {c.fone ? maskPhoneBr(c.fone) : 'Sem telefone'} · {formatDataCadastroBr(dataCadastroEfetiva(c))}
                        {!c.dataCadastro ? (
                          <span className="text-gray-400 dark:text-neutral-500"> · data estimada</span>
                        ) : null}
                      </p>
                      {c.ultimoContatoEm ? (
                        <p className="text-[10px] text-gray-400 dark:text-neutral-500 mt-1">
                          Último contato: {formatDataCadastroBr(c.ultimoContatoEm)}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-2 rounded-xl bg-gray-50 dark:bg-neutral-800/60 px-3 py-2">
                        <strong className="text-brand-dark dark:text-white">Próxima ação:</strong>{' '}
                        {crmStage === 'novo'
                          ? 'fazer o primeiro contato'
                          : crmStage === 'contato'
                            ? 'validar perfil, orçamento e região'
                            : crmStage === 'qualificado'
                              ? 'selecionar imóvel e agendar visita'
                              : crmStage === 'visita'
                                ? 'realizar a visita na data combinada'
                                : crmStage === 'pos_visita'
                                  ? 'registrar feedback e decisão do cliente'
                                  : crmStage === 'proposta'
                                    ? 'acompanhar a negociação e registrar a venda'
                                    : crmStage === 'venda'
                                      ? 'acompanhar confirmação e comissão'
                                      : 'reativar somente quando houver novo interesse'}
                        {c.proximoContatoEm && crmStage !== 'perdido' && crmStage !== 'venda' ? (
                          <span className={`block mt-1 font-bold ${c.proximoContatoEm < todayISODate() ? 'text-red-600 dark:text-red-400' : 'text-hz-green dark:text-emerald-400'}`}>
                            Próximo contato: {formatDataCadastroBr(c.proximoContatoEm)}
                            {c.proximoContatoEm < todayISODate() ? ' · atrasado' : ''}
                          </span>
                        ) : null}
                      </p>
                      {c.orcamentoMax || c.quartosDesejados ? (
                        <p className="text-[11px] font-bold text-gray-500 dark:text-neutral-400 mt-1">
                          {c.orcamentoMax ? `Até ${formatBrlFull(c.orcamentoMax)}` : 'Orçamento não informado'}
                          {c.quartosDesejados ? ` · ${c.quartosDesejados} quarto${c.quartosDesejados === 1 ? '' : 's'}` : ''}
                        </p>
                      ) : null}
                      {c.bairrosInteresse?.trim() ? (
                        <p className="text-[10px] text-gray-500 dark:text-neutral-400 mt-1 line-clamp-2">
                          📍 {c.bairrosInteresse}
                        </p>
                      ) : null}
                      {matches.length > 0 ? (
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mt-1 leading-snug">
                          Sugestões: {matches.map((m) => tituloImovel(m)).join(' · ')}
                        </p>
                      ) : null}
                      {imLead ? (
                        <p className="text-[10px] text-hz-green dark:text-emerald-400 font-bold mt-1 leading-snug">
                          Imóvel ligado: {tituloImovel(imLead)}
                        </p>
                      ) : c.imovelInteresseId != null ? (
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold mt-1">
                          Imóvel ligado foi removido do cadastro — edite o lead para escolher outro.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50/80 dark:bg-neutral-800/40 border-t border-gray-100 dark:border-neutral-800">
                      {crmStage === 'novo' ? (
                        <button
                          type="button"
                          onClick={() => atualizarEtapaManualCliente(c.id, 'contato')}
                          className="min-h-[40px] px-3.5 rounded-xl bg-brand-dark text-brand-gold font-black text-[10px] uppercase"
                        >
                          Marcar contato feito
                        </button>
                      ) : crmStage === 'contato' ? (
                        <button type="button" onClick={() => atualizarEtapaManualCliente(c.id, 'qualificado')} className="min-h-[40px] px-3.5 rounded-xl bg-indigo-600 text-white font-black text-[10px] uppercase">
                          Qualificar lead
                        </button>
                      ) : crmStage === 'qualificado' ? (
                        <button type="button" onClick={() => openNovaVisitaForCliente(c)} className="min-h-[40px] px-3.5 rounded-xl bg-brand-dark text-brand-gold font-black text-[10px] uppercase">
                          + Agendar visita
                        </button>
                      ) : crmStage === 'visita' ? (
                        <button type="button" onClick={() => setSection('agenda')} className="min-h-[40px] px-3.5 rounded-xl bg-blue-600 text-white font-black text-[10px] uppercase">
                          Ver na agenda
                        </button>
                      ) : crmStage === 'pos_visita' || crmStage === 'proposta' || crmStage === 'venda' ? (
                        <button type="button" onClick={() => setSection('painel')} className="min-h-[40px] px-3.5 rounded-xl bg-violet-600 text-white font-black text-[10px] uppercase">
                          {crmStage === 'venda' ? 'Ver venda' : 'Abrir negociação'}
                        </button>
                      ) : (
                        <button type="button" onClick={() => atualizarEtapaManualCliente(c.id, 'novo')} className="min-h-[40px] px-3.5 rounded-xl bg-gray-700 text-white font-black text-[10px] uppercase">
                          Reativar lead
                        </button>
                      )}
                      {wa ? (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (crmStage === 'novo') atualizarEtapaManualCliente(c.id, 'contato');
                          }}
                          className="inline-flex min-h-[40px] items-center bg-brand-success px-3.5 rounded-xl text-white font-black text-[10px] touch-manipulation"
                        >
                          WhatsApp
                        </a>
                      ) : (
                        <span className="inline-flex min-h-[40px] items-center px-3 text-gray-400 text-[10px]">Sem telefone</span>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditCliente(c)}
                        className="min-h-[40px] px-3.5 bg-white dark:bg-neutral-800 text-gray-600 dark:text-neutral-300 rounded-xl border border-gray-200 dark:border-neutral-700 touch-manipulation text-[10px] font-bold"
                      >
                        Editar
                      </button>
                      {crmStage !== 'venda' && crmStage !== 'perdido' ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm('Encerrar esta oportunidade como perdida? O lead poderá ser reativado depois.')) {
                              atualizarEtapaManualCliente(c.id, 'perdido');
                            }
                          }}
                          className="min-h-[40px] px-3 text-gray-500 dark:text-neutral-400 text-[10px] font-bold"
                        >
                          Marcar perdido
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => remover('clientes', c.id)}
                        className="ml-auto min-h-[40px] px-3 bg-transparent text-red-400 dark:text-red-400 rounded-xl font-bold touch-manipulation text-[10px]"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {section === 'calc' ? (
          <section className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tighter text-center italic text-brand-dark dark:text-white">
              Simulador <span className="text-brand-gold not-italic">Financeiro</span>
            </h2>
            <div className="bg-white dark:bg-neutral-900 p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] shadow-sm border border-gray-100 dark:border-neutral-800 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-2">
                  Valor do imóvel (R$)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Ex: 850000"
                  value={fValor}
                  onChange={(e) => setFValor(e.target.value)}
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none font-semibold text-lg border-0 focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-2">
                  Entrada (R$) — opcional
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={fEntrada}
                  onChange={(e) => setFEntrada(e.target.value)}
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none font-semibold border-0 focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-2">
                  Número de parcelas (meses)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  placeholder="360"
                  value={fParcelas}
                  onChange={(e) => setFParcelas(e.target.value)}
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none font-semibold border-0 focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-2">
                  Taxa de juros a.a. (% nominal)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="10,5"
                  value={fTaxaAa}
                  onChange={(e) => setFTaxaAa(e.target.value)}
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none font-semibold border-0 focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
              </div>
              <button
                type="button"
                onClick={calcular}
                className="w-full bg-brand-dark dark:bg-neutral-800 text-white font-bold py-4 sm:py-5 rounded-2xl shadow-xl active:scale-95 transition-all uppercase tracking-widest text-xs min-h-[52px] dark:ring-1 dark:ring-neutral-600"
              >
                Calcular SAC
              </button>
              {resCalcOpen && simulationDetails ? (
                <div className="pt-6 border-t border-gray-100 dark:border-neutral-700 space-y-4">
                  <p className="text-[10px] font-bold text-gray-500 dark:text-neutral-400 uppercase tracking-widest text-center">
                    Financiado {simulationDetails.financiadoFmt} · {simulationDetails.parcelasLabel}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 p-4">
                      <p className="text-[9px] font-bold uppercase text-amber-900/80 dark:text-amber-200/90 tracking-wide mb-1">
                        1.ª parcela
                      </p>
                      <p className="text-lg font-black text-amber-900 dark:text-amber-300 tabular-nums">
                        {simulationDetails.primeiraFmt}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-gray-50 dark:bg-neutral-800 border border-gray-100 dark:border-neutral-700 p-4">
                      <p className="text-[9px] font-bold uppercase text-gray-500 dark:text-neutral-400 tracking-wide mb-1">
                        Última parcela
                      </p>
                      <p className="text-lg font-black text-brand-dark dark:text-white tabular-nums">
                        {simulationDetails.ultimaFmt}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-center text-gray-600 dark:text-neutral-400 px-1">
                    Amort. fixa {simulationDetails.amortizacaoFmt} · Juros total estimado{' '}
                    {simulationDetails.totalJurosFmt}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPropostaOpen(true)}
                    className="w-full border-2 border-brand-gold text-brand-gold font-bold py-4 rounded-2xl active:bg-brand-gold/10 transition-all uppercase tracking-widest text-xs min-h-[48px]"
                  >
                    Abrir proposta (PDF)
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {section === 'todo' ? (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold tracking-tighter italic text-brand-dark dark:text-white">
                Lembretes
              </h2>
              <span className="bg-brand-gold text-white text-[10px] font-black px-3 py-1 rounded-full">
                {dbVisao.tarefas.length}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                value={todoInput}
                onChange={(e) => setTodoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTodo()}
                type="text"
                placeholder="Tarefa para hoje..."
                className="flex-grow p-4 rounded-2xl border-0 bg-white dark:bg-neutral-900 dark:text-white shadow-sm outline-none min-h-[48px] text-base dark:ring-1 dark:ring-neutral-700"
              />
              <button
                type="button"
                onClick={addTodo}
                className="bg-brand-dark dark:bg-neutral-800 text-white w-14 h-14 rounded-2xl font-bold text-2xl shadow-lg shadow-black/10 shrink-0 touch-manipulation dark:ring-1 dark:ring-neutral-600"
                aria-label="Adicionar tarefa"
              >
                +
              </button>
            </div>
            <div className="bg-white dark:bg-neutral-900 rounded-[2rem] sm:rounded-[2.5rem] shadow-sm divide-y divide-gray-50 dark:divide-neutral-800 overflow-hidden dark:ring-1 dark:ring-neutral-800">
              {dbVisao.tarefas.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-5 sm:p-6 gap-3">
                  <span className="text-sm font-bold text-gray-700 dark:text-neutral-200 break-words">
                    {t.txt}
                  </span>
                  <button
                    type="button"
                    onClick={() => remover('tarefas', t.id)}
                    className="text-red-300 text-2xl shrink-0 touch-manipulation"
                    aria-label="Remover"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <PropostaOverlay
        open={propostaOpen}
        onClose={() => setPropostaOpen(false)}
        prData={prData}
        details={simulationDetails}
      />

      <nav
        className="hidden fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-neutral-950/95 backdrop-blur-xl border-t border-gray-100 dark:border-neutral-800 justify-around items-stretch pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] px-1 sm:px-4 z-40 no-print safe-pb"
        aria-label="Navegação principal"
      >
        {navItems.map(([id, label, d]) => {
          const active = section === id;
          const activeClass =
            section === 'inicio' && active ? 'active-tab-hz text-hz-green' : 'active-tab text-brand-gold';
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={active ? 'page' : undefined}
              className={
                'flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 min-h-[52px] transition-all touch-manipulation py-2 px-1 rounded-xl ' +
                (active ? activeClass : 'text-gray-300 dark:text-neutral-500')
              }
            >
              <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeWidth={2} d={d} />
              </svg>
              <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-tighter truncate max-w-full leading-tight text-center">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {modalVisita ? (
        <div
          className="fixed inset-0 z-50 modal-overlay flex items-end no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-visita-titulo"
        >
          <div className="bg-white dark:bg-neutral-900 w-full rounded-t-[3rem] p-8 sm:p-10 max-h-[90vh] overflow-y-auto max-w-2xl mx-auto dark:text-neutral-100">
            <div className="w-12 h-1 bg-gray-200 dark:bg-neutral-600 mx-auto mb-6 rounded-full" aria-hidden />
            <h3
              id="modal-visita-titulo"
              className="text-2xl sm:text-3xl font-black mb-6 italic tracking-tight"
            >
              {editVisitaId != null ? (
                <>
                  Editar <span className="text-brand-gold not-italic">Visita</span>
                </>
              ) : (
                <>
                  Agendar <span className="text-brand-gold not-italic">Visita</span>
                </>
              )}
            </h3>
            <div className="space-y-4">
              {vImovelId != null && !db.imoveis.some((i) => i.id === vImovelId) ? (
                <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded-xl p-3 border border-amber-200/80 dark:border-amber-800/60">
                  O imóvel original foi removido; preencha o endereço ou escolha outro cadastro abaixo.
                </p>
              ) : null}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest ml-1 text-gray-400 dark:text-neutral-500">
                  Lead (cadastro)
                </label>
                <select
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl border-0 font-semibold outline-none min-h-[48px]"
                  value={vClienteId === '' ? '' : String(vClienteId)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) {
                      setVClienteId('');
                      return;
                    }
                    const id = Number(raw);
                    setVClienteId(id);
                    const c = dbVisao.clientes.find((x) => x.id === id);
                    if (!c) return;
                    setVCliente(clienteAgendaLabel(c));
                    if (c.imovelInteresseId) {
                      const im = db.imoveis.find((m) => m.id === c.imovelInteresseId);
                      if (im) {
                        setVImovelId(im.id);
                        setVEndereco(enderecoParaVisitaDeImovel(im));
                        setVLat(undefined);
                        setVLng(undefined);
                      }
                    }
                  }}
                >
                  <option value="">Selecionar lead (puxa imóvel e localização cadastrados)…</option>
                  {dbVisao.clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {clienteAgendaLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              <ImovelSearchPicker
                imoveis={db.imoveis}
                selectedId={
                  vImovelId != null && db.imoveis.some((i) => i.id === vImovelId)
                    ? vImovelId
                    : undefined
                }
                onPick={(m) => {
                  setVImovelId(m.id);
                  setVEndereco(enderecoParaVisitaDeImovel(m));
                }}
                onClear={() => setVImovelId(undefined)}
                variant="visita"
              />
              <input
                value={vCliente}
                onChange={(e) => {
                  setVCliente(e.target.value);
                  setVClienteId('');
                }}
                placeholder="Nome do lead (texto da visita)"
                className="w-full p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-semibold focus:ring-2 ring-brand-gold/30 min-h-[48px]"
              />
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
                  Data da visita
                </label>
                <input
                  type="date"
                  value={vData}
                  onChange={(e) => setVData(e.target.value)}
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-bold min-h-[48px]"
                />
              </div>
              <input
                type="time"
                value={vHora}
                onChange={(e) => setVHora(e.target.value)}
                className="w-full p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-bold text-center min-h-[48px]"
              />
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
                  Chave do imóvel
                </label>
                <input
                  value={vChave}
                  onChange={(e) => setVChave(e.target.value)}
                  placeholder="Ex: Portaria · Imobiliária X · Com proprietário"
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-semibold focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">
                  Estado no funil
                </label>
                <select
                  value={vFunilEstado}
                  onChange={(e) => setVFunilEstado(e.target.value as FunilVisita)}
                  className="w-full mt-1 p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl border-0 font-bold outline-none min-h-[48px]"
                >
                  <option value="agendada">Agendada</option>
                  <option value="realizada">Realizada</option>
                  <option value="proposta">Proposta</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </div>
              <input
                value={vEndereco}
                onChange={(e) => setVEndereco(e.target.value)}
                placeholder={
                  vImovelId != null
                    ? 'Endereço da visita (veio do imóvel — pode editar)'
                    : 'Endereço ou referência'
                }
                className="w-full p-4 sm:p-5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-semibold focus:ring-2 ring-brand-gold/30 min-h-[48px]"
              />
              <button
                type="button"
                onClick={fillVisitaGps}
                disabled={loadingGpsVisita}
                className="w-full border-2 border-brand-dark/15 dark:border-neutral-600 text-brand-dark dark:text-neutral-200 font-bold py-4 rounded-2xl text-xs uppercase tracking-wider disabled:opacity-50 min-h-[48px]"
              >
                {loadingGpsVisita ? 'A obter localização…' : 'Usar localização (GPS)'}
              </button>
              <button
                type="button"
                onClick={saveVisita}
                className="w-full bg-brand-gold text-white font-black py-5 rounded-[2rem] shadow-2xl mt-4 uppercase tracking-widest text-xs min-h-[52px]"
              >
                Confirmar Dados
              </button>
              <button
                type="button"
                onClick={() => {
                  setVImovelId(undefined);
                  setVClienteId('');
                  setModalVisita(false);
                }}
                className="w-full text-gray-400 dark:text-neutral-500 py-3 font-bold text-[10px] uppercase tracking-widest"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalCliente ? (
        <div className="fixed inset-0 z-50 modal-overlay flex items-end no-print">
          <div className="bg-white dark:bg-neutral-900 w-full rounded-t-[2rem] p-5 sm:p-7 max-h-[92vh] overflow-y-auto max-w-xl mx-auto dark:text-neutral-100">
            <div className="w-10 h-1 bg-gray-200 dark:bg-neutral-600 mx-auto mb-4 rounded-full" />
            <h3 className="text-2xl font-black mb-4 italic tracking-tight">
              {editClienteId != null ? (
                <>
                  Editar <span className="text-brand-gold not-italic">Lead</span>
                </>
              ) : (
                <>
                  Capturar <span className="text-brand-gold not-italic">Lead</span>
                </>
              )}
            </h3>
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  value={cNome}
                  onChange={(e) => setCNome(e.target.value)}
                  placeholder="Nome do interessado *"
                  autoFocus
                  className="w-full p-3.5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-xl border-0 font-semibold outline-none focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
                <input
                  type="tel"
                  inputMode="tel"
                  value={cFone}
                  onChange={(e) => setCFone(maskPhoneBr(e.target.value))}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  className="w-full p-3.5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-xl border-0 font-semibold outline-none focus:ring-2 ring-brand-gold/30 min-h-[48px]"
                />
              </div>
              <select
                value={cStatus}
                onChange={(e) => setCStatus(e.target.value)}
                aria-label="Temperatura do lead"
                className="w-full p-3.5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-xl border-0 font-bold outline-none min-h-[48px]"
              >
                <option value="Quente">🔥 Quente</option>
                <option value="Morno">🌤️ Morno</option>
                <option value="Frio">❄️ Frio</option>
              </select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-gray-50 dark:bg-neutral-800/70 p-3">
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 dark:text-neutral-400 mb-1">
                    Etapa inicial do CRM
                  </label>
                  <select
                    value={cEtapaCrmManual}
                    onChange={(e) => setCEtapaCrmManual(e.target.value as typeof cEtapaCrmManual)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-neutral-900 dark:text-white border border-gray-200 dark:border-neutral-700 text-xs font-bold"
                  >
                    <option value="novo">Novo lead</option>
                    <option value="contato">Em contato</option>
                    <option value="qualificado">Qualificado</option>
                    <option value="perdido">Perdido</option>
                  </select>
                  <p className="text-[9px] text-gray-400 mt-1">Visitas, proposta e venda avançam automaticamente.</p>
                </div>
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 dark:text-neutral-400 mb-1">
                    Próximo contato
                  </label>
                  <input
                    type="date"
                    value={cProximoContatoEm}
                    onChange={(e) => setCProximoContatoEm(e.target.value)}
                    disabled={cEtapaCrmManual === 'perdido'}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-neutral-900 dark:text-white border border-gray-200 dark:border-neutral-700 text-xs font-bold disabled:opacity-50"
                  />
                </div>
              </div>
              <input
                value={cBairros}
                onChange={(e) => setCBairros(e.target.value)}
                placeholder="Bairros / regiões de interesse"
                className="w-full p-3.5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-xl border-0 font-semibold outline-none focus:ring-2 ring-brand-gold/30 min-h-[48px]"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={cQuartos}
                  onChange={(e) => setCQuartos(e.target.value)}
                  placeholder="Quartos"
                  className="w-full p-3.5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-xl border-0 font-bold outline-none min-h-[48px]"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={cOrcMax}
                  onChange={(e) => setCOrcMax(maskBrlWhole(e.target.value))}
                  placeholder="Orçamento máximo"
                  className="w-full p-3.5 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-xl border-0 font-bold outline-none min-h-[48px]"
                />
              </div>
              <details className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
                <summary className="cursor-pointer list-none p-3.5 text-xs font-bold text-gray-600 dark:text-neutral-300">
                  + Imóvel de interesse e observações
                </summary>
                <div className="border-t border-gray-100 dark:border-neutral-800 p-3.5 space-y-3">
                  <ImovelSearchPicker
                    imoveis={db.imoveis}
                    selectedId={
                      cImovelInteresseId != null && db.imoveis.some((i) => i.id === cImovelInteresseId)
                        ? cImovelInteresseId
                        : undefined
                    }
                    onPick={(m) => setCImovelInteresseId(m.id)}
                    onClear={() => setCImovelInteresseId(undefined)}
                    variant="lead"
                  />
                  <textarea
                    value={cNotas}
                    onChange={(e) => setCNotas(e.target.value)}
                    placeholder="Observações"
                    rows={2}
                    className="w-full p-3.5 rounded-xl bg-gray-50 dark:bg-neutral-800 dark:text-white border-0 text-sm outline-none focus:ring-2 ring-brand-gold/30"
                  />
                </div>
              </details>
              <div className="grid grid-cols-[1fr_2fr] gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setModalCliente(false)}
                  className="min-h-[50px] rounded-xl border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-300 font-bold text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveCliente}
                  className="min-h-[50px] rounded-xl bg-brand-dark text-white font-black shadow-lg uppercase tracking-wider text-xs"
                >
                  Salvar lead
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modalImovel ? (
        <div className="fixed inset-0 z-50 modal-overlay flex items-end no-print">
          <div className="bg-white dark:bg-neutral-900 w-full rounded-t-[3rem] p-8 sm:p-10 max-h-[90vh] overflow-y-auto max-w-2xl mx-auto dark:text-neutral-100">
            <div className="w-12 h-1 bg-gray-200 dark:bg-neutral-600 mx-auto mb-6 rounded-full" />
            <h3 className="font-display text-2xl sm:text-3xl text-hz-ink dark:text-white mb-1">
              {editImovelId != null ? 'Editar imóvel' : 'Novo imóvel'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mb-6 leading-relaxed">
              O cadastro de imóveis é feito apenas no separador Início. Use o botão de localização para
              preencher o endereço pelo GPS; depois ajuste bairro e cidade se precisar. Fotos são
              otimizadas automaticamente.
            </p>
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 mb-2">
                  Fotos
                </p>
                <input
                  id="imovel-fotos-input"
                  ref={imovelFotosRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => void onPickImovelFotos(e)}
                />
                {iFotoFeedback ? (
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800 rounded-2xl px-4 py-3 mb-2">
                    {iFotoFeedback}
                  </p>
                ) : null}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {iFotos.map((src, idx) => (
                    <div
                      key={`${idx}-${src.slice(0, 48)}`}
                      className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-neutral-800"
                    >
                      <img
                        src={src}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() =>
                          appendFotoLog(`PREVIEW falhou (miniatura): #${idx + 1} ${src.slice(0, 72)}…`)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removerFotoImovel(idx)}
                        className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white text-xs font-bold"
                        aria-label="Remover foto"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {iFotos.length < 8 ? (
                    <label
                      htmlFor={iFotosLoading ? undefined : 'imovel-fotos-input'}
                      className={
                        'aspect-square rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-600 bg-hz-cream dark:bg-neutral-800 flex flex-col items-center justify-center gap-1 text-gray-500 dark:text-neutral-400 text-[10px] font-bold p-2 ' +
                        (iFotosLoading ? 'opacity-50 pointer-events-none' : 'cursor-pointer active:scale-[0.98]')
                      }
                    >
                      <span className="text-2xl leading-none">+</span>
                      {iFotosLoading ? 'A processar…' : 'Galeria'}
                    </label>
                  ) : null}
                </div>
                <p className="text-[10px] text-gray-400 dark:text-neutral-500 mt-2">
                  Até 8 fotos · primeira imagem = capa
                </p>
                <details className="mt-3 rounded-2xl border border-gray-200 dark:border-neutral-700 bg-gray-50/80 dark:bg-neutral-800/50 p-3">
                  <summary className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-neutral-400 cursor-pointer">
                    Log de fotos (teste de erros)
                  </summary>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIFotoDebugLog([])}
                      className="text-[10px] font-bold uppercase text-gray-500 dark:text-neutral-400 underline"
                    >
                      Limpar log
                    </button>
                    <span className="text-[10px] text-gray-400 dark:text-neutral-500">
                      Abra a consola (F12) — cada linha também aparece como [fotos]
                    </span>
                  </div>
                  {iFotoDebugLog.length === 0 ? (
                    <p className="text-[10px] text-gray-400 dark:text-neutral-500 mt-2">
                      Sem eventos ainda. Ao escolher fotos, o resultado aparece aqui.
                    </p>
                  ) : (
                    <pre className="mt-2 text-[10px] font-mono text-gray-700 dark:text-neutral-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {iFotoDebugLog.join('\n')}
                    </pre>
                  )}
                </details>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                  Endereço (rua, número)
                </label>
                <input
                  value={iEndereco}
                  onChange={(e) => setIEndereco(e.target.value)}
                  placeholder="Ex: Rua das Flores, 42 — ap 101"
                  className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-semibold min-h-[48px]"
                />
                <button
                  type="button"
                  onClick={() => void fillImovelGps()}
                  disabled={loadingGpsImovel}
                  className="mt-2 w-full border-2 border-hz-green/30 dark:border-emerald-700/50 text-hz-green dark:text-emerald-400 font-bold py-3.5 rounded-2xl text-xs uppercase tracking-wider disabled:opacity-50 min-h-[44px]"
                >
                  {loadingGpsImovel ? 'A obter localização…' : 'Usar localização (GPS) no endereço'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                    Bairro
                  </label>
                  <input
                    value={iBairro}
                    onChange={(e) => setIBairro(e.target.value)}
                    placeholder="Bairro"
                    className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-semibold min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                    Banheiros
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={iBanheiros}
                    onChange={(e) => setIBanheiros(e.target.value)}
                    className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-bold text-center min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                    Cidade
                  </label>
                  <input
                    value={iCidade}
                    onChange={(e) => setICidade(e.target.value)}
                    placeholder="Cidade"
                    className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-semibold min-h-[48px]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                  Preço (R$)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={iPreco}
                  onChange={(e) => setIPreco(maskBrlWhole(e.target.value))}
                  placeholder="R$ 850.000"
                  className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-bold min-h-[48px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                    Quartos
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={iQuartos}
                    onChange={(e) => setIQuartos(e.target.value)}
                    className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl outline-none border-0 font-bold text-center min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500 ml-1">
                    Tipo
                  </label>
                  <select
                    value={iTipo}
                    onChange={(e) => setITipo(e.target.value as TipoImovel)}
                    className="mt-1 w-full p-4 bg-gray-50 dark:bg-neutral-800 dark:text-white rounded-2xl border-0 font-bold outline-none min-h-[48px]"
                  >
                    <option value="Apartamento">Apartamento</option>
                    <option value="Casa">Casa</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={saveImovel}
                className="w-full bg-hz-green text-white font-black py-5 rounded-[2rem] shadow-xl uppercase tracking-widest text-xs min-h-[52px]"
              >
                Guardar imóvel
              </button>
              <button
                type="button"
                onClick={() => setModalImovel(false)}
                className="w-full text-gray-400 dark:text-neutral-500 py-3 font-bold text-[10px] uppercase tracking-widest"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AgendaAssistantChat
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onSaveVisitas={addVisitasFromAssistant}
      />
    </div>
  );
}
