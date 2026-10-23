// GlobalBQS Forms - environment configuration.
// BUILD is replaced by tools/build.mjs (flavor "prod" or "demo", version string). In src/ it stays "dev".
export const BUILD = { flavor: 'prod', version: '1.1.5-20261023-559c1668' };

const PROJECTS = {
  prod: 'rubeyjumsounqyqikoyg',
  demo: 'sihgseutmekszhcwbgzw',
};

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * Which backend does this copy of the app talk to?
 *  - demo build (dist/demo)                          -> always demo (never production data)
 *  - any path under /demo/                           -> demo
 *  - a host name containing "demo", or localhost     -> demo
 *  - forms.globalbqs.com (outside /demo/)            -> production
 *  - anything else with the production build         -> production
 */
export function resolveEnv(loc = globalThis.location) {
  const host = (loc.hostname || '').toLowerCase();
  const path = loc.pathname || '/';
  let env;
  if (BUILD.flavor === 'demo') env = 'demo';
  else if (/(^|\/)demo\//.test(path)) env = 'demo';
  else if (host.includes('demo') || isLocal(host)) env = 'demo';
  else if (host === 'forms.globalbqs.com') env = 'prod';
  else env = 'prod';

  let apiBase = `https://${PROJECTS[env]}.supabase.co/functions/v1/forms-api`;

  // Test/development only: on localhost an API override can be given once with ?api=http://127.0.0.1:8788
  if (isLocal(host)) {
    try {
      const q = new URLSearchParams(loc.search).get('api');
      if (q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q)) localStorage.setItem('gbqs.apiOverride', q);
      const o = localStorage.getItem('gbqs.apiOverride');
      if (o) apiBase = o.replace(/\/+$/, '') + '/functions/v1/forms-api';
    } catch { /* storage blocked */ }
  }
  return { env, project: PROJECTS[env], apiBase, isDemo: env === 'demo', version: BUILD.version, flavor: BUILD.flavor };
}

export const ENV = resolveEnv();
