/**
 * useExchangeRates
 * ─────────────────
 * Fetches fiat exchange rates from open.er-api.com (free, no API key, 170+ currencies).
 * Rates are cached for 1 hour in localStorage to avoid hammering the API.
 * Returns rates relative to USD: { EUR: 0.92, GBP: 0.79, NGN: 1620, ... }
 */

import { useState, useEffect } from 'react';

const CACHE_KEY     = 'cronstream_fx_rates';
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour
const API_URL       = 'https://open.er-api.com/v6/latest/USD';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, rates } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL_MS) return rates;
  } catch { /* ignore */ }
  return null;
}

function writeCache(rates) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rates }));
  } catch { /* ignore */ }
}

// Module-level singleton so multiple components share one fetch
let _promise = null;
let _rates   = readCache();

export function useExchangeRates() {
  const [rates,   setRates]   = useState(_rates);
  const [loading, setLoading] = useState(!_rates);

  useEffect(() => {
    if (_rates) { setRates(_rates); setLoading(false); return; }

    if (!_promise) {
      _promise = fetch(API_URL, { signal: AbortSignal.timeout(8000) })
        .then(r => r.json())
        .then(data => {
          _rates = data.rates ?? {};
          writeCache(_rates);
          return _rates;
        })
        .catch(err => {
          console.warn('[useExchangeRates] Failed to fetch FX rates:', err.message);
          _promise = null; // allow retry next render
          return null;
        });
    }

    _promise.then(r => {
      if (r) setRates(r);
      setLoading(false);
    });
  }, []);

  /**
   * Convert a USD amount to another currency.
   * @param {number} usdAmount
   * @param {string} toCurrency  - e.g. 'EUR', 'NGN'
   * @returns {number}
   */
  function convert(usdAmount, toCurrency = 'USD') {
    if (!toCurrency || toCurrency === 'USD') return usdAmount;
    const rate = rates?.[toCurrency];
    return rate ? usdAmount * rate : usdAmount;
  }

  return { rates, loading, convert };
}
