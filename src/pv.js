import { fetchUUID, fetchSkyblockProfiles, getSelectedProfile } from "./profile.js";
import { calculateRtca } from "./rtca.js";

// Optional external texture base (e.g., Strawbby 16x pack path)
let TEXTURE_BASE = "";
let ICON_OVERRIDE = ""; // if set, use this single image for all icons

export async function renderPV(ign, env, opts = {}) {
  // Record texture base for this render pass (used by icon picker)
  TEXTURE_BASE = opts.textureBase || "";
  ICON_OVERRIDE = opts.iconUrl || "";
  let uuid = opts.uuidOverride;
  let profile = opts.rawProfile;

  if (!uuid || !profile) {
    const liveUuid = await fetchUUID(ign);
    const profiles = await fetchSkyblockProfiles(liveUuid, opts.hypixelKey || env.HYPIXEL_KEY);
    const selected = getSelectedProfile(profiles);
    if (!selected) return htmlResponse(500, `No profiles found for ${escapeHtml(ign)}`);
    if (!uuid) uuid = liveUuid;
    if (!profile) profile = selected;
  }

  const rtca = calculateRtca(profile, ign, uuid);
  const uuidNoDash = uuid.replace(/-/g, "").toLowerCase();
  const me = rtca.members[uuidNoDash];
  const memberData = profile.members?.[uuidNoDash] || {};

  const invSections = await buildInventorySections(memberData, opts);
  // Try to load NEU pet constants once for level -> stat conversion
  let NEU_PETNUMS = null;
  let NEU_PETS_CONST = null;
  try {
    const base = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/constants';
    const [pnRes, pcRes] = await Promise.all([fetch(base + '/petnums.json'), fetch(base + '/pets.json')]);
    if (pnRes && pnRes.ok) NEU_PETNUMS = await pnRes.json().catch(() => null);
    if (pcRes && pcRes.ok) NEU_PETS_CONST = await pcRes.json().catch(() => null);
  } catch (e) { /* ignore */ }
  const floorStats = buildDungeonStats(memberData);
  const kuudraGear = await buildKuudraGear(memberData, profile, me);
  const kuudraStats = await buildKuudraStats(memberData);
  const riftSection = buildRiftSection(memberData);
  const gearSection = await buildGearSection(memberData);

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(ign)} • BomboAPI Player</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="hero">
    <div class="container">
      <div class="badge">Player Viewer</div>
      <h1>${escapeHtml(ign)}</h1>
      <p class="lead">Profile: <strong>${escapeHtml(profile.cute_name || "-")}</strong> • UUID: <code>${uuid}</code></p>
      <div class="cta">
        <a class="btn" href="/${encodeURIComponent(ign)}/rtca" target="_blank">Raw RTCA JSON</a>
        <a class="btn" href="/" >Home</a>
      </div>
      <p class="lead" style="margin-top:10px;color:#9ca3af">Use <code>?tex=&lt;base-url&gt;</code> to load custom textures (expects <code>{id}.png</code> under the base). Example: <code>?tex=https://cdn.example.com/assets/minecraft/textures/item</code></p>
    </div>
  </header>

  <main class="container">
    <div class="top-grid">
  ${buildSkillsSection(memberData, me)}
  ${gearSection}
    </div>
    ${me ? `
    <section class="grid">
      <div class="card">
        <h2>Catacombs</h2>
        <p>Level: <strong>${Number(me.catacombs.level).toFixed(2)}</strong></p>
        <p>XP: <code>${Math.floor(me.catacombs.xp).toLocaleString()}</code></p>
      </div>
      <div class="card">
        <h2>Class Average</h2>
        <p>Average Level: <strong>${me.average_level}</strong></p>
        <p>Runs to Average 50: <strong>${me.runs_to_avg_50}</strong></p>
      </div>
    </section>
    <section class="card">
      <h2>Classes</h2>
      <div class="endpoints">
        ${Object.entries(me.details).map(([cls, d]) => `
          <div class="endpoint">
            <div class="method get">${cls}</div>
            <div class="path">Lv ${d.level}</div>
            <div class="desc">XP: ${Math.floor(d.xp).toLocaleString()} • to 50: ${Math.floor(d.remaining_to_50).toLocaleString()} • sel runs: ${d.runs_to_50_selected} • unsel runs: ${d.runs_to_50_unselected}</div>
          </div>
        `).join("")}
      </div>
    </section>
    ` : `<section class="card"><p>No member data found.</p></section>`}

    ${floorStats}
    ${kuudraGear}
    ${kuudraStats}
    ${buildMuseumSection(profile, uuidNoDash)}
    ${riftSection}
    ${invSections}
  </main>
  <footer class="footer container"><p>© <span id="year"></span> BomboAPI • Cloudflare Workers</p></footer>
  <script>
  document.getElementById('year').textContent = new Date().getFullYear();
  (function(){
    const DEBUG = new URLSearchParams(location.search).has('debug');
    // Create overlay node
    const ov = document.createElement('div');
    ov.id = 'item-overlay';
    ov.className = 'item-overlay';
    ov.style.display = 'none';
    ov.innerHTML = '<div class="io-header"><div class="io-icon"></div><div class="io-title"></div><button class="io-close" title="Close">×</button></div><div class="io-body"></div>';
    document.body.appendChild(ov);

  // Create a single global tooltip element attached to body so it doesn't get clipped
  const tt = document.createElement('div');
  tt.id = 'item-tooltip';
  tt.className = 'item-tooltip';
  tt.style.display = 'none';
  document.body.appendChild(tt);

  // Show tooltip by copying the per-card .tooltip HTML into the global tooltip and
  // positioning it next to the card. Using a body-level node avoids ancestor clipping.
  function showTooltip(card) {
    const tooltipData = card.querySelector('.tooltip');
    if (!tooltipData) return;
    tt.innerHTML = tooltipData.innerHTML;
    tt.style.display = 'block';
    if (DEBUG) console.debug('[PV] showTooltip html:', tt.innerHTML);
    // Temporarily position off-screen to measure
    tt.style.left = '0px';
    tt.style.top = '0px';
    const tipRect = tt.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    // Prefer to the right of the card
    let newX = Math.round(cardRect.right + 8);
    let newY = Math.round(cardRect.top + (cardRect.height - tipRect.height) / 2);
    // If no space on right, put to the left
    if (newX + tipRect.width > window.innerWidth) {
      newX = Math.round(cardRect.left - tipRect.width - 8);
    }
    // Clamp vertically inside viewport
    if (newY < 8) newY = 8;
    if (newY + tipRect.height > window.innerHeight - 8) newY = Math.max(8, window.innerHeight - tipRect.height - 8);
    tt.style.left = newX + 'px';
    tt.style.top = newY + 'px';
  }

  function hideTooltip() {
    tt.style.display = 'none';
  }

  // Wire mouse events to show/hide the global tooltip
  document.addEventListener('mouseover', function(e) {
    const card = e.target.closest('.item-card.has-tooltip');
    if (card) showTooltip(card);
  });
  document.addEventListener('mouseout', function(e) {
    const card = e.target.closest('.item-card.has-tooltip');
    if (card && !card.contains(e.relatedTarget)) hideTooltip();
  });

    function switchInvTab(btn){const root=btn.closest('[data-tab-root]');if(!root) return false;const key=btn.getAttribute('data-tab');const panelId='tab-'+key;if(DEBUG) console.debug('[PV] switchInvTab', key);root.querySelectorAll('[data-panel]').forEach(el=>el.style.display=(el.id===panelId?'block':'none'));root.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));return false;}
    function switchSubTab(btn){const gp=btn.closest('[data-tab-group]');if(!gp) return false;const id=btn.getAttribute('data-target');if(DEBUG) console.debug('[PV] switchSubTab', id);gp.querySelectorAll('[data-content]').forEach(el=>el.style.display=(el.id===id?'block':'none'));gp.querySelectorAll('[data-target]').forEach(x=>x.classList.toggle('active',x===btn));return false;}
    function openItemOverlay(card){const t=card.querySelector('.tooltip-title');const l=card.querySelector('.tooltip-lore');const ic=card.querySelector('.item-icon');const rc=card.getAttribute('data-rarity')||'';ov.setAttribute('data-rarity', rc);ov.querySelector('.io-title').innerHTML = t ? t.innerHTML : 'Unknown Item';ov.querySelector('.io-body').innerHTML = l ? l.innerHTML : '<div class="tooltip-lore-line">No description</div>';ov.querySelector('.io-icon').style.backgroundImage = ic ? ic.style.backgroundImage : 'none';ov.querySelector('.io-header').style.background = rc || '#2a2a2a';ov.style.display='block';}
    function closeItemOverlay(){ov.style.display='none';}
    function openItemOverlay2(card){const t=card.querySelector('.tooltip-title');const l=card.querySelector('.tooltip-lore');const ic=card.querySelector('.item-icon');let rc='';try{const map={ 'VERY SPECIAL':'#FF5555','SPECIAL':'#FF5555','ADMIN':'#AA0000','DIVINE':'#55FFFF','MYTHIC':'#FF55FF','LEGENDARY':'#FFAA00','EPIC':'#AA00AA','RARE':'#5555FF','UNCOMMON':'#55FF55','COMMON':'#FFFFFF' };const lines=[...card.querySelectorAll('.tooltip-lore-line')].map(x=>x.textContent.trim().toUpperCase());for(let i=lines.length-1;i>=0;i--){const line=lines[i];for(const k of Object.keys(map)){if(line.includes(k)){rc=map[k];break;}}if(rc) break;}}catch{};ov.setAttribute('data-rarity', rc);ov.querySelector('.io-title').innerHTML = t ? t.innerHTML : 'Unknown Item';ov.querySelector('.io-body').innerHTML = l ? l.innerHTML : '<div class=\"tooltip-lore-line\">No description</div>';ov.querySelector('.io-icon').style.backgroundImage = ic ? ic.style.backgroundImage : 'none';ov.querySelector('.io-header').style.background = rc || '#2a2a2a';ov.style.display='block';}

    document.addEventListener('click',function(e){
      const c=e.target.closest('.item-card');
      if(c){ e.preventDefault(); openItemOverlay2(c); return; }
      const tab=e.target.closest('[data-tab]');
      if(tab){ e.preventDefault(); return switchInvTab(tab); }
      const t=e.target.closest('[data-target]');
      if(t){ e.preventDefault(); return switchSubTab(t); }
      if(e.target.closest('.io-close')){ e.preventDefault(); return closeItemOverlay(); }
      if(!e.target.closest('#item-overlay')){ closeItemOverlay(); }
    });

    window.switchInvTab = switchInvTab;
    window.switchSubTab = switchSubTab;
  })();
  </script>
