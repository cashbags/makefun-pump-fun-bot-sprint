# Graduation-flow scout — design notes

## What the dev tape says (measured, not guessed)

- Graduation is exactly **85.01 SOL** of real reserve: all 35 completers in
  the 24 h dev window (1,222 mints) complete at 85.01 SOL. Nothing else
  completes.
- Conditional completion odds climb with reserve: 6% of coins that reach
  5 SOL complete, 10% at 10 SOL, 22% at 20, 33% at 30, 46% at 40, 63% at
  50, 75% at 60, 92% at 80. The edge is riding the climb, not buying the
  launch: every launch sniper in the resolved sister comp lost to fees.
- Median price multiples along the climb (coins that get there): 5→10 SOL
  is 1.29x, 5→20 is 2.01x, 10→20 is 1.54x, 20→40 is 1.84x. A coin bought
  at 5 SOL and held to death loses ~29% (median last-price ratio 0.71),
  so exits must be fast: take the spike, cut the fade.
- Flow filters help: at age ≥300 slots in the 5–60 band, coins with the
  creator unsold, ≥5 distinct buyers and positive net flow hit +30% within
  1,200 slots 46% of the time (vs 31% unfiltered). Younger entries score
  better still on paper, but live grading says otherwise: minAge 10 lost
  more (−0.95 SOL) than minAge 300 (−0.53) — fills land 2 slots late on
  fast-moving launches, so the bot buys the top of the burst.
- The cliff is the dominant loss: a coin can fall 85–90% in a single slot
  when early holders dump together, and the 2-slot fill latency means any
  stop only fills at the bottom. Cliff rate by entry reserve: 0% at 5–10
  SOL, 27% at 10–20, 88% at 20–40, 60% at 40–60. By launch burst (real
  SOL within the first 10 slots of life): 6% cliff when the burst is
  under 5 SOL, 48% at 5–20, 80% above 20. By price jump from first trade
  to entry: 10% cliff under 1.5x, 43% at 1.5–3x, 100% at 3–6x. The bot
  therefore only enters the 5–15 SOL band, only coins whose launch burst
  stayed under 10 SOL, and only while the price is under 2x its first
  trade — the organic climbers, not the distribution traps.

## The bot, in one paragraph

Scout every curve from its CreateEvent. A coin becomes a candidate once
it is ≥300 slots old with 5–15 SOL of real reserve, its launch burst
(real reserve within its first 10 slots) stayed under 10 SOL, and its
price is under 2x its first trade. Enter only when the last 150 slots
show positive net inflow that is accelerating (newer half beats older
half), ≥9 distinct buyers, no single buyer over half the window's buy
volume, the creator unsold, price within 8% of the window high, and no
single sell over 10% of real reserve in the window. Probe 0.02 SOL, then
pyramid 0.01 SOL tranches while price holds above the last buy and flow
stays positive, to 0.08 SOL per coin and at most 5 open positions. One
entry per coin per run — re-entering a coin that already stopped out was
the single biggest leak in early versions (it turned −0.53 SOL into
−1.61 SOL of churn). Exit the whole position at +40% over cost, on a
trailing stop of −20% from peak once +10% up, on a hard stop of −15%
under cost, after 1,200 slots, on staleness (600 slots without a trade),
creator selling, or a single sell over 10% of real reserve. The
flow-reversal exit was tested and removed: it fired 24 times and cut
winners before they reached take-profit. Drawdown guard: no new entries
past 25% drawdown, flatten everything past 40% (cap is 50%). Coverage
guard: if fewer than 20 round trips are banked once 150 mints have been
seen, enter 0.01 SOL probes on any liquid coin with non-negative flow
and exit them at ±8% — cheap insurance, ~0.0005 SOL drag each if flat.

## Fee math

Every trade pays curve fees (95 bps protocol + 30 bps creator = 1.25%
each way) plus 105,000 lamports per order. A 0.02 SOL probe therefore
costs ~0.00025 SOL curve fees + 0.000105 SOL tx fee to open, and the
same to close: ~3.5% round-trip drag. The +40% take-profit and −15%
stop both clear that by a wide margin; the minimum buy is 0.01 SOL, and
no order is sent below it. Small 0.01 SOL pyramid tranches were chosen
deliberately: 0.03 SOL tranches lost more (−0.038 SOL dev) than 0.01
(−0.003) because they put the most capital in just before the turn.
Buys are capped at 1% of real reserve per reply by the harness, so a
0.02 SOL probe needs ≥2 SOL of reserve — the 5 SOL band floor
guarantees headroom.

## Dev-window results (grade-local, --driver process)

| version | change | net PnL | maxDD | trips | fills |
|---|---|---|---|---|---|
| v1 | spec baseline | −1.614 | 17.0% | 336 | 1,896 |
| v2 | one entry per coin | −0.534 | 6.0% | 73 | 360 |
| v3 | minAge 10 | −0.949 | 9.6% | 200 | 760 |
| v4a | drop flow-reversal exit | −0.257 | 5.3% | 75 | 373 |
| v4b | pyramid 0.03→0.02, max 0.08 | −0.180 | 3.2% | 74 | 301 |
| v4c | tighter exits | −0.225 | 3.1% | 74 | 302 |
| v5 | band 5–15, burst<10, jump<2x | −0.069 | 1.7% | 43 | 187 |
| v6 | drop dump exit | −0.079 | 1.9% | 43 | 190 |
| v7 | TP 30→40% | −0.038 | 1.6% | 43 | 187 |
| v8 | TP 50% | −0.069 | 2.3% | 43 | 187 |
| v9 | SL −12% | −0.078 | 1.6% | 43 | 187 |
| v10 | dump threshold 25% | −0.055 | 2.0% | 43 | 190 |
| v11 | pyramid 0.02→0.01 | −0.003 | 1.4% | 43 | 246 |
| v12 | probe 0.03 | −0.033 | 1.6% | 43 | 246 |
| v13 | minBuyers 7 | +0.040 | 1.1% | 40 | 229 |
| v14 | minBuyers 9 | **+0.075** | 0.7% | 35 | 190 |
| v15 | minBuyers 12 | +0.057 | 0.5% | 30 | 165 |

v14 (shipped): +0.0751 SOL, max drawdown 0.71%, win rate 31.4%, 35
round trips over 33 coins, 190 fills, fees 0.044 SOL, 90% interval
[−0.06, +0.25], net PnL at 2x fees +0.010 SOL. Beats hold-cash (0)
and the house sniper baseline (−0.468) on the dev window. The
minBuyers curve (5→−0.003, 7→+0.040, 9→+0.075, 12→+0.057) is flat
around the chosen value, not a sharp spike — the edge is structural
(cliff avoidance + small pyramids), not a tuned cell. The final window
is unseen, so no dev-window figure is a promise.

## Determinism

No clock, no randomness, no network, no wall-clock reads. All decisions
come from the batch stream (slot, events, marks, fills) in arrival
order; candidate ties break on mint string. Two runs on the same window
produce byte-identical action logs.
