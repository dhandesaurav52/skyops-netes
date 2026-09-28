let cached: { rate: number; fetchedAt: number; source: string } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface UsdInrRate {
  rate: number;
  fetchedAt: number;
  source: string;
}

export async function getUsdInrRate(): Promise<UsdInrRate | null> {
  const configured = Number(process.env.USD_INR_RATE);
  if (Number.isFinite(configured) && configured > 0) {
    return { rate: configured, fetchedAt: Number(process.env.USD_INR_RATE_AS_OF) || Date.now(), source: 'configured' };
  }

  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/INR', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`FX provider HTTP ${response.status}`);
    const data = await response.json() as { rates?: Record<string, number> };
    const rate = Number(data.rates?.USD);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('FX provider returned an invalid INR/USD rate');
    cached = { rate, fetchedAt: Date.now(), source: 'open.er-api.com' };
    return cached;
  } catch {
    return cached;
  }
}