</body>
</html>`;

  return htmlResponse(200, page);
}

// Render a snapshot view that shows all members of a profile (used by /pv-snapshot)
export async function renderPVSnapshotAllMembers(ign, env, opts = {}) {
  TEXTURE_BASE = opts.textureBase || "";
  ICON_OVERRIDE = opts.iconUrl || "";
  let profile = opts.rawProfile;

  if (!profile) {
    const uuid = await fetchUUID(ign);
    const profiles = await fetchSkyblockProfiles(uuid, opts.hypixelKey || env.HYPIXEL_KEY);
    profile = getSelectedProfile(profiles);
    if (!profile) return htmlResponse(500, `No profiles found for ${escapeHtml(ign)}`);
  }

  // Compute RTCA for all members (pass empty requestedUuid)
  const rtca = calculateRtca(profile, ign, "");
  const members = profile.members || {};
  const entries = Object.entries(members);
  const sections = [];

  let idx = 0;
  for (const [memberUuid, memberData] of entries) {
    const isPrimary = idx === 0;
    idx += 1;
    const cleanUuid = String(memberUuid || "").replace(/-/g, "").toLowerCase();
    const me = rtca.members[memberUuid] || rtca.members[cleanUuid];

    // Best-effort display name: try common fields, fall back to uuid
    let label = await resolveMemberName(memberUuid, memberData);

    const invSections = isPrimary ? await buildInventorySections(memberData, opts) : "";
    const floorStats = buildDungeonStats(memberData);
    const kuudraGear = isPrimary ? await buildKuudraGear(memberData, profile, me) : "";
    const kuudraStats = isPrimary ? await buildKuudraStats(memberData) : "";
    const riftSection = buildRiftSection(memberData);
    const gearSection = await buildGearSection(memberData);

    const statsBlock = me ? `
    <section class="grid">
      <div class="card">
        <h3>Catacombs</h3>
        <p>Level: <strong>${Number(me.catacombs.level || 0).toFixed(2)}</strong></p>
        <p>XP: <code>${Math.floor(me.catacombs.xp || 0).toLocaleString()}</code></p>
      </div>
      <div class="card">
        <h3>Class Average</h3>
        <p>Average Level: <strong>${me.average_level}</strong></p>
        <p>Runs to Average 50: <strong>${me.runs_to_avg_50}</strong></p>
      </div>
    </section>
    <section class="card">
      <h3>Classes</h3>
      <div class="endpoints">
        ${Object.entries(me.details || {}).map(([cls, d]) => `
          <div class="endpoint">
            <div class="method get">${cls}</div>
            <div class="path">Lv ${d.level}</div>
            <div class="desc">XP: ${Math.floor(d.xp || 0).toLocaleString()}  to 50: ${Math.floor(d.remaining_to_50 || 0).toLocaleString()}  sel runs: ${d.runs_to_50_selected}  unsel runs: ${d.runs_to_50_unselected}</div>
          </div>
        `).join("")}
      </div>
    </section>
    ` : `<section class="card"><p>No dungeon data for this member.</p></section>`;

    sections.push(`
    <section class="card" style="margin-top:24px;">
      <h2>${escapeHtml(label)}</h2>
      <p class="lead" style="margin-top:0;">UUID: <code>${memberUuid}</code></p>
      <div class="top-grid">
        ${buildSkillsSection(memberData, me)}
        ${gearSection}
      </div>
      ${statsBlock}
      ${floorStats}
      ${kuudraGear}
      ${kuudraStats}
      ${isPrimary ? buildMuseumSection(profile, cleanUuid) : ""}
      ${riftSection}
      ${invSections}
    </section>`);
  }

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(profile.cute_name || ign)}  BomboAPI Profile Snapshot</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="hero">
    <div class="container">
      <div class="badge">Player Viewer</div>
      <h1>${escapeHtml(profile.cute_name || ign)}</h1>
      <p class="lead">Snapshot with ${entries.length} member${entries.length === 1 ? "" : "s"}.</p>
      <div class="cta">
        <a class="btn" href="/" >Home</a>
      </div>
    </div>
  </header>

  <main class="container">
    ${sections.join("\n")}
  </main>
  <footer class="footer container"><p>c <span id="year"></span> BomboAPI  Cloudflare Workers</p></footer>
  <script>
  document.getElementById('year').textContent = new Date().getFullYear();
  (function(){
    const DEBUG = new URLSearchParams(location.search).has('debug');
    // Create overlay node
    const ov = document.createElement('div');
    ov.id = 'item-overlay';
    ov.className = 'item-overlay';
    ov.style.display = 'none';
    ov.innerHTML = '<div class="io-header"><div class="io-icon"></div><div class="io-title"></div><button class="io-close" title="Close">x</button></div><div class="io-body"></div>';
    document.body.appendChild(ov);

  // Create a single global tooltip element attached to body so it doesn't get clipped
  const tt = document.createElement('div');
  tt.id = 'item-tooltip';
  tt.className = 'item-tooltip';
  tt.style.display = 'none';
  document.body.appendChild(tt);

  // Show tooltip by copying the per-card .tooltip HTML into the global tooltip and
  // positioning it next to the card. Using a body-level node avoids ancestor clipping.
  function showTooltip(card) {
    const tooltipData = card.querySelector('.tooltip');
    if (!tooltipData) return;
    tt.innerHTML = tooltipData.innerHTML;
    tt.style.display = 'block';
    if (DEBUG) console.debug('[PV] showTooltip html:', tt.innerHTML);
    // Temporarily position off-screen to measure
    tt.style.left = '0px';
    tt.style.top = '0px';
    const tipRect = tt.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    // Prefer to the right of the card
    let newX = Math.round(cardRect.right + 8);
    let newY = Math.round(cardRect.top + (cardRect.height - tipRect.height) / 2);
    // If no space on right, put to the left
    if (newX + tipRect.width > window.innerWidth) {
      newX = Math.round(cardRect.left - tipRect.width - 8);
    }
    // Clamp vertically inside viewport
    if (newY < 8) newY = 8;
    if (newY + tipRect.height > window.innerHeight - 8) newY = Math.max(8, window.innerHeight - tipRect.height - 8);
    tt.style.left = newX + 'px';
    tt.style.top = newY + 'px';
  }

  function hideTooltip() {
    tt.style.display = 'none';
  }

  // Wire mouse events to show/hide the global tooltip
  document.addEventListener('mouseover', function(e) {
    const card = e.target.closest('.item-card.has-tooltip');
    if (card) showTooltip(card);
  });
  document.addEventListener('mouseout', function(e) {
    const card = e.target.closest('.item-card.has-tooltip');
    if (card && !card.contains(e.relatedTarget)) hideTooltip();
  });

    function switchInvTab(btn){const root=btn.closest('[data-tab-root]');if(!root) return false;const key=btn.getAttribute('data-tab');const panelId='tab-'+key;if(DEBUG) console.debug('[PV] switchInvTab', key);root.querySelectorAll('[data-panel]').forEach(el=>el.style.display=(el.id===panelId?'block':'none'));root.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));return false;}
    function switchSubTab(btn){const gp=btn.closest('[data-tab-group]');if(!gp) return false;const id=btn.getAttribute('data-target');if(DEBUG) console.debug('[PV] switchSubTab', id);gp.querySelectorAll('[data-content]').forEach(el=>el.style.display=(el.id===id?'block':'none'));gp.querySelectorAll('[data-target]').forEach(x=>x.classList.toggle('active',x===btn));return false;}
    function openItemOverlay(card){const t=card.querySelector('.tooltip-title');const l=card.querySelector('.tooltip-lore');const ic=card.querySelector('.item-icon');const rc=card.getAttribute('data-rarity')||'';ov.setAttribute('data-rarity', rc);ov.querySelector('.io-title').innerHTML = t ? t.innerHTML : 'Unknown Item';ov.querySelector('.io-body').innerHTML = l ? l.innerHTML : '<div class="tooltip-lore-line">No description</div>';ov.querySelector('.io-icon').style.backgroundImage = ic ? ic.style.backgroundImage : 'none';ov.querySelector('.io-header').style.background = rc || '#2a2a2a';ov.style.display='block';}
    function closeItemOverlay(){ov.style.display='none';}
    function openItemOverlay2(card){const t=card.querySelector('.tooltip-title');const l=card.querySelector('.tooltip-lore');const ic=card.querySelector('.item-icon');let rc='';try{const map={ 'VERY SPECIAL':'#FF5555','SPECIAL':'#FF5555','ADMIN':'#AA0000','DIVINE':'#55FFFF','MYTHIC':'#FF55FF','LEGENDARY':'#FFAA00','EPIC':'#AA00AA','RARE':'#5555FF','UNCOMMON':'#55FF55','COMMON':'#FFFFFF' };const lines=[...card.querySelectorAll('.tooltip-lore-line')].map(x=>x.textContent.trim().toUpperCase());for(let i=lines.length-1;i>=0;i--){const line=lines[i];for(const k of Object.keys(map)){if(line.includes(k)){rc=map[k];break;}}if(rc) break;}}catch{};ov.setAttribute('data-rarity', rc);ov.querySelector('.io-title').innerHTML = t ? t.innerHTML : 'Unknown Item';ov.querySelector('.io-body').innerHTML = l ? l.innerHTML : '<div class=\"tooltip-lore-line\">No description</div>';ov.querySelector('.io-icon').style.backgroundImage = ic ? ic.style.backgroundImage : 'none';ov.querySelector('.io-header').style.background = rc || '#2a2a2a';ov.style.display='block';}

    document.addEventListener('click',function(e){
      const c=e.target.closest('.item-card');
      if(c){ e.preventDefault(); openItemOverlay2(c); return; }
      const tab=e.target.closest('[data-tab]');
      if(tab){ e.preventDefault(); return switchInvTab(tab); }
      const t=e.target.closest('[data-target]');
      if(t){ e.preventDefault(); return switchSubTab(t); }
      if(e.target.closest('.io-close')){ e.preventDefault(); return closeItemOverlay(); }
      if(!e.target.closest('#item-overlay')){ closeItemOverlay(); }
    });

    window.switchInvTab = switchInvTab;
    window.switchSubTab = switchSubTab;
  })();

  // Client-side UUID -> name resolver for snapshot headers
  (async function(){
    const hex32 = /^[0-9a-f]{32}$/i;
    const sections = document.querySelectorAll('main.container > section.card');
    for (const sec of sections) {
      const header = sec.querySelector('h2');
      const codeEl = sec.querySelector('p.lead code');
      if (!header || !codeEl) continue;
      const uuid = (codeEl.textContent || '').trim();
      const current = (header.textContent || '').trim();
      if (!hex32.test(uuid) || !hex32.test(current)) continue;
      let name = '';
      try {
        const r = await fetch('https://playerdb.co/api/player/minecraft/' + encodeURIComponent(uuid));
        if (r.ok) {
          const j = await r.json().catch(() => null);
          name = (j && j.data && j.data.player && (j.data.player.username || j.data.player.name)) || '';
        }
      } catch (_) {}
      if (!name) {
        try {
          const r2 = await fetch('https://api.mojang.com/user/profile/' + encodeURIComponent(uuid));
          if (r2.ok) {
            const j2 = await r2.json().catch(() => null);
            if (j2 && typeof j2.name === 'string') name = j2.name.trim();
          }
        } catch (_) {}
      }
      if (name) header.textContent = name;
    }
  })();
  </script>
</body>
</html>`;

  return htmlResponse(200, page);
}

function htmlResponse(status, body) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function resolveMemberName(uuid, memberData) {
  if (!uuid) return "Unknown";

  // Try to read a name from the member data first
  try {
    const candidate =
      memberData?.player_data?.player_name ||
      memberData?.playername ||
      memberData?.username;
    if (typeof candidate === "string" && candidate.trim()) {
      const n = candidate.trim();
      return n;
    }
  } catch (_) {}

  // Fallback: leave UUID as-is; client-side JS may try external APIs
  return uuid;
}

function buildDungeonStats(member) {
  const d = member?.dungeons || {};
  const cat = d.dungeon_types?.catacombs || {}; // Catacombs data
  const mcat = d.dungeon_types?.master_catacombs || {}; // Master Catacombs data
  const comps = cat?.tier_completions || {};
  const mcomps = mcat?.tier_completions || {};
  const onlyNums = (obj) => Object.keys(obj || {}).filter(k => /^\d+$/.test(String(k))).sort((a,b)=>Number(a)-Number(b));
  const catKeys = onlyNums(comps);
  const mKeys = onlyNums(mcomps);
  const sum = (o, ks) => ks.reduce((a,k)=>a + Number(o[k] || 0), 0);
  const fTotal = sum(comps, catKeys);
  const mTotal = sum(mcomps, mKeys);
  const catList = [
    ...catKeys.map((k) => `<li>F${k}: <strong>${Number(comps[k]).toLocaleString()}</strong></li>`),
    ...(fTotal ? [`<li><strong>Ftotal: ${fTotal.toLocaleString()}</strong></li>`] : [])
  ].join("");
  const mList = [
    ...mKeys.map((k) => `<li>M${k}: <strong>${Number(mcomps[k]).toLocaleString()}</strong></li>`),
    ...(mTotal ? [`<li><strong>Mtotal: ${mTotal.toLocaleString()}</strong></li>`] : [])
  ].join("");
  const secrets = d?.secrets || 0;
  if (!catList && !mList && !secrets) return "";
  const totalRuns = fTotal + mTotal;
  const spr = totalRuns ? (Number(secrets)/totalRuns).toFixed(2) : '0.00';
  return `
  <section class="card">
    <h2>Dungeons Completions</h2>
    <div class="grid">
      <div>
        <h3>Catacombs</h3>
        <ul>${catList || '<li>None</li>'}</ul>
      </div>
      <div>
        <h3>Master Catacombs</h3>
        <ul>${mList || '<li>None</li>'}</ul>
      </div>
    </div>
    <p>Secrets Found: <strong>${Number(secrets).toLocaleString()}</strong> • Secrets/Run: <strong>${spr}</strong></p>
  </section>`;
}

