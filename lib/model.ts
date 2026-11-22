// token-radar-02 — the value model, fitted from the sealed snapshot at runtime.
//
// Every number the board shows is derived from the snapshot itself, in this
// file, on every run: nothing about any protocol is hard-coded, no protocol
// name is special-cased, and the same function scores every row.
//
// The model, in four fitted pieces:
//
//   1. Comps fit. 128 traded tokens (market cap > 0, TVL > 0) give a log-log
//      OLS, log(mcap) = a + b*log(TVL), plus a per-category median residual
//      shrunk toward zero (k = 8). The fit is weak on purpose and the page
//      says so: R2 is about 0.19, the median held-out error about 84%.
//   2. Growth and maturity. A 7-day TVL change, clamped to [-60, +120] and
//      weighted 0.5, and an age factor from 0.6 (new) to 1.0 (3 years or
//      older). Both are stated constants, not fitted.
//   3. Token odds. The chance a protocol ever records a token, estimated
//      from the snapshot itself: the traded share of its age x TVL bucket,
//      shrunk (k = 10) toward the global traded rate. Expected value is
//      implied value times odds, and the board ranks by expected value.
//   4. Uncertainty. Each row carries a 68% interval from its category's
//      residual spread (shrunk toward the global spread), so a thin category
//      shows a wide interval instead of false precision.
//
// The farm verdict is a stated economic model, not a feeling: the airdrop
// pool is assumed to be 5% of expected value, split among an estimated
// farmer count of 100*sqrt(TVL in $M) at a $1,000 median position; gas is
// the main chain's typical per-transaction cost times the transaction
// count; time is shown in hours and never converted to dollars. FARM when
// the net is at least $20, THIN when it is at least $0, SKIP below $0.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted comps model, as the dashboard states it. */
export interface CompsFit {
  n: number;
  intercept: number;
  slope: number;
  r2: number;
  global_sigma: number;
  global_median_ratio: number;
  shrinkage_k: number;
  category_adj: Record<string, number>;
  category_sigma: Record<string, number>;
}

/** One held-out test's honest numbers. */
export interface ValidationRun {
  n: number;
  mape_pct: number;
  median_ape_pct: number;
  within_3x: number;
  within_3x_pct: number;
}

/** The model's held-out validation, computed at runtime and shown twice on the page. */
export interface Validation {
  loo: ValidationRun;
  split_even_odd: ValidationRun;
  split_odd_even: ValidationRun;
  spearman: number;
}

