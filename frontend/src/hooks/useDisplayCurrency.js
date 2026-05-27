/**
 * useDisplayCurrency
 * ──────────────────
 * Combines the user's preferred display currency (from profile) with live FX
 * rates to produce a ready-to-use `fmt(usdAmount)` formatter.
 *
 * Usage:
 *   const { currency, fmt, convertUsd } = useDisplayCurrency();
 *   fmt(119.99)   → "$119.99"  or  "₦194,384.80" depending on preference
 */

import { useMemo } from 'react';
import { useExchangeRates } from './useExchangeRates';
import { formatCurrency, DEFAULT_CURRENCY, tokenUsdPrice } from '../lib/currencies';
import { formatUnits } from 'viem';

/**
 * @param {string|null} preferredCurrency — from profile.display_currency
 */
export function useDisplayCurrency(preferredCurrency) {
  const currency = preferredCurrency || DEFAULT_CURRENCY;
  const { convert, loading: ratesLoading } = useExchangeRates();

  const fmt = useMemo(() => (usdAmount, opts = {}) => {
    const converted = convert(usdAmount, currency);
    return formatCurrency(converted, currency, opts);
  }, [currency, convert]);

  /**
   * Convert a raw BigInt token amount to a formatted display string.
   * @param {bigint}  raw          — raw on-chain amount
   * @param {number}  decimals     — token decimals (e.g. 6 for USDC)
   * @param {string}  tokenAddress — to look up USD price
   */
  const fmtToken = useMemo(() => (raw, decimals = 6, tokenAddress = null) => {
    const tokenAmount = parseFloat(formatUnits(raw ?? 0n, decimals));
    const usdPrice    = tokenUsdPrice(tokenAddress) ?? 1; // fallback: treat as $1
    const usdAmount   = tokenAmount * usdPrice;
    const converted   = convert(usdAmount, currency);
    return formatCurrency(converted, currency);
  }, [currency, convert]);

  return {
    currency,        // active currency code e.g. 'USD'
    fmt,             // fmt(usdNumber) → formatted string
    fmtToken,        // fmtToken(rawBigInt, decimals, tokenAddress) → formatted string
    convertUsd: convert,
    ratesLoading,
  };
}