async function buildKuudraStats(member) {
  // Trimmed per user request: remove Kuudra text rows (Runs, Reputation, Terror/Aurora/Hollow)
  // Keep only Kuudra Gear section elsewhere. Do not render this block.
  return "";
  const nether = member?.nether_island_player_data || {};
  const raw = nether?.kuudra_completed_tiers || nether?.kuudra_completed || {};
  // Completions aggregation
  const agg = { basic: 0, hot: 0, burning: 0, fiery: 0, infernal: 0 };
  const waves = { basic: null, hot: null, burning: null, fiery: null, infernal: null };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k).toLowerCase();
      if (key.startsWith('highest_wave')) {
        const tier = key.endsWith('none') ? 'basic'
          : key.endsWith('hot') ? 'hot'
          : key.endsWith('burning') ? 'burning'
          : key.endsWith('fiery') ? 'fiery'
          : key.endsWith('infernal') ? 'infernal' : null;
        if (tier) waves[tier] = Number(v) || 0;
        continue;
      }
      const tier = key === 'none' ? 'basic' : key;
      if (tier in agg) agg[tier] += Number(v) || 0;
    }
  }

  const order = ['basic', 'hot', 'burning', 'fiery', 'infernal'];
  const totalRuns = Object.values(agg).reduce((a, b) => a + Number(b || 0), 0);
  const t5Runs = Number(agg.infernal || 0);

  // Reputation / faction
  const mageRep = Number(nether?.mage_reputation || nether?.mages_reputation || 0);
  const barbRep = Number(nether?.barbarian_reputation || nether?.barbarians_reputation || 0);
  const faction = (nether?.chosen_faction || nether?.current_faction || nether?.faction || '').toString();

  // Decode inventory/ender/wardrobe for armor scanning
  const invRoot = member?.inventory || member;
  async function decodeNode(pathKey) {
    const node = invRoot?.[pathKey];
    const b64 = node?.data || node?.raw || node?.bytes;
    if (!b64 || typeof b64 !== 'string') return [];
    try { return await decodeInventoryItems(b64); } catch { return []; }
  }
  const [invItems, ecItems, wardItems] = await Promise.all([
    decodeNode('inv_contents'),
    decodeNode('ender_chest_contents'),
    decodeNode('wardrobe_contents'),
  ]);
  const allItems = ([]).concat(wardItems || [], invItems || [], ecItems || []);

  // Helpers to detect Kuudra armor and best tiers
  const TIER_ORDER = ['basic', 'hot', 'burning', 'fiery', 'infernal'];
  const rank = (t) => Math.max(0, TIER_ORDER.indexOf(t));
  function detectArmor(it) {
    const baseId = String(it?.hypixelId || it?.id || '').toUpperCase();
    const nm = String(it?.name || '').toLowerCase();
    const sets = ['terror', 'aurora', 'hollow'];
    let set = null;
    for (const s of sets) {
      if (nm.includes(s)) { set = s; break; }
      if (baseId.includes(s.toUpperCase())) { set = s; break; }
    }
    if (!set) return null;
    const tier = nm.includes('infernal') ? 'infernal'
      : nm.includes('fiery') ? 'fiery'
      : nm.includes('burning') ? 'burning'
      : nm.includes('hot') ? 'hot'
      : 'basic';
    return { set, tier, item: it };
  }
  function findBest(setName) {
    let best = null;
    for (const it of allItems) {
      const d = detectArmor(it);
      if (!d || d.set !== setName) continue;
      if (!best || rank(d.tier) > rank(best.tier)) best = d;
    }
    return best;
  }
  function extractEnchantsAndGems(it) {
    const lore = Array.isArray(it?.lore) ? it.lore : [];
    let manaEnchant = null;
    let legion = null;
    const gems = new Set();
    const GEM_WORDS = ['RUBY','JASPER','AMETHYST','SAPPHIRE','AMBER','JADE','TOPAZ','OPAL','ONYX','AQUAMARINE','CITRINE','PERIDOT'];
    for (const rawLine of lore) {
      const line = simplifyMcText(typeof rawLine === 'string' ? rawLine : JSON.stringify(rawLine));
      const u = line.toUpperCase();
      if (!manaEnchant && /STRONG\s+MANA\s+[IVXLCDM]+/i.test(line)) manaEnchant = (line.match(/Strong\s+Mana\s+[IVXLCDM]+/i) || [line])[0];
      if (!manaEnchant && /FEROCIOUS\s+MANA\s+[IVXLCDM]+/i.test(line)) manaEnchant = (line.match(/Ferocious\s+Mana\s+[IVXLCDM]+/i) || [line])[0];
      if (!legion && /LEGION\s+[IVXLCDM]+/i.test(line)) legion = (line.match(/Legion\s+[IVXLCDM]+/i) || [line])[0];
      if (/[✧◆♦]/.test(line) || u.includes('GEM') || u.includes('GEMSTONE') || /SLOT/i.test(line)) {
        for (const g of GEM_WORDS) if (u.includes(g)) gems.add(g);
      }
    }
    return { manaEnchant, legion, gemstones: Array.from(gems) };
  }

  const terrorBest = findBest('terror');
  const auroraBest = findBest('aurora');
  const hollowBest = findBest('hollow');
  const terrorInfo = terrorBest ? extractEnchantsAndGems(terrorBest.item) : null;

  // Golden Dragon presence
  const hasGDrag = Array.isArray(member?.pets) && member.pets.some(p => String(p?.type).toUpperCase() === 'GOLDEN_DRAGON');

  // Render
  const list = order.map((t) => `<li>${t[0].toUpperCase()}${t.slice(1)}: <strong>${Number(agg[t]||0).toLocaleString()}</strong>${waves[t]!=null?` (${waves[t]})`:''}</li>`).join('');

  const rows = [];
  rows.push(`<div class="endpoint"><div class="method get">Runs</div><div class="path">${t5Runs.toLocaleString()} (${totalRuns.toLocaleString()})</div><div class="desc">T5 (Total)</div></div>`);
  if (hasGDrag) rows.push(`<div class="endpoint"><div class="method get">Pet</div><div class="path">Golden Dragon</div><div class="desc">Present</div></div>`);
  if (typeof mageRep === 'number' || typeof barbRep === 'number') {
    rows.push(`<div class="endpoint"><div class="method get">Reputation</div><div class="path">Mage: ${Number(mageRep||0).toLocaleString()}</div><div class="desc">Barbarian: ${Number(barbRep||0).toLocaleString()}${faction?`  Faction: ${escapeHtml(faction)}`:''}</div></div>`);
  }
  if (terrorBest) {
    const nm = simplifyMcText(terrorBest.item?.name || 'Terror');
    const parts = [];
    if (terrorInfo?.manaEnchant) parts.push(escapeHtml(terrorInfo.manaEnchant));
    if (terrorInfo?.legion) parts.push(escapeHtml(terrorInfo.legion));
    if (terrorInfo?.gemstones?.length) parts.push(`Gems: ${escapeHtml(terrorInfo.gemstones.join(', '))}`);
    rows.push(`<div class="endpoint"><div class="method get">Terror</div><div class="path">${escapeHtml(terrorBest.tier[0].toUpperCase()+terrorBest.tier.slice(1))}</div><div class="desc">${escapeHtml(nm)}${parts.length?`  ${parts.join('  ')}`:''}</div></div>`);
  }
  if (auroraBest) {
    const nm = simplifyMcText(auroraBest.item?.name || 'Aurora');
    rows.push(`<div class="endpoint"><div class="method get">Aurora</div><div class="path">${escapeHtml(auroraBest.tier[0].toUpperCase()+auroraBest.tier.slice(1))}</div><div class="desc">${escapeHtml(nm)}</div></div>`);
  }
  if (hollowBest && hollowBest.tier === 'infernal') {
    const nm = simplifyMcText(hollowBest.item?.name || 'Hollow');
    rows.push(`<div class="endpoint"><div class="method get">Hollow</div><div class="path">Infernal</div><div class="desc">${escapeHtml(nm)}</div></div>`);
  }

  // If nothing meaningful and no completions, omit the section entirely
  const hasAny = rows.length || totalRuns;
  if (!hasAny) return "";

  return `
  <section class="card">
    <h2>Kuudra</h2>
    <div class="endpoints">${rows.join('')}</div>
    <h3 style="margin-top:10px">Completions by Tier</h3>
    <ul>${list}</ul>
  </section>`;
}

function buildRiftSection(member) {
  const rift = member?.rift || {};
  const milestones = rift?.milestones || rift?.milestone_data || null;
  const time = rift?.time || rift?.total_time || null;
  if (!milestones && !time) return "";
  const body = [
    time != null ? `<p>Total Rift Time: <strong>${Number(time).toLocaleString()}</strong></p>` : '' ,
    milestones ? `<pre class="code-block">${escapeHtml(JSON.stringify(milestones, null, 2))}</pre>` : ''
  ].join('\n');
  return `
  <section class="card">
    <h2>Rift</h2>
    ${body}
  </section>`;
}



 

function buildSkillsSection(member, me) {
  const expNode = member?.experience || member?.player_data?.experience || {};
  const sbLevel = Math.floor(Number(member?.leveling?.experience || 0) / 100);

  const maxLevels = {
    Combat: 60,
    Foraging: 50,
    Mining: 60,
    Farming: 50,
    Enchanting: 60,
    Fishing: 50,
    Alchemy: 50,
    Taming: 50,
  };

  const farmingPerk = member?.jacobs_contest?.perks?.farming_level_cap || 0;
  maxLevels.Farming = 50 + farmingPerk;

  const sacrificedPets = member?.pets_data?.pet_care?.pet_types_sacrificed?.length || 0;
  maxLevels.Taming = Math.min(60, 50 + sacrificedPets);

  const skills = [
    { name: "Combat", xp: expNode.SKILL_COMBAT || 0 },
    { name: "Foraging", xp: expNode.SKILL_FORAGING || 0 },
    { name: "Mining", xp: expNode.SKILL_MINING || 0 },
    { name: "Farming", xp: expNode.SKILL_FARMING || 0 },
    { name: "Enchanting", xp: expNode.SKILL_ENCHANTING || 0 },
    { name: "Fishing", xp: expNode.SKILL_FISHING || 0 },
    { name: "Alchemy", xp: expNode.SKILL_ALCHEMY || 0 },
    { name: "Taming", xp: expNode.SKILL_TAMING || 0 },
  ];

  const skillLevels = skills.map(skill => {
    const maxLevel = maxLevels[skill.name] || 50;
    const level = Math.floor(levelFromSkillXp(skill.xp, maxLevel));
    return {
      name: skill.name,
      level: level,
    };
  });

  const cataLvl = Math.floor(Number(me?.catacombs?.level || 0));

  const skillsHtml = skillLevels.map(skill => `
    <div class="skill-item">
      <span class="skill-name">${skill.name}</span>
      <span class="skill-level">${skill.level}</span>
    </div>
  `).join("");

  return `
    <section class="card">
      <div class="skills-grid">
        <div class="skill-item">
          <span class="skill-name">SkyBlock Level</span>
          <span class="skill-level">${sbLevel}</span>
        </div>
        <div class="skill-item">
          <span class="skill-name">Catacombs</span>
          <span class="skill-level">${cataLvl}</span>
        </div>
        ${skillsHtml}
      </div>
    </section>
  `;
}

async function buildGearSection(member) {
  const invRoot = member?.inventory || member;
  async function decodeNode(pathKey) {
    const node = invRoot?.[pathKey];
    const b64 = node?.data || node?.raw || node?.bytes;
    if (!b64 || typeof b64 !== 'string') return [];
    try { return await decodeInventoryItems(b64); } catch { return []; }
  }

  const armorItemsRaw = await decodeNode('inv_armor');
  // Try both legacy and newer keys for equipment; some profiles use 'equipment_contents'
  let equipmentItems = await decodeNode('equip_contents');
  if ((!equipmentItems || equipmentItems.length === 0) && typeof invRoot === 'object') {
    // try alternative key used in some exports
    equipmentItems = await decodeNode('equipment_contents');
  }

  if ((!armorItemsRaw || armorItemsRaw.length === 0) && (!equipmentItems || equipmentItems.length === 0)) {
    return "";
  }

  // Armor items are in order: boots, leggings, chestplate, helmet. Reverse for top-down display.
  const armorItems = (armorItemsRaw || []).reverse();
  // Pad armor to 4 slots for consistent layout
  while (armorItems.length < 4) armorItems.push(null);

  const equipmentItemsPadded = equipmentItems ? [...equipmentItems] : [];
  while (equipmentItemsPadded.length < 4) equipmentItemsPadded.push(null);


  const renderSet = (items, title) => {
    if (!items || items.length === 0) return '';
    const html = items.map(item => {
      if (!item || Object.keys(item).length === 0) {
        return `<div class="item-card"><div class="item-icon empty"></div></div>`;
      }
      const titleHtml = item.nameRaw ? formatMcText(item.nameRaw) : escapeHtml(item.name);
      const icons = getItemIconUrls(item);
      const rarity = getRarityColor(item);
      const toRgb = (hex) => {
        const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      };
      const rgb = rarity ? toRgb(rarity) : null;
      const bgOverlay = rgb ? `linear-gradient(rgba(${rgb.r},${rgb.g},${rgb.b},0.35), rgba(${rgb.r},${rgb.g},${rgb.b},0.35))` : '';
      const bgComma = (bgOverlay && icons.length) ? ', ' : '';
      const imgHtml = (icons && icons[0])
        ? `<img class="item-img" src="${icons[0]}" ${icons[1]?`data-alt="${icons[1]}"`:''} ${icons[2]?`data-alt2="${icons[2]}"`:''} onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=this.dataset.alt2||'';return;}if(this.dataset.alt2){this.src=this.dataset.alt2;this.dataset.alt2='';}" style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;display:block;">`
        : '';
      const loreHtml = (item.loreRaw && item.loreRaw.length)
        ? `<div class="tooltip-lore">${item.loreRaw.map(line => `<div class="tooltip-lore-line">${formatMcText(line)}</div>`).join('')}</div>`
        : '';

      return `<div class="item-card has-tooltip">
                <div class="item-icon" style="background-image:${bgOverlay}${bgComma}${icons.map(u => `url('${u}')`).join(', ')}">
                  ${imgHtml}
                </div>
                <div class="tooltip">
                  <div class="tooltip-title">${titleHtml}</div>
                  ${loreHtml}
                </div>
              </div>`;
    }).join("");

    return `<div style="text-align: center;"><h3>${title}</h3><div class="gear-set-grid" style="display: flex; flex-direction: column; gap: 8px;">${html}</div></div>`;
  }

  const armorHtml = renderSet(armorItems, 'Armor');
  const equipmentHtml = renderSet(equipmentItemsPadded, 'Equipment');

  return `
    <section class="card">
      <h2>Gear</h2>
      <div class="gear-display" style="display: flex; gap: 24px; justify-content: center; align-items: flex-start;">
        ${armorHtml}
        ${equipmentHtml}
      </div>
    </section>
  `;
}