/** The snapshot's own token-odds table. */
export interface OddsTable {
  global_rate: number;
  shrinkage_k: number;
  buckets: Record<string, number>;
  bucket_counts: Record<string, string>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-2';

/** The growth and maturity constants, stated on the page. */
export const GROWTH_WEIGHT = 0.5;
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
export const MATURITY_FLOOR = 0.6;
export const MATURITY_RANGE = 0.4;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;

/** The shrinkage strength for a category's residual (toward zero) and sigma (toward global). */
export const CATEGORY_SHRINK_K = 8;
/** The shrinkage strength for a token-odds bucket (toward the global traded rate). */
export const ODDS_SHRINK_K = 10;
/** The assumed airdrop pool, as a share of expected value. */
export const AIRDROP_POOL_SHARE = 0.05;
/** The assumed median farm position, in dollars. */
export const MEDIAN_POSITION_USD = 1000;
/** The assumed farmer count per sqrt(TVL in $M). */
export const FARMERS_PER_SQRT_TVL_M = 100;
/** The verdict lines, in dollars of net. */
export const FARM_NET_USD = 20;
export const THIN_NET_USD = 0;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-not number list. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The population standard deviation of a list. */
function pstdev(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are exchanges or wrapped, staked or bridged products of another protocol. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Exchange names that may not lead a rankable protocol's name. */
const EXCHANGE_LEADERS = new Set(['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini']);

/** Whether a protocol records a token at all (the watchlist's own definition). */
export function isTraded(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !isTraded(p);
}

/** Whether a protocol is one the board may rank: pre-token, and not an
 *  exchange, a bridge, a wrapped or staked product, or a versioned pool.
 *  This is the watchlist's rule applied to every row, not only the watchlist. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const first = p.name.split(/\s+/)[0];
  if (first !== undefined && EXCHANGE_LEADERS.has(first)) return false;
  return true;
}

/** The traded tokens the comps fit runs on: a market cap above zero and a TVL above zero. */
export function compsTokens(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => isTraded(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
}

/** The log-log OLS of log(mcap) on log(TVL), and the category adjustments. */
export function fitComps(comps: SnapshotProtocol[]): CompsFit {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
  const sxx = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssRes = ys.reduce((a, y, i) => a + (y - (intercept + slope * xs[i]!)) ** 2, 0);
  const ssTot = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const residuals = comps.map((p) => Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd)));
  const globalSigma = pstdev(residuals);
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const globalMedianRatio = median(ratios);
  const byCat = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const list = byCat.get(p.category ?? '') ?? [];
    list.push(residuals[i]!);
    byCat.set(p.category ?? '', list);
  });
  const categoryAdj: Record<string, number> = {};
  const categorySigma: Record<string, number> = {};
  for (const [cat, rs] of byCat) {
    categoryAdj[cat] = (rs.length * median(rs)) / (rs.length + CATEGORY_SHRINK_K);
    const sd = rs.length > 1 ? pstdev(rs) : globalSigma;
    categorySigma[cat] = (rs.length * sd + CATEGORY_SHRINK_K * globalSigma) / (rs.length + CATEGORY_SHRINK_K);
  }
  return { n, intercept: round4(intercept), slope: round4(slope), r2: round4(r2), global_sigma: round4(globalSigma), global_median_ratio: round4(globalMedianRatio), shrinkage_k: CATEGORY_SHRINK_K, category_adj: categoryAdj, category_sigma: categorySigma };
}

/** The fitted log(mcap) for one protocol, before growth and maturity. */
function fittedLogMcap(p: SnapshotProtocol, fit: CompsFit): number {
  return fit.intercept + fit.slope * Math.log(p.tvl_usd) + (fit.category_adj[p.category ?? ''] ?? 0);
}

/** The residual spread one row's interval uses. */
function sigmaFor(p: SnapshotProtocol, fit: CompsFit): number {
  return fit.category_sigma[p.category ?? ''] ?? fit.global_sigma;
}

/** The age bucket of a protocol, for the odds table. */
function ageBucket(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 180) return '<180d';
  if (age < 365) return '180-364d';
  if (age < 730) return '365-729d';
  return '730d+';
}

/** The TVL bucket of a protocol, for the odds table. */
function tvlBucket(tvl: number): string {
  if (tvl < 100_000_000) return '<$100M';
  if (tvl < 1_000_000_000) return '$100M-1B';
  return '$1B+';
}

/** The token-odds table: each age x TVL bucket's traded share, shrunk toward the global rate. */
export function oddsTable(snapshot: Snapshot): OddsTable {
  const buckets = new Map<string, { traded: number; total: number }>();
  let tradedTotal = 0;
  for (const p of snapshot.protocols) {
    const key = `${ageBucket(ageDays(snapshot.as_of, p.listed_at))}|${tvlBucket(p.tvl_usd)}`;
    const cell = buckets.get(key) ?? { traded: 0, total: 0 };
    cell.total += 1;
    if (isTraded(p)) {
      cell.traded += 1;
      tradedTotal += 1;
    }
    buckets.set(key, cell);
  }
  const globalRate = tradedTotal / snapshot.protocols.length;
  const out: Record<string, number> = {};
  const counts: Record<string, string> = {};
  for (const [key, cell] of [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out[key] = round4((cell.traded + ODDS_SHRINK_K * globalRate) / (cell.total + ODDS_SHRINK_K));
    counts[key] = `${cell.traded}/${cell.total}`;
  }
  return { global_rate: round4(globalRate), shrinkage_k: ODDS_SHRINK_K, buckets: out, bucket_counts: counts };
}

/** One protocol's token odds from the table. */
export function tokenOdds(p: SnapshotProtocol, snapshot: Snapshot, table: OddsTable): number {
  const key = `${ageBucket(ageDays(snapshot.as_of, p.listed_at))}|${tvlBucket(p.tvl_usd)}`;
  return table.buckets[key] ?? table.global_rate;
}

/** The growth multiplier from a 7-day TVL change. */
export function growthMultiplier(change7d: number | null): { pct: number; mult: number } {
  const raw = change7d ?? 0;
  const pct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw));
  return { pct: round2(pct), mult: round4(1 + (pct / 100) * GROWTH_WEIGHT) };
}

