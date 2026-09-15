// BEACON — the one build-time PWA switch (ADR-047). `NEXT_PUBLIC_PWA=on` registers public/sw.js and
// links the web-app manifest; anything else (the default) registers nothing AND actively unregisters a
// worker left over from an earlier `on` build, deleting its caches — the complete fallback to the
// pre-PWA behaviour. Read as a literal `process.env.NEXT_PUBLIC_*` so `next build` can inline it.
export const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA === 'on';
