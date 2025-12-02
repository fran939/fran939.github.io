const DEFAULT_SEL_CLASS_XP = 360000; // selected class XP per run (tunable)
const DEFAULT_UNSEL_CLASS_XP = 90000; // non-selected classes XP per run (tunable)
const TARGET_LEVEL = 50;

// Per-level XP required for each dungeon/class level (1..50)
const XP_CHART = [
  50, 75, 110, 160, 230, 330, 470, 670, 950, 1340,
  1890, 2665, 3760, 5260, 7380, 10300, 14400, 20000, 27600, 38000,
  52500, 71500, 97000, 132000, 180000, 243000, 328000, 445000, 600000, 800000,
  1065000, 1410000, 1900000, 2500000, 3300000, 4300000, 5600000, 7200000, 9200000, 12000000,
  15000000, 19000000, 24000000, 30000000, 38000000, 48000000, 60000000, 75000000, 93000000, 116250000,
];

// cumulative XP required to reach each whole level (1..50)
const CUM_XP = XP_CHART.reduce((acc, xp) => {
  acc.push((acc.at(-1) || 0) + xp);
  return acc;
}, []);

const LEVEL50_XP = CUM_XP[CUM_XP.length - 1];
const CLASSES = ["healer", "mage", "berserk", "archer", "tank"];

export function calculateRtca(profile, _ign, requestedUuid, opts = {}) {
  const out = { profile: profile.cute_name, members: {} };

  const wanted = (requestedUuid || "").replace(/-/g, "").toLowerCase();

  const entries = Object.entries(profile.members || {});
  const filtered = wanted && entries.find(([id]) => id.toLowerCase() === wanted)
    ? entries.filter(([id]) => id.toLowerCase() === wanted)
    : entries; // fallback: all members if match not found

  for (const [uuid, m] of filtered) {
    const d = m?.dungeons || {};
    const classesNode = d.player_classes || d.classes || {};
    const cataXp = d.dungeon_types?.catacombs?.experience || 0;

    const classXp = Object.fromEntries(
      CLASSES.map((c) => [c, classesNode?.[c]?.experience || 0])
    );

    const classLevels = Object.fromEntries(
      CLASSES.map((c) => [c, levelFromXp(classXp[c])])
    );

    const avgLevel = average(Object.values(classLevels));

    let plan;
    if (opts.classPerRun && typeof opts.classPerRun === 'object') {
      plan = simulatePlanToAverage50Advanced(classXp, opts.classPerRun);
    } else {
      const selXp = Number.isFinite(opts.selXp) ? opts.selXp : DEFAULT_SEL_CLASS_XP;
      const unselXp = Number.isFinite(opts.unselXp) ? opts.unselXp : DEFAULT_UNSEL_CLASS_XP;
      plan = simulatePlanToAverage50(classXp, selXp, unselXp);
    }

    // Optional: catacombs runs to a target level (Adjectils-style)
    let cataRuns = undefined;
    if (opts && opts.floor && Number(opts.floor) > 0 && Number.isFinite(Number(opts.floor))) {
      const target = Number.isFinite(Number(opts.targetCata)) ? Number(opts.targetCata) : undefined;
      cataRuns = computeCatacombRunsLeft({
        currentXp: cataXp,
        floorValue: Number(opts.floor),
        targetLevel: target,
        global: Number(opts.global) || 1,
        mayor: Number(opts.mayor) || 1,
        cataExpert: Number(opts.cataexpert) || 0,
        hecatomb: Number(opts.hecatomb) || 0,
      });
    }

    out.members[uuid] = {
      average_level: round2(avgLevel),
      runs_to_avg_50: plan.total_runs,
      class_run_plan: { total_runs: plan.total_runs, per_class_runs: plan.per_class_runs },
      catacombs: {
        xp: cataXp,
        level: levelFromXp(cataXp),
        runs_to_target: cataRuns,
      },
      details: Object.fromEntries(
        CLASSES.map((c) => {
          const rem = Math.max(LEVEL50_XP - classXp[c], 0);
          return [
            c,
            {
              level: round2(classLevels[c]),
              xp: classXp[c],
              remaining_to_50: rem,
              runs_until_complete: plan.per_class_runs[c] || 0,
              runs_to_50_selected: Math.ceil(rem / (opts.classPerRun ? (opts.classPerRun[c] || DEFAULT_SEL_CLASS_XP) : (Number.isFinite(opts.selXp) ? opts.selXp : DEFAULT_SEL_CLASS_XP))),
              runs_to_50_unselected: Math.ceil(rem / (opts.classPerRun ? ((opts.classPerRun[c] || DEFAULT_SEL_CLASS_XP)/4) : (Number.isFinite(opts.unselXp) ? opts.unselXp : DEFAULT_UNSEL_CLASS_XP))),
            },
          ];
        })
      ),
    };
  }

  return out;
}

function levelFromXp(xp) {
  if (xp <= 0) return 0;
  for (let i = 0; i < CUM_XP.length; i++) {
    if (xp < CUM_XP[i]) {
      const prev = i === 0 ? 0 : CUM_XP[i - 1];
      const seg = XP_CHART[i];
      return i + (xp - prev) / seg; // fractional level
    }
  }
  // beyond 50: linear tail at 200M per level (very rarely used)
  const extra = xp - LEVEL50_XP;
  return 50 + extra / 200_000_000;
}

