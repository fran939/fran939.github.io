import { fetchUUID, fetchSkyblockProfiles, getSelectedProfile } from "./profile.js";
import { renderPV } from "./pv.js"; // not used, but ensures same env assumptions

export async function renderInventoryApi(ign, env, params = null) {
  try {
    const uuid = await fetchUUID(ign);
    const profiles = await fetchSkyblockProfiles(uuid, env.HYPIXEL_KEY);
    const profile = getSelectedProfile(profiles);
    if (!profile) return json({ error: "No profiles found" }, 404);

    const uuidNoDash = uuid.replace(/-/g, "").toLowerCase();
    const member = profile.members?.[uuidNoDash] || {};
    const inv = member?.inventory || member;

    const out = {};

    async function addNode(nodeKey, outKey, pageSize, minPages=0) {
      const node = inv?.[nodeKey];
      const b64 = node?.data || node?.raw || node?.bytes;
      if (!b64 || typeof b64 !== 'string') return;
      const items = await decodeInventoryItems(b64);
      if (pageSize) {
        const pages = splitByPages(items, pageSize);
        // Ensure visibility of higher pages if slots indicate, and at least minPages
        const maxSlot = items.reduce((m, it) => typeof it.slot === 'number' ? Math.max(m, it.slot) : m, -1);
        const min = Math.max(minPages, maxSlot >= 0 ? Math.floor(maxSlot / pageSize) + 1 : 0);
        for (let i=0; i<Math.max(pages.length, min); i++) {
          out[`${outKey}${i+1}`] = asNameLoreMap(pages[i] || []);
        }
      } else {
        out[outKey] = asNameLoreMap(items);
      }
    }

    await addNode('inv_contents', 'inventory', 36);
    await addNode('wardrobe_contents', 'wardrobe', 27);
    // Ender chest: 45 slots per page (5x9). Ensure pages based on slot indices (1..9)
    await addNode('ender_chest_contents', 'ec', 45, 1);

    // Backpacks map
    const bpMap = inv?.backpack_contents || member?.backpack_contents || null;
    if (bpMap && typeof bpMap === 'object') {
      const keys = Object.keys(bpMap).sort((a,b)=>Number(a)-Number(b));
      for (const k of keys) {
        const b64 = bpMap[k]?.data || bpMap[k]?.raw || bpMap[k]?.bytes || bpMap[k];
        if (typeof b64 !== 'string') continue;
        const items = await decodeInventoryItems(b64);
        out[`bp${Number(k)+1}`] = asNameLoreMap(items);
      }
      // Ensure bp1..bp18 keys exist
      for (let i=1;i<=18;i++){ if (out[`bp${i}`] == null) out[`bp${i}`] = {}; }
    }

    // Personal Vault (if present in API)
    await addNode('personal_vault_contents', 'personal_vault', 27);

    // Pet menu: list pets summary
    const pets = Array.isArray(member?.pets) ? member.pets : [];
    if (pets.length) {
      out.pet_menu = pets.map(p => ({ type: p?.type, tier: p?.tier, exp: Math.floor(Number(p?.exp||0)) }));
    }

    // Museum (raw if available)
    const museum = member?.museum || member?.museum_data || null;
    if (museum) out.museum = museum;

    // Plain-text view when requested (format=txt or txt=1)
    const qp = params && typeof params.get === 'function' ? params : new URLSearchParams();
    const fmt = (qp.get('format') || qp.get('fmt') || '').toLowerCase();
    const wantTxt = qp.get('json') === '1' ? false : (fmt ? fmt === 'txt' : true);
    if (wantTxt) {
      const lines = [];

      // Helper to push a section with items, customizing slot string
      const pushSection = (title, items, slotOf) => {
        if (!Array.isArray(items) || items.length === 0) return;
        lines.push(title);
        const sorted = items.slice().sort((a,b) => (a.slot ?? 1e9) - (b.slot ?? 1e9));
        for (const it of sorted) {
          const nm = it?.name || 'Unknown';
          const slotStr = (typeof slotOf === 'function') ? slotOf(it) : (typeof it?.slot === 'number' ? String(it.slot) : '?');
          lines.push(`${nm} (${slotStr})`);
          const lore = Array.isArray(it?.lore) ? it.lore : [];
          for (const ln of lore) lines.push(`  ${ln}`);
        }
        lines.push("");
      };

      // Decode primary nodes for ordered listing (inventory, wardrobe, ec, pv, backpacks)
      const decodeNodeItems = async (key) => {
        try {
          const node = inv?.[key];
          const b64 = node?.data || node?.raw || node?.bytes;
          if (!b64 || typeof b64 !== 'string') return [];
          return await decodeInventoryItems(b64);
        } catch { return []; }
      };

      // Decode basics
      const invItems = await decodeNodeItems('inv_contents'); // 0..35
      const equipItems1 = await decodeNodeItems('equippment_contents');
      const equipItems2 = await decodeNodeItems('equipment_contents');
      const equipmentItems = (equipItems1 && equipItems1.length) ? equipItems1 : equipItems2;
      const wardItems = await decodeNodeItems('wardrobe_contents');

      // Ender chest pages: 45 per page (collect, then append in order)
      const ecItems = await decodeNodeItems('ender_chest_contents');
      let ecLines = [];
      if (ecItems.length) {
        const pages = splitByPages(ecItems, 45);
        // derive min pages from highest slot
        const maxSlot = ecItems.reduce((m, it) => typeof it.slot === 'number' ? Math.max(m, it.slot) : m, -1);
        const minPages = Math.max(1, maxSlot >= 0 ? Math.floor(maxSlot / 45) + 1 : 1);
        for (let i=0;i<Math.max(pages.length, minPages); i++) {
          const pageItems = pages[i] || [];
          ecLines.push(`ender chest ${i+1}`);
          const sorted = pageItems.slice().sort((a,b) => (a.slot ?? 1e9) - (b.slot ?? 1e9));
          for (const it of sorted) {
            const nm = it?.name || 'Unknown';
            const rel = (typeof it?.slot === 'number') ? String(it.slot % 45) : '?';
            ecLines.push(`${nm} (${rel})`);
            const lore = Array.isArray(it?.lore) ? it.lore : [];
            for (const ln of lore) ecLines.push(`  ${ln}`);
          }
          ecLines.push("");
        }
      }

      // Personal vault
      const pvItems = await decodeNodeItems('personal_vault_contents');

      // Backpacks
      let bpLines = [];
      if (bpMap && typeof bpMap === 'object') {
        const keys = Object.keys(bpMap).sort((a,b)=>Number(a)-Number(b));
        for (const k of keys) {
          const b64 = bpMap[k]?.data || bpMap[k]?.raw || bpMap[k]?.bytes || bpMap[k];
          if (typeof b64 !== 'string') continue;
          const items = await decodeInventoryItems(b64);
          const idx = Number(k) + 1;
          bpLines.push(`backpack ${idx}`);
          const sorted = items.slice().sort((a,b)=>(a.slot??1e9)-(b.slot??1e9));
          for (const it of sorted) {
            const nm = it?.name || 'Unknown';
            const s = (typeof it?.slot === 'number') ? String(it.slot) : '?';
            bpLines.push(`${nm} (${s})`);
            const lore = Array.isArray(it?.lore) ? it.lore : [];
            for (const ln of lore) bpLines.push(`  ${ln}`);
          }
          bpLines.push("");
        }
      }

      // Pets
      const pets = Array.isArray(member?.pets) ? member.pets : [];

      // Optional: other *_contents we haven't listed (including rift)
      const seen = new Set(['inv_contents','wardrobe_contents','ender_chest_contents','personal_vault_contents','equippment_contents','equipment_contents']);
      const riftNodes = [];
      const otherNodes = [];
      for (const [k, v] of Object.entries(inv || {})) {
        if (!/_contents$/i.test(k)) continue;
        if (seen.has(k)) continue;
        if (/^rift.*_contents$/i.test(k)) riftNodes.push([k, v]); else otherNodes.push([k, v]);
      }
      // Build final output in requested order
      pushSection('inventory', invItems, (it)=> (typeof it.slot==='number'? String(it.slot) : '?'));
      pushSection('equipment', equipmentItems, (it)=> (typeof it.slot==='number'? String(it.slot) : '?'));
      lines.push(...ecLines);
      lines.push(...bpLines);
      pushSection('wardrobe', wardItems, (it)=> (typeof it.slot==='number'? String(it.slot) : '?'));
      if (pets.length) {
        lines.push('pets');
        for (const p of pets) lines.push(`${p?.type || 'UNKNOWN'} (${p?.tier || '-'}) exp=${Math.floor(Number(p?.exp||0))}`);
        lines.push('');
      }
      pushSection('personal vault', pvItems, (it)=> (typeof it.slot==='number'? String(it.slot) : '?'));
      if (riftNodes.length) {
        lines.push('rift');
        for (const [k, v] of riftNodes) {
          try {
            const b64 = v?.data || v?.raw || v?.bytes || v;
            if (typeof b64 !== 'string') continue;
            const items = await decodeInventoryItems(b64);
            const sorted = items.slice().sort((a,b)=>(a.slot??1e9)-(b.slot??1e9));
            for (const it of sorted) {
              const nm = it?.name || 'Unknown';
              const s = (typeof it?.slot === 'number') ? String(it.slot) : '?';
              lines.push(`${nm} (${s})`);
              const lore = Array.isArray(it?.lore) ? it.lore : [];
              for (const ln of lore) lines.push(`  ${ln}`);
            }
            lines.push('');
          } catch {}
        }
      }
      for (const [k, v] of otherNodes) {
        try {
          const b64 = v?.data || v?.raw || v?.bytes || v;
          if (typeof b64 !== 'string') continue;
          const items = await decodeInventoryItems(b64);
          lines.push(k.replace(/_/g,' '));
          const sorted = items.slice().sort((a,b)=>(a.slot??1e9)-(b.slot??1e9));
          for (const it of sorted) {
            const nm = it?.name || 'Unknown';
            const s = (typeof it?.slot === 'number') ? String(it.slot) : '?';
            lines.push(`${nm} (${s})`);
            const lore = Array.isArray(it?.lore) ? it.lore : [];
            for (const ln of lore) lines.push(`  ${ln}`);
          }
          lines.push('');
        } catch {}
      }

      const txt = lines.join('\n');
      return new Response(txt, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
    }

    return json(out, 200);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
}

function json(body, status=200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Minimal copies from pv.js for decoding (kept small to avoid circular imports)
async function decodeInventoryItems(b64) {
  const bytes = base64ToBytes(b64);
  const raw = await gunzipMaybe(bytes);
  const nbt = parseNbtSync(raw);
  const root = nbt?.value || {};
  const inv = root.i?.value || root.value?.i?.value; // common layout
  const list = Array.isArray(inv) ? inv : [];
  const items = [];
  for (let idx = 0; idx < list.length; idx++) {
    const el = list[idx];
    const v = el?.value || {};
    const count = num(v.Count?.value);
    if (!count) continue;
    const id = text(v.id?.value || '');
    const dispNameJson = text(v.tag?.value?.display?.value?.Name?.value || '');
    const dispName = dispNameJson ? simplifyMcText(dispNameJson) : (id || 'Unknown');
    const loreList = v.tag?.value?.display?.value?.Lore?.value;
    const lore = Array.isArray(loreList)
      ? loreList.map((ln) => simplifyMcText(text(ln?.value || ln))).filter(Boolean)
      : [];
    let slot = (v.Slot && typeof v.Slot.value === 'number') ? v.Slot.value : null;
    if (!(typeof slot === 'number')) slot = idx; // fallback to list index when Slot missing
    items.push({ name: dispName, count, slot, lore, id });
  }
  return items;
}

function asNameLoreMap(items){
  const obj = {};
  for (const it of items) {
    const nm = it.name || 'Unknown';
    const lore = (it.lore && it.lore.length) ? it.lore.join('\n') : '';
    if (obj[nm] != null) {
      const suffix = typeof it.slot === 'number' ? ` (#${it.slot})` : ` (${it.count || 1})`;
      obj[nm + suffix] = lore;
    } else {
      obj[nm] = lore;
    }
  }
  return obj;
}

async function gunzipMaybe(data) {
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Response(new Blob([data]).stream().pipeThrough(ds));
    const buf = await stream.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return data;
  }
}

function parseNbtSync(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  function readU8() { const v = dv.getUint8(off); off += 1; return v; }
  function readI16() { const v = dv.getInt16(off, false); off += 2; return v; }
  function readI32() { const v = dv.getInt32(off, false); off += 4; return v; }
  function readI64() { const hi = dv.getInt32(off, false); const lo = dv.getInt32(off+4, false); off += 8; return BigInt(hi) << 32n | BigInt(lo >>> 0); }
  function readF32() { const v = dv.getFloat32(off, false); off += 4; return v; }
  function readF64() { const v = dv.getFloat64(off, false); off += 8; return v; }
  function readBytes(n) { const out = new Uint8Array(buf.buffer, buf.byteOffset + off, n); off += n; return out; }
  function readString() { const len = readI16(); const bytes = readBytes(len); return new TextDecoder().decode(bytes); }

  function readTagPayload(tagId) {
    switch (tagId) {
      case 0: return null;
      case 1: { const v = dv.getInt8(off); off += 1; return v; }
      case 2: return readI16();
      case 3: return readI32();
      case 4: return readI64();
      case 5: return readF32();
      case 6: return readF64();
      case 7: { const len = readI32(); return readBytes(len); }
      case 8: return readString();
      case 9: { const elemType = readU8(); const len = readI32(); const arr = new Array(len); for (let i=0;i<len;i++) arr[i] = { type: elemType, value: readTagPayload(elemType) }; return arr; }
      case 10: { const obj = {}; while (true) { const t = readU8(); if (t===0) break; const name = readString(); obj[name] = { type: t, value: readTagPayload(t) }; } return obj; }
      case 11: { const len = readI32(); const out = new Int32Array(len); for (let i=0;i<len;i++) out[i] = readI32(); return out; }
      case 12: { const len = readI32(); const out = new Array(len); for (let i=0;i<len;i++) out[i] = readI64(); return out; }
      default: throw new Error('Unknown NBT tag '+tagId);
    }
  }
  const rootType = dv.getUint8(off); off += 1;
  if (rootType !== 10) throw new Error('Invalid NBT root');
  const _name = readString();
  const value = readTagPayload(10);
  return { type: rootType, value };
}

function splitByPages(items, pageSize) {
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
  const out = [];
  for (let i=0;i<items.length;i+=pageSize) out.push(items.slice(i, i+pageSize));
  return out;
}

function num(v) { return typeof v === 'number' ? v : Number(v || 0); }
function text(v) { return v == null ? '' : String(v); }
function base64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function simplifyMcText(name) { try { const j = JSON.parse(name); if (typeof j === 'string') return j; if (Array.isArray(j)) return j.map(s => typeof s==='string'?s:(s.text||'')).join('').trim(); if (j && typeof j==='object') return (j.text||'').trim(); } catch {} return name.replace(/§./g, '').trim(); }
