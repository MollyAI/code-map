#!/usr/bin/env node
// scripts/cli.mjs — subcommand dispatcher for the Node pipeline. The bin/code-map
// launcher execs this with a detected JS runtime.
const [cmd, ...rest] = process.argv.slice(2);

const routes = {
  analyze: () => import('./analyze.mjs').then((m) => m.main(rest)),
  plan: () => import('./incremental.mjs').then((m) => m.planMain(rest)),
  merge: () => import('./incremental.mjs').then((m) => m.mergeMain(rest)),
  run: () => import('./mapctl.mjs').then((m) => m.runMain(rest)),
  stop: () => import('./mapctl.mjs').then((m) => m.stopMain(rest)),
  'session-end': () => import('./mapctl.mjs').then((m) => m.sessionEndMain(rest)),
  serve: () => import('./serve.mjs').then((m) => m.runServer(rest)),
  score: () => import('./score.mjs').then((m) => m.main(rest)),
  invariants: () => import('./invariants.mjs').then((m) => m.main(rest)),
  overlay: () => import('./overlay.mjs').then((m) => m.main(rest)),
};

(async () => {
  const fn = routes[cmd];
  if (!fn) {
    console.error(`code-map: unknown subcommand '${cmd ?? ''}'. ` +
      `Expected one of: ${Object.keys(routes).join(', ')}`);
    process.exit(2);
  }
  try {
    process.exit((await fn()) ?? 0);
  } catch (e) {
    console.error(e?.stack || String(e));
    process.exit(1);
  }
})();