function simulateRunsToAverage50(initialXpMap, selXp, unselXp) {
  // Greedy: always select the class farthest from 50 (highest remaining XP)
  const xp = { ...initialXpMap };
  let runs = 0;
  const maxRuns = 50000; // safety guard

  while (average(CLASSES.map((c) => levelFromXp(xp[c]))) < TARGET_LEVEL - 1e-6) {
    const rem = Object.fromEntries(
      CLASSES.map((c) => [c, Math.max(LEVEL50_XP - xp[c], 0)])
    );
    const selected = CLASSES.reduce((a, b) => (rem[a] >= rem[b] ? a : b));

    for (const c of CLASSES) {
      xp[c] += c === selected ? selXp : unselXp;
      if (xp[c] > LEVEL50_XP) xp[c] = LEVEL50_XP; // cap at 50
    }

    runs++;
    if (runs > maxRuns) break; // prevent infinite loops on malformed data
  }

  return runs;
}

function simulateRunsToAverage50Advanced(initialXpMap, classPerRun) {
  const xp = { ...initialXpMap };
  let runs = 0;
  const maxRuns = 50000;
  while (average(CLASSES.map((c) => levelFromXp(xp[c]))) < TARGET_LEVEL - 1e-6) {
    const rem = Object.fromEntries(CLASSES.map((c) => [c, Math.max(LEVEL50_XP - xp[c], 0)]));
    const selected = CLASSES.reduce((a, b) => (rem[a] >= rem[b] ? a : b));
    for (const c of CLASSES) {
      const per = classPerRun[c] || DEFAULT_SEL_CLASS_XP;
      xp[c] += c === selected ? per : per / 4;
      if (xp[c] > LEVEL50_XP) xp[c] = LEVEL50_XP;
    }
    runs++;
    if (runs > maxRuns) break;
  }
  return runs;
}

function targetCataXpForLevel(level) {
  if (!Number.isFinite(level) || level <= 0) return 0;
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += i < 50 ? XP_CHART[i] : 200_000_000;
  }
  return total;
}

function computeCatacombRunsLeft({ currentXp, floorValue, targetLevel, global = 1, mayor = 1, cataExpert = 0, hecatomb = 0 }) {
  try {
    const lvl = Number(targetLevel);
    const targetXp = Number.isFinite(lvl) && lvl > 0 ? targetCataXpForLevel(lvl) : 0;
    const left = Math.max(targetXp - (currentXp || 0), 0);
    if (!left) return 0;
    // Max completions heuristic copied from Adjectils
    let maxcomps = 76;
    if (floorValue >= 15000) maxcomps = 26; // M floors
    else if (floorValue === 4880) maxcomps = 51; // F6

    let perRun = 0;
    if (cataExpert > 0 && mayor > 1) {
      perRun = floorValue * (0.95 + ((mayor - 1) + (maxcomps - 1) / 100) + cataExpert + hecatomb + (maxcomps - 1) * (0.024 + hecatomb / 50));
    } else if (cataExpert > 0) {
      perRun = floorValue * (0.95 + cataExpert + hecatomb + (maxcomps - 1) * (0.024 + hecatomb / 50));
    } else {
      perRun = floorValue * (0.95 + hecatomb + (maxcomps - 1) * (0.022 + hecatomb / 50));
    }
    perRun *= global;
    perRun = Math.ceil(perRun);
    if (!perRun) return undefined;
    return Math.ceil(left / perRun);
  } catch (_) {
    return undefined;
  }
}

function simulatePlanToAverage50(initialXpMap, selXp, unselXp) {
  const xpLeft = Object.fromEntries(
    CLASSES.map((c) => [c, Math.max(LEVEL50_XP - (initialXpMap[c] || 0), 0)])
  );
  const perClassRuns = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let total = 0;
  const maxRuns = 50000;

  const avgLevel = () => average(CLASSES.map((c) => levelFromXp(LEVEL50_XP - xpLeft[c])));
  while (avgLevel() < TARGET_LEVEL - 1e-6) {
    // pick class with the highest remaining xp to 50
    let selected = CLASSES[0];
    for (const c of CLASSES) {
      if (xpLeft[c] > xpLeft[selected]) selected = c;
    }
    for (const c of CLASSES) {
      const inc = c === selected ? selXp : unselXp;
      xpLeft[c] = Math.max(xpLeft[c] - inc, 0);
    }
    perClassRuns[selected] += 1;
    total += 1;
    if (total > maxRuns) break;
  }
  return { total_runs: total, per_class_runs: perClassRuns };
}

function simulatePlanToAverage50Advanced(initialXpMap, classPerRun) {
  const xpLeft = Object.fromEntries(
    CLASSES.map((c) => [c, Math.max(LEVEL50_XP - (initialXpMap[c] || 0), 0)])
  );
  const perClassRuns = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let total = 0;
  const maxRuns = 50000;

  const avgLevel = () => average(CLASSES.map((c) => levelFromXp(LEVEL50_XP - xpLeft[c])));
  while (avgLevel() < TARGET_LEVEL - 1e-6) {
    let selected = CLASSES[0];
    for (const c of CLASSES) {
      if (xpLeft[c] > xpLeft[selected]) selected = c;
    }
    for (const c of CLASSES) {
      const inc = c === selected ? (classPerRun[c] || DEFAULT_SEL_CLASS_XP) : (classPerRun[c] || DEFAULT_SEL_CLASS_XP) / 4;
      xpLeft[c] = Math.max(xpLeft[c] - inc, 0);
    }
    perClassRuns[selected] += 1;
    total += 1;
    if (total > maxRuns) break;
  }
  return { total_runs: total, per_class_runs: perClassRuns };
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