// Kuudra gear: vertical columns (side-by-side) and key stats
async function buildKuudraGear(member, profile, me) {
  try {
    const nether = member?.nether_island_player_data || {};
    const raw = nether?.kuudra_completed_tiers || nether?.kuudra_completed || {};
    const agg = { basic: 0, hot: 0, burning: 0, fiery: 0, infernal: 0 };
    for (const [k, v] of Object.entries(raw || {})) {
      const key = String(k).toLowerCase();
      if (key.startsWith('highest_wave')) continue;
      const tier = key === 'none' ? 'basic' : key;
      if (tier in agg) agg[tier] += Number(v) || 0;
    }
    const totalRuns = Object.values(agg).reduce((a,b)=>a+Number(b||0),0);
    const t5Runs = Number(agg.infernal || 0);

    const mageRep = Number(nether?.mage_reputation || nether?.mages_reputation || 0);
    const barbRep = Number(nether?.barbarian_reputation || nether?.barbarians_reputation || 0);

    // Pets: support both layouts
    const petsArr = Array.isArray(member?.pets) ? member.pets : (Array.isArray(member?.pets_data?.pets) ? member.pets_data.pets : []);
    const gdrags = petsArr.filter(p => String(p?.type||'').toUpperCase() === 'GOLDEN_DRAGON');

    // Personal gold collection & bank
    const goldCollection = Number(member?.collection?.GOLD_INGOT || member?.collection?.gold_ingot || 0) || 0;
    const bankBalance = Number(profile?.banking?.balance || profile?.banking?.bank_balance || 0);

    // Decode items from inventory sources
    const invRoot = member?.inventory || member;
    async function decodeNode(pathKey) {
      const node = invRoot?.[pathKey];
      const b64 = node?.data || node?.raw || node?.bytes;
      if (!b64 || typeof b64 !== 'string') return [];
      try { return await decodeInventoryItems(b64); } catch { return []; }
    }
    const [invItems, ecItems, wardItems] = await Promise.all([
      decodeNode('inv_contents'),
      decodeNode('ender_chest_contents'),
      decodeNode('wardrobe_contents'),
    ]);
    const bpMap = invRoot?.backpack_contents || member?.backpack_contents || {};
    let bpItems = [];
    for (const k of Object.keys(bpMap)) {
      const b64 = bpMap[k]?.data || bpMap[k]?.raw || bpMap[k]?.bytes || bpMap[k];
      if (typeof b64 !== 'string') continue;
      try { const its = await decodeInventoryItems(b64); bpItems = bpItems.concat(its); } catch {}
    }
    const nonBpItems = ([]).concat(wardItems || [], invItems || [], ecItems || []);
    const allItems = nonBpItems.concat(bpItems);

    // Accessory bag decode for Magical Power
    const bagContents = invRoot?.bag_contents || member?.bag_contents || {};
    async function decodeBag(key) {
      const node = bagContents?.[key];
      const b64 = node?.data || node?.raw || node?.bytes || node;
      if (!b64 || typeof b64 !== 'string') return [];
      try { return await decodeInventoryItems(b64); } catch { return []; }
    }
    let accItems = [];
    accItems = accItems.concat(await decodeBag('accessory_bag'));
    accItems = accItems.concat(await decodeBag('talisman_bag'));
    // Dedupe accessories by Hypixel ID
    const uniqueMap = new Map();
    for (const it of accItems) {
      const key = String(it?.hypixelId || it?.id || it?.name || '').toUpperCase();
      if (!key) continue;
      if (!uniqueMap.has(key)) uniqueMap.set(key, it);
    }
    const uniqAccs = Array.from(uniqueMap.values());

    // Helpers
    function detectArmor(it) {
      const baseId = String(it?.hypixelId || it?.id || '').toUpperCase();
      const nm = String(it?.name || '').toLowerCase();
      const sets = ['terror', 'aurora', 'hollow'];
      let set = null;
      for (const s of sets) {
        if (nm.includes(s)) { set = s; break; }
        if (baseId.includes(s.toUpperCase())) { set = s; break; }
      }
      if (!set) return null;
      const tier = nm.includes('infernal') ? 'infernal'
        : nm.includes('fiery') ? 'fiery'
        : nm.includes('burning') ? 'burning'
        : nm.includes('hot') ? 'hot'
        : 'basic';
      return { set, tier, item: it };
    }
    function slotOf(it) {
      const s = String(it?.hypixelId || it?.id || it?.name || '').toUpperCase();
      if (s.includes('HELMET')) return 'HELMET';
      if (s.includes('CHESTPLATE')) return 'CHESTPLATE';
      if (s.includes('LEGGINGS')) return 'LEGGINGS';
      if (s.includes('BOOTS')) return 'BOOTS';
      return 'OTHER';
    }
    const sortArmor = (items) => {
      const order = { HELMET: 0, CHESTPLATE: 1, LEGGINGS: 2, BOOTS: 3 };
      return (items || []).slice().sort((a,b)=> (order[slotOf(a)] ?? 9) - (order[slotOf(b)] ?? 9));
    };
    function hasReforge(it){ try { const nameU = String(it?.name||'').toUpperCase(); const reforges = ['ANCIENT','RENOWNED','NECROTIC','WISE','LOVING','GIANT','FIERCE','PURE','TITANIC','REINFORCED','SPIRITUAL','FABLED','WITHERED','PRECISE']; return reforges.some(r => nameU.includes(r+' ')); } catch { return false; } }
    function hasEnchants(it){ try { const lore = Array.isArray(it?.lore)? it.lore : []; for (const raw of lore){ const line = simplifyMcText(typeof raw === 'string' ? raw : JSON.stringify(raw)); if (/\b[IVXLCDM]{1,4}\b/.test(line)) return true; } } catch {} return false; }
    const hasEnchantAndReforge = (it) => hasReforge(it) && hasEnchants(it);

    // Best tiers per set
    function findBest(setName) {
      const tiers = ['basic', 'hot', 'burning', 'fiery', 'infernal'];
      let best = null;
      for (const it of allItems) {
        const d = detectArmor(it);
        if (!d || d.set !== setName) continue;
        if (!best || tiers.indexOf(d.tier) > tiers.indexOf(best.tier)) best = d;
      }
      return best;
    }
    const terrorBest = findBest('terror');
    const auroraBest = findBest('aurora');
    const hollowBest = findBest('hollow');

    // Helmets
    const warden = allItems.find(it => /WARDEN[_\s]?HELMET/i.test(String(it?.hypixelId||it?.name||'')));
    const primordialHelm = allItems.find(it => /PRIMORDIAL/i.test(String(it?.hypixelId||it?.name||'')) && /HELMET/i.test(String(it?.hypixelId||it?.name||'')));
    const auroraHelmAny = allItems.find(it => /AURORA/i.test(String(it?.hypixelId||it?.name||'')) && /HELMET/i.test(String(it?.hypixelId||it?.name||'')));
    const witherGoggles = allItems.find(it => /WITHER[_\s]?GOGGLES/i.test(String(it?.hypixelId||it?.name||'')));

    // Weapons
    function matchItem(it, key) { const id = String(it?.hypixelId || it?.id || '').toUpperCase(); const nm = String(it?.name || '').toUpperCase(); return id.includes(key) || nm.includes(key.replace(/_/g,' ')); }
    let weaponItems = allItems.filter(it => ['HYPERION','TERMINATOR','BONEMERANG','RAGNAROK_AXE'].some(k => matchItem(it, k)));
    // Prefer Terminators with Duplex or Rend
    const termAll = weaponItems.filter(it => matchItem(it, 'TERMINATOR'));
    const hasEnchantName = (it, names) => { const lore = it?.lore || []; const u = lore.map(l => simplifyMcText(typeof l === 'string' ? l : JSON.stringify(l)).toUpperCase()); return names.some(n => u.some(line => line.includes(n))); };
    const termSpecial = termAll.filter(it => hasEnchantName(it, ['DUPLEX','REND']));
    if (termSpecial.length) weaponItems = weaponItems.filter(it => !matchItem(it, 'TERMINATOR')).concat(termSpecial);
    // Add Katanas if Tux is valid
    const tuxPieces = allItems.filter(it => /ELEGANT[_\s]?TUXEDO/i.test(String(it?.hypixelId||it?.name||'')) && hasEnchantAndReforge(it));
    const hasTux = tuxPieces.some(it => /(CHESTPLATE|LEGGINGS|BOOTS)/i.test(String(it?.hypixelId||it?.name||'')));
    if (hasTux) weaponItems = weaponItems.concat(allItems.filter(it => matchItem(it, 'KATANA')));

    // Skills
    const cataLvl = Math.floor(Number(me?.catacombs?.level || 0));
    const sbLevel = Math.floor(Number(member?.leveling?.experience || 0) / 100);

    // Magical Power from accessories + extras (Abiphone contacts + Imbued Rift Prism)
    function getRarityKey(it) {
      const lines = it?.loreRaw || it?.lore || [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const plain = simplifyMcText(typeof lines[i] === 'string' ? lines[i] : JSON.stringify(lines[i])).toUpperCase();
        if (!plain) continue;
        const keys = ['VERY SPECIAL','SPECIAL','DIVINE','MYTHIC','LEGENDARY','EPIC','RARE','UNCOMMON','COMMON'];
        for (const k of keys) if (plain.includes(k)) return k;
      }
      return null;
    }
    const mpPerRarity = { 'COMMON':3, 'UNCOMMON':5, 'RARE':8, 'EPIC':12, 'LEGENDARY':16, 'MYTHIC':22, 'DIVINE':22, 'SPECIAL':3, 'VERY SPECIAL':5 };
    let baseMP = 0;
    const mpBreakdown = {};
    for (const it of uniqAccs) {
      const rk = getRarityKey(it);
      let mp = rk ? (mpPerRarity[rk] || 0) : 0;

      // Check for Hegemony Artifact and double its MP
      if (/HEGEMONY_ARTIFACT/i.test(String(it?.hypixelId||it?.name||''))) {
        mp *= 2;
        mpBreakdown.HEGEMONY_ARTIFACT = (mpBreakdown.HEGEMONY_ARTIFACT || 0) + 1; // Track Hegemony separately for debug
      }
      
      if (rk) mpBreakdown[rk] = (mpBreakdown[rk] || 0) + 1;
      baseMP += mp;
    }
    const contacts = Array.isArray(member?.nether_island_player_data?.abiphone?.active_contacts) ? member.nether_island_player_data.abiphone.active_contacts
                    : (Array.isArray(member?.abiphone?.active_contacts) ? member.abiphone.active_contacts
                    : (Array.isArray(member?.abiphone_data?.active_contacts) ? member.abiphone_data.active_contacts : []));
    const hasAbiphoneAcc = uniqAccs.some(it => /ABIPHONE|ABICASE/i.test(String(it?.hypixelId||it?.name||'')));
    const abiphoneMP = hasAbiphoneAcc ? Math.floor((contacts.length || 0) / 2) : 0;
    const prismOn = !!(member?.rift?.access?.consumed_prism);
    const prismMP = prismOn ? 11 : 0;

    function hasEnrichment(it) {
      const lore = it?.loreRaw || it?.lore || [];
      return lore.some(line => simplifyMcText(line).includes("Enrichment: "));
    }

    let enrichedTalismansCount = 0;
    for (const it of uniqAccs) {
      if (hasEnrichment(it)) {
        enrichedTalismansCount++;
      }
    }

    const totalMP = baseMP + abiphoneMP + prismMP;

    // Build debug string for Magical Power breakdown
    const mpDebugParts = [];
    for (const rk in mpBreakdown) {
      if (mpBreakdown.hasOwnProperty(rk)) {
        if (rk === 'HEGEMONY_ARTIFACT') {
          mpDebugParts.push(`Hegemony x${mpBreakdown[rk]}`);
        } else {
          mpDebugParts.push(`${mpPerRarity[rk]}MP x ${mpBreakdown[rk]} ${rk.toLowerCase()} accs`);
        }
      }
    }
    if (prismOn) mpDebugParts.push(`+11 Prism`);
    if (hasAbiphoneAcc) mpDebugParts.push(`+${abiphoneMP} Abiphone (${contacts.length} contacts)`);
    const mpDebugString = mpDebugParts.join(' \u0007 ');

    // Build rows
    const rows = [];
    rows.push(`<div class=\"endpoint\"><div class=\"method get\">Runs</div><div class=\"path\">${t5Runs.toLocaleString()} (${totalRuns.toLocaleString()})</div><div class=\"desc\">T5 (Total)</div></div>`);
    rows.push(`<div class=\"endpoint\"><div class=\"method get\">Magical Power</div><div class=\"path\">${totalMP.toLocaleString()}</div><div class=\"desc\">${mpDebugString}${enrichedTalismansCount > 0 ? ` \u0007 ${enrichedTalismansCount} enriched` : ''}</div></div>`);
    if (gdrags.length) {
      const petItems = Array.from(new Set(gdrags.map(p => String(p?.heldItem || '').trim()).filter(Boolean)));
      const icons = petItems.map(id => `<img class=\"slot-icon\" src=\"/texture/${encodeURIComponent(id)}.png\" alt=\"${escapeHtml(id)}\">`).join(' ');
      const parts = [];
      if (icons) parts.push(icons);
      if (goldCollection) parts.push(`[${escapeHtml(formatCompact(goldCollection))} ⛏️]`);
      if (bankBalance) parts.push(`[${escapeHtml(formatCompact(bankBalance))} Bank]`);
      rows.push(`<div class=\"endpoint\"><div class=\"method get\">G-Drag</div><div class=\"path\">✔</div><div class=\"desc\">Golden Dragon ${parts.length?`\u0007 ${parts.join(' \u0007 ')}`:''}</div></div>`);
    } else {
      rows.push(`<div class=\"endpoint\"><div class=\"method get\">G-Drag</div><div class=\"path\">✖</div><div class=\"desc\">Not owned</div></div>`);
    }
    rows.push(`<div class=\"endpoint\"><div class=\"method get\">Reputation</div><div class=\"path\">Mages | ${Number(mageRep||0).toLocaleString()}</div><div class=\"desc\">Barbarians | ${Number(barbRep||0).toLocaleString()}</div></div>`);
    rows.push(`<div class=\"endpoint\"><div class=\"method get\">Skills</div><div class=\"path\">Cata ${cataLvl}, Combat ${combatLvl}, Foraging ${foragingLvl}, SB ${sbLevel}</div><div class=\"desc\"></div></div>`);

    // Panels in requested order: Terror, Hollow, Terror (Mana), Aurora, Tux, Weapons
    const panels = [];
    if (terrorBest) {
      const best = terrorBest.tier;
      const items = allItems.map(it => ({det: detectArmor(it), it})).filter(x => x.det && x.det.set==='terror' && x.det.tier===best).map(x=>x.it);
      const helm = (tuxPieces.length ? (primordialHelm || items.find(i=>/HELMET/i.test(String(i?.hypixelId||i?.name||''))) || warden || null) : (warden || primordialHelm || items.find(i=>/HELMET/i.test(String(i?.hypixelId||i?.name||''))) || null));
      const col = [helm, items.find(i=>/CHESTPLATE/i.test(String(i?.hypixelId||i?.name||''))), items.find(i=>/LEGGINGS/i.test(String(i?.hypixelId||i?.name||''))), items.find(i=>/BOOTS/i.test(String(i?.hypixelId||i?.name||'')))].filter(Boolean);
      if (col.length) panels.push(`<div><h3>Terror (${escapeHtml(best[0].toUpperCase()+best.slice(1))})</h3>${renderItemGrid2(sortArmor(col), { showSlot: false, grid: { cols: 1 } })}</div>`);
    }
    if (hollowBest && hollowBest.tier === 'infernal') {
      const hol = allItems.map(it => ({det: detectArmor(it), it})).filter(x => x.det && x.det.set==='hollow' && x.det.tier==='infernal').map(x=>x.it);
      if (hol.length) panels.push(`<div><h3>Hollow (Infernal)</h3>${renderItemGrid2(sortArmor(hol), { showSlot: false, grid: { cols: 1 } })}</div>`);
    }
    if (terrorBest) {
      const best = terrorBest.tier;
      const manaItems = allItems.map(it => ({it, nameU:String(it?.name||'').toUpperCase(), det:detectArmor(it)})).filter(x => x.det && x.det.set==='terror' && x.det.tier===best && /\b(NECROTIC|LOVING)\b/.test(x.nameU)).map(x=>x.it);
      if (manaItems.length) {
        const prefHelm = auroraHelmAny || witherGoggles || manaItems.find(i=>/HELMET/i.test(String(i?.hypixelId||i?.name||''))) || null;
        const col = [prefHelm, manaItems.find(i=>/CHESTPLATE/i.test(String(i?.hypixelId||i?.name||''))), manaItems.find(i=>/LEGGINGS/i.test(String(i?.hypixelId||i?.name||''))), manaItems.find(i=>/BOOTS/i.test(String(i?.hypixelId||i?.name||'')))].filter(Boolean);
        if (col.length) panels.push(`<div><h3>Terror (Mana)</h3>${renderItemGrid2(sortArmor(col), { showSlot: false, grid: { cols: 1 } })}</div>`);
      }
    }
    if (auroraBest) {
      const best = auroraBest.tier;
      const aur = allItems.map(it => ({det: detectArmor(it), it})).filter(x => x.det && x.det.set==='aurora' && x.det.tier===best && hasEnchantAndReforge(x.it)).map(x=>x.it);
      if (aur.length) panels.push(`<div><h3>Aurora (${escapeHtml(best[0].toUpperCase()+best.slice(1))})</h3>${renderItemGrid2(sortArmor(aur), { showSlot: false, grid: { cols: 1 } })}</div>`);
    }
    if (tuxPieces.length) {
      const tuxSlot = (slot) => tuxPieces.find(it => new RegExp(slot,'i').test(String(it?.hypixelId||it?.name||'')));
      const tuxCol = [warden||null, tuxSlot('CHESTPLATE'), tuxSlot('LEGGINGS'), tuxSlot('BOOTS')].filter(Boolean);
      if (tuxCol.length) panels.push(`<div><h3>Tuxedo</h3>${renderItemGrid2(sortArmor(tuxCol), { showSlot: false, grid: { cols: 1 } })}</div>`);
    }
    if (weaponItems.length) panels.push(`<div><h3>Weapons</h3>${renderItemGrid2(weaponItems, { showSlot: false })}</div>`);

    const panelsHtml = panels.length ? `<div class=\"panel-inner\" style=\"display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start\">${panels.map(p => `<div style=\"display:flex;flex-direction:column;gap:8px\">${p}</div>`).join('')}</div>` : '';
    const hasAny = rows.length || panels.length;
    if (!hasAny) return '';
    return `
    <section class=\"card\">
      <h2>Kuudra</h2>
      <div class=\"endpoints\">${rows.join('')}</div>
      ${panelsHtml}
    </section>`;
  } catch {
    return '';
  }
}

