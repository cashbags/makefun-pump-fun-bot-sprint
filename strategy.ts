// Graduation-flow scout for pump.fun curves (agent-fun/replay/v2).
// Most curves die young; the money is the climb toward the 85 SOL
// graduation line. Scout every curve, buy only ones already climbing
// on real inflow, add while flow stays strong, leave fast when it
// turns. Numbers behind each knob: DESIGN.md.
import { LAMPORTS_PER_SOL, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';
const SOL = LAMPORTS_PER_SOL;
const P = {
  minAge: 300, lo: 5n * SOL, hi: 15n * SOL, win: 150,
  probe: 20_000_000n, add: 10_000_000n, maxCoin: 80_000_000n,
  tp: 4000, arm: 1000, trail: 2000, sl: 1500,
  hold: 1200, stale: 600, ddStop: 2500, ddFlat: 4000,
  buyers: 9, top: 5000, nearHi: 9200, big: 1000, dump: 1000,
  covMints: 150, covTrips: 20, slip: 10000,
};
const sol = (b: bigint) => Number(b) / 1e9;
interface T { slot: number; px: number; buy: boolean; amt: number; user: string }
interface Tape { mint: Pubkey; born: number; dev: Pubkey; sold: boolean; done: boolean; last: number; real: bigint; vq: bigint; vt: bigint; tr: T[]; burst: number; firstPx: number }
interface Held { mint: Pubkey; since: number; peak: number; lastPx: number; lastSlot: number; cov: boolean }

export function createGraduationScout() {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  const bought = new Map<Pubkey, bigint>();
  const entered = new Set<Pubkey>();
  const pendBuy = new Set<Pubkey>();
  const covSet = new Set<Pubkey>();
  let seen = 0, trips = 0, peakEq = 0n;
  const px = (t: Tape) => (t.vt === 0n ? 0 : Number(t.vq) / Number(t.vt));
  const val = (s: BotState, m: Pubkey, tok: bigint) => {
    const c = s.curves.get(m);
    return !c || c.virtual_token_reserves === 0n ? 0n : (tok * c.virtual_quote_reserves) / c.virtual_token_reserves;
  };
  // Window stats at slot s: net buy SOL, newer/older half nets, distinct
  // buyers, top buyer share (bps), window high price, max single sell SOL.
  const win = (t: Tape, s: number) => {
    let net = 0, nw = 0, old = 0, buy = 0, hi = 0, big = 0;
    const by = new Map<string, number>(), who = new Set<string>();
    const cut = s - P.win, half = s - P.win / 2;
    for (const x of t.tr) {
      if (x.slot <= cut) continue;
      const d = x.buy ? x.amt : -x.amt; net += d;
      if (x.slot > half) nw += d; else old += d;
      if (x.buy) { buy += x.amt; who.add(x.user); by.set(x.user, (by.get(x.user) ?? 0) + x.amt); }
      else if (x.amt > big) big = x.amt;
      if (x.px > hi) hi = x.px;
    }
    let top = 0; for (const v of by.values()) if (v > top) top = v;
    return { net, nw, old, n: who.size, top: buy > 0 ? (top / buy) * 10000 : 10000, hi, big };
  };
  function onBatch(s: BotState, b: Batch): OrderInput[] {
    const slot = s.slot, tx = s.txFeeLamports();
    for (const fl of b.fills) {
      if (fl.side === 'buy') pendBuy.delete(fl.mint);
      if (fl.status !== 'filled') continue;
      if (fl.side === 'buy') { bought.set(fl.mint, (bought.get(fl.mint) ?? 0n) + BigInt(fl.quote_lamports)); entered.add(fl.mint); }
      else if (!fl.client_id.startsWith('_') && !s.positions.has(fl.mint) && (bought.get(fl.mint) ?? 0n) >= 10_000_000n) trips++;
    }
    const dump = new Set<Pubkey>();
    const pendSell = (m: Pubkey) => { for (const p of s.pending.values()) if (p.order.side === 'sell' && p.order.mint === m) return true; return false; };
    for (const e of b.events) {
      if (e.event === 'CreateEvent') {
        seen++;
        if (!tapes.has(e.mint)) tapes.set(e.mint, { mint: e.mint, born: e.slot, dev: e.creator, sold: false, done: false, last: e.slot, real: 0n, vq: BigInt(e.virtual_quote_reserves), vt: BigInt(e.virtual_token_reserves), tr: [], burst: 0, firstPx: Number(BigInt(e.virtual_quote_reserves)) / Number(BigInt(e.virtual_token_reserves)) });
      } else if (e.event === 'TradeEvent') {
        let t = tapes.get(e.mint);
        if (!t) { t = { mint: e.mint, born: e.slot, dev: e.creator, sold: false, done: false, last: e.slot, real: 0n, vq: 0n, vt: 0n, tr: [], burst: 0, firstPx: 0 }; tapes.set(e.mint, t); }
        const amt = sol(BigInt(e.sol_amount));
        const tpx = Number(BigInt(e.virtual_quote_reserves)) / Number(BigInt(e.virtual_token_reserves));
        if (t.firstPx === 0) t.firstPx = tpx;
        if (e.slot - t.born <= 10) { const r = sol(BigInt(e.real_sol_reserves)); if (r > t.burst) t.burst = r; }
        t.tr.push({ slot: e.slot, px: tpx, buy: e.is_buy, amt, user: e.user });
        while (t.tr.length && t.tr[0].slot <= slot - P.win) t.tr.shift();
        t.last = e.slot; t.real = BigInt(e.real_sol_reserves);
        t.vq = BigInt(e.virtual_quote_reserves); t.vt = BigInt(e.virtual_token_reserves);
        if (!e.is_buy && e.user === t.dev) t.sold = true;
        if (!e.is_buy && amt >= sol(t.real) * (P.dump / 10000)) dump.add(e.mint);
      } else { const t = tapes.get(e.mint); if (t) t.done = true; }
    }
    for (const [m] of held) if (!s.positions.has(m)) { held.delete(m); covSet.delete(m); }
    let eq = s.cash;
    for (const [m, p] of s.positions) {
      const v = val(s, m, BigInt(p.token_amount)); eq += v;
      let h = held.get(m);
      if (!h) { const t = tapes.get(m); h = { mint: m, since: slot, peak: 0, lastPx: t ? px(t) : 0, lastSlot: slot, cov: covSet.has(m) }; held.set(m, h); }
      const r = p.cost_lamports === '0' ? 0 : Number(v) / Number(BigInt(p.cost_lamports));
      if (r > h.peak) h.peak = r;
    }
    if (eq > peakEq) peakEq = eq;
    const dd = peakEq > 0n ? Number(((peakEq - eq) * 10000n) / peakEq) : 0;
    const orders: OrderInput[] = [];
    let free = s.freeCashLamports();
    const maxOrd = s.hello.caps.max_orders_per_batch;
    const sellAll = (m: Pubkey, tok: bigint) => { if (orders.length < maxOrd) orders.push({ side: 'sell', mint: m, token_amount: tok, max_slippage_bps: P.slip }); };
    if (dd >= P.ddFlat) { for (const [m, p] of s.positions) sellAll(m, BigInt(p.token_amount)); return orders; }
    for (const [m, p] of s.positions) {
      const h = held.get(m)!; const t = tapes.get(m);
      const v = val(s, m, BigInt(p.token_amount));
      const r = p.cost_lamports === '0' ? 0 : Number(v) / Number(BigInt(p.cost_lamports));
      let out: boolean;
      if (h.cov) out = r >= 1.08 || r <= 0.92 || slot - h.since >= 300 || (t !== undefined && slot - t.last >= 300);
      else {
        out = r * 10000 >= 10000 + P.tp || (h.peak * 10000 >= 10000 + P.arm && r <= (h.peak * (10000 - P.trail)) / 10000) ||
          r * 10000 <= 10000 - P.sl || slot - h.since >= P.hold ||
          (t !== undefined && (slot - t.last >= P.stale || t.sold)) || dump.has(m);
      }
      if (out && !pendSell(m)) sellAll(m, BigInt(p.token_amount));
    }
    const sold = new Set(orders.filter(o => o.side === 'sell').map(o => o.mint));
    if (dd < P.ddStop) {
      for (const [m, p] of s.positions) {
        if (sold.has(m) || orders.length >= maxOrd) continue;
        const h = held.get(m)!; const t = tapes.get(m);
        if (!t || t.done || BigInt(p.cost_lamports) >= P.maxCoin || slot - h.lastSlot < 2 || pendBuy.has(m)) continue;
        const w = win(t, slot);
        if (w.net <= 0 || px(t) < h.lastPx) continue;
        const amt = [P.add, P.maxCoin - BigInt(p.cost_lamports), s.maxBuyLamports(m), free - tx].reduce((a, c) => (c < a ? c : a));
        if (amt < 10_000_000n) continue;
        orders.push({ side: 'buy', mint: m, quote_lamports: amt, max_slippage_bps: P.slip });
        pendBuy.add(m);
        free -= amt + tx; h.lastPx = px(t); h.lastSlot = slot;
      }
      const covering = trips < P.covTrips && seen >= P.covMints;
      const cands: { m: Pubkey; sc: number; cov: boolean }[] = [];
      const doneMints = new Set<Pubkey>();
      for (const e of b.events) {
        if (e.event !== 'TradeEvent' && e.event !== 'CreateEvent') continue;
        if (doneMints.has(e.mint)) continue; doneMints.add(e.mint);
        const t = tapes.get(e.mint); if (!t || t.done) continue;
        if (s.positions.has(e.mint) || held.has(e.mint) || entered.has(e.mint) || pendBuy.has(e.mint)) continue;
        if (slot - t.born < P.minAge || t.real < P.lo || t.real > P.hi) continue;
        const w = win(t, slot);
        const strict = !t.sold && w.net > 0 && w.nw > w.old && w.n >= P.buyers && w.top < P.top &&
          px(t) * 10000 >= w.hi * P.nearHi && w.big < sol(t.real) * (P.big / 10000) &&
          t.burst < 10 && t.firstPx > 0 && px(t) < 2 * t.firstPx;
        const loose = covering && !t.sold && w.n >= 3 && w.net >= 0 && w.top < P.top;
        if (strict || loose) cands.push({ m: e.mint, sc: w.nw - w.old, cov: !strict });
      }
      cands.sort((a, c) => (c.sc - a.sc) || (a.m < c.m ? -1 : 1));
      let slots = s.hello.caps.max_open_positions - s.committedPositionCount();
      for (const c of cands) {
        if (slots <= 0 || orders.length >= maxOrd) break;
        if (s.positions.has(c.m) || orders.some(o => o.mint === c.m)) continue;
        const want = c.cov ? 10_000_000n : P.probe;
        const amt = [want, s.maxBuyLamports(c.m), free - tx].reduce((a, x) => (x < a ? x : a));
        if (amt < 10_000_000n) continue;
        orders.push({ side: 'buy', mint: c.m, quote_lamports: amt, max_slippage_bps: P.slip });
        pendBuy.add(c.m); if (c.cov) covSet.add(c.m);
        free -= amt + tx; slots--;
      }
    }
    return orders;
  }
  return { onBatch };
}
