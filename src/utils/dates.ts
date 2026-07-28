// Jalali (Shamsi) date conversion utilities
// Uses jalaali-js for accurate Persian calendar conversion

import { toJalaali as convertToJalaali } from 'jalaali-js';
import type { Language } from '../types';

function localizeDigits(value: string, language: Language): string {
  if (language !== 'fa') return value;
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  return value.replace(/\d/g, (digit) => persianDigits[Number(digit)]);
}

export function toJalali(dateStr: string, language: Language = 'en'): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    const { jy, jm, jd } = convertToJalaali(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate()
    );
    return localizeDigits(
      `${jy}/${jm.toString().padStart(2, '0')}/${jd.toString().padStart(2, '0')}`,
      language
    );
  } catch {
    return '';
  }
}

export function toGregorian(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatDualDate(
  dateStr: string,
  language: Language = 'en'
): { gregorian: string; jalali: string } {
  return {
    gregorian: toGregorian(dateStr),
    jalali: toJalali(dateStr, language),
  };
}

export function formatCurrency(
  amount: number,
  currency: 'USD' | 'IRR',
  language: Language = 'en'
): string {
  const locale = language === 'fa' ? 'fa-IR' : 'en-US';
  if (currency === 'USD') {
    const formatted = amount.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return language === 'fa' ? `\u2066$${formatted}\u2069` : `$${formatted}`;
  }
  return language === 'fa'
    ? `${amount.toLocaleString(locale)} ریال`
    : `${amount.toLocaleString(locale)} ﷼`;
}

export function formatNumber(value: number, language: Language = 'en'): string {
  return value.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US');
}

export function usdToIrr(usd: number, rate: number): number {
  return Math.round(usd * rate);
}