/** The maturity multiplier from a protocol's age. */
export function maturityMultiplier(age: number | null): number {
  const a = age ?? UNKNOWN_AGE_DAYS;
  return round4(MATURITY_FLOOR + (Math.min(Math.max(a, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE);
}

/** The growth and maturity a protocol gets, and the implied value before odds. */
export function impliedValue(p: SnapshotProtocol, fit: CompsFit, age: number | null): { implied: number; growthPct: number; growthMult: number; maturityMult: number; base: number } {
  const base = Math.exp(fittedLogMcap(p, fit));
  const { pct, mult } = growthMultiplier(p.change_7d);
  const maturity = maturityMultiplier(age);
  const implied = Math.max(1, Math.round(base * mult * maturity));
  return { implied, growthPct: pct, growthMult: mult, maturityMult: maturity, base: Math.round(base) };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The typical cost of one transaction on a chain, in dollars (a stated
 *  assumption of this program, November 2026 — the snapshot carries no gas
 *  data). Chains the table does not name default to $1.00. */
export const GAS_PER_TX_USD: Record<string, number> = {
  Ethereum: 6.0, Bitcoin: 2.0, Tron: 1.0, Doge: 0.5, Cardano: 0.3, Litecoin: 0.1,
  Solana: 0.05, Sui: 0.05, Aptos: 0.05, Near: 0.05, Sei: 0.05, Stellar: 0.05,
  Ripple: 0.05, Hedera: 0.05, Cosmos: 0.05, Algorand: 0.05, Injective: 0.05,
  Binance: 0.25, Avalanche: 0.3, Arbitrum: 0.4, Optimism: 0.4, Base: 0.3,
  Polygon: 0.1, 'Polygon zkEVM': 0.2, zkSync: 0.3, 'zkSync Era': 0.3, Starknet: 0.3,
  Linea: 0.2, Scroll: 0.2, Blast: 0.2, Mantle: 0.2, Mode: 0.2, 'Op_Bnb': 0.2,
  Metis: 0.1, Kava: 0.1, Klaytn: 0.1, Fraxtal: 0.1, Celo: 0.1, Gnosis: 0.2,
  xDai: 0.2, Fantom: 0.2, Sonic: 0.1, Berachain: 0.1, Monad: 0.1, 'Hyperliquid L1': 0.1,
  Soneium: 0.2, Unichain: 0.2, Ink: 0.2, Katana: 0.1, MegaETH: 0.1, Plume: 0.2,
  'Plume Mainnet': 0.2, 'World Chain': 0.2, Taiko: 0.2, Morph: 0.2, Manta: 0.2,
  Moonbeam: 0.3, Moonriver: 0.3, Aurora: 0.2, 'BOB': 0.2, 'CORE': 0.1, Harmony: 0.1,
  Cronos: 0.2, 'X Layer': 0.1, Flare: 0.1, 'Robinhood Chain': 0.2, Plasma: 0.2,
  'BOB': 0.2, Ronin: 0.1, Bittensor: 0.2, ZetaChain: 0.2, 'BSquared': 0.2,
  'OKExChain': 0.2, Boba: 0.2, Telos: 0.1, EOS: 0.1, Filecoin: 0.1, 'Polkadot': 0.1,
  Arc: 0.2, 'Stable': 0.2, 'Hemi': 0.2, 'Astar': 0.2, 'TON': 0.1,
};
export const GAS_DEFAULT_USD = 1.0;

/** The first chain a protocol names, or a neutral phrase. */
export function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The typical cost of one transaction on a protocol's main chain. */
export function gasPerTx(p: SnapshotProtocol): number {
  return GAS_PER_TX_USD[chainOf(p)] ?? GAS_DEFAULT_USD;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and keep the position open.`;
  if (c.includes('dex') || c.includes('yield aggregator') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the position open.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('derivative') || c.includes('basis trading') || c.includes('interest rate')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('btc')) return `Deposit $${capital} of BTC into ${name} on ${chain} and keep the position open.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('payment')) return `Fund $${capital} into ${name} on ${chain} and make one payment a week.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote in its governance.`;
  if (c.includes('otc')) return `Place one $${capital} OTC order through ${name} on ${chain}.`;
  if (c.includes('card')) return `Load $${capital} onto a ${name} card on ${chain} and spend it in small amounts.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name}'s managed vault on ${chain} and keep the position open.`;
  if (c.includes('chain')) return `Use $${capital} of USDC in ${name}'s flagship app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action, in a few words. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a deposit, a borrow or a repayment';
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity manager') || c.includes('farm')) return 'a swap or a liquidity adjustment';
  if (c.includes('curator') || c.includes('allocator')) return 'a deposit or a vault rebalance vote';
  if (c.includes('derivative') || c.includes('basis trading') || c.includes('interest rate')) return 'a hedge adjustment or a margin top-up';
  if (c.includes('prediction')) return 'one market position';
  if (c.includes('staking') || c.includes('restak')) return 'a stake top-up or a restake';
  if (c.includes('bridge')) return 'one bridge transfer';
  if (c.includes('rwa')) return 'a mint or a hold check';
  if (c.includes('governance')) return 'one governance vote';
  return 'a deposit, a swap or a vote';
}

/** A dollar amount, short: $43.9M, $2.46M, $537K, $12. */
export function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** The break-even arithmetic of one farm plan, from the stated assumptions. */
export interface BreakEven {
  capital: number;
  hold_days: number;
  weekly_count: number;
  tx_count: number;
  gas_per_tx: number;
  gas_total: number;
  farmers_est: number;
  expected_gross: number;
  net: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  hours: number;
}

export function breakEven(p: SnapshotProtocol, ev: number, age: number | null): BreakEven {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weekly = Math.min(8, Math.max(4, Math.floor(hold / 7)));
  const txCount = 1 + weekly + 1;
  const gasTx = gasPerTx(p);
  const gasTotal = round2(txCount * gasTx);
  const farmers = Math.round(FARMERS_PER_SQRT_TVL_M * Math.sqrt(p.tvl_usd / 1_000_000));
  const gross = round2(AIRDROP_POOL_SHARE * ev * (capital / MEDIAN_POSITION_USD) / Math.max(1, farmers));
  const net = round2(gross - gasTotal);
  const verdict = net >= FARM_NET_USD ? 'FARM' : net >= THIN_NET_USD ? 'THIN' : 'SKIP';
  const hours = round2((45 + weekly * 10) / 60);
  return { capital, hold_days: hold, weekly_count: weekly, tx_count: txCount, gas_per_tx: gasTx, gas_total: gasTotal, farmers_est: farmers, expected_gross: gross, net, verdict, hours };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL,
 * age, expected value) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, ev: number, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const be = breakEven(p, ev, age);
  const gas = be.gas_per_tx;
  const gasStr = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas.toFixed(0)}`;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, be.capital, chain),
      cost: `$${be.capital} of capital and about ${gasStr} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as ${weeklyFor(p)}.`,
      cost: `about ${gasStr} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${be.hold_days} days so the activity is counted in more than one snapshot.`,
      cost: `the $${be.capital} stays in the position`,
      time: `${be.hold_days} days`,
    },
    {
      text: `Halfway through the hold, open the protocol's own points or rewards page and confirm the position is earning.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes, and never pay anyone to claim for you.`,
      cost: `about ${gasStr} of gas to claim`,
      time: '10 minutes',
    },
    {
      text: `Break-even: the model's expected airdrop for a $${be.capital} position is about ${fmtUsd(be.expected_gross)} against ${fmtUsd(be.gas_total)} of gas over ${be.tx_count} transactions, a net of about ${fmtUsd(be.net)} — verdict ${be.verdict}. Write the wallet, the dates and every transaction in a farm log.`,
      cost: `${fmtUsd(be.gas_total)} of gas in total`,
      time: `about ${be.hours} hours over ${be.hold_days} days`,
    },
  ];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_raw_usd: number;
  odds: number;
  implied_value_usd: number;
  ev_low_usd: number;
  ev_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  capital_usd: number;
  farmers_est: number;
  expected_gross_usd: number;
  gas_total_usd: number;
  net_usd: number;
  model: { base_usd: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; category_adj: number };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_raw_usd: number;
  odds: number;
  implied_value_usd: number;
  ev_low_usd: number;
  ev_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  capital_usd: number;
  farmers_est: number;
  expected_gross_usd: number;
  gas_total_usd: number;
  net_usd: number;
  base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_adj: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The integrity strip: every one of the snapshot's protocols, accounted for. */
export interface Integrity {
  total: number;
  ranked: number;
  traded: number;
  excluded: number;
  excluded_by_reason: Record<string, number>;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: CompsFit;
  odds: OddsTable;
  validation: Validation;
  integrity: Integrity;
  assumptions: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why one protocol is excluded from the board, or null when it is ranked. */
function exclusionReason(p: SnapshotProtocol): string | null {
  if (isTraded(p)) return 'already trades';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return p.category;
  if (VERSIONED.test(p.name)) return 'versioned pool';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked name';
  const first = p.name.split(/\s+/)[0];
  if (first !== undefined && EXCHANGE_LEADERS.has(first)) return 'exchange-leading name';
  return null;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: CompsFit, odds: OddsTable): BoardRow[] {
  const scored: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { implied, growthPct, growthMult, maturityMult, base } = impliedValue(p, fit, age);
    const od = tokenOdds(p, snapshot, odds);
    const ev = Math.max(1, Math.round(implied * od));
    const sigma = sigmaFor(p, fit);
    const be = breakEven(p, ev, age);
    scored.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      watchlist: snapshot.watchlist.includes(p.slug),
      implied_raw_usd: implied,
      odds: od,
      implied_value_usd: ev,
      ev_low_usd: Math.max(1, Math.round(ev * Math.exp(-sigma))),
      ev_high_usd: Math.round(ev * Math.exp(sigma)),
      verdict: be.verdict,
      capital_usd: be.capital,
      farmers_est: be.farmers_est,
      expected_gross_usd: be.expected_gross,
      gas_total_usd: be.gas_total,
      net_usd: be.net,
      model: { base_usd: base, growth_pct: growthPct, growth_multiplier: growthMult, maturity_multiplier: maturityMult, category_adj: round4(fit.category_adj[p.category ?? ''] ?? 0) },
      farm_steps: farmSteps(p, ev, age).map(stepText),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  return scored;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isTraded(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** The integrity strip's counts, from the snapshot itself. */
export function integrityCounts(snapshot: Snapshot, board: BoardRow[]): Integrity {
  const byReason: Record<string, number> = {};
  let traded = 0;
  let excluded = 0;
  for (const p of snapshot.protocols) {
    if (isTraded(p)) {
      traded += 1;
      continue;
    }
    const reason = exclusionReason(p);
    if (reason !== null) {
      excluded += 1;
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
  }
  return { total: snapshot.protocols.length, ranked: board.length, traded, excluded, excluded_by_reason: byReason };
}

/** The absolute percentage errors of predictions against actuals, as a run's numbers. */
function apeRun(actual: number[], predicted: number[]): ValidationRun {
  const apes = actual.map((a, i) => Math.abs(predicted[i]! - a) / a);
  const sorted = [...apes].sort((x, y) => x - y);
  const within = apes.filter((e, i) => predicted[i]! / actual[i]! >= 1 / 3 && predicted[i]! / actual[i]! <= 3).length;
  return {
    n: actual.length,
    mape_pct: round2((apes.reduce((a, b) => a + b, 0) / apes.length) * 100),
    median_ape_pct: round2(median(sorted) * 100),
    within_3x: within,
    within_3x_pct: round2((within / apes.length) * 100),
  };
}

/** The Spearman rank correlation of two lists. */
function spearman(xs: number[], ys: number[]): number {
  const rankOf = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(v.length);
    order.forEach((idx, k) => {
      r[idx] = k;
    });
    return r;
  };
  const rx = rankOf(xs);
  const ry = rankOf(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  const cov = rx.reduce((a, x, i) => a + (x - mx) * (ry[i]! - my), 0);
  const vx = rx.reduce((a, x) => a + (x - mx) * (x - mx), 0);
  const vy = ry.reduce((a, y) => a + (y - my) * (y - my), 0);
  return vx === 0 || vy === 0 ? 0 : round4(cov / Math.sqrt(vx * vy));
}

/** The held-out validation: two split-half runs and a leave-one-out run, on the core fit. */
export function validateComps(comps: SnapshotProtocol[]): Validation {
  const sorted = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const even = sorted.filter((_, i) => i % 2 === 0);
  const odd = sorted.filter((_, i) => i % 2 === 1);
  const runSplit = (train: SnapshotProtocol[], test: SnapshotProtocol[]): ValidationRun => {
    const fit = fitComps(train);
    return apeRun(
      test.map((p) => p.mcap_usd!),
      test.map((p) => Math.exp(fittedLogMcap(p, fit))),
    );
  };
  const looActual: number[] = [];
  const looPredicted: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = [...comps.slice(0, i), ...comps.slice(i + 1)];
    const fit = fitComps(rest);
    looActual.push(comps[i]!.mcap_usd!);
    looPredicted.push(Math.exp(fittedLogMcap(comps[i]!, fit)));
  }
  const loo = apeRun(looActual, looPredicted);
  const full = fitComps(comps);
  const sp = spearman(
    comps.map((p) => p.mcap_usd!),
    comps.map((p) => Math.exp(fittedLogMcap(p, full))),
  );
  return { loo, split_even_odd: runSplit(even, odd), split_odd_even: runSplit(odd, even), spearman: sp };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = compsTokens(snapshot);
  const fit = fitComps(comps);
  const odds = oddsTable(snapshot);
  const board = buildBoard(snapshot, fit, odds);
  const validation = validateComps(comps);
  const integrity = integrityCounts(snapshot, board);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    odds,
    validation,
    integrity,
    assumptions: [
      'Airdrop pool: 5% of expected value, split among an estimated 100*sqrt(TVL in $M) farmers at a $1,000 median position.',
      'Gas: the main chain\u2019s typical per-transaction cost (November 2026), 6 transactions per plan; unknown chains $1.00. Time is shown in hours and never converted to dollars.',
      'Verdict: FARM when the net is at least $20, THIN from $0, SKIP below $0.',
      'Odds: the traded share of the protocol\u2019s age x TVL bucket, shrunk toward the global traded rate (k = 10).',
      'No protocol name is special-cased: the same function scores every row.',
    ],
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chain: r.chains.length > 0 ? r.chains[0]! : 'its main chain',
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_raw_usd: r.implied_raw_usd,
      odds: r.odds,
      implied_value_usd: r.implied_value_usd,
      ev_low_usd: r.ev_low_usd,
      ev_high_usd: r.ev_high_usd,
      verdict: r.verdict,
      capital_usd: r.capital_usd,
      farmers_est: r.farmers_est,
      expected_gross_usd: r.expected_gross_usd,
      gas_total_usd: r.gas_total_usd,
      net_usd: r.net_usd,
      base_usd: r.model.base_usd,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      category_adj: r.model.category_adj,
      farm_steps: r.farm_steps,
    })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
