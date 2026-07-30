/**
 * Generates assets/stats-dark.svg and assets/stats-light.svg from live GitHub data.
 *
 * Self-hosted on purpose: third-party README stat services rate-limit and 503,
 * which leaves broken images on the profile. This runs in Actions and commits
 * the rendered SVGs, so the README only ever points at files in this repo.
 */

const USER = process.env.GH_USER || 'Frankyface';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        name
        stargazerCount
        homepageUrl
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'frankyface-profile-stats',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data.user;
}

const FALLBACK_COLOR = '#8b98a5';

function summarise(user) {
  const repos = user.repositories.nodes;
  const bytesByLang = new Map();
  const colorByLang = new Map();
  let totalBytes = 0;

  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      bytesByLang.set(node.name, (bytesByLang.get(node.name) || 0) + size);
      if (node.color) colorByLang.set(node.name, node.color);
      totalBytes += size;
    }
  }

  const languages = [...bytesByLang.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, size]) => ({
      name,
      pct: totalBytes ? (100 * size) / totalBytes : 0,
      color: colorByLang.get(name) || FALLBACK_COLOR,
    }))
    // A language rendering as "0.0%" reads as a bug rather than a rounding artifact.
    .filter((lang) => lang.pct >= 0.1)
    .slice(0, 6);

  return {
    contributions: user.contributionsCollection.contributionCalendar.totalContributions,
    repos: user.repositories.totalCount,
    live: repos.filter((r) => r.homepageUrl && r.homepageUrl.trim()).length,
    megabytes: totalBytes / 1e6,
    stars: repos.reduce((n, r) => n + r.stargazerCount, 0),
    languages,
  };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const THEMES = {
  dark: {
    bg0: '#0a1018', bg1: '#0d1626', bg2: '#070a0f',
    accent: '#35e08b', accent2: '#38bdf8',
    value: '#ffffff', label: '#64788c', muted: '#7f95a8',
    line: '#9fe8c4', lineOp: 0.055, lineOp2: 0.13,
    track: '#1b2a3d', border: 0.16, glow: 0.22, glow2: 0.18,
  },
  light: {
    bg0: '#ffffff', bg1: '#f3f8f5', bg2: '#eef4fa',
    accent: '#0f9d58', accent2: '#0969da',
    value: '#0b1a12', label: '#5b6b7a', muted: '#41505e',
    line: '#0f5132', lineOp: 0.07, lineOp2: 0.16,
    track: '#dbe4ea', border: 0.22, glow: 0.14, glow2: 0.12,
  },
};

const MONO = 'ui-monospace,SFMono-Regular,Consolas,Menlo,monospace';
const SANS = 'Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif';

const W = 1000;
const H = 210;
const BAR_X = 610;
const BAR_W = 350;

function render(stats, themeName) {
  const t = THEMES[themeName];

  const tiles = [
    { value: stats.contributions.toLocaleString('en-US'), label: 'CONTRIBUTIONS' },
    { value: String(stats.repos), label: 'PUBLIC REPOS' },
    { value: String(stats.live), label: 'LIVE SITES' },
    { value: `${stats.megabytes.toFixed(1)}MB`, label: 'CODE WRITTEN' },
  ];

  const tileSvg = tiles
    .map((tile, i) => {
      const x = 44 + i * 138;
      return `    <text x="${x}" y="112" fill="${t.value}" font-size="38" font-weight="700" font-family="${SANS}">${esc(tile.value)}</text>
    <text x="${x}" y="136" fill="${t.label}" font-size="10.5" letter-spacing="1.7" font-family="${MONO}">${esc(tile.label)}</text>`;
    })
    .join('\n');

  // Stacked language bar. Widths are floored and the remainder goes to the last
  // visible segment so the bar always fills exactly BAR_W with no seam.
  const shown = stats.languages;
  const raw = shown.map((l) => (l.pct / 100) * BAR_W);
  const widths = raw.map((v) => Math.max(2, Math.floor(v)));
  const drift = BAR_W - widths.reduce((a, b) => a + b, 0);
  if (widths.length) widths[widths.length - 1] += drift;

  let cursor = BAR_X;
  const segs = shown
    .map((lang, i) => {
      const w = widths[i];
      const seg = `    <rect x="${cursor}" y="62" width="${w}" height="13" fill="${lang.color}" opacity="0.92"/>`;
      cursor += w;
      return seg;
    })
    .join('\n');

  const legend = shown
    .map((lang, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = BAR_X + col * 178;
      const y = 108 + row * 26;
      const name = lang.name.length > 12 ? `${lang.name.slice(0, 11)}…` : lang.name;
      return `    <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${lang.color}"/>
    <text x="${x + 18}" y="${y}" fill="${t.muted}" font-size="12.5" font-family="${MONO}">${esc(name)}</text>
    <text x="${x + 150}" y="${y}" fill="${t.label}" font-size="12.5" text-anchor="end" font-family="${MONO}">${lang.pct.toFixed(1)}%</text>`;
    })
    .join('\n');

  const gridlines = Array.from({ length: 15 }, (_, i) => `M${(i + 1) * 60} 0V${H}`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub statistics for ${esc(USER)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.bg0}"/>
      <stop offset="0.55" stop-color="${t.bg1}"/>
      <stop offset="1" stop-color="${t.bg2}"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.12" cy="0.2" r="0.8">
      <stop offset="0" stop-color="${t.accent}" stop-opacity="${t.glow}"/>
      <stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.9" cy="0.1" r="0.7">
      <stop offset="0" stop-color="${t.accent2}" stop-opacity="${t.glow2}"/>
      <stop offset="1" stop-color="${t.accent2}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="card"><rect x="0" y="0" width="${W}" height="${H}" rx="16"/></clipPath>
    <clipPath id="barclip"><rect x="${BAR_X}" y="62" width="${BAR_W}" height="13" rx="6.5"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glowA)"/>
    <rect width="${W}" height="${H}" fill="url(#glowB)"/>
    <g stroke="${t.line}" stroke-opacity="${t.lineOp}"><path d="${gridlines}"/></g>
    <g stroke="${t.line}" stroke-opacity="${t.lineOp2}"><path d="M580 0V${H}"/></g>

    <text x="44" y="44" fill="${t.accent}" font-size="11.5" letter-spacing="3" font-family="${MONO}">// BY THE NUMBERS</text>
${tileSvg}

    <text x="${BAR_X}" y="44" fill="${t.accent}" font-size="11.5" letter-spacing="3" font-family="${MONO}">// LANGUAGES</text>
    <rect x="${BAR_X}" y="62" width="${BAR_W}" height="13" rx="6.5" fill="${t.track}"/>
    <g clip-path="url(#barclip)">
${segs}
    </g>
${legend}

    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="${t.accent}" stroke-opacity="${t.border}"/>
  </g>
</svg>
`;
}

const user = await fetchStats();
const stats = summarise(user);

const { writeFile, mkdir } = await import('node:fs/promises');
await mkdir('assets', { recursive: true });
await writeFile('assets/stats-dark.svg', render(stats, 'dark'));
await writeFile('assets/stats-light.svg', render(stats, 'light'));

console.log('Generated stats SVGs:', JSON.stringify({
  contributions: stats.contributions,
  repos: stats.repos,
  live: stats.live,
  megabytes: +stats.megabytes.toFixed(1),
  stars: stats.stars,
  languages: stats.languages.map((l) => `${l.name} ${l.pct.toFixed(1)}%`),
}, null, 2));
