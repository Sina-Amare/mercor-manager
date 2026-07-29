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

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * "3 days ago" / «۳ روز پیش». Answers the question a task list exists to
 * answer — how long has this been sitting here — using Intl rather than a
 * date library.
 */
export function formatRelativeTime(dateStr: string, language: Language = 'en'): string {
  if (!dateStr) return '';
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return '';

  const elapsed = time - Date.now();
  const formatter = new Intl.RelativeTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
    numeric: 'auto',
  });

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return formatter.format(Math.round(elapsed / ms), unit);
    }
  }
  return formatter.format(Math.round(elapsed / 1000), 'second');
}

/** Whole days since a timestamp, for flagging tasks that have gone quiet. */
export function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000));
}

export function usdToIrr(usd: number, rate: number): number {
  return Math.round(usd * rate);
}