async function buildInventorySections(member, _opts = {}) {
  const inv = member?.inventory || member; // some profiles have inv_* at member root

  // Helpers
  async function decodeNode(pathKey) {
    const node = inv?.[pathKey];
    const b64 = node?.data || node?.raw || node?.bytes;
    if (!b64 || typeof b64 !== 'string') return null;
    return await decodeInventoryItems(b64);
  }

  const itemsInv = await decodeNode('inv_contents');
  const itemsEc = await decodeNode('ender_chest_contents');
  const itemsWard = await decodeNode('wardrobe_contents');
  const bpMap = inv?.backpack_contents || member?.backpack_contents || null;
  const bagContents = inv?.bag_contents || member?.bag_contents || null;
  const sacksCounts = member?.sacks_counts || member?.sacks_count || null;

  const panels = {};

  if (itemsInv && itemsInv.length) {
    // Map Minecraft inventory slots to visual grid:
    // main inventory (9..35) as top 3 rows, hotbar (0..8) as bottom row
    const invSlotToGrid = (s) => {
      if (typeof s !== 'number') return null;
      if (s >= 9 && s <= 35) return s - 9;      // top rows
      if (s >= 0 && s <= 8) return 27 + s;      // bottom hotbar row
      return null;
    };
    const invNorm = itemsInv.map(it => ({ ...it, slotView: invSlotToGrid(it.slot) }));
    panels.inventory = `
      <div class="panel-inner">
        ${renderItemGrid2(invNorm, { showSlot: true, grid: { size: 36, cols: 9, slotField: 'slotView' } })}
      </div>`;
  }

  if (itemsEc && itemsEc.length) {
    const pages = splitByPages(itemsEc, 45);
    // Ensure at least 3 pages are visible and cover highest slot index
    const maxSlot = itemsEc.reduce((m, it) => typeof it.slot === 'number' ? Math.max(m, it.slot) : m, -1);
    const minPages = Math.min(9, Math.max(1, (maxSlot >= 0 ? Math.floor(maxSlot / 45) + 1 : 1)));
    while (pages.length < minPages) pages.push([]);
    const ecIcon = getEnderChestIcon();
    const tabs = pages.map((_,i)=>`<button type="button" class="slot-tab ${i===0?'active':''}" data-target="ec-page-${i+1}" onclick="return switchSubTab(this)">` + (ecIcon?`<img class=\"slot-icon\" src=\"${ecIcon}\" alt=\"EC\">`:`EC${i+1}`) + `</button>`).join('');
    const contents = pages.map((pageItems, idx) => {
      const normalized = pageItems.map(it => ({ ...it, slotRel: typeof it.slot === 'number' ? (it.slot % 45) : null }));
      return `<div id="ec-page-${idx+1}" data-content style="display:${idx===0?'block':'none'}">${renderItemGrid2(normalized, { showSlot: true, grid: { size: 45, cols: 9, slotField: 'slotRel' } })}</div>`;
    }).join('');
    panels.ender = `<div class="panel-inner" data-tab-group><div class="selector-bar">${tabs}</div>${contents}</div>`;
  }

  if (itemsWard && itemsWard.length) {
    const pages = splitByPages(itemsWard, 36);
    const maxSlot = itemsWard.reduce((m, it) => typeof it.slot === 'number' ? Math.max(m, it.slot) : m, -1);
    const minPages = Math.min(18, Math.max(1, (maxSlot >= 0 ? Math.floor(maxSlot / 36) + 1 : 1)));
    while (pages.length < minPages) pages.push([]);

    const tabs = pages.map((_,i)=>`<button type="button" class="slot-tab ${i===0?'active':''}" data-target="wardrobe-page-${i+1}" onclick="return switchSubTab(this)">Page ${i+1}</button>`).join('');
    const contents = pages.map((pageItems, idx) => {
      const normalized = pageItems.map(it => ({ ...it, slotRel: typeof it.slot === 'number' ? (it.slot % 36) : null }));
      return `<div id="wardrobe-page-${idx+1}" data-content style="display:${idx===0?'block':'none'}">${renderItemGrid2(normalized, { showSlot: true, grid: { size: 36, cols: 9, slotField: 'slotRel' } })}</div>`;
    }).join('');

    panels.wardrobe = `<div class="panel-inner" data-tab-group><div class="selector-bar">${tabs}</div>${contents}</div>`;
  }

  // Pets panel so pet menu is visible under inventory tabs
    try {
    const pets = Array.isArray(member?.pets) ? member.pets : (Array.isArray(member?.pets_data?.pets) ? member.pets_data.pets : []);
    if (pets.length) {
      // When available, prefer lore from the NotEnoughUpdates (NEU) JSON definitions.
      // Map tier names to NEU semicolon index: 0 common,1 uncommon,2 rare,3 epic,4 legendary,5 mythic
      const TIER_INDEX = { 'COMMON':0,'UNCOMMON':1,'RARE':2,'EPIC':3,'LEGENDARY':4,'MYTHIC':5 };

      const petItems = await Promise.all(pets.map(async (p) => {
        const lore = [];
        const tierColors = { 'MYTHIC':'§d','LEGENDARY':'§6','EPIC':'§5','RARE':'§9','UNCOMMON':'§a','COMMON':'§f' };
        const tierColor = tierColors[p.tier] || '§7';

        lore.push(`${tierColor}${p.tier}`);
        if (p.exp) lore.push(`§7XP: §f${Math.floor(p.exp).toLocaleString()}`);
        if (p.active) lore.push(`§a(Active)`);

        // Base item we will return; may be augmented by NEU JSON data
        const baseItem = {
          name: p.type.replace(/_/g, ' '),
          nameRaw: `${tierColor}${p.type.replace(/_/g, ' ')}`,
          count: 1,
          lore: lore.map(l => simplifyMcText(l)),
          loreRaw: lore,
          hypixelId: `PET-${p.type}`,
          rarity: p.tier,
          active: p.active,
          exp: p.exp || 0,
          // preserve raw skin metadata when present so icon selection can prefer skins
          skin: p.skin || null,
          // pet-held item id (e.g. PET_ITEM_...)
          heldItem: p.heldItem || null,
        };

        // Attempt to fetch the NEU JSON for this pet to get a richer lore display.
        try {
          const tierIdx = (TIER_INDEX[String(p.tier).toUpperCase()] !== undefined) ? TIER_INDEX[String(p.tier).toUpperCase()] : 0;
          const neuName = `${p.type};${tierIdx}`;
          const neuUrl = `https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/items/${encodeURIComponent(neuName)}.json`;
          const res = await fetch(neuUrl, { method: 'GET' });
          if (res && res.ok) {
            const j = await res.json().catch(() => null);
            if (j) {
              // Prefer top-level 'lore' if present, otherwise try display.Lore in nbttag
              const neuLore = Array.isArray(j.lore) && j.lore.length ? j.lore
                : (j.nbttag && j.nbttag.display && Array.isArray(j.nbttag.display.Lore) && j.nbttag.display.Lore.length ? j.nbttag.display.Lore : null);
              if (neuLore && neuLore.length) {
                // Use the NEU lore (they include color codes). Keep the original trailing tier line if NEU doesn't include a tier.
                baseItem.loreRaw = neuLore.map(line => String(line));
                baseItem.lore = baseItem.loreRaw.map(l => simplifyMcText(l));
                // Use displayname from NEU JSON if present (preserves formatting)
                if (j.displayname) baseItem.nameRaw = j.displayname;
              }
            }
          }
        } catch (e) {
          // Swallow network/parse errors and keep the simple lore
        }

        return baseItem;
      }));

      const rarityOrder = ['MYTHIC', 'LEGENDARY', 'EPIC', 'RARE', 'UNCOMMON', 'COMMON'];
      petItems.sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        const aRarity = rarityOrder.indexOf(a.rarity);
        const bRarity = rarityOrder.indexOf(b.rarity);
        if (aRarity !== bRarity) return aRarity - bRarity;
        return b.exp - a.exp;
      });

      const petCardsHtml = petItems.map(it => {
        const titleHtml = it.nameRaw ? formatMcText(it.nameRaw) : escapeHtml(it.name);
        const icons = getItemIconUrls(it);
        const rarityColor = getRarityColor(it);
        const toRgb = (hex) => {
          const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
          if (!m) return null;
          const n = parseInt(m[1], 16);
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        };
        const rgb = rarityColor ? toRgb(rarityColor) : null;
        const bgOverlay = rgb ? `linear-gradient(rgba(${rgb.r},${rgb.g},${rgb.b},0.35), rgba(${rgb.r},${rgb.g},${rgb.b},0.35))` : '';
        const bgComma = (bgOverlay && icons.length) ? ', ' : '';
        const imgHtml = (icons && icons[0])
          ? `<img class="item-img" src="${icons[0]}" ${icons[1]?`data-alt="${icons[1]}"`:''} ${icons[2]?`data-alt2="${icons[2]}"`:''} onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=this.dataset.alt2||'';return;}if(this.dataset.alt2){this.src=this.dataset.alt2;this.dataset.alt2='';}" style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;display:block;">`
          : '';
        // pet-held item small overlay
        let petItemHtml = '';
        try {
          if (it.heldItem) {
            const heldIcons = getItemIconUrls({ hypixelId: it.heldItem });
            const heldSrc = (heldIcons && heldIcons[0]) ? heldIcons[0] : '';
            if (heldSrc) {
              petItemHtml = `<img class="pet-item" src="${heldSrc}" onerror="this.style.display='none'" alt="item">`;
            }
          }
        } catch (e) {}
        const loreHtml = (it.loreRaw && it.loreRaw.length)
          ? `<div class="tooltip-lore">${it.loreRaw.map(line => `<div class="tooltip-lore-line">${formatMcText(line)}</div>`).join('')}</div>`
          : '';
        
        return `
          <div class="item-card has-tooltip">
            <div class="item-icon" style="background-image:${bgOverlay}${bgComma}${icons.map(u => `url('${u}')`).join(', ')}">
              ${imgHtml}
              ${petItemHtml}
            </div>
            <div class="tooltip">
              <div class="tooltip-title">${titleHtml}</div>
              ${loreHtml}
            </div>
          </div>`;
      }).join('');

      panels.pets = `<div class="panel-inner"><div class="pets-list" style="display: flex; flex-wrap: wrap; gap: 8px;">${petCardsHtml}</div></div>`;
    }
  } catch {}

  if (bpMap && typeof bpMap === 'object') {
    const keys = Object.keys(bpMap).sort((a,b)=>Number(a)-Number(b));
    const included = new Set();
    let bpTabs = [];
    let bpHtml = [];
    let maxIndex = 0;
    for (const k of keys) {
      const b64 = bpMap[k]?.data || bpMap[k]?.raw || bpMap[k]?.bytes || bpMap[k];
      if (typeof b64 !== 'string') continue;
      try {
        const items = await decodeInventoryItems(b64);
        const htmlItems = renderItemGrid2(items, { showSlot: true, grid: { size: 36, cols: 9 } });
        const idx = Number(k) + 1; maxIndex = Math.max(maxIndex, idx);
        const bpIcon = getBackpackIcon();
        bpTabs.push(`<button type="button" class="slot-tab ${bpTabs.length===0?'active':''}" data-target="bp-page-${idx}" onclick="return switchSubTab(this)">` + (bpIcon ? `<img class="slot-icon" src="${bpIcon}" alt="BP">` : `BP${idx}`) + `</button>`);
        bpHtml.push(`<div id="bp-page-${idx}" data-content style="display:${bpHtml.length===0?'block':'none'}">${htmlItems}</div>`);
        included.add(idx);
      } catch {}
    }
    // Ensure up to 18 pages exist (empty placeholders) so users can switch
    const totalBp = Math.max(18, maxIndex);
    for (let i=1; i<=totalBp; i++) {
      if (included.has(i)) continue;
      const bpIcon = getBackpackIcon();
      bpTabs.push(`<button type="button" class="slot-tab ${bpTabs.length===0?'active':''}" data-target="bp-page-${i}" onclick="return switchSubTab(this)">` + (bpIcon ? `<img class=\"slot-icon\" src=\"${bpIcon}\" alt=\"BP\">` : `BP${i}`) + `</button>`);
      bpHtml.push(`<div id="bp-page-${i}" data-content style="display:${bpHtml.length===0?'block':'none'}">${renderItemGrid2([], { showSlot: true, grid: { size: 36, cols: 9 } })}</div>`);
    }
    if (bpHtml.length) {
      panels.backpack = `<div class="panel-inner" data-tab-group><div class="selector-bar">${bpTabs.join('')}</div>${bpHtml.join('')}</div>`;
    }
  }

  if (bagContents && typeof bagContents === 'object') {
    const bagLabels = { talisman_bag: 'Accessory Bag', accessory_bag: 'Accessory Bag', quiver: 'Quiver', potion_bag: 'Potion Bag', fishing_bag: 'Fishing Bag', sacks_bag: 'Sack of Sacks' };
    const parts = [];
    for (const [bagKey, val] of Object.entries(bagContents)) {
      const label = bagLabels[bagKey] || bagKey;
      const b64 = val?.data || val?.raw || val?.bytes || val;
      if (typeof b64 !== 'string') continue;
      try {
        const items = await decodeInventoryItems(b64);
        const htmlItems = renderItemGrid2(items, { showSlot: false });
        parts.push(`<h3 style="margin:10px 0 6px">${escapeHtml(label)}</h3>${htmlItems}`);
      } catch {}
    }
    if (parts.length) panels.bags = `<div class="panel-inner">${parts.join('\n')}</div>`;
  }

  if (sacksCounts && typeof sacksCounts === 'object') {
    const list = Object.entries(sacksCounts)
      .sort((a,b)=> String(a[0]).localeCompare(String(b[0])))
      .map(([id, n]) => `<li><code>${escapeHtml(id)}</code>: <strong>${Number(n).toLocaleString()}</strong></li>`)
      .join('');
    panels.sacks = `<div class="panel-inner"><h3 style="margin:0 0 6px">Sack Contents</h3><ul>${list}</ul></div>`;
  }

  const order = [
    ['inventory','Inventory','chest'],
    ['backpack','Backpack','bundle'],
    ['ender','Ender Chest','ender_chest'],
    ['pets','Pets','player_head'],
    ['bags','Bags','player_head'],
    ['sacks','Sacks','barrel'],
    ['wardrobe','Wardrobe','leather_chestplate'],
  ].filter(([k]) => panels[k]);

  if (!order.length) {
    return `
      <section class="card subtle">
        <h2>Inventories</h2>
        <p>Inventory data not available. Enable SkyBlock API inventory in-game.</p>
      </section>`;
  }

  const tabIcon = (id) => {
    if (!ICON_OVERRIDE && !TEXTURE_BASE) return '';
    const base = (s) => `${TEXTURE_BASE.replace(/\/$/,'')}/${s}.png`;
    const primary = ICON_OVERRIDE || base(id);
    const alts = [];
    if (!ICON_OVERRIDE && TEXTURE_BASE) {
      if (id === 'player_head') alts.push(base('skull'), base('chest'));
      if (id === 'bow') alts.push(base('bow_standby'));
      if (id === 'bundle') alts.push(base('chest'), base('book_normal'));
    }
    let attrs = `class="tab-icon" src="${primary}"`;
    if (alts[0]) attrs += ` data-alt="${alts[0]}"`;
    if (alts[1]) attrs += ` data-alt2="${alts[1]}"`;
    attrs += ` onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=this.dataset.alt2||'';return;}if(this.dataset.alt2){this.src=this.dataset.alt2;this.dataset.alt2='';}"`;
    return `<img ${attrs} alt="">`;
  };
  const tabBar = order.map(([k, label, icon], i) => `<button type="button" class="tab ${i===0?'active':''}" data-tab="${k}" onclick="return switchInvTab(this)">${tabIcon(icon)}<span>${escapeHtml(label)}</span></button>`).join('');
  const panelsHtml = order.map(([k], i) => `<div id="tab-${k}" data-panel style="display:${i===0?'block':'none'}">${panels[k]}</div>`).join('');

  return `
    <section class="card" data-tab-root>
      <h2>Inventory</h2>
      <div class="tab-bar">${tabBar}</div>
      ${panelsHtml}
    </section>`;
}

