export function escapeHtml(s: string | number | undefined | null): string {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

export function formatBrl(n: number): string {
  const val = Number.isFinite(Number(n)) ? Number(n) : 0;
  return val.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBrlFull(n: number): string {
  const val = Number.isFinite(Number(n)) ? Number(n) : 0;
  return val.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte texto de moeda pt-BR para número.
 * Exemplos aceitos: "600000", "600.000", "600.000,50", "R$ 600.000,50".
 */
export function parseBrlNumber(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  const raw = String(input ?? '').trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;

  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '');
  }

  const val = Number.parseFloat(normalized);
  return Number.isFinite(val) ? val : 0;
}

export function onlyDigits(phone: string): string {
  return String(phone).replace(/\D/g, '');
}

/** Máscara progressiva para telefone brasileiro, com no máximo 11 dígitos. */
export function maskPhoneBr(input: string): string {
  const digits = onlyDigits(input).slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const area = digits.slice(0, 2);
  const local = digits.slice(2);
  if (local.length <= 4) return `(${area}) ${local}`;
  if (digits.length <= 10) return `(${area}) ${local.slice(0, 4)}-${local.slice(4)}`;
  return `(${area}) ${local.slice(0, 5)}-${local.slice(5)}`;
}

/** Máscara de reais inteiros para preços de imóveis e orçamentos. */
export function maskBrlWhole(input: string | number | null | undefined): string {
  const digits = String(input ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
  if (!digits) return '';
  return `R$ ${Number(digits).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

export function mapsUrl(endereco: string): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(endereco);
}

import type { Cliente, Imovel } from './types';

/** Nome do lead como aparece na agenda (nome + telefone). */
export function clienteAgendaLabel(c: Cliente): string {
  const n = String(c.nome ?? '').trim();
  const f = String(c.fone ?? '').trim();
  return f ? `${n} (${f})` : n;
}

/** Texto completo para o campo da visita e para o Maps (prioriza o endereço do imóvel). */
export function enderecoParaVisitaDeImovel(m: Imovel): string {
  const rua = String(m.endereco ?? '').trim();
  const extra = [m.bairro, m.cidade].filter((s) => String(s).trim()).join(' · ');
  if (rua) {
    return extra ? `${rua} — ${extra}` : rua;
  }
  const kind = m.tipo === 'Casa' ? 'Casa' : 'Apartamento';
  return extra ? `${kind} — ${extra}` : kind;
}

export function mapsUrlForVisita(v: {
  endereco?: string;
  lat?: number;
  lng?: number;
}): string | null {
  if (v.lat != null && v.lng != null && Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
    return 'https://www.google.com/maps?q=' + encodeURIComponent(v.lat + ',' + v.lng);
  }
  if (v.endereco?.trim()) {
    return mapsUrl(v.endereco.trim());
  }
  return null;
}
