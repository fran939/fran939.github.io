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

function buildPetsSection(member) {
  const pets = member?.pets || [];
  if (!Array.isArray(pets) || pets.length === 0) return "";
  const rows = pets.map((p) => {
    const name = p?.type || 'UNKNOWN';
    const tier = p?.tier || 'COMMON';
    const xp = Math.floor(Number(p?.exp || 0)).toLocaleString();
    const active = p?.active ? ' (active)' : '';
    return `<div class="endpoint"><div class="method get">${escapeHtml(tier)}</div><div class="path">${escapeHtml(name)}</div><div class="desc">XP: ${xp}${active}</div></div>`;
  }).join("");
  return `
  <section class="card">
    <h2>Pets</h2>
    <div class="endpoints">${rows}</div>
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

// Kuudra gear: vertical columns (side-by-side) and key stats
async function buildKuudraGear(member, profile, me) {
  try {
    const nether = member?.nether_island_player_data || {};
    const raw = nether?.kuudra_completed_tiers || nether?.kuudra_completed || {};
    const agg = { basic: 0, hot: 0, burning: 0, fiery: 0, infernal: 0 };