function buildMuseumSection(profile, uuidNoDash){
  try{
    const member = profile?.members?.[uuidNoDash] || {};
    const museum = member.museum || member.museum_data || profile?.museum || null;
    if(!museum) return "";
    const body = `<pre class="code-block">${escapeHtml(JSON.stringify(museum, null, 2))}</pre>`;
    return `
    <section class="card">
      <h2>Museum</h2>
      ${body}
    </section>`;
  }catch(_){ return ""; }
}

function deepGet(obj, path) {
  return path.reduce((o, k) => (o && k in o ? o[k] : undefined), obj);
}

function num(v) { return typeof v === "number" ? v : Number(v || 0); }
function text(v) { return v == null ? "" : String(v); }

function simplifyMcText(name) {
  try {
    const j = JSON.parse(name);
    if (typeof j === "string") return j;
    if (Array.isArray(j)) return j.map(seg => (typeof seg === "string" ? seg : seg.text || "")).join("").trim();
    if (j && typeof j === "object") return (j.text || "").trim();
  } catch {}
  // Strip § formatting codes as fallback
  return name.replace(/§./g, "").trim();
}

// --- Minimal NBT decode (gzip + NBT types) for listing item names and counts ---
async function decodeInventoryItems(b64) {
  const bytes = base64ToBytes(b64);
  const raw = await gunzipMaybe(bytes);
  const nbt = parseNbtSync(raw);
  const root = nbt?.value || {};
  let inv = root.i?.value; // Main inventory tag
  
  // If `i` tag not found, check if the root contains a list directly.
  if (!Array.isArray(inv)) {
    for (const key in root) {
      if (root[key]?.type === 9 && Array.isArray(root[key]?.value)) {
        inv = root[key].value;
        break;
      }
    }
  }

  const list = Array.isArray(inv) ? inv : [];
  const items = [];
  for (let idx = 0; idx < list.length; idx++) {
    const el = list[idx];
    if (!el) continue; // Skip empty slots
    const v = el?.value || {};
    const count = num(v.Count?.value);
    if (!count) continue;
    const id = text(v.id?.value || '');
    const hypixelId = text(v.tag?.value?.ExtraAttributes?.value?.id?.value || '');
    const dispNameRaw = v.tag?.value?.display?.value?.Name?.value;
    const dispName = dispNameRaw ? simplifyMcText(typeof dispNameRaw === 'string' ? dispNameRaw : JSON.stringify(dispNameRaw)) : (id || 'Unknown');
    // Lore can be a List of strings (type 8) or json text
    const loreList = v.tag?.value?.display?.value?.Lore?.value; const loreRaw = Array.isArray(loreList) ? loreList.map(ln => (ln?.value ?? ln)) : []; const lore = loreRaw.map(ln => simplifyMcText(typeof ln === 'string' ? ln : JSON.stringify(ln))).filter(Boolean);
    let slot = (v.Slot && typeof v.Slot.value === 'number') ? v.Slot.value : null;
    if (!(typeof slot === 'number')) slot = idx; // fallback to list position when Slot missing
    items.push({ name: dispName, nameRaw: dispNameRaw || dispName, count, slot, lore, loreRaw, id, hypixelId });
  }
  return items;
}

