// Jalali (Shamsi) date conversion utilities
// Uses jalaali-js for accurate Persian calendar conversion

import { toJalaali as convertToJalaali } from 'jalaali-js';

export function toJalali(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    const { jy, jm, jd } = convertToJalaali(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate()
    );
    return `${jy}/${jm.toString().padStart(2, '0')}/${jd.toString().padStart(2, '0')}`;
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

export function formatDualDate(dateStr: string): { gregorian: string; jalali: string } {
  return {
    gregorian: toGregorian(dateStr),
    jalali: toJalali(dateStr),
  };
}

export function formatCurrency(amount: number, currency: 'USD' | 'IRR'): string {
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${amount.toLocaleString('en-US')} ﷼`;
}

export function usdToIrr(usd: number, rate: number): number {
  return Math.round(usd * rate);
}
