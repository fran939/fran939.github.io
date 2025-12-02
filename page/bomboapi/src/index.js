import { fetchUUID, fetchSkyblockProfiles, getSelectedProfile, getProfileByName } from "./profile.js";
import { calculateRtca } from "./rtca.js";
import { renderPV, renderPVSnapshotAllMembers } from "./pv.js";
import { renderInventoryApi } from "./inventory.js";
import indexHtml from "./index.html";
import styleCss from "./style.css";
import JSZip from "jszip";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Lazy-load texture pack index once per worker instance
        async function getPack() {
            if (!globalThis.__PACK_INDEX) {
                try {
                    if (!env.PACK || typeof env.PACK.fetch !== 'function') {
                        throw new Error('PACK binding missing');
                    }
                    // Load zip from the bound static assets (see wrangler.toml assets binding)
                    const res = await env.PACK.fetch(new Request(new URL('/strawbby.zip', request.url)));
                    if (!res.ok) throw new Error("pack not found");
                    const buf = await res.arrayBuffer();
                    const zip = await JSZip.loadAsync(buf);
                    const index = new Map();
                    zip.forEach((path, file) => {
                        if (file.dir) return;
                        const p = path.toLowerCase();
                        if (!/assets\/minecraft\/textures\/(item|items)\/.+\.png$/.test(p)) return;
                        const base = p.split("/").pop();
                        const id = base.replace(/\.png$/, "");
                        index.set(id, file);
                    });
                    globalThis.__PACK_INDEX = { zip, index, cache: new Map() };
                } catch (e) {
                    globalThis.__PACK_INDEX = { zip: null, index: new Map(), cache: new Map(), error: String(e && e.message || e) };
                }
            }
            return globalThis.__PACK_INDEX;
        }

        // === Serve HTML ===
        if (url.pathname === "/" || url.pathname === "/index.html") {
            const base = new Response(indexHtml, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
            const rewriter = new HTMLRewriter().on("head", {
                element(el) {
                    el.append(`\n  <style>\n${styleCss}\n  </style>\n`, { html: true });
                },
            });
            return rewriter.transform(base);
        }

        // === Serve CSS ===
        if (url.pathname === "/style.css") {
            return new Response(styleCss, {
                headers: { "Content-Type": "text/css; charset=utf-8" },
            });
        }

        // === Favicon ===
        if (url.pathname === "/favicon.ico") {
            // return a 204 to avoid noisy 500s in logs during dev
            return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
        }

        // === Hypixel item texture proxy (/texture/:HYPX_ID[.png]) ===
        if (url.pathname.startsWith("/texture/")) {
            const raw = url.pathname.slice("/texture/".length);
            const id = decodeURIComponent(raw.replace(/\.png$/i, ""));
            if (!id) return new Response("Missing id", { status: 400 });
            const upstream = `https://sky.shiiyu.moe/api/item/${encodeURIComponent(id)}`;
            const res = await fetch(upstream, { cf: { cacheTtl: 86400, cacheEverything: true } });
            if (!res.ok) return new Response("Not Found", { status: 404 });
            const bytes = await res.arrayBuffer();
            return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
        }

        // === Serve local texture pack files (/tex/{id}.png) ===
        if (url.pathname.startsWith("/tex/")) {
            const id = url.pathname.slice(5).replace(/\.png$/i, "").toLowerCase();
            const { index, cache } = await getPack();

            const serveBytes = (key, fileObj) => fileObj.async("uint8array").then((bytes) => {
                cache.set(key, bytes);
                return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
            });

            if (cache.has(id)) {
                return new Response(cache.get(id), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
            }

            const tryKeys = (base) => {
                const out = [];
                if (index.has(base)) out.push(base);
                // Aliases for common mismatches across packs
                const alt = [];
                if (base === 'enchanted_book') alt.push('book_enchanted');
                if (base === 'book_enchanted') alt.push('enchanted_book');
                if (base === 'potion') alt.push('potion_bottle_drinkable', 'potion_bottle_splash');
                if (base === 'player_head' || base === 'skull_item' || base === 'skull') alt.push('skull');
                if (base === 'bow') alt.push('bow_standby');
                if (base.endsWith('_sword')) alt.push('diamond_sword');
                if (base.endsWith('_pickaxe') || base.includes('pick')) alt.push('iron_pickaxe', 'diamond_pickaxe');
                if (base.endsWith('_helmet')) alt.push('diamond_helmet', 'iron_helmet', 'gold_helmet', 'chainmail_helmet', 'leather_helmet');
                if (base === 'bundle') alt.push('chest', 'book_normal');
                if (base === 'ender_chest') alt.push('eye_of_ender', 'ender_pearl');
                for (const k of alt) if (index.has(k)) out.push(k);
                // Last resort: pick any one by fuzzy contains
                for (const k of index.keys()) { if (k.includes(base.split('_')[0])) { out.push(k); break; } }
                return out;
            };

            const candidates = tryKeys(id);
            for (const key of candidates) {
                const f = index.get(key);
                if (f) return await serveBytes(key, f);
            }
            return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
        }

        // === Serve any file from textures directory for quick tests (/static/<filename>) ===
        if (url.pathname.startsWith("/static/")) {
            const path = url.pathname.slice("/static".length) || '/';
            if (!env.PACK || typeof env.PACK.fetch !== 'function') {
                return new Response('PACK binding missing', { status: 500 });
            }
            const assetUrl = new URL(path, request.url);
            const res = await env.PACK.fetch(new Request(assetUrl));
            if (!res.ok) return new Response("Not found", { status: 404 });
            return new Response(res.body, { headers: res.headers });
        }

        // Optional: index viewer to verify assets loaded
        if (url.pathname === "/tex-index") {
            const { index, error } = await getPack();
            const arr = Array.from(index.keys()).slice(0, 50);
            return new Response(JSON.stringify({ count: index.size, sample: arr, error: error || null }, null, 2), { headers: { "Content-Type": "application/json" } });
        }

        // === Player Viewer (/pv/:user) ===
        if (url.pathname.startsWith("/pv/")) {
            const ign = url.pathname.split("/")[2];
            if (!ign) return new Response("Missing user in /pv/:user", { status: 400 });
            try {
                const textureBase = url.searchParams.get("tex") || env.TEXTURE_BASE || "/tex";
                const iconUrl = url.searchParams.get("icon") || undefined; // optional: single image override for all icons
                const hypixelKey = url.searchParams.get("hypixel_key") || env.HYPIXEL_KEY;
                const page = await renderPV(ign, env, { textureBase, iconUrl, hypixelKey });
                const rewriter = new HTMLRewriter().on("head", {
                    element(el) { el.append(`\n  <style>\n${styleCss}\n  </style>\n`, { html: true }); },
                });
                const resp = rewriter.transform(page);
                try { resp.headers.set('Cache-Control', 'public, max-age=60'); } catch {}
                return resp;
            } catch (e) {
                // During local development return the full stack to aid debugging
                try { console.error(e); } catch (_) {}
                const txt = e && e.stack ? String(e.stack) : String(e && e.message || e);
                return new Response("Error loading player: " + txt, { status: 500 });
            }
        }

        // === Player Viewer from uploaded JSON snapshot (/pv-snapshot, POST) ===
        if (url.pathname === "/pv-snapshot" && request.method === "POST") {
            try {
                const form = await request.formData();
                let rawText = "";
                const snapField = form.get("snapshot");
                if (typeof snapField === "string") {
                    rawText = snapField.trim();
                }
                if (!rawText) {
                    const file = form.get("file");
                    if (file && typeof file === "object" && typeof file.text === "function") {
                        rawText = (await file.text()).trim();
                    }
                }
                if (!rawText) {
                    return new Response("No JSON provided in snapshot.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
                }
                let parsed;
                try {
                    parsed = JSON.parse(rawText);
                } catch (e) {
                    return new Response("Invalid JSON snapshot: " + (e && e.message ? e.message : String(e)), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
                }
                let ignSnap = form.get("ign");
                if (ignSnap && typeof ignSnap !== "string") ignSnap = String(ignSnap);
                let ign = (ignSnap && ignSnap.trim()) || (typeof parsed.ign === "string" && parsed.ign.trim()) || "Snapshot";
                const rawProfile = parsed.raw_profile || parsed.profile || parsed;
                if (!rawProfile || typeof rawProfile !== "object") {
                    return new Response("Snapshot JSON does not contain a raw_profile object.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
                }
                let uuid = "";
                let uuidField = form.get("uuid");
                if (uuidField && typeof uuidField !== "string") uuidField = String(uuidField);
                if (uuidField && uuidField.trim()) {
                    uuid = uuidField.trim();
                } else if (typeof parsed.uuid === "string" && parsed.uuid.trim()) {
                    uuid = parsed.uuid.trim();
                }
                if (!uuid && rawProfile && rawProfile.members && typeof rawProfile.members === "object") {
                    const keys = Object.keys(rawProfile.members);
                    if (keys.length) uuid = keys[0];
                }
                if (!uuid && ign && ign !== "Snapshot") {
                    try {
                        uuid = await fetchUUID(ign);
                    } catch (_) { /* ignore */ }
                }
                if (!uuid) {
                    return new Response("Could not determine player UUID from snapshot JSON.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
                }
                const textureBase = url.searchParams.get("tex") || env.TEXTURE_BASE || "/tex";
                const iconUrl = url.searchParams.get("icon") || undefined;
                const page = await renderPVSnapshotAllMembers(ign, env, { textureBase, iconUrl, rawProfile });
                const rewriter = new HTMLRewriter().on("head", {
                    element(el) { el.append(`\n  <style>\n${styleCss}\n  </style>\n`, { html: true }); },
                });
                const resp = rewriter.transform(page);
                return resp;
            } catch (e) {
                const txt = e && e.stack ? String(e.stack) : String(e && e.message || e);
                return new Response("Error loading snapshot: " + txt, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
            }
        }

        if (url.pathname.startsWith("/inv/")) {
            const ign = url.pathname.split("/")[2];
            if (!ign) return new Response(JSON.stringify({ error: "Missing user in /inv/:user" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            return await renderInventoryApi(ign, env, url.searchParams);
        }

        // === API logic ===
        const HYPIXEL_KEY = url.searchParams.get("hypixel_key") || env.HYPIXEL_KEY;
        const parts = url.pathname.slice(1).split("/");
        const ign = parts[0];
        if (!ign) {
            return new Response(JSON.stringify({ error: "Missing IGN" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        try {
            const uuid = await fetchUUID(ign);
            const profiles = await fetchSkyblockProfiles(uuid, HYPIXEL_KEY);

            let profile;
            if (parts[1] === "profile" && parts[2]) {
                profile = getProfileByName(profiles, parts[2]);
            } else {
                profile = getSelectedProfile(profiles);
            }

            if (!profile) {
                return new Response(JSON.stringify({ error: "No profiles found" }), {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (parts[1] === "rtca") {
                const selXp = url.searchParams.get("sel");
                const unselXp = url.searchParams.get("unsel");
                // Advanced params (adjectils-style)
                const floor = num(url.searchParams.get("floor"));
                const hec = num(url.searchParams.get("hecatomb"));
                const ring = num(url.searchParams.get("cataexpert"));
                const grimoire = num(url.searchParams.get("grimoire"));
                const scarf = num(url.searchParams.get("scarfshardlevel"));
                const globalBoost = num(url.searchParams.get("global")) || 1;
                const mayor = num(url.searchParams.get("mayor")) || 1;
                const archBoost = num(url.searchParams.get("archboost"));
                const bersBoost = num(url.searchParams.get("bersboost"));
                const healBoost = num(url.searchParams.get("healboost"));
                const mageBoost = num(url.searchParams.get("mageboost"));
                const tankBoost = num(url.searchParams.get("tankboost"));
                const targetCata = num(url.searchParams.get("targetcata"));

                let opts = {};
                if (floor) {
                    const base = (clsBoost) => floor * (1 + (hec || 0) * 2 + (clsBoost || 0) + (grimoire || 0) + (scarf || 0)) * (globalBoost || 1) * (mayor || 1);
                    opts.classPerRun = {
                        healer: base(healBoost),
                        mage: base(mageBoost),
                        berserk: base(bersBoost),
                        archer: base(archBoost),
                        tank: base(tankBoost),
                    };
                    // Also pass raw params for catacombs run computation
                    opts.floor = floor;
                    opts.cataexpert = ring;
                    opts.global = globalBoost;
                    opts.mayor = mayor;
                    opts.hecatomb = hec;
                    opts.targetCata = targetCata || undefined;
                } else {
                    opts = {
                        selXp: selXp ? Number(selXp) : undefined,
                        unselXp: unselXp ? Number(unselXp) : undefined,
                    };
                }
                const result = calculateRtca(profile, ign, uuid, opts);
                return new Response(JSON.stringify(result), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "max-age=60",
                    },
                });
            }

            return new Response(JSON.stringify({
                ign,
                profile: profile.cute_name,
                raw_profile: profile,
            }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "max-age=60",
                },
            });
        } catch (e) {
            console.error(e);
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },
};

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
