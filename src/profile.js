export async function fetchUUID(ign) {
    const cache = caches.default;
    const playerDbReq = new Request(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(ign)}`);
    const tryCacheJson = async (req, ttl) => {
        let r = await cache.match(req);
        if (!r) {
            const u = await fetch(req, { cf: { cacheTtl: ttl, cacheEverything: true } });
            if (!u.ok) return null;
            r = new Response(u.body, u);
            try { r.headers.set('Cache-Control', `public, max-age=${ttl}`); } catch {}
            await cache.put(req, r.clone());
        }
        try { return await r.json(); } catch { return null; }
    };

    // 1) PlayerDB
    let json = await tryCacheJson(playerDbReq, 86400);
    let raw = json?.data?.player?.raw_id;
    if (raw && typeof raw === 'string') return raw;

    // 2) Mojang fallback
    const mojangReq = new Request(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`);
    json = await tryCacheJson(mojangReq, 86400);
    raw = json?.id;
    if (raw && typeof raw === 'string') return raw;

    throw new Error("IGN not found");
}

export async function fetchSkyblockProfiles(uuid, key) {
    if (!key) throw new Error("HYPIXEL_KEY missing");
    const url = `https://api.hypixel.net/v2/skyblock/profiles?key=${encodeURIComponent(key)}&uuid=${encodeURIComponent(uuid)}`;
    const req = new Request(url, { method: 'GET' });
    const cache = caches.default;
    let res = await cache.match(req);
    if (!res) {
        const upstream = await fetch(req, { cf: { cacheTtl: 60, cacheEverything: true } });
        if (!upstream.ok) throw new Error("Hypixel fetch failed");
        res = new Response(upstream.body, upstream);
        try { res.headers.set('Cache-Control', 'public, max-age=60'); } catch {}
        await cache.put(req, res.clone());
    }
    const json = await res.json();
    if (!json?.profiles) throw new Error("No profiles found");
    return json.profiles;
}

export function getSelectedProfile(profiles) {
    return profiles.find(p => p.selected) || profiles[0];
}

export function getProfileByName(profiles, profileName) {
    return profiles.find(p => p.cute_name?.toLowerCase() === profileName.toLowerCase());
}