async function gunzipMaybe(data) {
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Response(new Blob([data]).stream().pipeThrough(ds));
    const buf = await stream.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return data; // not compressed
  }
}

function parseNbtSync(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  function readU8() { const v = dv.getUint8(off); off += 1; return v; }
  function readI8() { const v = dv.getInt8(off); off += 1; return v; }
  function readU16() { const v = dv.getUint16(off, false); off += 2; return v; }
  function readI16() { const v = dv.getInt16(off, false); off += 2; return v; }
  function readI32() { const v = dv.getInt32(off, false); off += 4; return v; }
  function readI64() { const hi = dv.getInt32(off, false); const lo = dv.getInt32(off+4, false); off += 8; return BigInt(hi) << 32n | BigInt(lo >>> 0); }
  function readF32() { const v = dv.getFloat32(off, false); off += 4; return v; }
  function readF64() { const v = dv.getFloat64(off, false); off += 8; return v; }
  function readBytes(n) { const out = buf.subarray(off, off+n); off += n; return out; }
  function readString() { const len = readU16(); const bytes = readBytes(len); return new TextDecoder().decode(bytes); }

  function readTagPayload(tagId) {
    switch (tagId) {
      case 0: return null; // End
      case 1: return readI8();
      case 2: return readI16();
      case 3: return readI32();
      case 4: return readI64();
      case 5: return readF32();
      case 6: return readF64();
      case 7: { // Byte Array
        const len = readI32();
        return readBytes(len);
      }
      case 8: return readString();
      case 9: { // List
        const elemType = readU8();
        const len = readI32();
        const arr = new Array(len);
        for (let i=0; i<len; i++) arr[i] = { type: elemType, value: readTagPayload(elemType) };
        return arr;
      }
      case 10: { // Compound
        const obj = {};
        while (true) {
          const t = readU8();
          if (t === 0) break;
          const name = readString();
          obj[name] = { type: t, value: readTagPayload(t) };
        }
        return obj;
      }
      case 11: { // Int Array
        const len = readI32();
        const out = new Int32Array(len);
        for (let i=0; i<len; i++) out[i] = readI32();
        return out;
      }
      case 12: { // Long Array
        const len = readI32();
        const out = new Array(len);
        for (let i=0; i<len; i++) out[i] = readI64();
        return out;
      }
      default:
        throw new Error('Unknown NBT tag '+tagId);
    }
  }

  // Root
  const rootType = readU8(); // usually 10
  if (rootType !== 10) throw new Error('Invalid NBT root (expected Compound)');
  const rootName = readString();
  const rootValue = readTagPayload(10);
  return { type: rootType, name: rootName, value: rootValue };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// removed legacy renderItemGrid2\n

function getItemIconUrls(it) {
  if (ICON_OVERRIDE) return [ICON_OVERRIDE];
  const name = (it.hypixelId || it.id || it.name || '').toLowerCase();
  const is = (s) => name.includes(s);
  const svg = (p) => `data:image/svg+xml;utf8,${encodeURIComponent(p)}`;
  const urls = [];
  // We'll append Hypixel CDN texture as a fallback later
  const hypId = (it.hypixelId || '').trim();

  // Try external texture pack first if provided
  if (TEXTURE_BASE) {
    let id = (it.id || '').toLowerCase();
    if (id.includes(':')) id = id.split(':')[1];
    id = id.replace(/^minecraft\./, '');
    // Normalize some legacy/common variants
    if (id.includes('skull') || id.includes('head')) id = 'player_head';
    if (id === 'skull_item') id = 'player_head';
    if (id === 'book_enchanted') id = 'enchanted_book';
    if (id === 'splash_potion' || id === 'lingering_potion') id = 'potion';

    // If base id is missing, infer category from Hypixel item id
    const hyp = (it.hypixelId || '').toUpperCase();
    if (!id && hyp) {
      const SW_REGEX = /(\w+_)?SWORD$|BLADE$|KATANA$|SCYLLA|VALKYRIE|ASTRAEA|ASPECT_OF_THE_(END|VOID)|GIANTS_SWORD/;
      if (SW_REGEX.test(hyp)) id = 'diamond_sword';
      else if (/BOW/.test(hyp)) id = 'bow';
      else if (/ROD|FISH/.test(hyp)) id = 'fishing_rod';
      else if (/AXE/.test(hyp)) id = 'diamond_axe';
      else if (/PICKAXE|_PICK$|\bPICK\b/.test(hyp)) id = 'iron_pickaxe';
      else if (/WAND/.test(hyp)) id = 'blaze_rod';
      else if (/POTION|ELIXIR/.test(hyp)) id = 'potion';
      else if (/HELMET/.test(hyp)) id = 'diamond_helmet';
      else if (/CHESTPLATE/.test(hyp)) id = 'diamond_chestplate';
      else if (/LEGGINGS/.test(hyp)) id = 'diamond_leggings';
      else if (/BOOTS/.test(hyp)) id = 'diamond_boots';
    }
    if (!id) {
      if (is('arrow')) id = 'arrow';
      else if (is('bottle')) id = 'experience_bottle';
      else if (is('enchanted_book') || is('book')) id = 'enchanted_book';
      else if (is('potion')) id = 'potion';
      else if (is('rod') || is('fishing')) id = 'fishing_rod';
      else if (is('bow')) id = 'bow';
      else if (is('sword')) id = 'diamond_sword';
      else if (is('pick')) id = 'iron_pickaxe';
      else if (is('helmet')) id = 'diamond_helmet';
      else if (is('chestplate')) id = 'diamond_chestplate';
      else if (is('leggings')) id = 'diamond_leggings';
      else if (is('boots')) id = 'diamond_boots';
    }
    if (id) urls.push(`${TEXTURE_BASE.replace(/\/$/, '')}/${id}.png`);
  }

  // Hypixel item icon via SkyCrypt CDN (by Hypixel ID) as a fallback to pack
  // Pets: attempt to load images from the repository's PETS folder as a fallback
  if (hypId) {
    try {
      const up = String(hypId).toUpperCase();
      if (up.startsWith('PET-')) {
        // try skin variant first when present on the item object
        // item objects created for pets may include a .skin property (kept as-is when mapping)
        const typePart = up.replace(/^PET-/, '').replace(/-/g, '_');
        // Attempt to construct a skin filename if item has skin metadata
        if (it && it.skin) {
          // Try to derive a simple skin token
          let skinToken = null;
          if (typeof it.skin === 'string') skinToken = it.skin;
          else if (it.skin && typeof it.skin === 'object') {
            skinToken = it.skin?.name || it.skin?.type || it.skin?.texture || null;
          }
          if (skinToken) {
            const sk = String(skinToken).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            const skinFile = `PET_${typePart}_SKIN_${sk}.png`;
            urls.push(`https://raw.githubusercontent.com/fran939/bomboapi/main/PETS/${encodeURIComponent(skinFile)}`);
          }
        }
        // Add canonical pet filename fallback (e.g., PET_AMMONITE.png)
        const petFile = `PET_${typePart}.png`;
        urls.push(`https://raw.githubusercontent.com/fran939/bomboapi/main/PETS/${encodeURIComponent(petFile)}`);
      }
    } catch (e) { /* ignore */ }
    // Finally fall back to the server texture endpoint
    urls.push(`/texture/${encodeURIComponent(hypId)}`);
  }

  // Pet items fallback: use PET_ITEMS folder on GitHub when hypId indicates a pet item
  try {
    const up2 = String(hypId || '').toUpperCase();
    if (up2.startsWith('PET_ITEM_')) {
      // Direct filename is the hypId without prefix or as-is depending on repository naming
      const file = up2.replace(/^PET_ITEM_/, '');
      // The repo stores files like CROCHET_TIGER_PLUSHIE.png under PET_ITEMS
      urls.unshift(`https://raw.githubusercontent.com/fran939/bomboapi/main/PET_ITEMS/${encodeURIComponent(file)}.png`);
    }
  } catch (e) {}

  // Simple inline SVG icons for common items
  const base = (fill) => `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' fill='none'><rect width='64' height='64' rx='10' fill='%23101215'/><rect x='1' y='1' width='62' height='62' rx='9' stroke='%23262626'/>
  ${fill}
  </svg>`;
  const iconArrow = base("<path d='M10 34h28l-6 6 4 4 14-14-14-14-4 4 6 6H10v8z' fill='%23b8e1ff'/>"
  );
  const iconSword = base("<path d='M40 8l8 8-6 6 4 4-10 10-4-4-6 6-6 2 2-6 6-6-4-4 10-10 4 4 6-6z' fill='%23ffd166'/>"
  );
  const iconBow = base("<path d='M18 12c16 0 34 18 34 34-10 0-22-12-22-22 0-6 6-12 12-12-6 0-12 6-12 12 0 10-12 22-22 22 0-16 18-34 34-34' fill='%23c4b5fd'/>"
  );
  const iconPick = base("<path d='M10 22l8-8 8 8-3 3 7 7 3-3 8 8-5 5-8-8 3-3-7-7-3 3-8-8z' fill='%23a3e635'/>"
  );
  const iconArmor = base("<path d='M16 12l16 6 16-6v12l-6 4v24H22V28l-6-4V12z' fill='%2399f6e4'/>"
  );
  const iconBook = base("<path d='M14 16h28a6 6 0 016 6v20a6 6 0 01-6 6H14a6 6 0 01-6-6V22a6 6 0 016-6zm0 6v20h28V22H14z' fill='%23f472b6'/>"
  );
  const iconPotion = base("<path d='M28 10h8v8l6 6v8l-10 10L22 32v-8l6-6v-8z' fill='%2378d0ff'/>"
  );
  const iconRod = base("<path d='M18 12l4 4-4 4 6 6-4 4 6 6 16-16-6-6-4 4-6-6-4 4-4-4z' fill='%23f59e0b'/>"
  );
  const iconDefault = base("<circle cx='32' cy='32' r='10' fill='%23e5e7eb'/>"
  );

  if (is('arrow')) urls.push(svg(iconArrow));
  else if (is('bow')) urls.push(svg(iconBow));
  else if (is('sword')) urls.push(svg(iconSword));
  else if (is('pickaxe') || is('pick')) urls.push(svg(iconPick));
  else if (is('helmet') || is('chestplate') || is('leggings') || is('boots')) urls.push(svg(iconArmor));
  else if (is('book') || is('enchanted_book')) urls.push(svg(iconBook));
  else if (is('potion') || is('splash_potion')) urls.push(svg(iconPotion));
  else if (is('rod') || is('fishing')) urls.push(svg(iconRod));
  else urls.push(svg(iconDefault));
  return urls;
}

// Fallback SVG icon generator used as a safety layer under external textures
function getItemFallbackSvg(it) {
  const name = (it.hypixelId || it.id || it.name || '').toLowerCase();
  const is = (s) => name.includes(s);
  const svg = (p) => `data:image/svg+xml;utf8,${encodeURIComponent(p)}`;
  const base = (fill) => `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' fill='none'><rect width='64' height='64' rx='10' fill='%23101215'/><rect x='1' y='1' width='62' height='62' rx='9' stroke='%23262626'/>${fill}</svg>`;
  const iconArrow = base("<path d='M10 34h28l-6 6 4 4 14-14-14-14-4 4 6 6H10v8z' fill='%23b8e1ff'/>");
  const iconSword = base("<path d='M40 8l8 8-6 6 4 4-10 10-4-4-6 6-6 2 2-6 6-6-4-4 10-10 4 4 6-6z' fill='%23ffd166'/>");
  const iconBow = base("<path d='M18 12c16 0 34 18 34 34-10 0-22-12-22-22 0-6 6-12 12-12-6 0-12 6-12 12 0 10-12 22-22 22 0-16 18-34 34-34' fill='%23c4b5fd'/>");
  const iconPick = base("<path d='M10 22l8-8 8 8-3 3 7 7 3-3 8 8-5 5-8-8 3-3-7-7-3 3-8-8z' fill='%23a3e635'/>");
  const iconArmor = base("<path d='M16 12l16 6 16-6v12l-6 4v24H22V28l-6-4V12z' fill='%2399f6e4'/>");
  const iconBook = base("<path d='M14 16h28a6 6 0 016 6v20a6 6 0 01-6 6H14a6 6 0 01-6-6V22a6 6 0 016-6zm0 6v20h28V22H14z' fill='%23f472b6'/>");
  const iconPotion = base("<path d='M28 10h8v8l6 6v8l-10 10L22 32v-8l6-6v-8z' fill='%2378d0ff'/>");
  const iconRod = base("<path d='M18 12l4 4-4 4 6 6-4 4 6 6 16-16-6-6-4 4-6-6-4 4-4-4z' fill='%23f59e0b'/>");
  const iconDefault = base("<circle cx='32' cy='32' r='10' fill='%23e5e7eb'/>");
  if (is('arrow')) urls.push(svg(iconArrow));
  else if (is('bow')) urls.push(svg(iconBow));
  else if (is('sword')) urls.push(svg(iconSword));
  else if (is('pickaxe') || is('pick')) urls.push(svg(iconPick));
  else if (is('helmet') || is('chestplate') || is('leggings') || is('boots')) urls.push(svg(iconArmor));
  else if (is('book') || is('enchanted_book')) urls.push(svg(iconBook));
  else if (is('potion') || is('splash_potion')) urls.push(svg(iconPotion));
  else if (is('rod') || is('fishing')) urls.push(svg(iconRod));
  else urls.push(svg(iconDefault));
  return urls;
}

function getBackpackIcon(){
  if (ICON_OVERRIDE) return ICON_OVERRIDE;
  if (TEXTURE_BASE) return `${TEXTURE_BASE.replace(/\/$/, '')}/bundle.png`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' fill='none'><rect width='64' height='64' rx='10' fill='#101215'/><rect x='1' y='1' width='62' height='62' rx='9' stroke='#262626'/><path d='M22 18h20l4 6v22c0 3-2 5-5 5H23c-3 0-5-2-5-5V24l4-6z' fill='#b06b2d'/><path d='M24 24h16v10H24z' fill='#d29f64'/><circle cx='32' cy='20' r='6' fill='#8a4f21'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getEnderChestIcon(){
  if (ICON_OVERRIDE) return ICON_OVERRIDE;
  if (TEXTURE_BASE) return `${TEXTURE_BASE.replace(/\/$/, '')}/ender_chest.png`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' fill='none'><rect width='64' height='64' rx='10' fill='#101215'/><rect x='1' y='1' width='62' height='62' rx='9' stroke='#262626'/><rect x='14' y='18' width='36' height='28' rx='4' fill='#0a6d6d'/><rect x='14' y='24' width='36' height='4' fill='#0e8f8f'/><rect x='14' y='40' width='36' height='2' fill='#0e8f8f'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function splitByPages(items, pageSize) {
  if (!Array.isArray(items) || items.length === 0) return [ [] ];
  // If slot present, group by Math.floor(slot / pageSize)
  const withSlot = items.filter(i => typeof i.slot === 'number');
  if (withSlot.length) {
    const map = new Map();
    for (const it of items) {
      const page = typeof it.slot === 'number' ? Math.floor(it.slot / pageSize) : 0;
      if (!map.has(page)) map.set(page, []);
      map.get(page).push(it);
    }
    return Array.from(map.keys()).sort((a,b)=>a-b).map(k => map.get(k));
  }
  // Fallback: chunk into pageSize
  const out = [];
  for (let i=0;i<items.length;i+=pageSize) out.push(items.slice(i, i+pageSize));
  return out;
}

// Render items in a grid with optional fixed slots, rarity overlay and colored lore
function renderItemGrid2(items, { showSlot, grid } = { showSlot: true }) {
  // Keep grid layout like in-game; do not collapse empty slots
  const cols = grid?.cols || 9;
  const slotField = grid?.slotField || 'slot';

  // Build fixed-size cells when grid.size is provided
  let cells = [];
  const size = Number.isFinite(grid?.size) ? Number(grid.size) : null;
  if (size != null) {
    cells = new Array(size).fill(null);
    const placeNext = () => cells.findIndex((c) => c === null);
    for (const it of (items || [])) {
      let idx = (it && typeof it[slotField] === 'number') ? it[slotField] : -1;
      if (!(idx >= 0 && idx < size)) idx = placeNext();
      if (idx >= 0 && idx < size) cells[idx] = it;
    }
  } else {
    const seq = Array.isArray(items) ? items.slice() : [];
    const rows = Math.max(1, Math.ceil(seq.length / cols));
    const target = rows * cols;
    cells = seq.concat(new Array(Math.max(0, target - seq.length)).fill(null));
  }
  if (cells.length === 0) return '<em>No items</em>';

  const toRgb = (hex) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const tile = (it, idx) => {
    if (!it) return `<div class="item-card"><div class="item-icon empty"></div></div>`;
    const titleHtml = it.nameRaw ? formatMcText(it.nameRaw) : escapeHtml(it.name);
    const count = it.count ? `${it.count}` : '';
    const slotNum = (typeof it[slotField] === 'number') ? it[slotField] : (size != null ? idx : null);
    const slotBadge = showSlot && (typeof slotNum === 'number') ? `#${slotNum}` : '';
    let icons = getItemIconUrls(it);
    if (!Array.isArray(icons)) icons = icons ? [icons] : [];
    if (icons.length === 0) {
      const fallbackSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' fill='none'><rect width='64' height='64' rx='10' fill='#101215'/><rect x='1' y='1' width='62' height='62' rx='9' stroke='#262626'/><circle cx='32' cy='32' r='10' fill='#e5e7eb'/></svg>`;
      icons.push(`data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`);
    }
    const rarity = getRarityColor(it);
    const rgb = rarity ? toRgb(rarity) : null;
    const bgOverlay = rgb ? `linear-gradient(rgba(${rgb.r},${rgb.g},${rgb.b},0.35), rgba(${rgb.r},${rgb.g},${rgb.b},0.35))` : '';
    const bgComma = (bgOverlay && icons.length) ? ', ' : '';
    const imgHtml = (icons && icons[0])
      ? `<img class="item-img" src="${icons[0]}" ${icons[1]?`data-alt="${icons[1]}"`:''} ${icons[2]?`data-alt2="${icons[2]}"`:''} onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=this.dataset.alt2||'';return;}if(this.dataset.alt2){this.src=this.dataset.alt2;this.dataset.alt2='';}" style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;display:block;">`
      : '';
    const loreHtml = (it.loreRaw && it.loreRaw.length)
      ? `<div class="tooltip-lore">${it.loreRaw.map(line => `<div class="tooltip-lore-line">${formatMcText(line)}</div>`).join('')}</div>`
      : '';
    // Debug line: show the normalized base id (e.g., iron_sword) and hypixel id
    let baseId = (it.id || '').toLowerCase();
    if (baseId.includes(':')) baseId = baseId.split(':')[1];
    baseId = baseId.replace(/^minecraft\./, '');
    if (baseId.includes('skull') || baseId.includes('head')) baseId = 'player_head';
    if (baseId === 'book_enchanted') baseId = 'enchanted_book';
    if (baseId === 'splash_potion' || baseId === 'lingering_potion') baseId = 'potion';
    const titleWithIdHtml = `${titleHtml} <span style="color:#9ca3af">(${escapeHtml(baseId || '-')})</span>`;
    const idLine = `<div class="tooltip-lore-line" style="margin-top:6px;color:#9ca3af">id: <code>${escapeHtml(baseId || '-')}${it.hypixelId ? `</code> &middot; hyp: <code>${escapeHtml(String(it.hypixelId))}` : ''}</code></div>`;
    return `
      <div class="item-card has-tooltip">
        <div class="item-icon" style="background-image:${bgOverlay}${bgComma}${icons.map(u => `url('${u}')`).join(', ')}">
          ${count ? `<span class="badge count">× ${count}</span>` : ''}
          ${slotBadge ? `<span class="badge slot">${slotBadge}</span>` : ''}
          ${imgHtml}
        </div>
        <div class="tooltip">
          <div class="tooltip-title">${titleWithIdHtml}</div>
          ${loreHtml}
          ${idLine}
        </div>
      </div>`;
  };

  const gridTiles = cells.map((c, i) => tile(c, i)).join('');
  return `<div class="item-grid" style="grid-template-columns: repeat(${cols}, 64px); justify-content: start;">${gridTiles}</div>`;
}


// New rendering with grid, rarity overlay, and colored tooltips

function mcColorToHex(color) {
  const map = { black:'#000000', dark_blue:'#0000AA', dark_green:'#00AA00', dark_aqua:'#00AAAA', dark_red:'#AA0000', dark_purple:'#AA00AA', gold:'#FFAA00', gray:'#AAAAAA', dark_gray:'#555555', blue:'#5555FF', green:'#55FF55', aqua:'#55FFFF', red:'#FF5555', light_purple:'#FF55FF', yellow:'#FFFF55', white:'#FFFFFF' };
  return map[color] || null;
}

function formatMcText(input) {
  try {
    const j = JSON.parse(input);
    const parts = Array.isArray(j) ? j : (j?.extra ? [j, ...j.extra] : [j]);
    return parts.map(seg => {
      const txt = escapeHtml(seg?.text || (typeof seg === 'string' ? seg : ''));
      const color = mcColorToHex(seg?.color);
      const style = [ color?`color:${color}`:'', seg?.bold?'font-weight:700':'', seg?.italic?'font-style:italic':'', (seg?.underlined||seg?.underline)?'text-decoration:underline':'', seg?.strikethrough?'text-decoration:line-through':'' ].filter(Boolean).join(';');
      return `<span style="${style}">${txt}</span>`;
    }).join('');
  } catch {
    const codeMap = { '0':'#000000','1':'#0000AA','2':'#00AA00','3':'#00AAAA','4':'#AA0000','5':'#AA00AA','6':'#FFAA00','7':'#AAAAAA','8':'#555555','9':'#5555FF','a':'#55FF55','b':'#55FFFF','c':'#FF5555','d':'#FF55FF','e':'#FFFF55','f':'#FFFFFF' };
    let cur = { color:null, bold:false, italic:false, underline:false, strike:false };
    let out='';
    const push=(text)=>{ if(!text) return; const style=[ cur.color?`color:${cur.color}`:'', cur.bold?'font-weight:700':'', cur.italic?'font-style:italic':'', (cur.underline||cur.strike)?`text-decoration:${[cur.underline?'underline':'', cur.strike?'line-through':''].filter(Boolean).join(' ')}`:'' ].filter(Boolean).join(';'); out+=`<span style="${style}">${escapeHtml(text)}</span>`; };
    const s=String(input);
    for(let i=0;i<s.length;i++){
      if(s[i]==='§' && i+1<s.length){ const code=s[i+1]; i++; if(code==='l'){cur.bold=true; continue;} if(code==='o'){cur.italic=true; continue;} if(code==='n'){cur.underline=true; continue;} if(code==='m'){cur.strike=true; continue;} if(code==='r'){cur={ color:null,bold:false,italic:false,underline:false,strike:false }; continue;} if(codeMap[code]){cur.color=codeMap[code]; continue;} }
      push(s[i]);
    }
    return out;
  }
}

function getRarityColor(it) {
  const lines = it.loreRaw || it.lore || [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const plain = simplifyMcText(lines[i]).toUpperCase();
    if (!plain) continue;
    const map = { 'VERY SPECIAL':'#FF5555', 'SPECIAL':'#FF5555', 'ADMIN':'#AA0000', 'DIVINE':'#55FFFF', 'MYTHIC':'#FF55FF', 'LEGENDARY':'#FFAA00','EPIC':'#AA00AA','RARE':'#5555FF','UNCOMMON':'#55FF55','COMMON':'#FFFFFF' };
    const keys = Object.keys(map).sort((a,b)=>b.length-a.length);
    for (const key of keys) { if (plain.includes(key)) return map[key]; }
  }
  return null;
}

// Compact number formatting: 1234 -> 1.23K, 1_234_567 -> 1.23M
function formatCompact(n) {
  const num = Number(n) || 0;
  const abs = Math.abs(num);
  const fmt = (v, s) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100) + s;
  if (abs >= 1e12) return fmt(num / 1e12, 'T');
  if (abs >= 1e9)  return fmt(num / 1e9,  'B');
  if (abs >= 1e6)  return fmt(num / 1e6,  'M');
  if (abs >= 1e3)  return fmt(num / 1e3,  'K');
  return String(Math.round(num));
}

function levelFromSkillXp(xp, maxLevel = 60) {
  const XP = [50,125,200,300,500,750,1000,1500,2000,3500,5000,7500,10000,15000,20000,30000,40000,50000,75000,100000,200000,300000,400000,500000,600000,700000,800000,900000,1000000,1100000,1200000,1300000,1400000,1500000,1600000,1700000,1800000,1900000,2000000,2200000,2400000,2600000,2800000,3000000,3200000,3400000,3600000,3800000,4000000];
  while (XP.length < 100) XP.push(5000000); // Using 100 to be safe for any future level cap increases

  const relevantXp = XP.slice(0, maxLevel);
  const CUM = relevantXp.reduce((a,v)=>{a.push((a.at(-1)||0)+v);return a;},[]);

  for(let i=0; i < CUM.length; i++){
      if(xp < CUM[i]){
          const prev = i === 0 ? 0 : CUM[i-1];
          const seg = relevantXp[i];
          return i + (xp - prev) / seg;
      }
  }
  return maxLevel;
}
