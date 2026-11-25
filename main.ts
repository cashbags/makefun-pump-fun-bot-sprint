// Pump.fun Bot Sprint entry: graduation-flow scout bot.
// Thin entrypoint: the harness shim plus the strategy in strategy.ts.
import { runBot } from './vendor/makefun-bot.ts';
import { createGraduationScout } from './strategy.ts';

await runBot(createGraduationScout());
