/* ==========================================================================
   锻剑纳贡 · 游戏逻辑（第一人称场景交互版）
   --------------------------------------------------------------------------
   所有玩法都在铁匠铺里完成：
   剑架拿剑 → 熔炉加热 → 铁砧锻造 → 取下剑 → 贡台放剑 → 铃铛上贡
   遗物机和幽灵商人也直接在场景里用准星 + E 互动。
   ========================================================================== */

(function () {
  'use strict';

  const CFG = window.FT_CONFIG;
  const B = CFG.balance;
  window.__FT_BUILD = '20261028-51';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ------------------------------ 状态 ------------------------------ */

  let lang = 'zh';
  let langExplicit = false;
  let soundOn = true;
  let volume = 0.65;
  let unlocks = { achievements: {}, relics: {}, bestForm: {}, swings: 0 };
  let run = null;
  let relicStats = emptyStats();
  let world = null;
  let audio = null;

  let forgeMode = false;
  let busy = false;
  let heating = false;
  let settling = false;
  let overlayMode = null;
  let overlayData = null;
  let focus = null;
  let frenzy = { active: false, until: 0, total: 0 };
  let autoHammerTimer = 0;
  let chainFrenzyTimer = 0;
  let lastLog = '';
  let toastTimer = 0;
  let resetArmed = false;
  let resetTimer = 0;
  let discardTimer = 0;
  let lockNoticeShown = false;
  let bellArmedUntil = 0;
  let bellTimer = 0;
  let isTouch = false;
  let joy = { active: false, id: null, x: 0, y: 0 };
  let chosenDifficulty = 'normal';
  // 开局选择的龙（可多选 / 可不选）与契约总天数
  let chosenDragons = [];
  let chosenDays = 21;
  let lowQuality = false;

  const UI = {};

  /* ------------------------------ 工具 ------------------------------ */

  function t(key, vars) {
    const dict = CFG.strings[lang] || CFG.strings.zh;
    let s = dict[key];
    if (s == null) s = CFG.strings.zh[key];
    if (s == null) return key;
    if (vars) {
      Object.keys(vars).forEach(k => {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return s;
  }

  // 大数自动缩写（1.23万 / 4.5M），具体单位表见 config.js 的 fmtUnits
  function fmt(n) {
    return CFG.fmtNumber(n, lang);
  }

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  // 剑的等级上限：balance.maxLevel <= 0 表示无上限
  function levelCap() {
    const v = Number(B.maxLevel);
    return v > 0 ? v : Infinity;
  }

  // 契约日期：从 4/15 起顺延，支持自定义更长或更短的天数
  const DATE_MONTHS = [[4, 30], [5, 31], [6, 30], [7, 31], [8, 31], [9, 30]];
  function dateForDay(day) {
    let abs = 15 + (Math.max(1, day) - 1);
    for (const [m, len] of DATE_MONTHS) {
      if (abs <= len) return { m, d: abs };
      abs -= len;
    }
    return { m: 9, d: 30 };
  }

  function dateLabel(day) {
    const d = dateForDay(day);
    if (lang === 'zh') return `${d.m}月${d.d}日`;
    const names = { 4: 'April', 5: 'May', 6: 'June', 7: 'July', 8: 'August', 9: 'September' };
    return `${names[d.m] || d.m} ${d.d}`;
  }

  function difficultyById(id) {
    return (CFG.difficulties || []).find(d => d.id === id) || null;
  }

  function currentDifficulty() {
    return difficultyById(run && run.difficulty) || difficultyById('normal') || { quotaMult: 1 };
  }

  function eventById(id) {
    return (CFG.dailyEvents || []).find(e => e.id === id) || null;
  }

  /* ------------------------------ 龙王契约 ------------------------------ */

  function hasDragon(id) {
    return !!(run && Array.isArray(run.dragons) && run.dragons.indexOf(id) >= 0);
  }

  // 本局累计破碎层数：每次锻造按剑当时的层数累加，只增不减
  function dragonLayers() {
    return run ? Math.max(0, Math.floor(Number(run.dragonLayers) || 0)) : 0;
  }

  // 契约总天数：开局设置，断日龙会缩短
  function totalDays() {
    const v = Math.round(Number(run && run.totalDays) || B.maxDays);
    return clamp(v, 1, 999);
  }

  // 怒气上限：噬魂龙压到 1
  function angerCap() {
    return hasDragon('soul') ? 1 : Math.max(1, Math.floor(Number(B.maxAnger) || 1));
  }

  // 柜台槽位：锁链龙会削减
  function counterCap() {
    const base = Math.max(1, Math.floor(Number(B.maxCounter) || 5));
    if (!hasDragon('shackle')) return base;
    return clamp(3 - Math.floor(dragonLayers() / 40), 1, base);
  }

  // 所有龙负面聚合成一份修正表（数值随累计层数增长）
  function dragonMods() {
    const L = dragonLayers();
    const out = {
      quotaMult: 1,
      quotaDayPct: 0,
      breakAdd: 0,
      angerCap: angerCap(),
      failureAnger: 1,
      noGuard: false,
      frostPct: 0,
      damageExtra: 0,
      damageToBreak: 0,
      crackThreshold: 0,
      chainBreak: 0,
      consumeSwords: 0,
      supplyPenalty: 0,
      newLevelCap: Infinity,
      newLevelPenalty: 0,
      disableNewLevelRelics: false,
      counterCap: counterCap(),
      tributeRackLoss: 0,
      frenzyBanned: false,
      frenzyChargeAdd: 0,
      frenzySecondsSub: 0,
      frenzyBreakPct: 0,
      goldTax: 0,
      relicCostMult: 1,
      offersCap: 4,
      refreshCap: 0,
      buyBanned: false,
      relicEffectMult: 1,
      hideLevels: 0,
      hideOdds: false,
      resultDelay: 0,
      tributeValueMult: 1,
      sealedCount: 0,
      swingSlow: 1
    };
    if (!run) return out;
    if (hasDragon('doom')) out.quotaMult *= 1 + 0.45 + 0.005 * L;
    if (hasDragon('erode')) out.quotaDayPct += 0.12 + 0.004 * L;
    if (hasDragon('feast')) out.quotaMult *= 1 + (run.dragonTributeStacks || 0) * (0.10 + 0.003 * L);
    if (hasDragon('soul')) out.quotaMult *= 1 + Math.floor(L / 20) * 0.04;
    if (hasDragon('blood')) out.failureAnger = 2 + Math.floor(L * 0.02);
    if (hasDragon('nopardon')) { out.noGuard = true; out.quotaMult *= 1 + Math.floor(L / 20) * 0.04; }
    if (hasDragon('frost')) out.frostPct = Math.min(1, 0.5 + 0.005 * L);
    if (hasDragon('reverse')) out.breakAdd += 0.25 + 0.005 * L;
    if (hasDragon('bone')) out.breakAdd += Math.floor(L / 20) * 0.10;
    if (hasDragon('fester')) {
      out.damageExtra = 2;
      out.damageToBreak = Math.min(0.9, 0.3 + 0.004 * L);
    }
    if (hasDragon('crack')) out.crackThreshold = Math.max(1, 3 - Math.floor(L / 20));
    if (hasDragon('chain')) out.chainBreak = 1 + Math.floor(L / 25);
    if (hasDragon('starve')) out.consumeSwords = 1 + Math.floor(L / 25);
    if (hasDragon('hollow')) {
      out.supplyPenalty = 1;
      out.newLevelCap = Math.max(0, 3 - Math.floor(L / 30));
    }
    if (hasDragon('barren')) {
      out.newLevelPenalty = 2 + Math.floor(L / 20);
      out.disableNewLevelRelics = true;
    }
    if (hasDragon('toll')) out.tributeRackLoss = 1 + Math.floor(L / 25);
    if (hasDragon('wither')) { out.frenzyBanned = true; out.quotaMult *= 1 + Math.floor(L / 20) * 0.04; }
    if (hasDragon('mire')) out.swingSlow = Math.min(3.5, 1.7 + 0.01 * L);
    if (hasDragon('chaos')) {
      out.frenzyChargeAdd = 6 + Math.floor(L / 20);
      out.frenzySecondsSub = 2;
    }
    if (hasDragon('hex')) out.frenzyBreakPct = Math.min(0.9, 0.2 + 0.005 * L);
    if (hasDragon('tax')) {
      out.goldTax = Math.min(0.9, 0.3 + 0.003 * L);
      out.relicCostMult *= 1.5;
    }
    if (hasDragon('emptybox')) {
      out.offersCap = 1;
      out.refreshCap = 1;
      out.relicCostMult *= 1 + Math.floor(L / 20) * 0.15;
    }
    if (hasDragon('buyban')) { out.buyBanned = true; out.quotaMult *= 1 + Math.floor(L / 20) * 0.04; }
    if (hasDragon('rot')) out.relicEffectMult = Math.max(0.2, 0.5 - 0.05 * Math.floor(L / 25));
    if (hasDragon('mist')) out.hideLevels = 1 + Math.floor(L / 15);
    if (hasDragon('blind')) { out.hideOdds = true; out.resultDelay = 1 + Math.floor(L / 20) * 0.4; }
    if (hasDragon('scale')) out.tributeValueMult = Math.max(0.2, 0.7 - 0.005 * L);
    if (hasDragon('fickle')) out.sealedCount = 2 + Math.floor(L / 25);
    return out;
  }

  function dragonById(id) {
    return (CFG.dragons || []).find(d => d.id === id) || null;
  }

  // 开局界面预览契约天数（断日龙会缩短）
  function chosenDaysPreview() {
    let d = clamp(Math.round(Number(chosenDays) || B.maxDays), 5, 99);
    if (chosenDragons.indexOf('shortday') >= 0) d = Math.max(5, Math.round(d * 0.7));
    return d;
  }

  // 当天贡额：基础曲线 × 遗物贡额倍率 × 难度 × 龙王
  function quotaFor(day) {
    const mult = currentDifficulty().quotaMult || 1;
    const dm = dragonMods();
    const steps = Math.floor((Math.max(1, day || 1) - 1) / 5);
    const dragonMult = dm.quotaMult * (1 + steps * dm.quotaDayPct);
    return Math.round(CFG.quotaForDay(day, totalDays()) * relicStats.quotaMult * mult * dragonMult / 10) * 10;
  }

  function baseValue(level) {
    return B.baseValue * Math.pow(B.valueGrowth, Math.max(0, level));
  }

  function emptyStats() {
    return {
      successBonus: 0,
      breakMult: 1,
      tickets: { break: 0, damage: 0, hold: 0, success: 0, great: 0 },
      greatExtra: 0,
      greatValue: 2.5,
      damageRestore: 0,
      damageFlat: 0,
      inheritOnBreak: 0,
      scrapGold: 0,
      shield: 0,
      quotaMult: 1,
      extraSword: 0,
      frenzyBonus: 0,
      chargeBonus: 0,
      holdValue: 0,
      valueMult: 0,
      merchantDiscount: 0,
      refreshDiscount: 0,
      tributeGold: 0,
      nextSwordLevel: 0,
      startHeated: false,
      dailyGold: 0,
      frenzyCost: 0,
      greatCharge: 0,
      firstBreakGuard: 0,
      inheritCharge: 0,
      successEvery2Level: 0,
      highLevelSuccessValue: 0,
      frenzyGreatTickets: 0,
      duplicateChance: 0,
      holdFlat: 0,
      damageGuard: 0,
      funeralSword: 0,
      flatTickets: 0,
      excessCarry: 0,
      excessCap: 0,
      pardon: 0,
      extraMerchant: 0,
      damageBreakCut: 0,
      damageBreakCap: 0,
      damageToShield: 0,
      breakWeightFlat: 0,
      breakOnHighLossMark: 0,
      highLevelBreakCut: 0,
      breakValueResist: 0,
      dailyBreakGuard: 0,
      autoHammer: 0,
      lowLevelBreakCut: 0,
      holdBreakCut: 0,
      holdBreakCap: 0,
      successShield: 0,
      breakTierCut: 0,
      breakChanceFlat: 0,
      frenzyTierCut: 0,
      frenzyGreatCharge: 0,
      frenzyTimeCut: 0,
      phantomHammer: 0,
      elfCarry: 0
    };
  }

  function collectStats() {
    const out = emptyStats();
    if (!run) return out;
    // 诡龙：每天被封印的遗物当天不提供任何效果
    const sealed = hasDragon('fickle') ? new Set(run.dragonSealed || []) : null;
    for (const id of run.relics) {
      if (sealed && sealed.has(id)) continue;
      const relic = CFG.relics.find(r => r.id === id);
      if (!relic) continue;
      const e = relic.effects || {};
      if (e.successBonus) out.successBonus += e.successBonus;
      if (e.breakMult) out.breakMult *= e.breakMult;
      if (e.tickets) {
        for (const k of Object.keys(e.tickets)) out.tickets[k] += e.tickets[k] || 0;
      }
      if (e.greatExtra) out.greatExtra += e.greatExtra;
      // 大成功倍率按“额外倍率”叠加，重复购买同一遗物也能继续提升
      if (e.greatValue) out.greatValue += (e.greatValue - 2.5);
      if (e.damageRestore) out.damageRestore += e.damageRestore;
      if (e.damageFlat) out.damageFlat += e.damageFlat;
      if (e.inheritOnBreak) out.inheritOnBreak += e.inheritOnBreak;
      if (e.scrapGold) out.scrapGold += e.scrapGold;
      if (e.shield) out.shield += e.shield;
      if (e.quotaMult) out.quotaMult *= e.quotaMult;
      if (e.extraSword) out.extraSword += e.extraSword;
      if (e.frenzyBonus) out.frenzyBonus += e.frenzyBonus;
      if (e.chargeBonus) out.chargeBonus += e.chargeBonus;
      if (e.holdValue) out.holdValue += e.holdValue;
      if (e.valueMult) out.valueMult += e.valueMult;
      if (e.merchantDiscount) out.merchantDiscount += e.merchantDiscount;
      if (e.refreshDiscount) out.refreshDiscount += e.refreshDiscount;
      if (e.tributeGold) out.tributeGold += e.tributeGold;
      if (e.nextSwordLevel) out.nextSwordLevel += e.nextSwordLevel;
      if (e.startHeated) out.startHeated = true;
      if (e.dailyGold) out.dailyGold += e.dailyGold;
      if (e.frenzyCost) out.frenzyCost += e.frenzyCost;
      if (e.greatCharge) out.greatCharge += e.greatCharge;
      if (e.firstBreakGuard) out.firstBreakGuard += e.firstBreakGuard;
      if (e.inheritCharge) out.inheritCharge += e.inheritCharge;
      if (e.successEvery2Level) out.successEvery2Level += e.successEvery2Level;
      if (e.highLevelSuccessValue) out.highLevelSuccessValue += e.highLevelSuccessValue;
      if (e.frenzyGreatTickets) out.frenzyGreatTickets += e.frenzyGreatTickets;
      if (e.duplicateChance) out.duplicateChance += e.duplicateChance;
      if (e.holdFlat) out.holdFlat += e.holdFlat;
      if (e.damageGuard) out.damageGuard += e.damageGuard;
      if (e.funeralSword) out.funeralSword += e.funeralSword;
      if (e.flatTickets) out.flatTickets = Math.max(out.flatTickets, e.flatTickets);
      if (e.excessCarry) out.excessCarry += e.excessCarry;
      if (e.excessCap) out.excessCap += e.excessCap;
      if (e.pardon) out.pardon += e.pardon;
      if (e.extraMerchant) out.extraMerchant += e.extraMerchant;
      if (e.damageBreakCut) out.damageBreakCut += e.damageBreakCut;
      if (e.damageBreakCap) out.damageBreakCap += e.damageBreakCap;
      if (e.damageToShield) out.damageToShield += e.damageToShield;
      if (e.breakWeightFlat) out.breakWeightFlat += e.breakWeightFlat;
      if (e.breakOnHighLossMark) out.breakOnHighLossMark += e.breakOnHighLossMark;
      if (e.highLevelBreakCut) out.highLevelBreakCut += e.highLevelBreakCut;
      if (e.breakValueResist) out.breakValueResist = Math.max(out.breakValueResist, e.breakValueResist);
      if (e.dailyBreakGuard) out.dailyBreakGuard += e.dailyBreakGuard;
      if (e.autoHammer) out.autoHammer += e.autoHammer;
      if (e.lowLevelBreakCut) out.lowLevelBreakCut += e.lowLevelBreakCut;
      if (e.holdBreakCut) out.holdBreakCut += e.holdBreakCut;
      if (e.holdBreakCap) out.holdBreakCap += e.holdBreakCap;
      if (e.successShield) out.successShield += e.successShield;
      if (e.breakTierCut) out.breakTierCut += e.breakTierCut;
      if (e.breakChanceFlat) out.breakChanceFlat += e.breakChanceFlat;
      if (e.frenzyTierCut) out.frenzyTierCut += e.frenzyTierCut;
      if (e.frenzyGreatCharge) out.frenzyGreatCharge += e.frenzyGreatCharge;
      if (e.frenzyTimeCut) out.frenzyTimeCut += e.frenzyTimeCut;
      if (e.phantomHammer) out.phantomHammer += e.phantomHammer;
      if (e.elfCarry) out.elfCarry += e.elfCarry;
    }
    // 遗物套装：集齐整套时追加效果
    if (run && CFG.relicSets) {
      const owned = new Set(run.relics.filter(id => !sealed || !sealed.has(id)));
      for (const set of CFG.relicSets) {
        if (!set.relics.every(id => owned.has(id))) continue;
        const b = set.bonus || {};
        if (b.successBonus) out.successBonus += b.successBonus;
        if (b.breakChanceFlat) out.breakChanceFlat += b.breakChanceFlat;
        if (b.inheritOnBreak) out.inheritOnBreak = Math.max(out.inheritOnBreak, b.inheritOnBreak);
        if (b.frenzyTierCut) out.frenzyTierCut = Math.max(out.frenzyTierCut, b.frenzyTierCut);
        if (b.phantomExtra) out.phantomHammer += b.phantomExtra;
      }
    }
    // 重复购买后也保持数值可控
    out.damageRestore = Math.min(1, out.damageRestore);
    out.inheritOnBreak = Math.min(1, out.inheritOnBreak);
    out.scrapGold = Math.min(1, out.scrapGold);
    out.merchantDiscount = Math.min(0.9, out.merchantDiscount);
    out.refreshDiscount = Math.min(0.9, out.refreshDiscount);
    out.duplicateChance = Math.min(0.4, out.duplicateChance);
    out.damageGuard = Math.min(4, out.damageGuard);
    out.damageBreakCap = Math.min(0.9, out.damageBreakCap);
    out.highLevelBreakCut = Math.min(0.75, out.highLevelBreakCut);
    out.excessCap = Math.min(0.6, out.excessCap);
    out.extraMerchant = Math.min(2, out.extraMerchant);
    out.pardon = Math.min(3, out.pardon);
    out.funeralSword = Math.min(2, out.funeralSword);
    out.autoHammer = Math.min(2, out.autoHammer);
    out.lowLevelBreakCut = Math.min(0.7, out.lowLevelBreakCut);
    out.holdBreakCap = Math.min(0.4, out.holdBreakCap);
    out.successShield = Math.min(2, out.successShield);
    out.breakTierCut = Math.min(0.9, out.breakTierCut);
    out.breakChanceFlat = Math.max(-0.3, out.breakChanceFlat);
    out.frenzyTierCut = Math.min(1, out.frenzyTierCut);
    out.frenzyTimeCut = Math.min(0.95, out.frenzyTimeCut);
    out.frenzyGreatCharge = Math.min(3, out.frenzyGreatCharge);
    // 腐化龙：所有遗物效果整体缩放
    const relicFactor = dragonMods().relicEffectMult;
    if (relicFactor < 1) scaleRelicStats(out, relicFactor);
    return out;
  }

  // 腐化龙用：加法项直接乘系数，倍率项按「超出 1 的部分」乘
  const RELIC_SCALE_FIELDS = [
    'successBonus', 'greatExtra', 'damageRestore', 'damageFlat', 'inheritOnBreak', 'scrapGold', 'shield',
    'extraSword', 'frenzyBonus', 'chargeBonus', 'holdValue', 'valueMult', 'merchantDiscount', 'refreshDiscount',
    'tributeGold', 'nextSwordLevel', 'dailyGold', 'frenzyCost', 'greatCharge', 'firstBreakGuard', 'inheritCharge',
    'successEvery2Level', 'highLevelSuccessValue', 'frenzyGreatTickets', 'duplicateChance', 'holdFlat', 'damageGuard',
    'funeralSword', 'excessCarry', 'excessCap', 'pardon', 'extraMerchant', 'damageBreakCut', 'damageBreakCap',
    'damageToShield', 'breakWeightFlat', 'breakOnHighLossMark', 'highLevelBreakCut', 'breakValueResist',
    'dailyBreakGuard', 'autoHammer', 'lowLevelBreakCut', 'holdBreakCut', 'holdBreakCap', 'successShield',
    'breakTierCut', 'breakChanceFlat', 'frenzyTierCut', 'frenzyGreatCharge', 'frenzyTimeCut', 'phantomHammer', 'elfCarry'
  ];

  function scaleRelicStats(out, f) {
    for (const k of RELIC_SCALE_FIELDS) {
      if (typeof out[k] === 'number') out[k] *= f;
    }
    for (const k of Object.keys(out.tickets)) out.tickets[k] *= f;
    out.breakMult = 1 + (out.breakMult - 1) * f;
    out.quotaMult = 1 + (out.quotaMult - 1) * f;
    out.greatValue = 2.5 + (out.greatValue - 2.5) * f;
    out.flatTickets = Math.floor(out.flatTickets * f);
    ['shield', 'extraSword', 'nextSwordLevel', 'firstBreakGuard', 'pardon', 'extraMerchant', 'funeralSword',
      'dailyBreakGuard', 'autoHammer', 'successShield', 'phantomHammer', 'elfCarry', 'frenzyGreatCharge'
    ].forEach(k => { out[k] = Math.floor(out[k]); });
  }

  function breakProbability(level) {
    const tab = CFG.breakTable;
    let p;
    if (level <= tab[0][0]) {
      p = tab[0][1];
    } else {
      p = tab[tab.length - 1][1];
      for (let i = 1; i < tab.length; i++) {
        if (level <= tab[i][0]) {
          const [l0, p0] = tab[i - 1];
          const [l1, p1] = tab[i];
          p = p0 + (p1 - p0) * (level - l0) / (l1 - l0);
          break;
        }
      }
    }
    // 高等级叠层：超过起始等级后每若干级加一层破坏概率，可被遗物削减
    const layers = breakLayersFor(level);
    if (layers > 0) {
      const cut = 1 - clamp(relicStats.breakTierCut || 0, 0, 0.9);
      p += layers * (Number(B.breakTierChance) || 0) * cut;
    }
    // 遗物直接削减破坏概率
    p += relicStats.breakChanceFlat || 0;
    // 龙王：破碎概率随本局累计层数上涨（封顶 99%，避免必碎）
    const dm = dragonMods();
    if (dm.breakAdd > 0) p = Math.min(0.99, Math.max(0, p) + dm.breakAdd);
    // 不在 99% 提前封顶：高等级叠层会继续累加破坏签，不会被遗物的固定削减吃成 0
    return Math.max(0, p);
  }

  // 等级叠层数：达到起始等级后，每 breakTierStep 级叠 1 层（骨龙让层数翻倍）
  function breakLayersFor(level) {
    const start = Number(B.breakTierStart) || 0;
    const step = Math.max(1, Number(B.breakTierStep) || 1);
    const chance = Number(B.breakTierChance) || 0;
    if (!start || !chance || level < start) return 0;
    let n = Math.floor((level - start) / step) + 1;
    if (hasDragon('bone')) n *= 2;
    return n;
  }

  function oddsFor(s) {
    const st = relicStats;
    const level = s ? (s.level || 0) : 0;
    const cracks = s ? (s.cracks || 0) : 0;
    const dayGreat = run ? (run.greatTicketsToday || 0) : 0;
    const frenzyGreat = frenzy.active ? st.frenzyGreatTickets : 0;
    let w;

    if (st.flatTickets > 0) {
      // 镰刀与锤子：所有结果的基础签数固定
      const base = st.flatTickets;
      // 基础签数固定，但高等级叠层 / 遗物削减依旧要生效，否则破坏率会被锁死
      let breakW = base + (st.tickets.break || 0) + st.breakWeightFlat + (run ? (run.breakWeightBonus || 0) : 0);
      breakW *= st.breakMult || 1;
      const layers = breakLayersFor(level);
      if (layers > 0) {
        const cut = 1 - clamp(st.breakTierCut || 0, 0, 0.9);
        breakW += layers * (Number(B.breakTierChance) || 0) * 100 * cut;
      }
      breakW += (st.breakChanceFlat || 0) * 100;
      // 龙王附加破碎
      const dmFlat = dragonMods();
      if (dmFlat.breakAdd > 0) breakW += dmFlat.breakAdd * 100;
      if (level >= 6 && st.highLevelBreakCut > 0) breakW *= 1 - st.highLevelBreakCut;
      if (level < 7 && st.lowLevelBreakCut > 0) breakW *= 1 - st.lowLevelBreakCut;
      w = {
        break: Math.max(0, breakW),
        damage: base + (st.tickets.damage || 0),
        hold: base + (st.tickets.hold || 0),
        success: base + (st.tickets.success || 0),
        great: base + (st.tickets.great || 0) + dayGreat + frenzyGreat
      };
      if (frenzy.active) w.break = 0;
    } else {
      let breakW = breakProbability(level) * 100 * st.breakMult;
      breakW += st.breakWeightFlat + (run ? (run.breakWeightBonus || 0) : 0);
      if (level >= 6 && st.highLevelBreakCut > 0) breakW *= 1 - st.highLevelBreakCut;
      if (level < 7 && st.lowLevelBreakCut > 0) breakW *= 1 - st.lowLevelBreakCut;
      if (cracks > 0 && st.damageBreakCut > 0) {
        breakW *= 1 - Math.min(st.damageBreakCap, cracks * st.damageBreakCut);
      }
      if (s && s.holdStreak > 0 && st.holdBreakCut > 0) {
        breakW *= 1 - Math.min(st.holdBreakCap, s.holdStreak * st.holdBreakCut);
      }
      if (frenzy.active) breakW = 0;
      breakW = Math.max(0, breakW);

      const rest = 100 - breakW;
      const share = CFG.nonBreakShare;
      w = {
        break: breakW,
        damage: rest * share.damage + (st.tickets.damage || 0),
        hold: rest * share.hold + (st.tickets.hold || 0),
        success: rest * share.success + (st.tickets.success || 0),
        great: rest * share.great + (st.tickets.great || 0) + dayGreat + frenzyGreat
      };
    }

    // 剑形被动影响签数
    const tr = s ? formTrait(s) : null;
    if (tr) {
      if (tr.holdWeight) w.hold *= tr.holdWeight;
      if (tr.breakDelta) w.break = Math.max(0, w.break + tr.breakDelta * 100);
    }

    if (run && run.greatDouble > 0) w.great *= 2;
    for (const k of Object.keys(w)) w[k] = Math.max(k === 'break' ? 0 : 0.5, w[k]);
    const total = w.break + w.damage + w.hold + w.success + w.great;
    const pct = {};
    for (const k of Object.keys(w)) pct[k] = total > 0 ? (w[k] / total) * 100 : 0;
    return { w, total, pct };
  }

  function drawOutcome(odds) {
    let r = Math.random() * odds.total;
    for (const k of ['break', 'damage', 'hold', 'success', 'great']) {
      r -= odds.w[k];
      if (r <= 0) return k;
    }
    return 'success';
  }

  function isMerchantDay(day) {
    const every = Math.max(1, B.merchantEvery | 0);
    return day >= every && day % every === 0;
  }

  // 入神所需充能：烟肺等遗物可以减少；高等级会让所需格子逐渐变多
  function frenzyNeed() {
    const base = Math.max(1, Math.round(B.frenzyCharge - (relicStats.frenzyCost || 0)));
    const s = anvilSword();
    return base + frenzyTierBonus(s ? s.level : 0) + dragonMods().frenzyChargeAdd;
  }

  // 0..1 的确定性伪随机：同一个等级永远得到同一个结果，避免面板数字来回跳
  function hash01(n) {
    const x = Math.sin(n * 9.7 + 41.3) * 43758.5453;
    return x - Math.floor(x);
  }

  // 高等级额外要的入神格子：每 stride 级判定一次，命中一次 +1 格
  function frenzyTierBonus(level) {
    const stride = Math.max(1, Math.floor(Number(B.frenzyTierStride) || 10));
    const base = clamp(Number(B.frenzyTierChance) || 0, 0, 1);
    const cut = clamp(relicStats.frenzyTierCut || 0, 0, 0.95);
    const chance = base * (1 - cut);
    const nodes = Math.floor(Math.max(0, level) / stride);
    if (!nodes || chance <= 0) return 0;
    let n = 0;
    for (let i = 1; i <= nodes; i++) if (hash01(i) < chance) n += 1;
    return n;
  }

  // 高等级入神时长缩短：每 frenzyTimeStride 级判定一次，命中一次少 frenzyTimeStep 秒
  function frenzyTimeLoss(level) {
    const stride = Math.max(1, Math.floor(Number(B.frenzyTimeStride) || 25));
    const base = clamp(Number(B.frenzyTimeChance) || 0, 0, 1);
    const step = Math.max(0.01, Number(B.frenzyTimeStep) || 0.1);
    const cut = clamp(relicStats.frenzyTimeCut || 0, 0, 0.95);
    const chance = base * (1 - cut);
    const nodes = Math.floor(Math.max(0, level) / stride);
    if (!nodes || chance <= 0) return 0;
    let n = 0;
    // 与“格子”判定错开，避免同一等级两件事同时发生
    for (let i = 1; i <= nodes; i++) if (hash01(i + 97) < chance) n += step;
    return Math.round(n * 10) / 10;
  }

  // 这把剑进入入神时的持续时间（至少 1 秒）
  function frenzySecondsFor(level) {
    const base = B.frenzySeconds + relicStats.frenzyBonus - frenzyTimeLoss(level || 0) - dragonMods().frenzySecondsSub;
    return Math.max(1, Math.round(base * 10) / 10);
  }

  function ensureFrenzyPips() {
    if (!UI.fpPips) return;
    const need = frenzyNeed();
    // 格子太多会撑爆面板：最多画 24 个，详情看右侧数字
    const shown = Math.min(need, 24);
    const sig = shown + ':' + need;
    if (UI.fpPips.dataset.sig === sig) return;
    UI.fpPips.dataset.sig = sig;
    UI.fpPips.innerHTML = '';
    for (let i = 0; i < shown; i++) {
      const p = document.createElement('i');
      p.className = 'pip';
      UI.fpPips.appendChild(p);
    }
    UI.fpPips.classList.toggle('dense', need > 14);
  }

  // 剑值统一用 log10 存储（s.lv），避免 1.5^等级 把 Number 撑爆成 Infinity
  function baseValueLog(level) {
    const g = Math.max(1.0000001, Number(B.valueGrowth) || 1.5);
    return Math.log10(Math.max(1, Number(B.baseValue) || 1)) + Math.max(0, level) * Math.log10(g);
  }

  // 10^a + 10^b 的对数，用于合计贡品价值
  function logAdd(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    const d = lo - hi;
    return d < -12 ? hi : hi + Math.log10(1 + Math.pow(10, d));
  }

  function fmtLog(l) {
    return CFG.fmtLog(l, lang);
  }

  function effective(s) {
    if (!s) return 0;
    const dayBonus = run ? (run.valueBonusToday || 0) : 0;
    const mult = Math.max(0.0001, 1 + relicStats.valueMult + dayBonus);
    return (s.lv || 0) + Math.log10(mult);
  }

  function swordName(s) {
    const prefix = CFG.namePrefix[clamp(s.p | 0, 0, CFG.namePrefix.length - 1)];
    const noun = CFG.nameNoun[clamp(s.n | 0, 0, CFG.nameNoun.length - 1)];
    return lang === 'zh' ? `${prefix.zh}·${noun.zh}` : `${prefix.en} ${noun.en}`;
  }

  function formForNoun(n) {
    return CFG.swordForms[clamp(n | 0, 0, CFG.swordForms.length - 1)] || 'longsword';
  }

  // 剑形被动：同一种剑形固定一个特性
  function formTrait(s) {
    if (!s || !s.form) return null;
    return (CFG.formTraits && CFG.formTraits[s.form]) || null;
  }

  function relicById(id) {
    return CFG.relics.find(r => r.id === id) || null;
  }

  function relicCount(id) {
    if (!run || !run.relics) return 0;
    return run.relics.filter(x => x === id).length;
  }

  function relicCounts() {
    const map = {};
    if (run && run.relics) {
      run.relics.forEach(id => { map[id] = (map[id] || 0) + 1; });
    }
    return map;
  }

  function relicGlyph(relic) {
    if (!relic) return '';
    if (lang === 'zh') {
      const idx = CFG.relics.findIndex(r => r.id === relic.id);
      return CFG.relicGlyphsZh[idx] || relic.glyph;
    }
    return relic.glyph;
  }

  function itemById(id) {
    return CFG.merchantItems.find(i => i.id === id) || null;
  }

  /* ------------------------------ 永久解锁 / 成就 ------------------------------ */

  function loadUnlocks() {
    try {
      const raw = localStorage.getItem(CFG.unlockKey || 'forgeTax.unlocks.v1');
      if (!raw) return;
      const o = JSON.parse(raw);
      unlocks = {
        achievements: (o && o.achievements) || {},
        relics: (o && o.relics) || {},
        bestForm: (o && o.bestForm) || {},
        swings: Math.max(0, Math.floor(Number(o && o.swings) || 0))
      };
    } catch (err) {
      unlocks = { achievements: {}, relics: {}, bestForm: {}, swings: 0 };
    }
  }

  function saveUnlocks() {
    try {
      localStorage.setItem(CFG.unlockKey || 'forgeTax.unlocks.v1', JSON.stringify(unlocks));
    } catch (err) {
      /* 忽略 */
    }
  }

  function availableRelicIds() {
    return CFG.relics.filter(r => !r.ach || unlocks.relics[r.id]).map(r => r.id);
  }

  function achievementValue(a) {
    if (a.form) return unlocks.bestForm[a.form] || 0;
    if (a.kind === 'globalSwings') return unlocks.swings || 0;
    if (!run) return 0;
    const A = run.ach || {};
    switch (a.kind) {
      case 'win': return A.won ? 1 : 0;
      case 'runBreak': return A.breaks || 0;
      case 'runFrenzy': return A.frenzies || 0;
      case 'runTriple': return A.triples || 0;
      case 'runFinalAnger': return A.finalAnger || 0;
      case 'runMerchantClear': return A.merchantClears || 0;
      case 'runFullTribute': return A.fullTributes || 0;
      case 'runFirstTribute': return A.firstTribute || 0;
      case 'runRelicKinds': return new Set(run.relics || []).size;
      default: return 0;
    }
  }

  function unlockAchievement(a) {
    if (!a || unlocks.achievements[a.id]) return;
    unlocks.achievements[a.id] = true;
    let relic = null;
    if (a.relic) {
      unlocks.relics[a.relic] = true;
      relic = relicById(a.relic);
    }
    saveUnlocks();
    toast(t('achUnlockedToast', { name: a[lang] }), 'good');
    if (audio) audio.great();
    if (relic) {
      setTimeout(() => toast(t('achRelicJoin', { name: relic[lang] }), 'good'), 900);
    }
  }

  function checkAchievements() {
    let changed = false;
    for (const a of CFG.achievements || []) {
      if (unlocks.achievements[a.id]) continue;
      if (achievementValue(a) >= (a.target || 1)) {
        unlockAchievement(a);
        changed = true;
      }
    }
    return changed;
  }

  function rememberSwordLevel(s) {
    if (!s || !s.form) return;
    const best = unlocks.bestForm[s.form] || 0;
    if (s.level > best) {
      unlocks.bestForm[s.form] = s.level;
      saveUnlocks();
      checkAchievements();
    }
  }

  function newRunState() {
    return {
      day: 1,
      anger: 0,
      gold: 0,
      swords: [],
      relics: [],
      // 被消耗 1 把剑封禁的遗物：本局不再出现在售货机
      banned: [],
      items: {},
      offers: [],
      merchantStock: [],
      shields: 0,
      anvilId: null,
      heldId: null,
      quota: 0,
      starterChosen: false,
      over: null,
      refreshes: 0,
      nextId: 1,
      inheritLevel: 0,
      forceGreat: 0,
      valueBonusToday: 0,
      greatTicketsToday: 0,
      lastSupply: 0,
      breakWeightBonus: 0,
      damageMeter: 0,
      // 免碎裂次数（线缠剑鞘）：每天补充，当天没用完的累积到第二天
      dailyBreakGuard: 0,
      funeralBonus: 0,
      quotaCarry: 0,
      nextSwordCharge: 0,
      nextSupplyBonus: 0,
      crackedScale: 0,
      greatDouble: 0,
      powderBag: 0,
      // 小精灵自动收剑：交互后打开，会把地上的剑一把把送进售货机
      elfOn: false,
      // 难度与当天的随机事件
      difficulty: 'normal',
      dayEvent: null,
      // 龙王契约：开局选中的龙、累计破碎层数、契约总天数、当天被封印的遗物
      dragons: [],
      dragonLayers: 0,
      dragonTributeStacks: 0,
      dragonSealed: [],
      totalDays: B.maxDays,
      swingSnapshot: null,
      pardonUsed: 0,
      ach: {
        won: 0,
        breaks: 0,
        frenzies: 0,
        triples: 0,
        finalAnger: 0,
        merchantClears: 0,
        fullTributes: 0,
        firstTribute: 0
      },
      record: { bestValueLog: 0, totalGold: 0, maxDay: 1 }
    };
  }

  function rackCount() {
    return run ? run.swords.filter(s => s.location === 'rack').length : 0;
  }

  function counterSwords() {
    return run ? run.swords.filter(s => s.location === 'counter') : [];
  }

  function anvilSword() {
    if (!run || !run.anvilId) return null;
    return getSword(run.anvilId);
  }

  function heldSword() {
    if (!run || !run.heldId) return null;
    return getSword(run.heldId);
  }

  // 已存入售货机的剑：只有这些剑能用来换遗物
  function machineSwords() {
    return run ? run.swords.filter(s => s.location === 'machine') : [];
  }

  // 剑架放不下、落在地上的剑（与场景里的落地剑判定一致）
  function floorSwords() {
    if (!run) return [];
    return run.swords.filter(s => s.location === 'rack' &&
      !(Number.isInteger(s.rackSlot) && s.rackSlot >= 0 && s.rackSlot < 36));
  }

  // 地上剑超过 1000 把时，全部自动收进售货机，避免场景里堆几千把
  const FLOOR_BANK_LIMIT = 1000;
  function bankFloorSwords() {
    if (!run || run.over) return 0;
    const floor = floorSwords();
    if (floor.length <= FLOOR_BANK_LIMIT) return 0;
    for (const s of floor) {
      s.location = 'machine';
      s.rackSlot = -1;
      s.counterSlot = -1;
    }
    saveGame();
    syncWorld();
    updateHUD();
    toast(L(
      `地上的剑超过 ${FLOOR_BANK_LIMIT} 把，已全部送进售货机`,
      `Over ${FLOOR_BANK_LIMIT} blades on the floor — all sent to the machine`
    ), 'good');
    return floor.length;
  }

  function relicSwordCost(relic) {
    const base = Math.max(1, Math.floor(Number(relic && relic.swordCost) || 1));
    // 抽成龙 / 空匣龙：遗物涨价
    return Math.max(1, Math.round(base * dragonMods().relicCostMult));
  }

  function counterTotal() {
    let l = -Infinity;
    for (const s of counterSwords()) l = logAdd(l, effective(s));
    if (l === -Infinity) return 0;
    // 秤龙：上贡价值按比例结算
    const mult = dragonMods().tributeValueMult;
    return mult !== 1 ? l + Math.log10(mult) : l;
  }

  // 从剑架上随机收走 n 把剑（逆鳞龙 / 寒狱龙用）
  function takeRandomRackSwords(n) {
    if (!run) return 0;
    const pool = run.swords.filter(s => s.location === 'rack');
    const ids = new Set();
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      ids.add(pick.id);
    }
    if (!ids.size) return 0;
    run.swords = run.swords.filter(s => !ids.has(s.id));
    if (run.anvilId && ids.has(run.anvilId)) run.anvilId = null;
    if (run.heldId && ids.has(run.heldId)) run.heldId = null;
    return ids.size;
  }

  function getSword(id) {
    if (!run) return null;
    return run.swords.find(s => s.id === Number(id)) || null;
  }

  function addSword(extraLevel) {
    if (!run) return null;
    const dm = dragonMods();
    const relicLevel = dm.disableNewLevelRelics ? 0 : relicStats.nextSwordLevel;
    let level = Math.max(0, Math.floor(extraLevel || 0) + relicLevel - dm.newLevelPenalty);
    if (isFinite(dm.newLevelCap)) level = Math.min(level, dm.newLevelCap);
    const n = Math.floor(Math.random() * CFG.nameNoun.length);
    const rackUsed = new Set(run.swords.map(s => s.rackSlot).filter(v => Number.isInteger(v) && v >= 0));
    let rackSlot = -1;
    for (let i = 0; i < 36; i++) {
      if (!rackUsed.has(i)) { rackSlot = i; break; }
    }
    let counterSlot = -1;
    if (rackSlot < 0) {
      const counterUsed = new Set(run.swords.map(s => s.counterSlot).filter(v => Number.isInteger(v) && v >= 0));
      for (let i = 0; i < dm.counterCap; i++) {
        if (!counterUsed.has(i)) { counterSlot = i; break; }
      }
    }
    const location = rackSlot >= 0 ? 'rack' : counterSlot >= 0 ? 'counter' : 'rack';
    const startCharge = Math.min(B.frenzyCharge, run.nextSwordCharge || 0);
    run.nextSwordCharge = 0;
    const s = {
      id: run.nextId++,
      p: Math.floor(Math.random() * CFG.namePrefix.length),
      n,
      form: formForNoun(n),
      variant: Math.floor(Math.random() * 3),
      level,
      lv: baseValueLog(level),
      heated: !!relicStats.startHeated,
      location,
      rackSlot,
      counterSlot,
      cracks: 0,
      dragonCracks: 0,
      charge: startCharge,
      successCount: 0,
      freeDamage: 0,
      firstBreakUsed: false,
      phoenixUsed: false,
      holdStreak: 0
    };
    run.swords.push(s);
    if (location === 'rack' && rackSlot < 0) bankFloorSwords();
    return s;
  }

  function duplicateSword(src) {
    if (!src || !run) return null;
    // 剑架/贡台放不下也照常复制：多出来的剑会掉在地上（场景里有掉落表现）
    const copy = addSword(0);
    if (!copy) return null;
    copy.p = src.p;
    copy.n = src.n;
    copy.form = src.form;
    copy.variant = src.variant;
    copy.level = src.level;
    copy.lv = src.lv;
    copy.cracks = src.cracks;
    copy.heated = src.heated;
    copy.successCount = src.successCount || 0;
    copy.freeDamage = src.freeDamage || 0;
    copy.firstBreakUsed = !!src.firstBreakUsed;
    copy.phoenixUsed = !!src.phoenixUsed;
    copy.holdStreak = src.holdStreak || 0;
    return copy;
  }

  function breakGuardAvailable(s) {
    if (!s || !run) return false;
    // 死契龙：一切保命手段失效
    if (hasDragon('nopardon')) return false;
    if (run.shields > 0) return true;
    if (relicStats.firstBreakGuard > 0 && !s.firstBreakUsed) return true;
    if ((run.dailyBreakGuard || 0) > 0) return true;
    if (relicStats.breakValueResist > 0 && !s.phoenixUsed) return true;
    return false;
  }

  function rollOffers() {
    // 所有已解锁遗物（含开局遗物）都可能上架，且可重复购买；被封禁的除外
    const banned = new Set((run && run.banned) || []);
    const pool = availableRelicIds().filter(id => !banned.has(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // 空匣龙：售货机货位减少
    return pool.slice(0, Math.max(1, dragonMods().offersCap)).map(id => ({ relicId: id, sold: false }));
  }

  function rollMerchantStock() {
    const pool = CFG.merchantItems.map(i => i.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const slots = clamp(Math.floor(B.merchantSlots || 3) + (relicStats.extraMerchant || 0), 2, 6);
    return pool.slice(0, slots).map(id => {
      const item = CFG.merchantItems.find(i => i.id === id);
      const maxQty = item && item.cost <= 450 ? 3 : 2;
      const qty = 1 + Math.floor(Math.random() * maxQty);
      return { itemId: id, qty, sold: false };
    });
  }

  // 设置里改“每次几种货”后，当场调整今日货架数量（保留已买的）
  function resizeMerchantStock() {
    if (!run || run.over || !isMerchantDay(run.day)) return;
    const target = clamp(Math.floor(B.merchantSlots || 3) + (relicStats.extraMerchant || 0), 2, 6);
    while (run.merchantStock.length > target) {
      let idx = -1;
      for (let i = run.merchantStock.length - 1; i >= 0; i--) {
        if (!run.merchantStock[i].sold) { idx = i; break; }
      }
      if (idx < 0) break;
      run.merchantStock.splice(idx, 1);
    }
    while (run.merchantStock.length < target) {
      const used = new Set(run.merchantStock.map(e => e.itemId));
      const pool = CFG.merchantItems.filter(it => !used.has(it.id));
      if (!pool.length) break;
      const item = pool[Math.floor(Math.random() * pool.length)];
      const maxQty = item.cost <= 450 ? 3 : 2;
      run.merchantStock.push({
        itemId: item.id,
        qty: 1 + Math.floor(Math.random() * maxQty),
        sold: false
      });
    }
    saveGame();
    syncWorld();
    updateHUD();
    updatePrompt();
  }

  function refreshCost() {
    const base = B.refreshCost + (run ? run.refreshes : 0) * B.refreshGrowth;
    return Math.round(base * (1 - relicStats.refreshDiscount));
  }

  /* ------------------------------ 存档 ------------------------------ */

  function saveGame() {
    try {
      localStorage.setItem(CFG.saveKey, JSON.stringify({
        settings: { lang, sound: soundOn, langExplicit, volume, lowQuality },
        run
      }));
    } catch (e) { /* 忽略 */ }
  }

  // 导出/导入存档：把存档、解锁和调参一起打包成 JSON
  function exportSave() {
    if (run) saveGame();
    try {
      const payload = {
        save: JSON.parse(localStorage.getItem(CFG.saveKey) || 'null'),
        unlocks: JSON.parse(localStorage.getItem(CFG.unlockKey) || 'null'),
        config: JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'forgeTax-save.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(L('存档已导出', 'Save exported'), 'good');
    } catch (e) {
      toast(L('导出失败', 'Export failed'), 'danger');
    }
  }

  function importSaveFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.save) localStorage.setItem(CFG.saveKey, JSON.stringify(data.save));
        if (data.unlocks) localStorage.setItem(CFG.unlockKey, JSON.stringify(data.unlocks));
        if (data.config) localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
        location.reload();
      } catch (e) {
        toast(L('存档文件无法读取', 'Invalid save file'), 'danger');
      }
    };
    reader.readAsText(file);
  }

  function loadSaved() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(CFG.saveKey) || 'null');
    } catch (e) {
      data = null;
    }
    if (!data) return false;
    if (data.settings) {
      soundOn = data.settings.sound !== false;
      langExplicit = data.settings.langExplicit === true;
      if (typeof data.settings.volume === 'number') {
        volume = clamp(data.settings.volume, 0, 1);
      }
      lowQuality = data.settings.lowQuality === true;
      // 旧存档没有“用户主动切过语言”的标记，统一回到默认中文
      lang = langExplicit && data.settings.lang === 'en' ? 'en' : 'zh';
    }
    if (!data.run) return false;
    run = data.run;
    sanitizeRun();
    relicStats = collectStats();
    return true;
  }

  function sanitizeRun() {
    const base = newRunState();
    // 老存档没有免碎裂次数，只有「今天是否已用过」的布尔值：先把记号留下再套默认值
    const legacyGuardUsed = run.dailyBreakGuardUsed;
    const hasGuardPool = run.dailyBreakGuard !== undefined;
    run = Object.assign(base, run);
    // 龙王契约：校验选中的龙、契约天数与累计层数
    run.dragons = Array.isArray(run.dragons)
      ? run.dragons.filter(id => (CFG.dragons || []).some(d => d.id === id))
      : [];
    run.totalDays = clamp(Math.round(Number(run.totalDays) || B.maxDays), 5, 99);
    run.dragonLayers = Math.max(0, Math.floor(Number(run.dragonLayers) || 0));
    run.dragonTributeStacks = Math.max(0, Math.floor(Number(run.dragonTributeStacks) || 0));
    run.day = clamp(Number(run.day) || 1, 1, run.totalDays);
    run.anger = clamp(Number(run.anger) || 0, 0, angerCap());
    run.gold = Math.max(0, Math.floor(Number(run.gold) || 0));
    run.quota = Math.max(0, Math.floor(Number(run.quota) || 0));
    run.relics = Array.isArray(run.relics)
      ? run.relics.filter(id => CFG.relics.some(r => r.id === id))
      : [];
    run.dragonSealed = Array.isArray(run.dragonSealed)
      ? run.dragonSealed.filter(id => run.relics.indexOf(id) >= 0)
      : [];
    const items = {};
    if (run.items && typeof run.items === 'object') {
      for (const id of Object.keys(run.items)) {
        if (!CFG.merchantItems.some(i => i.id === id)) continue;
        const n = clamp(Math.floor(Number(run.items[id]) || 0), 0, 99);
        if (n > 0) items[id] = n;
      }
    }
    run.items = items;
    run.record = Object.assign({ bestValueLog: 0, totalGold: 0, maxDay: 1 }, run.record || {});
    // 旧存档的最佳剑值是普通数字，迁移成对数
    if (!(run.record.bestValueLog > 0) && Number(run.record.bestValue) > 0) {
      run.record.bestValueLog = Math.log10(Number(run.record.bestValue));
    }
    run.nextId = Math.max(1, Number(run.nextId) || 1);
    run.elfOn = !!run.elfOn;
    run.difficulty = difficultyById(run.difficulty) ? run.difficulty : 'normal';
    run.dayEvent = eventById(run.dayEvent) ? run.dayEvent : null;

    run.swords = (Array.isArray(run.swords) ? run.swords : []).filter(s => s && typeof s === 'object').map(s => {
      const level = clamp(Math.floor(Number(s.level) || 0), 0, levelCap());
      const n = clamp(Math.floor(Number(s.n) || 0), 0, CFG.nameNoun.length - 1);
      const loc = ['rack', 'anvil', 'counter', 'hand', 'machine'].includes(s.location)
        ? s.location
        // 存档时正被小精灵拿着：当作已经送进售货机
        : (s.location === 'elf' ? 'machine' : 'rack');
      return {
        id: Number(s.id) || run.nextId++,
        p: clamp(Math.floor(Number(s.p) || 0), 0, CFG.namePrefix.length - 1),
        n,
        form: s.form || formForNoun(n),
        variant: clamp(Math.floor(Number(s.variant) || 0), 0, 2),
        level,
        // 剑值用 log10 保存；旧存档的 value 是普通数字，这里迁移
        lv: Number.isFinite(Number(s.lv)) && Number(s.lv) >= 0
          ? Number(s.lv)
          : (Number(s.value) > 0 ? Math.log10(Number(s.value)) : baseValueLog(level)),
        heated: !!s.heated,
        location: loc,
        rackSlot: Number.isInteger(Number(s.rackSlot)) && Number(s.rackSlot) >= 0 ? Number(s.rackSlot) : -1,
        counterSlot: Number.isInteger(Number(s.counterSlot)) && Number(s.counterSlot) >= 0 ? Number(s.counterSlot) : -1,
        cracks: clamp(Math.floor(Number(s.cracks) || 0), 0, 5),
        dragonCracks: clamp(Math.floor(Number(s.dragonCracks) || 0), 0, 9),
        charge: clamp(Math.floor(Number(s.charge) || 0), 0, 999),
        successCount: Math.max(0, Math.floor(Number(s.successCount) || 0)),
        freeDamage: Math.max(0, Math.floor(Number(s.freeDamage) || 0)),
        firstBreakUsed: !!s.firstBreakUsed,
        phoenixUsed: !!s.phoenixUsed,
        holdStreak: Math.max(0, Math.floor(Number(s.holdStreak) || 0))
      };
    });
    run.nextId = Math.max(run.nextId, ...run.swords.map(s => s.id + 1), 1);

    // 固定槽位：旧存档或重复槽位重新分配，之后取放不再自动重排
    const usedRack = new Set();
    const usedCounter = new Set();
    // 存入售货机的剑不占用场景里的剑架/贡台槽位
    run.swords.forEach(s => {
      if (s.location !== 'machine') return;
      s.rackSlot = -1;
      s.counterSlot = -1;
    });
    run.swords.forEach(s => {
      if (s.location === 'machine') return;
      if (s.rackSlot < 0 || s.rackSlot > 35 || usedRack.has(s.rackSlot)) s.rackSlot = -1;
      else usedRack.add(s.rackSlot);
      if (s.counterSlot < 0 || s.counterSlot >= counterCap() || usedCounter.has(s.counterSlot)) s.counterSlot = -1;
      else usedCounter.add(s.counterSlot);
    });
    run.swords.forEach(s => {
      if (s.location === 'machine') return;
      if (s.rackSlot >= 0) return;
      let i = 0;
      while (i < 36 && usedRack.has(i)) i++;
      if (i < 36) { s.rackSlot = i; usedRack.add(i); }
    });
    run.swords.forEach(s => {
      if (s.location === 'machine') return;
      if (s.counterSlot >= 0) return;
      let i = 0;
      while (i < counterCap() && usedCounter.has(i)) i++;
      if (i < counterCap()) { s.counterSlot = i; usedCounter.add(i); }
    });

    // 一只手最多一把，其余回到剑架
    let held = null;
    run.swords.forEach(s => {
      if (s.location !== 'hand') return;
      if (held || (run.heldId && s.id !== run.heldId)) s.location = 'rack';
      else held = s;
    });
    run.heldId = held ? held.id : null;

    // 铁砧最多一把
    let anvil = null;
    run.swords.forEach(s => {
      if (s.location === 'anvil') {
        if (anvil) s.location = 'rack';
        else anvil = s;
      }
    });
    run.anvilId = anvil ? anvil.id : null;

    // 贡台最多 5 把
    let counterCount = 0;
    run.swords.forEach(s => {
      if (s.location === 'counter') {
        counterCount += 1;
        if (counterCount > counterCap()) s.location = 'rack';
      }
    });

    // 剑架最多 36 个可见位，多出的优先放到贡台
    let rackSeen = 0;
    run.swords.forEach(s => {
      if (s.location !== 'rack') return;
      rackSeen += 1;
      if (rackSeen > 36 && counterSwords().length < counterCap()) s.location = 'counter';
    });

    // 封禁列表：只保留仍然存在的遗物 id
    run.banned = (Array.isArray(run.banned) ? run.banned : [])
      .filter(id => typeof id === 'string' && CFG.relics.some(r => r.id === id));
    const bannedSet = new Set(run.banned);

    run.offers = (Array.isArray(run.offers) ? run.offers : [])
      .filter(o => o && availableRelicIds().includes(o.relicId) && !bannedSet.has(o.relicId))
      .slice(0, 4)
      .map(o => ({ relicId: o.relicId, sold: !!o.sold }));
    // 货架不足 4 格时补齐（封禁遗物后也不留空位）
    if (!run.over && run.offers.length < 4) {
      const used = new Set(run.offers.map(o => o.relicId));
      const rest = availableRelicIds().filter(id => !bannedSet.has(id) && !used.has(id));
      while (run.offers.length < 4 && rest.length) {
        const k = Math.floor(Math.random() * rest.length);
        run.offers.push({ relicId: rest.splice(k, 1)[0], sold: false });
      }
    }
    if (!run.offers.length && !run.over) run.offers = rollOffers();

    run.merchantStock = (Array.isArray(run.merchantStock) ? run.merchantStock : [])
      .filter(o => o && CFG.merchantItems.some(i => i.id === o.itemId))
      .slice(0, 6)
      .map(o => {
        const item = CFG.merchantItems.find(i => i.id === o.itemId);
        const maxQty = item && item.cost <= 450 ? 3 : 2;
        const raw = Number(o.qty);
        // 旧存档没有数量时，按价格补一个随机数量
        const qty = Number.isFinite(raw) && raw >= 1
          ? clamp(Math.floor(raw), 1, 9)
          : 1 + Math.floor(Math.random() * maxQty);
        return { itemId: o.itemId, qty, sold: !!o.sold };
      });
    if (!run.merchantStock.length && !run.over && isMerchantDay(run.day)) {
      run.merchantStock = rollMerchantStock();
    }

    run.shields = clamp(Number(run.shields) || 0, 0, 9);
    run.inheritLevel = clamp(Number(run.inheritLevel) || 0, 0, levelCap());
    run.forceGreat = clamp(Math.floor(Number(run.forceGreat) || 0), 0, 99);
    run.valueBonusToday = clamp(Number(run.valueBonusToday) || 0, 0, 5);
    run.greatTicketsToday = clamp(Number(run.greatTicketsToday) || 0, 0, 200);
    run.lastSupply = clamp(Number(run.lastSupply) || 0, 0, 12);
    run.refreshes = Math.max(0, Number(run.refreshes) || 0);
    run.breakWeightBonus = clamp(Number(run.breakWeightBonus) || 0, 0, 99);
    run.damageMeter = Math.max(0, Math.floor(Number(run.damageMeter) || 0));
    // 免碎裂改为可累积次数：老存档只有「今天是否已用过」的布尔值
    if (!hasGuardPool) {
      let legacyGuard = 0;
      if (!legacyGuardUsed && Array.isArray(run.relics)) {
        for (const id of run.relics) {
          const rl = CFG.relics.find(r => r.id === id);
          if (rl && rl.effects && rl.effects.dailyBreakGuard) legacyGuard += rl.effects.dailyBreakGuard;
        }
      }
      run.dailyBreakGuard = legacyGuard;
    }
    run.dailyBreakGuard = Math.max(0, Math.floor(Number(run.dailyBreakGuard) || 0));
    delete run.dailyBreakGuardUsed;
    run.funeralBonus = clamp(Math.floor(Number(run.funeralBonus) || 0), 0, 2);
    run.quotaCarry = Math.max(0, Number(run.quotaCarry) || 0);
    run.nextSwordCharge = clamp(Math.floor(Number(run.nextSwordCharge) || 0), 0, B.frenzyCharge);
    run.nextSupplyBonus = clamp(Math.floor(Number(run.nextSupplyBonus) || 0), 0, 20);
    run.crackedScale = clamp(Math.floor(Number(run.crackedScale) || 0), 0, 9);
    run.greatDouble = clamp(Math.floor(Number(run.greatDouble) || 0), 0, 9);
    run.powderBag = clamp(Math.floor(Number(run.powderBag) || 0), 0, 9);
    run.pardonUsed = clamp(Math.floor(Number(run.pardonUsed) || 0), 0, 3);
    run.swingSnapshot = run.swingSnapshot && typeof run.swingSnapshot === 'object' ? run.swingSnapshot : null;
    const achSrc = run.ach && typeof run.ach === 'object' ? run.ach : {};
    run.ach = {
      won: achSrc.won ? 1 : 0,
      breaks: Math.max(0, Math.floor(Number(achSrc.breaks) || 0)),
      frenzies: Math.max(0, Math.floor(Number(achSrc.frenzies) || 0)),
      triples: achSrc.triples ? 1 : 0,
      finalAnger: achSrc.finalAnger ? 1 : 0,
      merchantClears: achSrc.merchantClears ? 1 : 0,
      fullTributes: Math.max(0, Math.floor(Number(achSrc.fullTributes) || 0)),
      firstTribute: achSrc.firstTribute ? 1 : 0
    };
    run.over = run.over === 'death' || run.over === 'victory' ? run.over : null;
    if (run.over) run.record.maxDay = run.over === 'victory' ? totalDays() : clamp(run.day, 1, totalDays());
  }

  /* ------------------------------ 语言 / 基础界面 ------------------------------ */

  function applyLang() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? '锻剑纳贡' : 'Forge Tax';
    $$('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      // 记住 HTML 里写死的中文，词条缺失时兜底，绝不让键名露到界面上
      if (el.dataset.i18nFallback == null) el.dataset.i18nFallback = el.textContent;
      const text = t(key);
      el.textContent = text === key ? el.dataset.i18nFallback : text;
    });
    if (UI.btnLang) UI.btnLang.textContent = lang === 'zh' ? 'EN' : '中文';
    if (UI.fpLang) UI.fpLang.textContent = lang === 'zh' ? 'EN' : '中文';
    if (UI.btnSound) {
      UI.btnSound.classList.toggle('muted', !soundOn);
      UI.btnSound.title = soundOn ? t('soundOn') : t('soundOff');
    }
    if (world) world.setLang(lang);
    updateHUD();
    updateForgeUI();
    updatePrompt();
    updateChrome();
    if (overlayMode) UI.overlayCard.innerHTML = overlayHTML();
  }

  function updateChrome() {
    if (!UI.hud) return;
    const play = !!run && !run.over;
    const blocked = !!overlayMode || heating || settling;

    UI.hud.classList.toggle('hidden', !play || forgeMode);
    UI.goldHud.classList.toggle('hidden', !play);
    UI.objective.classList.toggle('hidden', !play || forgeMode || blocked);
    UI.heldHud.classList.toggle('hidden', !play || forgeMode || blocked || !heldSword());
    UI.relicHud.classList.toggle('hidden', !play || forgeMode || blocked || !(run.relics.length || itemCount() > 0));
    UI.crosshair.classList.toggle('hidden', !play || forgeMode || blocked);
    UI.interactPrompt.classList.toggle('hidden', !play || forgeMode || blocked || !focus);
    UI.joystick.classList.toggle('hidden', !isTouch || !play || forgeMode || blocked);
    UI.forgeUI.classList.toggle('hidden', !forgeMode);
    UI.overlay.classList.toggle('hidden', !overlayMode);

    if (UI.lockHint) {
      const showHint = play && !forgeMode && !blocked && !isTouch;
      UI.lockHint.classList.toggle('hidden', !showHint);
      if (showHint) {
        UI.lockHint.textContent = world && world.mouseLocked ? t('lockHintOn') : t('lockHint');
      }
    }

    if (isTouch && !UI.joystick.classList.contains('hidden')) {
      UI.joystick.classList.toggle('active', joy.active);
    }
  }

  function buildPips() {
    UI.angerPips.innerHTML = '';
    for (let i = 0; i < B.maxAnger; i++) {
      const p = document.createElement('i');
      p.className = 'anger-pip';
      UI.angerPips.appendChild(p);
    }
    UI.fpPips.innerHTML = '';
    for (let i = 0; i < B.frenzyCharge; i++) {
      const p = document.createElement('i');
      p.className = 'pip';
      UI.fpPips.appendChild(p);
    }
    UI.odds = {};
    ['break', 'damage', 'hold', 'success', 'great'].forEach(k => {
      UI.odds[k] = $(`.odd.${k} b`, UI.forgePanel);
    });
  }

  function updateHUD() {
    if (!run) return;
    UI.dayNum.textContent = run.day;
    if (UI.maxDayNum) UI.maxDayNum.textContent = totalDays();
    UI.dateText.textContent = dateLabel(run.day);
    UI.quotaNum.textContent = fmt(run.quota);
    const total = counterTotal();
    UI.offeredNum.textContent = fmtLog(total);
    // 进度条在超出贡额后直接满格（total 是对数，不能直接除）
    const ratio = run.quota > 0 ? Math.pow(10, total - Math.log10(run.quota)) : 0;
    UI.quotaFill.style.width = run.quota > 0 ? clamp(ratio * 100, 0, 100) + '%' : '0%';
    UI.swordCount.textContent = run.swords.length - machineSwords().length;
    UI.goldNum.textContent = fmt(run.gold);

    const shields = run.shields || 0;
    if (UI.shieldChip) {
      UI.shieldChip.textContent = t('shieldLabel') + ' ' + shields;
      UI.shieldChip.classList.toggle('hidden', shields <= 0);
    }

    if (UI.merchantChip) {
      UI.merchantChip.textContent = t('merchantChip');
      UI.merchantChip.classList.toggle('hidden', !isMerchantDay(run.day) || !!run.over);
    }

    Array.prototype.forEach.call(UI.angerPips.children, (el, i) => {
      el.classList.toggle('on', i < run.anger);
      el.classList.toggle('warn', run.anger === 2 && i === 2);
      // 噬魂龙把上限压到 1：多出来的格子直接置灰
      el.classList.toggle('locked', i >= angerCap());
    });

    updateHeldHud();
    updateRelicHud();
    updateBuffBar();
    updateTicketBoard();
    updateObjective();
    updateChrome();
  }

  // 场景里的实体签板：显示当前剑（或基础池）的五种签数与比例
  function updateTicketBoard() {
    if (!world || !world.setTicketBoard || !run) return;
    const s = anvilSword() || heldSword();
    const odds = oddsFor(s || { level: 0 });
    world.setTicketBoard({
      rows: ['break', 'damage', 'hold', 'success', 'great'].map(k => ({
        k, w: odds.w[k], pct: odds.pct[k]
      })),
      total: odds.total,
      level: s ? s.level : null
    });
  }

  // 底部增益条：只显示还有次数/剩余时间的可消耗效果
  function updateBuffBar() {
    if (!UI.buffBar) return;
    if (!run || run.over || overlayMode) {
      UI.buffBar.classList.add('hidden');
      return;
    }
    const chips = [];
    if (run.shields > 0 || relicStats.shield > 0) {
      const n = run.shields;
      chips.push(`<div class="buff-chip shield${n > 0 ? '' : ' spent'}" title="${t('buffShieldDesc')}">
        <span class="buff-icon">盾</span>
        <span class="buff-text"><b>${t('buffShield')}</b><em>${n} ${t('buffTimes')}</em></span></div>`);
    }
    if (frenzy.active && Date.now() < frenzy.until) {
      const remain = Math.max(0, (frenzy.until - Date.now()) / 1000);
      chips.push(`<div class="buff-chip frenzy" title="${t('buffFrenzyDesc')}">
        <span class="buff-icon">神</span>
        <span class="buff-text"><b>${t('buffFrenzy')}</b><em>${remain.toFixed(1)}s</em></span></div>`);
    }
    if (run.inheritLevel > 0) {
      chips.push(`<div class="buff-chip inherit" title="${t('buffInheritDesc')}">
        <span class="buff-icon">承</span>
        <span class="buff-text"><b>${t('buffInherit')}</b><em>+${run.inheritLevel}</em></span></div>`);
    }
    if (run.forceGreat > 0) {
      chips.push(`<div class="buff-chip force" title="${t('buffForceDesc')}">
        <span class="buff-icon">必</span>
        <span class="buff-text"><b>${t('buffForce')}</b><em>${run.forceGreat} ${t('buffTimes')}</em></span></div>`);
    }
    if (run.valueBonusToday > 0) {
      chips.push(`<div class="buff-chip value" title="${t('buffValueDesc')}">
        <span class="buff-icon">淬</span>
        <span class="buff-text"><b>${t('buffValue')}</b><em>+${Math.round(run.valueBonusToday * 100)}%</em></span></div>`);
    }
    if (run.greatTicketsToday > 0) {
      chips.push(`<div class="buff-chip tickets" title="${t('buffTicketsDesc')}">
        <span class="buff-icon">静</span>
        <span class="buff-text"><b>${t('buffTickets')}</b><em>+${run.greatTicketsToday}</em></span></div>`);
    }
    if (run.crackedScale > 0) {
      chips.push(`<div class="buff-chip shield" title="${t('buffCrackedScaleDesc')}">
        <span class="buff-icon">鳞</span>
        <span class="buff-text"><b>${t('buffCrackedScale')}</b><em>×${run.crackedScale}</em></span></div>`);
    }
    if (run.powderBag > 0) {
      chips.push(`<div class="buff-chip force" title="${t('buffPowderDesc')}">
        <span class="buff-icon">末</span>
        <span class="buff-text"><b>${t('buffPowder')}</b><em>×${run.powderBag}</em></span></div>`);
    }
    if (run.greatDouble > 0) {
      chips.push(`<div class="buff-chip tickets" title="${t('buffChalkDesc')}">
        <span class="buff-icon">粉</span>
        <span class="buff-text"><b>${t('buffChalk')}</b><em>×${run.greatDouble}</em></span></div>`);
    }
    if (relicStats.pardon > run.pardonUsed) {
      chips.push(`<div class="buff-chip value" title="${t('buffPardonDesc')}">
        <span class="buff-icon">赦</span>
        <span class="buff-text"><b>${t('buffPardon')}</b><em>${relicStats.pardon - run.pardonUsed} ${t('buffTimes')}</em></span></div>`);
    }
    UI.buffBar.innerHTML = chips.join('');
    UI.buffBar.classList.toggle('hidden', !chips.length);
  }

  function updateHeldHud() {
    const s = heldSword();
    if (!s) {
      UI.heldHud.classList.add('hidden');
      UI.heldName.textContent = '';
      UI.heldMeta.textContent = '';
      return;
    }
    UI.heldName.textContent = swordName(s);
    UI.heldMeta.textContent = `+${s.level} · ${fmtLog(effective(s))} G · ${s.heated ? t('heldHeated') : t('heldCold')}`;
  }

  function itemCount() {
    if (!run || !run.items) return 0;
    return Object.keys(run.items).reduce((n, id) => n + (run.items[id] || 0), 0);
  }

  function itemChipsHTML(extraClass) {
    if (!run || !run.items) return '';
    return CFG.merchantItems
      .filter(it => (run.items[it.id] || 0) > 0)
      .map(it => `<button class="relic-chip item-chip${extraClass ? ' ' + extraClass : ''}" data-item="${it.id}"
        title="${it[lang]}：${lang === 'zh' ? it.descZh : it.descEn} · ${t('itemClickUse')}">${it.glyph}<b class="chip-count">${run.items[it.id]}</b></button>`)
      .join('');
  }

  function updateForgeInventory() {
    if (!UI.fpInv) return;
    if (!run) {
      UI.fpInv.innerHTML = '';
      return;
    }
    const counts = relicCounts();
    const relicChips = Object.keys(counts).map(id => {
      const r = relicById(id);
      if (!r) return '';
      const n = counts[id];
      const desc = lang === 'zh' ? r.descZh : r.descEn;
      let badge = '';
      if (r.id === 'ward') {
        badge = `<b class="chip-count${run.shields > 0 ? '' : ' zero'}">${run.shields}</b>`;
      } else if (r.id === 'wrappedScabbard') {
        const left = run.dailyBreakGuard || 0;
        badge = `<b class="chip-count${left > 0 ? '' : ' zero'}">${left}</b>`;
      } else if (n > 1) {
        badge = `<b class="chip-count">${n}</b>`;
      }
      const title = `${r[lang]}${n > 1 ? ' ×' + n : ''}：${desc}` +
        (r.id === 'ward' ? ` · ${t('buffShield')} ${run.shields} ${t('buffTimes')}`
          : r.id === 'wrappedScabbard' ? ` · ${L('免碎裂剩余', 'Guards left')} ${run.dailyBreakGuard || 0}` : '');
      return `<button class="relic-chip fp-chip" data-relic="${r.id}" title="${title}">${relicGlyph(r)}${badge}</button>`;
    }).join('');
    const itemChips = itemChipsHTML('fp-chip');
    UI.fpInv.innerHTML =
      `<div class="fp-inv-row"><span class="fp-inv-label">${t('relicsLabel')}</span>${relicChips || `<span class="fp-inv-empty">${t('invRelicEmpty')}</span>`}</div>` +
      `<div class="fp-inv-row"><span class="fp-inv-label">${t('itemsLabel')}</span>${itemChips || `<span class="fp-inv-empty">${t('invItemEmpty')}</span>`}</div>`;
  }

  function restoreSwingSnapshot() {
    const snap = run && run.swingSnapshot;
    if (!snap || !snap.id) return false;
    let s = getSword(snap.id);
    if (s) {
      s.level = snap.level;
      if (Number.isFinite(snap.lv)) s.lv = snap.lv;
      s.cracks = snap.cracks;
      s.charge = snap.charge;
      s.successCount = snap.successCount || 0;
      s.freeDamage = snap.freeDamage || 0;
      s.firstBreakUsed = !!snap.firstBreakUsed;
      s.phoenixUsed = !!snap.phoenixUsed;
      s.location = 'anvil';
      s.counterSlot = -1;
      run.anvilId = s.id;
    } else {
      s = Object.assign({}, snap, { location: 'anvil', counterSlot: -1 });
      run.swords.push(s);
      run.anvilId = s.id;
    }
    if (run.heldId === s.id) run.heldId = null;
    if (snap._run) {
      run.gold = snap._run.gold;
      run.record.totalGold = snap._run.totalGold;
      run.inheritLevel = snap._run.inheritLevel;
      run.nextSwordCharge = snap._run.nextSwordCharge;
      run.funeralBonus = snap._run.funeralBonus;
      run.breakWeightBonus = snap._run.breakWeightBonus;
      if (run.ach) run.ach.breaks = snap._run.breaks;
    }
    run.swingSnapshot = null;
    // 如果上一次敲击导致退出锻造台，这里把剑放回铁砧，取消那次退出
    if (!forgeMode) {
      run.anvilId = s.id;
    }
    return true;
  }

  function useItem(id) {
    if (!run || run.over) return;
    const count = (run.items && run.items[id]) || 0;
    if (count <= 0) return;
    const item = itemById(id);
    if (!item) return;

    if (id === 'incense') {
      if (run.anger <= 0) {
        toast(t('toastAngerZero'), 'danger');
        return;
      }
      run.anger = Math.max(0, run.anger - 1);
      if (world) world.setAnger(run.anger);
    } else if (id === 'spare') {
      if (freeRackSlot(-1) < 0 && freeCounterSlot(-1) < 0) {
        toast(t('toastNoSpace'), 'danger');
        return;
      }
      addSword(0);
    } else if (id === 'wardCharm') {
      run.shields += 1;
    } else if (id === 'coinPouch') {
      run.gold += 1200;
      run.record.totalGold = (run.record.totalGold || 0) + 1200;
    } else if (id === 'whetstone') {
      run.forceGreat = Math.min(99, (run.forceGreat || 0) + 1);
    } else if (id === 'oil') {
      run.valueBonusToday = Math.min(5, (run.valueBonusToday || 0) + 0.2);
    } else if (id === 'charm') {
      run.greatTicketsToday = Math.min(200, (run.greatTicketsToday || 0) + 8);
    } else if (id === 'crackedScale') {
      run.crackedScale = Math.min(9, (run.crackedScale || 0) + 1);
    } else if (id === 'redChalk') {
      run.greatDouble = Math.min(9, (run.greatDouble || 0) + 1);
    } else if (id === 'powderBag') {
      run.powderBag = Math.min(9, (run.powderBag || 0) + 1);
    } else if (id === 'ghostDelivery') {
      run.nextSupplyBonus = Math.min(20, (run.nextSupplyBonus || 0) + 2);
    } else if (id === 'coldStar') {
      if (frenzy.active) {
        toast(t('toastFrenzyNoItem'), 'danger');
        return;
      }
      const anvil = anvilSword();
      if (!anvil) {
        toast(t('toastNoSword'), 'danger');
        return;
      }
      anvil.charge += 3;
      if (forgeMode) updateForgeUI();
    } else if (id === 'regretClockwork') {
      if (!restoreSwingSnapshot()) {
        toast(t('toastNoUndo'), 'danger');
        return;
      }
    }

    run.items[id] = count - 1;
    if (run.items[id] <= 0) delete run.items[id];
    saveGame();
    syncWorld();
    updateHUD();
    updateForgeUI();
    audio.relic();
    toast(t('toastItemUsed', { name: item[lang] }), 'good');
    if (world) world.updateFocus();
  }

  function updateRelicHud() {
    if (!run) return;
    const counts = relicCounts();
    const relics = Object.keys(counts).map(id => {
      const r = relicById(id);
      if (!r) return '';
      const n = counts[id];
      const desc = lang === 'zh' ? r.descZh : r.descEn;
      let badge = '';
      if (r.id === 'ward') {
        badge = `<b class="chip-count${run.shields > 0 ? '' : ' zero'}">${run.shields}</b>`;
      } else if (r.id === 'wrappedScabbard') {
        const left = run.dailyBreakGuard || 0;
        badge = `<b class="chip-count${left > 0 ? '' : ' zero'}">${left}</b>`;
      } else if (n > 1) {
        badge = `<b class="chip-count">${n}</b>`;
      }
      const extra = r.id === 'ward' ? ` · ${t('buffShield')} ${run.shields} ${t('buffTimes')}`
        : r.id === 'wrappedScabbard' ? ` · ${L('免碎裂剩余', 'Guards left')} ${run.dailyBreakGuard || 0}` : '';
      return `<button class="relic-chip" data-relic="${r.id}" title="${r[lang]}${n > 1 ? ' ×' + n : ''}：${desc}${extra}">${relicGlyph(r)}${badge}</button>`;
    }).join('');
    const items = itemChipsHTML('');
    if (!relics && !items) {
      UI.relicHud.innerHTML = '';
      UI.relicHud.classList.remove('many');
      return;
    }
    UI.relicHud.innerHTML = relics + items;
    const totalChips = Object.keys(counts).length + Object.keys(run.items || {}).length;
    UI.relicHud.classList.toggle('many', totalChips > 10);
  }

  function onChipClick(e) {
    const itemChip = e.target.closest('[data-item]');
    if (itemChip) {
      useItem(itemChip.dataset.item);
      return;
    }
    const chip = e.target.closest('[data-relic]');
    if (!chip) return;
    const relic = relicById(chip.dataset.relic);
    if (!relic) return;
    toast(relic[lang] + '：' + (lang === 'zh' ? relic.descZh : relic.descEn));
    audio.ui();
  }

  function objectiveKey() {
    if (!run) return '';
    const held = heldSword();
    const total = counterTotal();
    const counter = counterSwords().length;
    if (held) {
      if (!held.heated) return 'objHeat';
      if (held.level > 0) return 'objCarry';
      return 'objAnvil';
    }
    if (run.anvilId) return 'objForgeAnvil';
    if (counter > 0 && total >= Math.log10(Math.max(1, run.quota))) return 'objBell';
    if (counter > 0) return 'objCounter';
    if (rackCount() > 0) return 'objPick';
    return 'objNoSword';
  }

  function updateObjective() {
    if (!run) return;
    const key = objectiveKey();
    if (!key) return;
    if (key === 'objCounter') {
      UI.objectiveText.textContent = t(key, { offered: fmtLog(counterTotal()), quota: fmt(run.quota) });
    } else {
      UI.objectiveText.textContent = t(key);
    }
  }

  function setFocus(next) {
    focus = next;
    updatePrompt();
    updateChrome();
  }

  function focusAction() {
    if (!focus || !run || run.over || forgeMode) return null;
    const held = heldSword();
    const a = { title: '', sub: '', label: '', enabled: true, alt: null };

    if (focus.kind === 'sword') {
      const s = getSword(focus.id);
      if (!s) return null;
      a.title = swordName(s);
      a.sub = `+${s.level} · ${fmtLog(effective(s))} G · ${s.heated ? t('stateHeated') : t('stateCold')} · ${focus.source === 'counter' ? t('stateCounter') : t('stateRack')}`;
      a.label = held ? t('actSwap') : (focus.source === 'counter' ? t('actTake') : t('actPick'));
      return a;
    }

    if (focus.kind === 'rack') {
      a.title = t('stationRack');
      a.sub = held ? t('actHang') + '：' + swordName(held) : t('promptRackInfo');
      a.label = held ? t('actHang') : t('actInfo');
      a.enabled = !!held;
      return a;
    }

    if (focus.kind === 'anvil') {
      const s = anvilSword();
      if (s) {
        a.title = t('anvilTitle');
        a.sub = t('promptAnvilInfo', { name: swordName(s), level: s.level, value: fmtLog(effective(s)) });
        a.label = t('actForge');
        a.alt = t('actTakeAnvil');
      } else if (held) {
        a.title = t('anvilTitle');
        if (!held.heated) {
          a.sub = t('promptNeedHeat');
          a.label = t('actPlaceAnvil');
          a.enabled = false;
        } else {
          a.sub = t('promptAnvilInfo', { name: swordName(held), level: held.level, value: fmtLog(effective(held)) });
          a.label = t('actPlaceAnvil');
        }
      } else {
        a.title = t('anvilTitle');
        a.sub = t('promptNeedSword');
        a.label = t('actPlaceAnvil');
        a.enabled = false;
      }
      return a;
    }

    if (focus.kind === 'forge') {
      a.title = t('stationForge');
      if (held) {
        a.sub = t('promptAnvilInfo', { name: swordName(held), level: held.level, value: fmtLog(effective(held)) });
        a.label = held.heated ? t('promptHeatDone') : t('actHeat');
        a.enabled = !held.heated;
      } else {
        a.sub = t('promptNeedSword');
        a.label = t('actHeat');
        a.enabled = false;
      }
      return a;
    }

    if (focus.kind === 'counter') {
      a.title = t('tributeTitle');
      a.sub = t('promptCounterInfo', { offered: fmtLog(counterTotal()), quota: fmt(run.quota) });
      a.label = t('actPlaceCounter');
      if (!held) {
        a.sub += ' · ' + t('promptRackInfo');
        a.enabled = false;
      } else if (counterSwords().length >= counterCap()) {
        a.sub = t('promptCounterFull');
        a.enabled = false;
      }
      return a;
    }

    if (focus.kind === 'bell') {
      const total = counterTotal();
      const quotaLog = Math.log10(Math.max(1, run.quota));
      a.title = t('tributeTitle');
      a.sub = t('promptBellInfo', { offered: fmtLog(total), quota: fmt(run.quota) });
      a.label = t('actRing');
      if (total < quotaLog) {
        if (Date.now() < bellArmedUntil) {
          a.sub = t('promptRingAgain');
          a.label = t('actRingAgain');
        } else {
          a.sub += ' · ' + t('promptRingWarn');
        }
      }
      return a;
    }

    if (focus.kind === 'relic') {
      const offer = run.offers && run.offers[focus.index];
      const relic = offer ? relicById(offer.relicId) : null;
      const own = relic ? relicCount(relic.id) : 0;
      const cost = relic ? relicSwordCost(relic) : 1;
      const stored = machineSwords().length;
      a.title = relic ? `${relic[lang]}${own > 1 ? ' ×' + own : ''}` : t('machineEmpty');
      if (!offer || !relic) {
        a.sub = t('machineEmpty');
        a.label = t('actBuyRelic');
        a.enabled = false;
      } else if (offer.sold) {
        a.sub = t('promptSold') + ' · ' + t('promptRelicRefreshHint');
        a.label = t('actBuyRelic');
        a.enabled = false;
      } else {
        a.sub = (lang === 'zh' ? relic.descZh : relic.descEn) + ' · ' +
          t('promptRelicCost', { n: cost }) + ' · ' +
          t('promptRelicStored', { have: stored }) + ' · ' +
          t('promptRelicRepeat');
        a.label = t('actBuyRelic');
        if (stored < cost) {
          a.sub += ' · ' + t('promptMachineNeed', { n: cost });
          a.enabled = false;
        }
      }
      return a;
    }

    if (focus.kind === 'machineDeposit') {
      const stored = machineSwords();
      const held = heldSword();
      a.title = t('machineDepositTitle');
      a.sub = t('machineDepositInfo', { n: stored.length });
      if (held) {
        a.label = t('actMachineDeposit', { name: swordName(held) });
      } else if (stored.length) {
        a.label = t('actMachineWithdraw');
      } else {
        a.sub = t('promptMachineEmpty');
        a.label = t('actMachineWithdraw');
        a.enabled = false;
      }
      return a;
    }

    if (focus.kind === 'elf') {
      const n = floorSwords().length;
      a.title = t('elfTitle');
      a.sub = t('elfInfo', { n, cap: 1 + relicStats.elfCarry });
      a.label = run.elfOn ? t('actElfStop') : t('actElfHelp');
      return a;
    }

    if (focus.kind === 'refresh') {
      const cost = refreshCost();
      a.title = t('shopRefresh');
      a.sub = t('promptRefreshCost', { cost: fmt(cost) });
      a.label = t('actRefresh');
      if (run.gold < cost) {
        a.sub += ' · ' + t('promptNoGold');
        a.enabled = false;
      }
      return a;
    }

    if (focus.kind === 'banRelic') {
      const stored = machineSwords().length;
      a.title = t('promptBanTitle');
      a.sub = t('promptBanInfo') + ' · ' + t('machineDepositInfo', { n: stored });
      a.label = t('actBan');
      if (!stored) {
        a.sub += ' · ' + t('promptBanNeed');
        a.enabled = false;
      }
      return a;
    }

    if (focus.kind === 'merchant') {
      const entry = run.merchantStock && run.merchantStock[focus.index];
      const item = entry ? itemById(entry.itemId) : null;
      if (!item || !entry || entry.sold) {
        a.title = item ? item[lang] : t('merchantTitle');
        a.sub = t('promptSold');
        a.label = t('actBuy');
        a.enabled = false;
        return a;
      }
      const qty = clamp(Math.floor(Number(entry.qty) || 1), 1, 9);
      const price = Math.round(item.cost * qty * (1 - relicStats.merchantDiscount));
      a.title = `${item[lang]} ×${qty}`;
      a.sub = (lang === 'zh' ? item.descZh : item.descEn) + ' · ' + t('promptItemCost', { cost: fmt(price) }) + ' · ' + t('promptItemStore');
      a.label = t('actBuy');
      if (run.gold < price) {
        a.sub += ' · ' + t('promptNoGold');
        a.enabled = false;
      }
      return a;
    }

    return null;
  }

  function updatePrompt() {
    const a = focusAction();
    if (!a) {
      UI.interactPrompt.classList.add('hidden');
      return;
    }
    UI.promptTitle.textContent = a.title;
    UI.promptSub.textContent = a.sub;
    UI.promptKey.textContent = 'E';
    UI.promptGo.textContent = a.label;
    UI.promptGo.disabled = !a.enabled;
    if (a.alt) {
      UI.promptAlt.textContent = a.alt + (isTouch ? '' : ' (F)');
      UI.promptAlt.classList.remove('hidden');
      UI.promptAlt.disabled = false;
    } else {
      UI.promptAlt.classList.add('hidden');
    }
    UI.interactPrompt.classList.remove('hidden');
    if (!forgeMode && !overlayMode && !heating && !settling && run && !run.over) {
      // 保持与场景一致
    }
    updateChrome();
  }

  function toast(msg, kind) {
    clearTimeout(toastTimer);
    const low = forgeMode ? ' low' : '';
    UI.toast.textContent = msg;
    UI.toast.className = 'toast show' + low + (kind ? ' ' + kind : '');
    toastTimer = setTimeout(() => {
      UI.toast.className = 'toast' + low + (kind ? ' ' + kind : '');
    }, 2600);
  }

  function banner(text, color) {
    UI.resultBannerText.textContent = text;
    UI.resultBannerText.style.color = color || '#f4d9a1';
    UI.resultBanner.classList.remove('show');
    void UI.resultBanner.offsetWidth;
    UI.resultBanner.classList.add('show');
  }

  function damageFlash() {
    UI.damageFlash.classList.remove('on');
    void UI.damageFlash.offsetWidth;
    UI.damageFlash.classList.add('on');
  }

  function refreshLock() {
    if (!world) return;
    world.setLocked(!!(overlayMode || heating || settling || !run || run.over));
  }

  /* ------------------------------ 场景交互 ------------------------------ */

  function actFocus(f) {
    if (!f || !run || run.over || forgeMode || heating || settling || overlayMode) return;
    audio.ensure();
    switch (f.kind) {
      case 'sword':
        pickOrSwap(f);
        break;
      case 'rack':
        hangHeld();
        break;
      case 'anvil':
        anvilAction();
        break;
      case 'forge':
        heatHeld();
        break;
      case 'counter':
        placeHeldOnCounter();
        break;
      case 'bell':
        bellAction();
        break;
      case 'relic':
        buyRelic(f.index);
        break;
      case 'machineDeposit':
        machineDepositAction();
        break;
      case 'refresh':
        refreshMachine();
        break;
      case 'banRelic':
        openBanPicker();
        break;
      case 'elf':
        toggleElf();
        break;
      case 'merchant':
        buyMerchant(f.index);
        break;
      default:
        break;
    }
  }

  function pickOrSwap(f) {
    const s = getSword(f.id);
    if (!s) return;
    const held = heldSword();
    if (held) {
      const sourceLoc = s.location;
      if (sourceLoc === 'rack') {
        const t = held.rackSlot;
        held.rackSlot = s.rackSlot;
        s.rackSlot = t;
      } else if (sourceLoc === 'counter') {
        const t = held.counterSlot;
        held.counterSlot = s.counterSlot;
        s.counterSlot = t;
      }
      held.location = sourceLoc;
      s.location = 'hand';
      run.heldId = s.id;
      toast(t('toastSwapped', { name: swordName(s) }));
    } else {
      s.location = 'hand';
      run.heldId = s.id;
      toast(t('toastPicked', { name: swordName(s) }));
    }
    saveGame();
    syncWorld();
    updateHUD();
    audio.ui();
  }

  function freeRackSlot(excludeId) {
    const used = new Set(
      run.swords
        .filter(s => s.id !== excludeId && Number.isInteger(s.rackSlot) && s.rackSlot >= 0)
        .map(s => s.rackSlot)
    );
    for (let i = 0; i < 36; i++) if (!used.has(i)) return i;
    return -1;
  }

  function freeCounterSlot(excludeId) {
    const used = new Set(
      run.swords
        .filter(s => s.id !== excludeId && Number.isInteger(s.counterSlot) && s.counterSlot >= 0)
        .map(s => s.counterSlot)
    );
    for (let i = 0; i < counterCap(); i++) if (!used.has(i)) return i;
    return -1;
  }

  function hangHeld() {
    const s = heldSword();
    if (!s) return;
    if (s.rackSlot < 0) s.rackSlot = freeRackSlot(s.id);
    s.location = 'rack';
    run.heldId = null;
    saveGame();
    syncWorld();
    updateHUD();
    // 架子挂满时不再拒绝：剑会落在地面上（场景里有对应的掉落表现）
    toast(s.rackSlot >= 0
      ? t('toastRemovedAnvil', { name: swordName(s) })
      : L('剑架已满，剑落在地上', 'Rack full — the blade drops to the floor'));
    audio.ui();
  }

  function anvilAction() {
    const s = anvilSword();
    if (s) {
      enterForgeMode();
      return;
    }
    const held = heldSword();
    if (!held) {
      toast(t('promptNeedSword'), 'danger');
      return;
    }
    if (!held.heated) {
      toast(t('promptNeedHeat'), 'danger');
      return;
    }
    held.location = 'anvil';
    run.anvilId = held.id;
    run.heldId = null;
    saveGame();
    syncWorld();
    updateHUD();
    enterForgeMode();
  }

  function takeAnvilSword() {
    if (!run || run.over) return;
    clearAutoHammer();
    if (run) run.swingSnapshot = null;
    const s = anvilSword();
    if (!s) {
      toast(t('toastAnvilEmpty'), 'danger');
      return;
    }
    if (heldSword()) {
      toast(t('toastHandFull'), 'danger');
      return;
    }
    s.location = 'hand';
    run.heldId = s.id;
    run.anvilId = null;
    if (forgeMode) exitForgeMode();
    saveGame();
    syncWorld();
    updateHUD();
    toast(t('toastTookAnvil', { name: swordName(s) }), 'good');
    audio.ui();
  }

  function placeHeldOnCounter() {
    const s = heldSword();
    if (!s) return;
    if (counterSwords().length >= counterCap()) {
      toast(t('toastCounterFull'), 'danger');
      return;
    }
    if (s.counterSlot < 0) s.counterSlot = freeCounterSlot(s.id);
    if (s.counterSlot < 0) {
      toast(t('toastCounterFull'), 'danger');
      return;
    }
    s.location = 'counter';
    run.heldId = null;
    saveGame();
    syncWorld();
    updateHUD();
    toast(t('toastPlacedCounter', { name: swordName(s) }), 'good');
    audio.ui();
  }

  function heatHeld() {
    const s = heldSword();
    if (!s) {
      toast(t('promptNeedSword'), 'danger');
      return;
    }
    if (s.heated) {
      toast(t('promptHeatDone'), 'danger');
      return;
    }
    heating = true;
    refreshLock();
    updateChrome();
    audio.heat();
    toast(t('toastHeating', { name: swordName(s) }));
    world.heatSword({
      level: s.level,
      form: s.form,
      variant: s.variant,
      cracks: s.cracks
    }, () => {
      s.heated = true;
      heating = false;
      refreshLock();
      relockMouse(0);
      relockMouse(120);
      saveGame();
      syncWorld();
      updateHUD();
      updatePrompt();
      if (world) world.updateFocus();
      audio.success();
      toast(t('toastHeated', { name: swordName(s) }), 'good');
    });
  }

  function bellAction() {
    const total = counterTotal();
    if (total < Math.log10(Math.max(1, run.quota)) && Date.now() >= bellArmedUntil) {
      bellArmedUntil = Date.now() + 2600;
      clearTimeout(bellTimer);
      bellTimer = setTimeout(() => {
        bellArmedUntil = 0;
        updatePrompt();
      }, 2600);
      toast(t('promptRingWarn'), 'danger');
      audio.error();
      updatePrompt();
      return;
    }
    doRingBell();
  }

  /* ------------------------------ 遗物 / 商人 ------------------------------ */

  // 存剑口：手持剑时存入，空手时取回等级最高的一把
  function machineDepositAction() {
    if (!run) return;
    const held = heldSword();
    if (held) {
      held.location = 'machine';
      held.rackSlot = -1;
      held.counterSlot = -1;
      run.heldId = null;
      saveGame();
      syncWorld();
      updateHUD();
      audio.ui();
      toast(t('toastMachineDeposit', { name: swordName(held) }), 'good');
    } else {
      const stored = machineSwords();
      if (!stored.length) {
        audio.error();
        toast(t('promptMachineEmpty'), 'danger');
        return;
      }
      const s = stored.slice().sort((a, b) => b.level - a.level)[0];
      const rackSlot = freeRackSlot(s.id);
      const counterSlot = rackSlot < 0 ? freeCounterSlot(s.id) : -1;
      if (rackSlot < 0 && counterSlot < 0) {
        audio.error();
        toast(t('toastCounterFull'), 'danger');
        return;
      }
      if (rackSlot >= 0) {
        s.location = 'rack';
        s.rackSlot = rackSlot;
      } else {
        s.location = 'counter';
        s.counterSlot = counterSlot;
      }
      saveGame();
      syncWorld();
      updateHUD();
      audio.ui();
      toast(t('toastMachineWithdraw', { name: swordName(s) }), 'good');
    }
    updatePrompt();
  }

  /* ------------------------------ 家养小精灵 ------------------------------ */

  // 精灵走到地上的剑旁边时调用：把剑交给它（一次只拿一把）
  function elfPickup(id) {
    if (!run || !run.elfOn) return false;
    const s = getSword(id);
    if (!s || s.location !== 'rack') return false;
    if (Number.isInteger(s.rackSlot) && s.rackSlot >= 0 && s.rackSlot < 36) return false;
    s.location = 'elf';
    s.rackSlot = -1;
    saveGame();
    syncWorld();
    updateHUD();
    return true;
  }

  // 精灵走到售货机前时调用：剑正式存入售货机
  function elfDeposit(id) {
    if (!run) return false;
    const s = getSword(id);
    if (!s || s.location !== 'elf') return false;
    s.location = 'machine';
    s.rackSlot = -1;
    s.counterSlot = -1;
    saveGame();
    syncWorld();
    updateHUD();
    if (focus && focus.kind === 'machineDeposit') updatePrompt();
    return true;
  }

  function toggleElf() {
    if (!run) return;
    run.elfOn = !run.elfOn;
    saveGame();
    syncWorld();
    updateHUD();
    audio.ui();
    toast(run.elfOn ? t('toastElfOn') : t('toastElfOff'), run.elfOn ? 'good' : undefined);
    updatePrompt();
  }

  function buyRelic(index) {
    if (!run) return;
    // 禁器龙：本局无法购买遗物
    if (dragonMods().buyBanned) {
      audio.error();
      toast(t('toastDragonBuyban'), 'danger');
      return;
    }
    const offer = run.offers && run.offers[index];
    if (!offer) {
      toast(t('machineEmpty'), 'danger');
      return;
    }
    if (offer.sold) {
      toast(t('promptSold'), 'danger');
      return;
    }
    const relic = relicById(offer.relicId);
    if (!relic) return;
    const cost = relicSwordCost(relic);
    const stored = machineSwords();
    if (stored.length < cost) {
      audio.error();
      toast(t('promptMachineNeed', { n: cost }), 'danger');
      updatePrompt();
      return;
    }

    // 优先消耗等级最低的剑
    const spent = stored.slice().sort((a, b) => a.level - b.level).slice(0, cost);
    const spentIds = new Set(spent.map(s => s.id));
    run.swords = run.swords.filter(s => !spentIds.has(s.id));
    run.relics.push(relic.id);
    offer.sold = true;
    relicStats = collectStats();
    if (relic.effects && relic.effects.shield) run.shields += relic.effects.shield;
    // 当天买到线缠剑鞘也立刻拿到这一天的免碎裂
    if (relic.effects && relic.effects.dailyBreakGuard) run.dailyBreakGuard = (run.dailyBreakGuard || 0) + relic.effects.dailyBreakGuard;
    run.quota = quotaFor(run.day);
    checkAchievements();

    saveGame();
    syncWorld();
    updateHUD();
    audio.relic();
    const own = relicCount(relic.id);
    toast(t('toastRelic', { name: `${relic[lang]}${own > 1 ? ' ×' + own : ''}` }), 'good');
    updatePrompt();
  }

  // 售货机：打开封禁遗物面板
  function openBanPicker() {
    if (!run || run.over || forgeMode || heating || settling) return;
    settingsReturn = null;
    showOverlay('ban');
    audio.ensure();
    audio.ui();
  }

  // 封禁面板：列出所有可出现的遗物，点选消耗 1 把存剑永久移出货池
  function banHTML() {
    const stored = machineSwords().length;
    const banned = new Set(run.banned);
    const rows = availableRelicIds().map(id => {
      const r = relicById(id);
      if (!r) return '';
      const isBanned = banned.has(id);
      const own = relicCount(id);
      const desc = (own ? t('banOwned', { n: own }) + ' · ' : '') + (lang === 'zh' ? r.descZh : r.descEn);
      return `<div class="cfg-own${isBanned ? ' banned' : ''}">
        <span class="cfg-glyph">${relicGlyph(r)}</span>
        <div class="cfg-own-text">
          <b>${r[lang]}</b>
          <em>${desc}</em>
        </div>
        <button class="btn ghost small" data-act="banRelic" data-id="${r.id}"${(isBanned || !stored) ? ' disabled' : ''}>${isBanned ? t('banBanned') : t('actBan')}</button>
      </div>`;
    }).join('');
    return `<div class="end-kicker">${lang === 'zh' ? '锻剑纳贡' : 'FORGE TAX'}</div>
      <h2 class="starter-title">${t('banTitle')}</h2>
      <p class="starter-sub">${t('banHint')}</p>
      ${stored ? '' : `<p class="cfg-note">${t('banNeedSword')}</p>`}
      <section class="cfg-section">
        <div class="cfg-owns">${rows}</div>
      </section>
      <div class="start-actions">
        <button class="btn primary" data-act="closeOverlay">${t('helpClose')}</button>
      </div>`;
  }

  function banRelic(id) {
    if (!run || run.over) return;
    const relic = relicById(id);
    if (!relic) return;
    if (run.banned.includes(id)) {
      toast(t('banBanned'), 'danger');
      return;
    }
    const stored = machineSwords();
    if (!stored.length) {
      audio.error();
      toast(t('promptBanNeed'), 'danger');
      return;
    }
    // 至少留一个能上架的遗物，避免把货池封空
    const rest = availableRelicIds().filter(x => x !== id && !run.banned.includes(x));
    if (!rest.length) {
      audio.error();
      toast(t('banEmpty'), 'danger');
      return;
    }
    // 消耗等级最低的一把存剑
    const spent = stored.slice().sort((a, b) => a.level - b.level)[0];
    run.swords = run.swords.filter(s => s.id !== spent.id);
    run.banned.push(id);
    // 货架上正在卖的也立刻替换掉
    const idx = run.offers.findIndex(o => o.relicId === id);
    if (idx >= 0) {
      const used = new Set(run.offers.map(o => o.relicId));
      const rest = availableRelicIds().filter(x => !run.banned.includes(x) && !used.has(x));
      if (rest.length) {
        run.offers[idx] = { relicId: rest[Math.floor(Math.random() * rest.length)], sold: false };
      } else {
        run.offers.splice(idx, 1);
      }
    }
    saveGame();
    syncWorld();
    updateHUD();
    audio.relic();
    toast(t('toastBanned', { name: relic[lang] }), 'good');
    if (overlayMode === 'ban') {
      const scroll = UI.overlayCard.scrollTop;
      UI.overlayCard.innerHTML = overlayHTML();
      UI.overlayCard.scrollTop = scroll;
    }
  }

  function refreshMachine() {
    if (!run) return;
    // 空匣龙：每天刷新次数有上限
    const cap = dragonMods().refreshCap;
    if (cap > 0 && run.refreshes >= cap) {
      audio.error();
      toast(t('toastRefreshCap'), 'danger');
      return;
    }
    const cost = refreshCost();
    if (run.gold < cost) {
      audio.error();
      toast(t('toastNoGold'), 'danger');
      return;
    }
    run.gold -= cost;
    run.refreshes += 1;
    run.offers = rollOffers();
    saveGame();
    syncWorld();
    updateHUD();
    audio.coin();
    toast(t('toastMachineRefresh', { gold: fmt(cost) }), 'good');
    updatePrompt();
  }

  function buyMerchant(index) {
    if (!run) return;
    const entry = run.merchantStock && run.merchantStock[index];
    if (!entry || entry.sold) {
      toast(t('promptSold'), 'danger');
      return;
    }
    const item = itemById(entry.itemId);
    if (!item) return;
    const qty = clamp(Math.floor(Number(entry.qty) || 1), 1, 9);
    const price = Math.round(item.cost * qty * (1 - relicStats.merchantDiscount));
    if (run.gold < price) {
      audio.error();
      toast(t('toastNoGold'), 'danger');
      return;
    }

    run.gold -= price;
    entry.sold = true;
    run.items = run.items || {};
    run.items[item.id] = Math.min(99, (run.items[item.id] || 0) + qty);
    toast(t('toastItemStored', { name: `${item[lang]} ×${qty}` }), 'good');
    if (run.merchantStock.length && run.merchantStock.every(e => e.sold)) {
      if (run.ach) run.ach.merchantClears = 1;
      checkAchievements();
    }

    saveGame();
    syncWorld();
    updateHUD();
    audio.coin();
    updatePrompt();
  }

  /* ------------------------------ 贡品结算 ------------------------------ */

  function doRingBell() {
    if (settling || !run || run.over) return;
    bellArmedUntil = 0;
    clearTimeout(bellTimer);
    settling = true;
    refreshLock();
    updateChrome();
    audio.bell();
    world.ringBell();
    const total = counterTotal();
    const success = total >= Math.log10(Math.max(1, run.quota));
    if (success) {
      setTimeout(() => { if (audio) audio.gate(); }, 650);
    } else {
      setTimeout(() => {
        if (audio) audio.roar();
        if (world) world.roar();
        damageFlash();
      }, 520);
    }
    setTimeout(settleTribute, 1150);
  }

  function settleTribute() {
    if (!run) return;
    const dm = dragonMods();
    const total = counterTotal();
    const quotaLog = Math.log10(Math.max(1, run.quota));
    const success = total >= quotaLog;
    const prevDay = run.day;
    const prevQuota = run.quota;
    // 超出贡额的部分可能极大，封顶避免金币结算溢出
    const excess = success ? Math.min(1e12, Math.pow(10, Math.min(300, total - quotaLog))) : 0;
    let gain = 0;

    run.swords = run.swords.filter(s => s.location !== 'counter');

    if (success) {
      gain = Math.floor(
        B.goldBase +
        prevDay * B.goldPerDay +
        excess * B.goldExcessRate +
        relicStats.tributeGold
      );
      run.gold += gain;
      run.record.totalGold += gain;
      run.record.maxDay = Math.max(run.record.maxDay, prevDay);
      // 贪食龙：每次成功上贡都会让之后的贡额更重
      run.dragonTributeStacks = (run.dragonTributeStacks || 0) + 1;
      if (run.ach) {
        run.ach.fullTributes += 1;
        run.ach.firstTribute = 1;
        if (total >= Math.log10(prevQuota * 3)) run.ach.triples = 1;
        if (run.anger >= angerCap()) run.ach.finalAnger = 1;
      }
      if (relicStats.excessCarry > 0 && excess > 0) {
        run.quotaCarry = excess * relicStats.excessCarry;
      }
      checkAchievements();
    } else if (dm.frostPct > 0) {
      // 寒狱龙：失败不加怒气，改为摧毁剑架上的剑
      const rack = run.swords.filter(s => s.location === 'rack');
      const n = rack.length ? Math.max(1, Math.round(rack.length * dm.frostPct)) : 0;
      const lost = takeRandomRackSwords(n);
      if (lost > 0) toast(t('toastDragonFrost', { n: lost }), 'danger');
    } else {
      run.anger = Math.min(angerCap(), run.anger + dm.failureAnger);
    }

    // 逆鳞龙：上贡成功后仍要交出一部分剑架上的剑
    if (success && dm.tributeRackLoss > 0) {
      const lost = takeRandomRackSwords(dm.tributeRackLoss);
      if (lost > 0) toast(t('toastDragonToll', { n: lost }), 'danger');
    }
    // 抽成龙：每天结束抽走一部分金币
    if (dm.goldTax > 0 && run.gold > 0) {
      const tax = Math.floor(run.gold * dm.goldTax);
      if (tax > 0) {
        run.gold -= tax;
        toast(t('toastDragonTax', { gold: fmt(tax) }), 'danger');
      }
    }

    if (success && prevDay >= totalDays()) {
      if (run.ach) run.ach.won = 1;
      checkAchievements();
      settling = false;
      win();
      return;
    }
    const pardonMax = hasDragon('nopardon') ? 0 : relicStats.pardon;
    if (!success && run.anger >= angerCap() && prevDay < totalDays() && run.pardonUsed < pardonMax) {
      // 龙之赦免：免除这一次死亡
      run.pardonUsed += 1;
      run.anger = Math.max(0, run.anger - 1);
      toast(t('toastPardon'), 'good');
      if (world) world.setAnger(run.anger);
    } else if (!success && (run.anger >= angerCap() || prevDay >= totalDays())) {
      settling = false;
      die();
      return;
    }

    run.day = Math.min(totalDays(), prevDay + 1);
    beginDay();
    saveGame();
    settling = false;
    audio.coin();
    showOverlay('day', {
      kind: success ? 'success' : 'fail',
      gain,
      total,
      prevDay,
      prevQuota
    });
  }

  function win() {
    if (!run) return;
    run.over = 'victory';
    run.record.maxDay = totalDays();
    saveGame();
    endFrenzy(false);
    forgeMode = false;
    busy = false;
    UI.forgeUI.classList.add('hidden');
    if (world) {
      world.teleportTo('tribute');
      world.setLocked(true);
    }
    showOverlay('victory');
    audio.great();
    updateChrome();
  }

  function die() {
    if (!run) return;
    run.over = 'death';
    saveGame();
    endFrenzy(false);
    forgeMode = false;
    busy = false;
    UI.forgeUI.classList.add('hidden');
    if (world) {
      world.teleportTo('tribute');
      world.setLocked(true);
      world.roar();
    }
    showOverlay('death');
    audio.roar();
    damageFlash();
    updateChrome();
  }

  /* ------------------------------ 每日循环 ------------------------------ */

  function beginDay() {
    // 每日随机事件（第一天不触发）
    run.dayEvent = null;
    if (run.day > 1 && CFG.dailyEvents && CFG.dailyEvents.length && Math.random() < 0.35) {
      run.dayEvent = CFG.dailyEvents[Math.floor(Math.random() * CFG.dailyEvents.length)].id;
    }
    const ev = run.dayEvent;
    // 诡龙：先封印遗物，当天所有遗物效果按封印后的结果结算
    const dm = dragonMods();
    if (dm.sealedCount > 0 && run.relics.length) {
      const pool = run.relics.slice();
      const sealed = [];
      const n = Math.min(dm.sealedCount, pool.length);
      for (let i = 0; i < n; i++) {
        sealed.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      run.dragonSealed = sealed;
      const names = sealed.map(id => { const r = relicById(id); return r ? r[lang] : id; }).join('、');
      toast(t('toastDragonSealed', { n: sealed.length, names }), 'danger');
    } else {
      run.dragonSealed = [];
    }
    relicStats = collectStats();
    if (ev === 'anger') run.anger = Math.min(angerCap(), run.anger + 1);

    // 龙食龙：每天开始吞掉等级最高的剑；无剑可吞则怒气 +1
    if (dm.consumeSwords > 0) {
      const eat = Math.min(dm.consumeSwords, run.swords.length);
      if (eat > 0) {
        const ids = new Set(run.swords.slice().sort((a, b) => b.level - a.level).slice(0, eat).map(x => x.id));
        run.swords = run.swords.filter(x => !ids.has(x.id));
        if (run.anvilId && ids.has(run.anvilId)) run.anvilId = null;
        if (run.heldId && ids.has(run.heldId)) run.heldId = null;
        toast(t('toastDragonStarve', { n: eat }), 'danger');
      } else {
        run.anger = Math.min(angerCap(), run.anger + 1);
      }
    }

    run.quota = quotaFor(run.day);
    if (run.quotaCarry > 0) {
      const cap = run.quota * (relicStats.excessCap || 0.3);
      run.quota = Math.max(Math.round(run.quota - cap), Math.round(run.quota - run.quotaCarry));
      run.quotaCarry = 0;
    }
    if (ev === 'quota') run.quota = Math.max(10, Math.round(run.quota * 1.3 / 10) * 10);
    run.shields = relicStats.shield + (currentDifficulty().shieldBonus || 0);
    run.valueBonusToday = 0;
    run.greatTicketsToday = 0;
    // 免碎裂：每天补满一份，没用掉的继续留在池子里
    run.dailyBreakGuard = Math.max(0, Math.floor(Number(run.dailyBreakGuard) || 0)) + (relicStats.dailyBreakGuard || 0);
    if (ev === 'great') run.greatTicketsToday = 6;
    if (ev === 'gold') {
      run.gold += 400;
      run.record.totalGold = (run.record.totalGold || 0) + 400;
    }
    if (relicStats.dailyGold > 0) {
      run.gold += relicStats.dailyGold;
      run.record.totalGold = (run.record.totalGold || 0) + relicStats.dailyGold;
    }
    run.offers = rollOffers();
    run.merchantStock = isMerchantDay(run.day) ? rollMerchantStock() : [];
    run.refreshes = 0;
    // 铁砧上的剑跨天保留在原位（只有记录失效时才清理）
    if (run.anvilId && !getSword(run.anvilId)) run.anvilId = null;
    // 空巢龙：每日补给减少
    const count = Math.max(0, B.baseSwords + relicStats.extraSword + (run.funeralBonus || 0) +
      (run.nextSupplyBonus || 0) + (ev === 'supply' ? 2 : 0) - (dm.supplyPenalty || 0));
    run.lastSupply = count;
    run.funeralBonus = 0;
    run.nextSupplyBonus = 0;
    for (let i = 0; i < count; i++) {
      let extra = 0;
      if (run.inheritLevel > 0) {
        extra = run.inheritLevel;
        run.inheritLevel = 0;
      }
      addSword(extra);
    }
    run.record.maxDay = Math.max(run.record.maxDay, run.day);
    saveUnlocks();
    saveGame();
    syncWorld();
    updateHUD();
  }

  function syncWorld() {
    if (!world) return;
    if (!run) {
      world.sync({
        swords: [],
        anvilId: null,
        counterIds: [],
        day: 1,
        anger: 0,
        merchant: false,
        lang,
        offers: [],
        refreshCost: 208,
        merchantStock: [],
        machineSwords: 0,
        elfOn: false,
        elfCarry: 1,
        phantomHammer: false,
        quota: 0,
        offered: 0
      });
      return;
    }
    world.sync({
      swords: run.swords.map(s => ({
        id: s.id,
        level: s.level,
        heated: s.heated,
        location: s.location,
        cracks: s.cracks,
        form: s.form,
        variant: s.variant,
        rackSlot: s.rackSlot,
        counterSlot: s.counterSlot
      })),
      anvilId: run.anvilId,
      counterIds: run.swords.filter(s => s.location === 'counter').map(s => s.id),
      day: run.day,
      anger: run.anger,
      merchant: isMerchantDay(run.day),
      lang,
      offers: run.offers,
      refreshCost: refreshCost(),
      merchantStock: run.merchantStock,
      machineSwords: run.swords.filter(s => s.location === 'machine').length,
      elfOn: !!run.elfOn,
      elfCarry: 1 + relicStats.elfCarry,
      phantomHammer: relicStats.phantomHammer,
      quota: run.quota,
      offered: fmtLog(counterTotal()),
      offeredMet: counterTotal() >= Math.log10(Math.max(1, run.quota))
    });
  }

  /* ------------------------------ 锻造 ------------------------------ */

  function enterForgeMode() {
    const s = anvilSword();
    if (!s) return;
    forgeMode = true;
    busy = false;
    frenzy.active = false;
    lastLog = t('logReady');
    world.enterForge({
      level: s.level,
      heated: s.heated,
      cracks: s.cracks,
      form: s.form,
      variant: s.variant
    });
    UI.frenzyFlash.classList.remove('on');
    updateChrome();
    updateForgeUI();
    audio.ui();
  }

  function exitForgeMode() {
    if (!forgeMode) return;
    clearChainFrenzy();
    endFrenzy(false);
    if (run) run.swingSnapshot = null;
    forgeMode = false;
    busy = false;
    UI.frenzyFlash.classList.remove('on');
    world.exitForge();
    // 回到场景后把鼠标重新锁上；Esc 解锁后的冷却期内会被拒绝，稍后补一次
    relockMouse(0);
    relockMouse(1400);
    updateChrome();
    updateHUD();
    updatePrompt();
    audio.ui();
  }

  function trySwing() {
    if (!forgeMode || busy || !run || run.over) return;
    const s = anvilSword();
    if (!s) return;

    if (frenzy.active && Date.now() >= frenzy.until) endFrenzy(true);

    let startedFrenzy = false;
    if (!frenzy.active && !dragonMods().frenzyBanned && s.charge >= frenzyNeed()) {
      startFrenzy();
      startedFrenzy = true;
    }

    const odds = oddsFor(s);
    let outcome;
    if (run.forceGreat > 0) {
      run.forceGreat -= 1;
      outcome = 'great';
      updateBuffBar();
    } else {
      outcome = drawOutcome(odds);
    }
    // 红粉笔只影响这一锤
    if (run.greatDouble > 0) {
      run.greatDouble -= 1;
      updateBuffBar();
    }
    // 粉末袋改写结果
    if (run.powderBag > 0) {
      run.powderBag -= 1;
      outcome = (outcome === 'success' || outcome === 'great') ? 'great' : 'break';
      toast(t('toastPowder'), 'good');
      updateBuffBar();
    }
    // 开裂的龙鳞：无论结果都消耗，但挡掉这一次破碎
    if (run.crackedScale > 0) {
      run.crackedScale -= 1;
      if (outcome === 'break') outcome = 'damage';
      toast(t('toastCrackedScale'), 'good');
      updateBuffBar();
    }

    // 悔恨的发条：记录这一锤之前的剑状态
    run.swingSnapshot = JSON.parse(JSON.stringify(s));
    run.swingSnapshot._run = {
      gold: run.gold,
      totalGold: run.record.totalGold,
      inheritLevel: run.inheritLevel,
      nextSwordCharge: run.nextSwordCharge,
      funeralBonus: run.funeralBonus,
      breakWeightBonus: run.breakWeightBonus,
      breaks: run.ach ? run.ach.breaks : 0
    };
    busy = true;
    updateForgeUI();
    // 泥沼龙：挥击动作整体放慢
    if (world && world.setSwingSlow) world.setSwingSlow(dragonMods().swingSlow);

    const swung = world.swing(() => {
      audio.hammer(outcome === 'great' || outcome === 'success');
      const visual = outcome === 'break' && breakGuardAvailable(s) ? 'damage' : outcome;
      world.playOutcome(visual);
      resolveOutcome(s, outcome, startedFrenzy);
    }, () => {
      busy = false;
      updateForgeUI();
      // 入神期间自动连续锤击，直到入神结束或铁砧上的剑没了
      if (frenzy.active) {
        const speed = 1 + (relicStats.autoHammer || 0);
        scheduleAutoHammer(Math.max(0, 60 / speed));
      }
    });

    if (!swung) {
      busy = false;
      run.swingSnapshot = null;
      return;
    }
    unlocks.swings = (unlocks.swings || 0) + 1;
    if (unlocks.swings % 10 === 0) saveUnlocks();
    checkAchievements();
  }

  function clearAutoHammer() {
    if (autoHammerTimer) {
      clearTimeout(autoHammerTimer);
      autoHammerTimer = 0;
    }
  }

  function clearChainFrenzy() {
    if (chainFrenzyTimer) {
      clearTimeout(chainFrenzyTimer);
      chainFrenzyTimer = 0;
    }
  }

  // 入神结束后如果充能还够，就自动接着下一次入神
  function scheduleChainFrenzy(tries) {
    clearChainFrenzy();
    chainFrenzyTimer = setTimeout(() => {
      chainFrenzyTimer = 0;
      if (!forgeMode || !run || run.over || frenzy.active) return;
      const s = anvilSword();
      if (!s) return;
      if (busy) {
        if (tries < 10) scheduleChainFrenzy(tries + 1);
        return;
      }
      if (!dragonMods().frenzyBanned && (s.charge || 0) >= frenzyNeed()) {
        startFrenzy();
        scheduleAutoHammer(120);
      }
    }, tries === 0 ? 260 : 320);
  }

  // 入神自动锤：每次挥锤结束后按设置间隔继续下一锤
  function scheduleAutoHammer(delay) {
    clearAutoHammer();
    if (!frenzy.active || !forgeMode || !run || run.over) return;
    autoHammerTimer = setTimeout(() => {
      autoHammerTimer = 0;
      if (!frenzy.active || !forgeMode || !run || run.over) return;
      if (Date.now() >= frenzy.until) {
        endFrenzy(true);
        return;
      }
      if (!anvilSword()) return;
      trySwing();
    }, Math.max(0, Math.round(delay || 0)));
  }

  function startFrenzy() {
    const s = anvilSword();
    if (!s) return;
    clearChainFrenzy();
    const cost = frenzyNeed();
    const secs = frenzySecondsFor(s.level);
    frenzy.active = true;
    frenzy.until = Date.now() + secs * 1000;
    frenzy.total = secs;
    // 只消耗本次入神需要的格子，多出来的充能留到下一次
    s.charge = Math.max(0, (s.charge || 0) - cost);
    if (run.ach) run.ach.frenzies += 1;
    checkAchievements();
    world.setFrenzy(true);
    world.setFrenzySpeed(1 + (relicStats.autoHammer || 0));
    UI.frenzyFlash.classList.add('on');
    audio.frenzy();
    toast(t('toastFrenzy', { n: secs }), 'good');
    updateForgeUI();
    updateTicketBoard();
  }

  function endFrenzy(announce) {
    clearAutoHammer();
    if (!frenzy.active) return;
    frenzy.active = false;
    frenzy.until = 0;
    frenzy.total = 0;
    if (world) {
      world.setFrenzy(false);
      world.setFrenzySpeed(1);
    }
    UI.frenzyFlash.classList.remove('on');
    if (announce) toast(t('toastFrenzyEnd'));
    if (forgeMode) updateForgeUI();
    updateTicketBoard();
    // 结束后如果还有余量，自动续上入神
    if (announce && forgeMode && run && !run.over) scheduleChainFrenzy(0);
  }

  function resolveOutcome(s, outcome, startedFrenzy, phantom) {
    if (!s) return false;
    const name = swordName(s);
    const dm = dragonMods();
    if (!phantom) {
      // 龙王层数：每次锻造按这把剑当前的破碎层数累加，只增不减
      run.dragonLayers = (run.dragonLayers || 0) + breakLayersFor(s.level);
      // 毒牙龙：损伤有概率直接变成破碎
      if (outcome === 'damage' && dm.damageToBreak > 0 && Math.random() < dm.damageToBreak) {
        outcome = 'break';
        toast(t('toastDragonFester'), 'danger');
      }
      // 蛊龙：入神中的大成功反噬
      if (outcome === 'great' && frenzy.active && dm.frenzyBreakPct > 0 && Math.random() < dm.frenzyBreakPct) {
        outcome = 'break';
        toast(t('toastDragonHex'), 'danger');
      }
      // 铁鳞龙：每次成功累积裂痕，满阈值直接自碎
      if (outcome === 'success' && dm.crackThreshold > 0) {
        s.dragonCracks = (s.dragonCracks || 0) + 1;
        if (s.dragonCracks >= dm.crackThreshold) {
          s.dragonCracks = 0;
          outcome = 'break';
          toast(t('toastDragonCrack'), 'danger');
        }
      }
    }
    let survived = true;
    let survivedOutcome = outcome;
    let detail = '';
    let bannerDetail = '';
    if (outcome !== 'hold') s.holdStreak = 0;

    if (outcome === 'success') {
      let levels = 1;
      s.successCount = (s.successCount || 0) + 1;
      const tr = formTrait(s);
      if (relicStats.successEvery2Level > 0 && s.successCount % 2 === 0) {
        levels += relicStats.successEvery2Level;
      }
      if (tr && tr.successEvery2 && s.successCount % 2 === 0) levels += tr.successEvery2;
      if (tr && tr.highSuccess && s.level >= 7) levels += tr.highSuccess;
      s.level = Math.min(levelCap(), s.level + levels);
      const highBonus = s.level >= 7 ? 1 + relicStats.highLevelSuccessValue : 1;
      const traitMult = 1 + ((tr && tr.valueMult) || 0);
      s.lv += levels * Math.log10(Math.max(1.0000001, B.valueGrowth)) +
        Math.log10(Math.max(0.0001, (1 + relicStats.successBonus) * Math.max(0.0001, highBonus) * traitMult));
      if (relicStats.successShield > 0 && s.successCount % 3 === 0) {
        run.shields += relicStats.successShield;
        toast(t('toastShield'), 'good');
        updateBuffBar();
      }
      detail = `+${levels} · ${fmtLog(effective(s))} G`;
      bannerDetail = `+${levels}`;
      audio.success();
    } else if (outcome === 'great') {
      const tr = formTrait(s);
      const levels = 2 + relicStats.greatExtra + ((tr && tr.greatLevels) || 0);
      s.level = Math.min(levelCap(), s.level + levels);
      const highBonus = s.level >= 7 ? 1 + relicStats.highLevelSuccessValue : 1;
      const greatVal = relicStats.greatValue * ((tr && tr.greatMult) || 1) * (1 + ((tr && tr.valueMult) || 0));
      s.lv += Math.log10(Math.max(0.0001, greatVal * (1 + relicStats.successBonus) * Math.max(0.0001, highBonus)));
      detail = `+${levels} · ${fmtLog(effective(s))} G`;
      bannerDetail = `+${levels}`;
      // 入神余韵：入神中的大成功直接折算成入神充能，结束后仍然保留
      if (frenzy.active && relicStats.frenzyGreatCharge > 0) {
        s.charge = (s.charge || 0) + relicStats.frenzyGreatCharge;
      }
      audio.great();
    } else if (outcome === 'hold') {
      s.holdStreak = (s.holdStreak || 0) + 1;
      const tr = formTrait(s);
      const holdBoost = 1 + relicStats.holdValue * ((tr && tr.holdMult) || 1);
      s.lv = logAdd(s.lv + Math.log10(Math.max(0.0001, holdBoost)),
        relicStats.holdFlat > 0 ? Math.log10(relicStats.holdFlat) : -Infinity);
      const pct = Math.round((holdBoost - 1) * 100);
      detail = pct ? `+${pct}% · ${fmtLog(effective(s))} G` : t('resHold');
      bannerDetail = pct ? `+${pct}%` : '';
      audio.hold();
    } else if (outcome === 'damage') {
      s.cracks += 1;
      const guarded = (s.freeDamage || 0) < relicStats.damageGuard;
      if (guarded) {
        s.freeDamage = (s.freeDamage || 0) + 1;
        if (relicStats.damageFlat > 0) s.lv = logAdd(s.lv, Math.log10(relicStats.damageFlat));
        detail = `${t('resDamage')} · ${fmtLog(effective(s))} G`;
        bannerDetail = '';
      } else {
        const oldLevel = s.level;
        let lost = 1;
        s.level = Math.max(0, s.level - 1);
        // 毒牙龙：损伤额外多掉级
        if (dm.damageExtra > 0 && s.level > 0) {
          const extra = Math.min(s.level, dm.damageExtra);
          s.level -= extra;
          lost += extra;
        }
        s.lv = Math.max(baseValueLog(s.level), s.lv - lost * Math.log10(Math.max(1.0000001, B.valueGrowth)));
        if (relicStats.damageFlat > 0) s.lv = logAdd(s.lv, Math.log10(relicStats.damageFlat));
        if (oldLevel > 0 && relicStats.damageRestore > 0 && Math.random() < relicStats.damageRestore) {
          s.level = oldLevel;
          detail = `${t('resDamage')} · ${fmtLog(effective(s))} G`;
          bannerDetail = '';
        } else {
          detail = `-${lost} · ${fmtLog(effective(s))} G`;
          bannerDetail = '-' + lost;
        }
      }
      const tr = formTrait(s);
      if (tr && tr.damageValue) {
        s.lv += Math.log10(1 + tr.damageValue);
        detail = `${t('resDamage')} · ${fmtLog(effective(s))} G · ${lang === 'zh' ? tr.zh : tr.en}`;
      }
      if (relicStats.damageToShield > 0) {
        run.damageMeter = (run.damageMeter || 0) + 1;
        if (run.damageMeter >= 2) {
          run.damageMeter = 0;
          run.shields += 1;
          toast(t('toastShield'), 'good');
        }
      }
      audio.damage();
      if (!phantom) damageFlash();
    } else if (outcome === 'break') {
      survived = false;
      bannerDetail = '';
      let guardKey = '';
      if (!hasDragon('nopardon')) {
        if (run.shields > 0) {
          run.shields -= 1;
          guardKey = 'shield';
        } else if (relicStats.firstBreakGuard > 0 && !s.firstBreakUsed) {
          s.firstBreakUsed = true;
          guardKey = 'first';
        } else if ((run.dailyBreakGuard || 0) > 0) {
          run.dailyBreakGuard -= 1;
          guardKey = 'daily';
        } else if (relicStats.breakValueResist > 0 && !s.phoenixUsed) {
          s.phoenixUsed = true;
          guardKey = 'phoenix';
        }
      }

      if (guardKey) {
        s.cracks += 1;
        if (guardKey === 'phoenix') {
          s.lv += Math.log10(Math.max(0.0001, 1 - relicStats.breakValueResist));
          detail = t('toastPhoenix');
          toast(t('toastPhoenix'), 'good');
        } else {
          s.level = Math.max(0, s.level - 1);
          s.lv = Math.max(baseValueLog(s.level), s.lv - Math.log10(Math.max(1.0000001, B.valueGrowth)));
          detail = guardKey === 'first' ? t('toastFirstBreak')
            : guardKey === 'daily' ? t('toastDailyGuard', { n: run.dailyBreakGuard }) : t('shieldLabel');
          toast(guardKey === 'first' ? t('toastFirstBreak')
            : guardKey === 'daily' ? t('toastDailyGuard', { n: run.dailyBreakGuard }) : t('toastShield'), 'good');
        }
        survived = true;
        survivedOutcome = 'damage';
        updateBuffBar();
        audio.damage();
        damageFlash();
      } else {
        const lostValue = effective(s);
        run.record.bestValueLog = Math.max(run.record.bestValueLog || 0, lostValue);
        if (s.level >= 7 && relicStats.breakOnHighLossMark > 0) {
          run.breakWeightBonus = (run.breakWeightBonus || 0) + relicStats.breakOnHighLossMark;
        }
        // 玄冥龙：破碎不继承任何等级
        const inheritPct = hasDragon('reverse') ? 0 : Math.max(
          relicStats.inheritOnBreak,
          (formTrait(s) && formTrait(s).inheritOnBreak) || 0
        );
        if (inheritPct > 0 && s.level > 0) {
          run.inheritLevel = Math.max(run.inheritLevel, Math.floor(s.level * inheritPct));
          if (relicStats.inheritCharge > 0) run.nextSwordCharge = relicStats.inheritCharge;
          toast(t('toastInherit', { n: run.inheritLevel }));
        }
        if (relicStats.funeralSword > 0 && s.level >= 7) {
          run.funeralBonus = Math.min(2, (run.funeralBonus || 0) + relicStats.funeralSword);
        }
        if (relicStats.scrapGold > 0) {
          const scrap = Math.min(1e12, Math.floor(Math.pow(10, Math.min(300, lostValue + Math.log10(Math.max(0.000001, relicStats.scrapGold))))));
          if (scrap > 0) {
            run.gold += scrap;
            run.record.totalGold += scrap;
            toast(t('toastScrap', { gold: fmt(scrap) }), 'good');
          }
        }
        if (run.ach) run.ach.breaks += 1;
        run.swords = run.swords.filter(x => x.id !== s.id);
        run.anvilId = null;
        // 碎星龙：碎一把剑时连坐裂开其他剑
        if (!phantom && dm.chainBreak > 0 && run.swords.length) {
          const others = run.swords.slice();
          const n = Math.min(others.length, dm.chainBreak);
          for (let i = 0; i < n; i++) {
            const v = others.splice(Math.floor(Math.random() * others.length), 1)[0];
            v.cracks = (v.cracks || 0) + 1;
            if (v.level > 0) {
              v.level -= 1;
              v.lv = Math.max(baseValueLog(v.level), v.lv - Math.log10(Math.max(1.0000001, B.valueGrowth)));
            }
          }
          if (n > 0) toast(t('toastDragonChain', { n }), 'danger');
        }
        if (phantom && world) world.playOutcome('break');
        toast(t('toastBreak', { name }), 'danger');
        audio.shatter();
        damageFlash();
        lastLog = t('logBroken');
        checkAchievements();
        saveGame();
        syncWorld();
        updateHUD();
        updateForgeUI();
        banner(t('resBreak'), '#ff6a4d');
        setTimeout(() => {
          if (forgeMode && !run.anvilId) {
            exitForgeMode();
          }
        }, 1700);
        return false;
      }
    }

    run.record.bestValueLog = Math.max(run.record.bestValueLog || 0, effective(s));

    // 幻影锤：每把幽灵锤都像正常锤一样独立判定一次（可能加级、损伤甚至打碎剑）
    if (!phantom && survived && outcome !== 'break' && relicStats.phantomHammer > 0) {
      const parts = [];
      for (let i = 0; i < relicStats.phantomHammer; i++) {
        const out = drawOutcome(oddsFor(s));
        parts.push(t('phantomOut' + out.charAt(0).toUpperCase() + out.slice(1)));
        const ok = resolveOutcome(s, out, false, true);
        if (!ok) return false;
      }
      if (parts.length) {
        const txt = parts.join(' ');
        detail += ' · ' + txt;
        bannerDetail = bannerDetail ? bannerDetail + ' ' + txt : txt;
      }
    }

    if (survived && !frenzy.active && !startedFrenzy && outcome !== 'break') {
      const tr = formTrait(s);
      const gain = 1 + relicStats.chargeBonus + (outcome === 'great' ? relicStats.greatCharge : 0) +
        ((tr && tr.charge) || 0);
      s.charge = (s.charge || 0) + gain;
    }

    if (!phantom) {
      rememberSwordLevel(s);
      if (survived && relicStats.duplicateChance > 0 && Math.random() < relicStats.duplicateChance) {
        const copy = duplicateSword(s);
        if (copy) toast(t('toastDuplicate', { name: swordName(copy) }), 'good');
      }
      checkAchievements();

      const logText = `${t('res' + survivedOutcome.charAt(0).toUpperCase() + survivedOutcome.slice(1))} · ${detail}`;
      const bannerText = t('res' + outcome.charAt(0).toUpperCase() + outcome.slice(1)) + (bannerDetail ? ' ' + bannerDetail : '');
      const bannerColor = outcome === 'great' ? '#d6b8ff' : outcome === 'success' ? '#9fe6a8' : outcome === 'hold' ? '#cdb35c' : '#ff9a5c';
      // 盲龙：结果延迟揭晓
      if (dm.resultDelay > 0) {
        setTimeout(() => {
          lastLog = logText;
          banner(bannerText, bannerColor);
          if (forgeMode) updateForgeUI();
        }, Math.round(dm.resultDelay * 1000));
      } else {
        lastLog = logText;
        banner(bannerText, bannerColor);
      }
      saveGame();
      syncWorld();
      updateHUD();
      updateForgeUI();
    }
    return survived;
  }

  function renderTickets(odds) {
    if (!UI.fpTicketRow) return;
    const order = ['break', 'damage', 'hold', 'success', 'great'];
    UI.fpTicketRow.innerHTML = order.map(k => {
      const cap = k.charAt(0).toUpperCase() + k.slice(1);
      const v = odds ? (odds.w[k] || 0) : 0;
      return `<div class="ticket ${k}"><i></i><span>${t('out' + cap)}</span><b>${(Math.round(v * 10) / 10).toFixed(1)}</b></div>`;
    }).join('');
    if (UI.fpTicketTotal) {
      UI.fpTicketTotal.textContent = (odds ? Math.round(odds.total * 10) / 10 : 0).toFixed(1);
    }
  }

  // 破坏项旁的小徽标：显示等级叠了几层
  function setBreakTierBadge(layers) {
    const cell = UI.odds && UI.odds.break ? UI.odds.break.parentElement : null;
    if (!cell) return;
    let el = cell.querySelector('.odd-tier');
    if (layers > 0) {
      if (!el) {
        el = document.createElement('i');
        el.className = 'odd-tier';
        cell.appendChild(el);
      }
      el.textContent = L(`层×${layers}`, `×${layers}`);
    } else if (el) {
      el.remove();
    }
  }

  function updateForgeUI() {
    if (!forgeMode) return;
    updateForgeInventory();
    ensureFrenzyPips();
    const s = anvilSword();
    const charge = s ? s.charge : 0;
    const need = frenzyNeed();
    const secs = s ? frenzySecondsFor(s.level) : 0;
    // 高等级会额外要求更多格子，鼠标悬停时说明来源
    const baseNeed = Math.max(1, Math.round(B.frenzyCharge - (relicStats.frenzyCost || 0)));
    const extraNeed = Math.max(0, need - baseNeed);
    const timeLoss = s ? frenzyTimeLoss(s.level) : 0;
    const tips = [`${L('本次入神', 'Frenzy duration')} ${secs}s`];
    if (extraNeed > 0) tips.push(L(`高等级额外 +${extraNeed} 格`, `+${extraNeed} cells from level`));
    if (timeLoss > 0) tips.push(L(`高等级入神 -${timeLoss} 秒`, `-${timeLoss}s Frenzy from level`));
    UI.fpChargeText.title = tips.join(' · ');
    const pips = Array.prototype.slice.call(UI.fpPips.children);

    if (!s) {
      renderTickets(null);
      UI.fpName.textContent = '—';
      UI.fpLevel.textContent = '0';
      UI.fpValue.textContent = '0';
      UI.fpGreatLevel.textContent = '+0';
      UI.fpGreatGain.textContent = '';
      UI.fpTrait.textContent = '';
      UI.fpTrait.classList.add('hidden');
      pips.forEach(p => p.classList.remove('on'));
      UI.fpChargeText.textContent = '0 / ' + need;
      ['break', 'damage', 'hold', 'success', 'great'].forEach(k => {
        UI.odds[k].textContent = '0.0%';
      });
      setBreakTierBadge(0);
      UI.fpHeatFill.style.width = '0%';
      UI.fpLog.textContent = t('logBroken');
      UI.fpQuota.innerHTML = `<span>${t('tributeDue')}</span><b>${fmt(run ? run.quota : 0)} G</b><span>${t('offered')}</span><b>${fmtLog(counterTotal())} G</b>`;
      UI.btnSwing.disabled = true;
      UI.btnTakeSword.disabled = true;
      return;
    }

    const odds = oddsFor(s);
    const dm = dragonMods();
    renderTickets(dm.hideOdds || dm.hideLevels >= 3 ? null : odds);
    const tr = formTrait(s);
    const greatLevels = 2 + relicStats.greatExtra + ((tr && tr.greatLevels) || 0);
    const greatVal = relicStats.greatValue * ((tr && tr.greatMult) || 1) * (1 + ((tr && tr.valueMult) || 0));
    const greatMult = greatVal * (1 + relicStats.successBonus) - 1;
    const greatGainLog = effective(s) + Math.log10(Math.max(0.0001, greatMult));

    // 迷雾龙：随累计层数逐步遮住剑名 / 等级 / 估值 / 概率
    UI.fpName.textContent = dm.hideLevels >= 4 ? '???' : swordName(s);
    UI.fpLevel.textContent = dm.hideLevels >= 1 ? '??' : s.level;
    UI.fpValue.textContent = dm.hideLevels >= 2 ? '???' : fmtLog(effective(s));
    UI.fpGreatLevel.textContent = dm.hideLevels >= 2 ? '??' : '+' + greatLevels;
    UI.fpGreatGain.textContent = dm.hideLevels >= 2 ? '???' : `+${fmtLog(greatGainLog)} G · ${greatVal}×`;
    if (tr) {
      UI.fpTrait.textContent = `${lang === 'zh' ? tr.zh : tr.en} · ${lang === 'zh' ? tr.descZh : tr.descEn}`;
      UI.fpTrait.classList.remove('hidden');
    } else {
      UI.fpTrait.textContent = '';
      UI.fpTrait.classList.add('hidden');
    }

    pips.forEach((p, i) => p.classList.toggle('on', i < charge));
    if (dm.frenzyBanned) {
      // 蚀骨龙：整局无法进入入神
      UI.fpChargeText.textContent = t('frenzyBanned');
      UI.fpChargeText.title = t('frenzyBanned');
      pips.forEach(p => p.classList.remove('on'));
    } else if (frenzy.active) {
      const remain = Math.max(0, (frenzy.until - Date.now()) / 1000);
      UI.fpChargeText.textContent = remain.toFixed(1) + 's';
    } else if (charge >= need) {
      const over = charge - need;
      UI.fpChargeText.textContent = t('resFrenzy') + '!' + (over > 0 ? ' +' + over : '') + ' · ' + secs + 's';
    } else {
      UI.fpChargeText.textContent = charge + ' / ' + need + ' · ' + secs + 's';
    }

    const hideOdds = dm.hideOdds || dm.hideLevels >= 3;
    for (const k of ['break', 'damage', 'hold', 'success', 'great']) {
      const pct = k === 'break' ? Math.min(99.9, odds.pct[k]) : odds.pct[k];
      UI.odds[k].textContent = hideOdds ? '??' : pct.toFixed(1) + '%';
    }
    UI.odds.break.title = frenzy.active
      ? L('入神期间不会破碎', 'No breaking during Frenzy')
      : '';
    setBreakTierBadge(breakLayersFor(s.level));

    if (frenzy.active) {
      const total = Math.max(1, frenzy.total || frenzySecondsFor(s.level));
      const remain = clamp((frenzy.until - Date.now()) / 1000, 0, total);
      UI.fpHeatFill.style.width = (remain / total * 100) + '%';
    } else {
      UI.fpHeatFill.style.width = '100%';
    }

    UI.fpLog.textContent = lastLog || t('logReady');
    UI.fpQuota.innerHTML = `<span>${t('tributeDue')}</span><b>${fmt(run.quota)} G</b><span>${t('offered')}</span><b>${fmtLog(counterTotal())} G</b>`;

    UI.btnSwing.disabled = busy || !s;
    UI.btnTakeSword.disabled = busy;
  }

  function uiTick() {
    updateBuffBar();
    bankFloorSwords();
    if (!forgeMode) return;
    if (frenzy.active) {
      if (Date.now() >= frenzy.until) endFrenzy(true);
      else updateForgeUI();
    }
  }

  /* ------------------------------ 数值设置 ------------------------------ */

  const CONFIG_KEY = CFG.configKey || 'forgeTax.config.v1';
  const L = (zh, en) => (lang === 'zh' ? zh : en);
  let cfgDefaults = null;
  let cfgCurrent = null;
  let settingsReturn = null;
  let codexScale = 'lg';
  let forgeScale = 'md';

  function setCodexScale(v) {
    codexScale = ['md', 'lg', 'xl'].includes(v) ? v : 'lg';
    if (document.body) document.body.dataset.codex = codexScale;
  }

  // 锻造面板单独缩放（不影响图鉴/其他界面）
  function setForgeScale(v) {
    forgeScale = ['sm', 'md', 'lg', 'xl'].includes(v) ? v : 'md';
    if (document.body) document.body.dataset.forge = forgeScale;
  }

  // 可调数值：键、中文名、英文名、上下限、步长
  const BALANCE_FIELDS = [
    { k: 'maxDays', zh: '契约天数（≤21）', en: 'Contract days (≤21)', min: 1, max: 21, step: 1 },
    { k: 'baseSwords', zh: '每日发剑', en: 'Blades per day', min: 0, max: 20, step: 1 },
    { k: 'baseQuota', zh: '首日贡额', en: 'First day quota', min: 100, max: 1000000, step: 100 },
    { k: 'finalQuota', zh: '末日贡额', en: 'Final day quota', min: 100, max: 100000000, step: 1000 },
    { k: 'maxAnger', zh: '怒气上限', en: 'Max anger', min: 1, max: 9, step: 1 },
    { k: 'maxCounter', zh: '贡台格数（≤5）', en: 'Counter slots (≤5)', min: 1, max: 5, step: 1 },
    { k: 'baseValue', zh: '基础剑值', en: 'Base blade value', min: 1, max: 100000, step: 10 },
    { k: 'valueGrowth', zh: '每级剑值倍率', en: 'Value growth / level', min: 1, max: 5, step: 0.01 },
    { k: 'maxLevel', zh: '等级上限（0 = 无上限）', en: 'Max level (0 = unlimited)', min: 0, max: 9999, step: 1 },
    { k: 'breakTierStart', zh: '破坏叠层起始等级', en: 'Break tier start level', min: 0, max: 999, step: 1 },
    { k: 'breakTierStep', zh: '每几级叠一层破坏', en: 'Levels per break tier', min: 1, max: 99, step: 1 },
    { k: 'breakTierChance', zh: '每层破坏概率', en: 'Break chance per tier', min: 0, max: 0.2, step: 0.005, pct: true },
    { k: 'frenzyTierStride', zh: '入神格子判定间隔（级）', en: 'Frenzy tier stride (lv)', min: 1, max: 100, step: 1 },
    { k: 'frenzyTierChance', zh: '入神格子增长概率', en: 'Frenzy tier growth chance', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'frenzyTimeStride', zh: '入神时长判定间隔（级）', en: 'Frenzy time stride (lv)', min: 1, max: 100, step: 1 },
    { k: 'frenzyTimeChance', zh: '入神时长缩短概率', en: 'Frenzy time loss chance', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'frenzyCharge', zh: '入神所需充能', en: 'Frenzy charge needed', min: 1, max: 99, step: 1 },
    { k: 'frenzySeconds', zh: '入神持续（秒）', en: 'Frenzy seconds', min: 0.5, max: 30, step: 0.5 },
    { k: 'normalSwingMs', zh: '挥锤间隔（毫秒）', en: 'Swing interval (ms)', min: 50, max: 2000, step: 10 },
    { k: 'frenzySwingMs', zh: '入神间隔（毫秒）', en: 'Frenzy interval (ms)', min: 30, max: 1000, step: 10 },
    { k: 'goldBase', zh: '日结基础金币', en: 'Daily gold base', min: 0, max: 100000, step: 10 },
    { k: 'goldPerDay', zh: '每日金币递增', en: 'Gold per day', min: 0, max: 10000, step: 10 },
    { k: 'goldExcessRate', zh: '超额返金率', en: 'Excess gold rate', min: 0, max: 0.2, step: 0.0001 },
    { k: 'refreshCost', zh: '遗物机刷新费', en: 'Refresh base cost', min: 0, max: 100000, step: 10 },
    { k: 'refreshGrowth', zh: '刷新费递增', en: 'Refresh growth', min: 0, max: 10000, step: 10 },
    { k: 'merchantEvery', zh: '商人每隔几天', en: 'Merchant every N days', min: 1, max: 30, step: 1 },
    { k: 'merchantSlots', zh: '商人每次几种货', en: 'Merchant offers per visit', min: 2, max: 6, step: 1 },
    { k: 'moveSpeed', zh: '移动速度（米/秒）', en: 'Move speed (m/s)', min: 0.5, max: 8, step: 0.1 }
  ];

  // 遗物效果字段的可读名称
  const EFFECT_LABELS = {
    successBonus: ['成功剑值加成', 'Success value bonus', true],
    shield: ['每日破碎保护', 'Daily break shield', false],
    'tickets.damage': ['损伤签权重', 'Damage tickets', false],
    'tickets.hold': ['维持签权重', 'Hold tickets', false],
    'tickets.success': ['成功签权重', 'Success tickets', false],
    'tickets.great': ['大成功签权重', 'Great tickets', false],
    damageRestore: ['损伤恢复概率', 'Damage restore chance', true],
    damageFlat: ['损伤附加剑值', 'Damage flat value', false],
    inheritOnBreak: ['破碎继承比例', 'Inherit on break', true],
    scrapGold: ['破碎返金比例', 'Scrap gold rate', true],
    quotaMult: ['贡额倍率', 'Quota multiplier', false],
    extraSword: ['额外发剑', 'Extra swords', false],
    frenzyBonus: ['入神加时（秒）', 'Frenzy bonus (s)', false],
    chargeBonus: ['入神充能加成', 'Frenzy charge bonus', false],
    breakMult: ['破碎权重倍率', 'Break weight multiplier', false],
    breakTierCut: ['等级破坏削减', 'Level break chance cut', true],
    breakChanceFlat: ['破坏概率直接增减', 'Break chance flat', true],
    frenzyTierCut: ['入神格子增长削减', 'Frenzy tier growth cut', true],
    frenzyTimeCut: ['入神时长缩短削减', 'Frenzy time loss cut', true],
    frenzyGreatCharge: ['入神中大成功充能', 'Frenzy Great charge', false],
    phantomHammer: ['幽灵锤数量', 'Phantom hammers', false],
    elfCarry: ['小精灵额外搬运', 'Elf extra carry', false],
    holdValue: ['维持剑值加成', 'Hold value bonus', true],
    greatExtra: ['大成功额外等级', 'Great extra levels', false],
    valueMult: ['剑值总加成', 'Total value bonus', true],
    merchantDiscount: ['商人折扣', 'Merchant discount', true],
    refreshDiscount: ['刷新折扣', 'Refresh discount', true],
    tributeGold: ['进贡额外金币', 'Tribute bonus gold', false],
    nextSwordLevel: ['新剑起始等级', 'New blade start level', false],
    greatValue: ['大成功剑值倍率', 'Great value multiplier', false],
    startHeated: ['新剑自带加热（0/1）', 'Start heated (0/1)', false],
    dailyGold: ['每日金币', 'Daily gold', false],
    frenzyCost: ['入神充能减免', 'Frenzy charge discount', false],
    greatCharge: ['大成功充能', 'Great success charge', false]
  };

  function configSnapshot() {
    return {
      ui: { codexScale, forgeScale },
      balance: JSON.parse(JSON.stringify(CFG.balance)),
      nonBreakShare: JSON.parse(JSON.stringify(CFG.nonBreakShare)),
      breakTable: CFG.breakTable.map(r => [r[0], r[1]]),
      starterRelics: CFG.starterRelics.slice(),
      tierMins: CFG.tiers.map(t => t.min),
      relicEffects: CFG.relics.reduce((o, r) => {
        o[r.id] = JSON.parse(JSON.stringify(r.effects || {}));
        return o;
      }, {}),
      merchantCosts: CFG.merchantItems.reduce((o, i) => {
        o[i.id] = i.cost;
        return o;
      }, {})
    };
  }

  function applyConfigSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    if (snap.ui && snap.ui.codexScale) setCodexScale(snap.ui.codexScale);
    if (snap.ui && snap.ui.forgeScale) setForgeScale(snap.ui.forgeScale);
    if (snap.balance) Object.assign(B, snap.balance);
    if (snap.nonBreakShare) Object.assign(CFG.nonBreakShare, snap.nonBreakShare);
    if (Array.isArray(snap.breakTable) && snap.breakTable.length) {
      CFG.breakTable = snap.breakTable.map(r => [Number(r[0]) || 0, Number(r[1]) || 0]);
    }
    if (Array.isArray(snap.starterRelics) && snap.starterRelics.length) {
      CFG.starterRelics = snap.starterRelics.slice();
    }
    if (Array.isArray(snap.tierMins)) {
      snap.tierMins.forEach((m, i) => {
        if (CFG.tiers[i]) CFG.tiers[i].min = Number(m) || 0;
      });
    }
    if (snap.relicEffects) {
      for (const id of Object.keys(snap.relicEffects)) {
        const relic = CFG.relics.find(r => r.id === id);
        if (relic) relic.effects = JSON.parse(JSON.stringify(snap.relicEffects[id] || {}));
      }
    }
    if (snap.merchantCosts) {
      for (const id of Object.keys(snap.merchantCosts)) {
        const item = CFG.merchantItems.find(i => i.id === id);
        if (item) item.cost = Number(snap.merchantCosts[id]) || 0;
      }
    }
  }

  function loadConfigOverrides() {
    cfgDefaults = configSnapshot();
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    } catch (err) {
      saved = null;
    }
    // 旧版默认等级上限是 99，现已改为无上限（0）；把老快照里的旧默认值迁移过来
    if (saved && saved.balance && Number(saved.balance.maxLevel) === 99) {
      saved.balance.maxLevel = 0;
    }
    if (saved) applyConfigSnapshot(saved);
    setCodexScale(codexScale);
    setForgeScale(forgeScale);
    cfgCurrent = configSnapshot();
  }

  function persistConfig() {
    cfgCurrent = configSnapshot();
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfgCurrent));
    } catch (err) {
      /* 存储不可用时忽略 */
    }
  }

  function setAtPath(root, parts, val) {
    let o = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }

  function showNum(v, pct) {
    const n = pct ? v * 100 : v;
    return String(Number(n.toFixed(pct ? 2 : 4)));
  }

  function cfgField(zh, en, path, value, opts) {
    const o = opts || {};
    const pct = !!o.pct;
    return `<label class="cfg-field"><span>${L(zh, en)}</span>
      <input type="number" data-cfg="${path}"${pct ? ' data-scale="pct"' : ''}
        value="${showNum(Number(value) || 0, pct)}"
        min="${o.min != null ? o.min : -1000000}"
        max="${o.max != null ? o.max : 1000000}"
        step="${o.step != null ? o.step : (pct ? 1 : 0.01)}"></label>`;
  }

  function settingsHTML() {
    const src = cfgCurrent || configSnapshot();
    const bal = src.balance || {};
    const share = src.nonBreakShare || {};

    const balFields = BALANCE_FIELDS.map(f =>
      cfgField(f.zh, f.en, 'balance.' + f.k, bal[f.k], f)
    ).join('');

    const shareFields = [
      ['damage', '损伤占比', 'Damage share'],
      ['hold', '维持占比', 'Hold share'],
      ['success', '成功占比', 'Success share'],
      ['great', '大成功占比', 'Great share']
    ].map(([k, zh, en]) =>
      cfgField(zh, en, 'nonBreakShare.' + k, share[k], { min: 0, max: 100, step: 0.5, pct: true })
    ).join('');

    const relicBlocks = CFG.relics.map(relic => {
      const eff = (src.relicEffects && src.relicEffects[relic.id]) || {};
      const fields = [];
      const walk = (obj, prefix) => {
        for (const k of Object.keys(obj)) {
          const val = obj[k];
          const path = prefix ? prefix + '.' + k : k;
          if (val && typeof val === 'object') {
            walk(val, path);
          } else {
            const meta = EFFECT_LABELS[path] || [path, path, false];
            fields.push(cfgField(meta[0], meta[1], 'relicEffects.' + relic.id + '.' + path, val, {
              min: -100000, max: 100000, step: meta[2] ? 1 : 0.01, pct: meta[2]
            }));
          }
        }
      };
      walk(eff, '');
      return `<details class="cfg-relic"><summary><span class="cfg-glyph">${relicGlyph(relic)}</span>${relic[lang]}</summary>
        <div class="cfg-grid">${fields.join('')}</div></details>`;
    }).join('');

    const merchantFields = CFG.merchantItems.map(item =>
      cfgField(item.zh, item.en, 'merchantCosts.' + item.id, item.cost, { min: 0, max: 1000000, step: 10 })
    ).join('');

    const tierFields = CFG.tiers.map((tier, i) =>
      cfgField(tier.zh + ' 起始等级', tier.en + ' min level', 'tierMins.' + i, tier.min, { min: 0, max: 999, step: 1 })
    ).join('');

    let runFields = '';
    if (run) {
      runFields = `<section class="cfg-section">
        <h3>${L('当前进度', 'CURRENT RUN')}</h3>
        <p class="cfg-note">${L('直接改存档里的数值，立即生效。', 'Edit live save values; applied immediately.')}</p>
        <div class="cfg-grid">
          <label class="cfg-field"><span>${L('金币', 'Gold')}</span><input type="number" data-run="gold" value="${run.gold}" min="0" step="10"></label>
          <label class="cfg-field"><span>${L('怒气', 'Anger')}</span><input type="number" data-run="anger" value="${run.anger}" min="0" max="${angerCap()}" step="1"></label>
          <label class="cfg-field"><span>${L('今日贡额', 'Quota today')}</span><input type="number" data-run="quota" value="${run.quota}" min="0" step="10"></label>
          <label class="cfg-field"><span>${L('跳到第 N 天', 'Jump to day')}</span><input type="number" data-run="day" value="${run.day}" min="1" max="${totalDays()}" step="1"></label>
        </div>
      </section>`;
    }

    // 持有遗物：可逐件丢弃，用于甩掉不想要的负面/无用遗物
    let ownedSection = '';
    if (run && run.relics.length) {
      const counts = relicCounts();
      const rows = Object.keys(counts).map(id => {
        const r = relicById(id);
        if (!r) return '';
        const n = counts[id];
        return `<div class="cfg-own">
          <span class="cfg-glyph">${relicGlyph(r)}</span>
          <div class="cfg-own-text">
            <b>${r[lang]}${n > 1 ? ' ×' + n : ''}</b>
            <em>${lang === 'zh' ? r.descZh : r.descEn}</em>
          </div>
          <button class="btn ghost small" data-act="discardRelic" data-id="${r.id}">${L('丢弃', 'Discard')}</button>
        </div>`;
      }).join('');
      ownedSection = `<section class="cfg-section">
        <h3>${L('持有遗物', 'HELD RELICS')}</h3>
        <p class="cfg-note">${L('丢弃后该遗物立即失效，且无法找回；同种遗物持有多件时每次丢弃一件。', 'A discarded relic stops working at once and cannot be recovered. Duplicates are discarded one at a time.')}</p>
        <div class="cfg-owns">${rows}</div>
      </section>`;
    }

    const json = JSON.stringify(src, null, 2).replace(/</g, '&lt;');

    return `<div class="end-kicker">${lang === 'zh' ? '锻剑纳贡' : 'FORGE TAX'}</div>
      <h2 class="starter-title">${L('数值设置', 'TUNING')}</h2>
      <p class="starter-sub">${L('所有数值即时生效，并保存在本机', 'Every value applies instantly and is saved locally')}</p>

      ${runFields}
      ${ownedSection}

      <section class="cfg-section">
        <h3>${L('界面', 'INTERFACE')}</h3>
        <p class="cfg-note">${L('调整“玩法”里剑与道具详情的字号和卡片大小。', 'Adjust the size of blade and item details in the codex.')}</p>
        <div class="cfg-grid">
          <label class="cfg-field"><span>${L('剑与道具详情字号', 'Codex text size')}</span>
            <select data-cfg="ui.codexScale" data-type="text">
              <option value="md"${codexScale === 'md' ? ' selected' : ''}>${L('标准', 'Standard')}</option>
              <option value="lg"${codexScale === 'lg' ? ' selected' : ''}>${L('大（默认）', 'Large (default)')}</option>
              <option value="xl"${codexScale === 'xl' ? ' selected' : ''}>${L('特大', 'Extra large')}</option>
            </select>
          </label>
          <label class="cfg-field"><span>${L('锻造界面大小', 'Forge UI size')}</span>
            <select data-cfg="ui.forgeScale" data-type="text">
              <option value="sm"${forgeScale === 'sm' ? ' selected' : ''}>${L('小', 'Small')}</option>
              <option value="md"${forgeScale === 'md' ? ' selected' : ''}>${L('标准（默认）', 'Standard (default)')}</option>
              <option value="lg"${forgeScale === 'lg' ? ' selected' : ''}>${L('大', 'Large')}</option>
              <option value="xl"${forgeScale === 'xl' ? ' selected' : ''}>${L('特大', 'Extra large')}</option>
            </select>
          </label>
          <label class="cfg-field"><span>${L('画质', 'Graphics')}</span>
            <button class="btn ghost small" data-act="toggleQuality">${lowQuality ? L('低画质（省电）', 'Low (fast)') : L('高画质', 'High')}</button>
          </label>
        </div>
        <div class="start-actions cfg-actions">
          <button class="btn" data-act="exportSave">${L('导出存档', 'Export save')}</button>
          <label class="btn" style="position:relative;overflow:hidden;cursor:pointer">${L('导入存档', 'Import save')}
            <input type="file" accept="application/json,.json" data-save-file style="position:absolute;inset:0;opacity:0;cursor:pointer">
          </label>
        </div>
        ${window.self !== window.top ? `<div class="start-actions cfg-actions">
          <button class="btn" data-act="clearCache">${L('清除缓存并重载（保留存档）', 'Clear cache & reload (keep save)')}</button>
          <button class="btn" data-act="openWindow">${t('openWindow')}</button>
        </div>` : `<div class="start-actions cfg-actions">
          <button class="btn" data-act="clearCache">${L('清除缓存并重载（保留存档）', 'Clear cache & reload (keep save)')}</button>
        </div>`}
      </section>

      <section class="cfg-section">
        <h3>${L('声音', 'SOUND')}</h3>
        <div class="cfg-grid">
          <label class="cfg-field">
            <span>${L('主音量', 'Master volume')} <b id="cfgVolVal">${Math.round(volume * 100)}%</b></span>
            <input type="range" data-vol="1" min="0" max="100" step="1" value="${Math.round(volume * 100)}">
          </label>
        </div>
        <div class="start-actions cfg-actions">
          <button class="btn" data-act="testSound">${L('试听', 'Test sound')}</button>
        </div>
      </section>

      <section class="cfg-section">
        <h3>${L('契约与经济', 'CONTRACT & ECONOMY')}</h3>
        <div class="cfg-grid">${balFields}</div>
      </section>

      <section class="cfg-section">
        <h3>${L('五签权重', 'DRAW WEIGHTS')}</h3>
        <p class="cfg-note">${L('四项占比会自动归一化；破碎率由下面的等级曲线决定。', 'Shares are normalized automatically; break chance comes from the level curve below.')}</p>
        <div class="cfg-grid">${shareFields}</div>
      </section>

      <section class="cfg-section">
        <h3>${L('遗物效果', 'RELIC EFFECTS')}</h3>
        <p class="cfg-note">${L('展开任意遗物即可修改它的效果数值。', 'Expand a relic to edit its effect values.')}</p>
        <div class="cfg-relics">${relicBlocks}</div>
      </section>

      <section class="cfg-section">
        <h3>${L('幽灵商人价格', 'MERCHANT PRICES')}</h3>
        <div class="cfg-grid">${merchantFields}</div>
      </section>

      <section class="cfg-section">
        <h3>${L('品质门槛', 'TIER THRESHOLDS')}</h3>
        <div class="cfg-grid">${tierFields}</div>
      </section>

      <section class="cfg-section">
        <h3>${L('高级：整份配置 JSON', 'ADVANCED: FULL CONFIG JSON')}</h3>
        <p class="cfg-note">${L('可编辑破碎曲线、初始遗物、全部效果等。修改后点“应用 JSON”。', 'Edit the break curve, starter relics and every effect. Then press Apply JSON.')}</p>
        <textarea class="cfg-json" id="cfgJson" spellcheck="false">${json}</textarea>
        <div class="start-actions cfg-actions">
          <button class="btn" data-act="cfgApplyJson">${L('应用 JSON', 'Apply JSON')}</button>
        </div>
      </section>

      <div class="start-actions cfg-actions">
        <button class="btn primary" data-act="closeOverlay">${t('helpClose')}</button>
        <button class="btn" data-act="cfgRevalue">${L('重算现有剑值', 'Recompute blade values')}</button>
        <button class="btn danger" data-act="cfgReset">${L('恢复默认数值', 'Restore defaults')}</button>
      </div>`;
  }

  function showSettings() {
    if (forgeMode || heating || settling) return;
    if (!run && !overlayMode) return;
    settingsReturn = overlayMode === 'start' ? 'start' : null;
    showOverlay('settings');
    audio.ensure();
    audio.ui();
  }

  function showAchievements() {
    if (forgeMode || heating || settling) return;
    settingsReturn = overlayMode === 'start' ? 'start' : null;
    showOverlay('achievements');
    audio.ensure();
    audio.ui();
  }

  // 重新捕获鼠标：加热/退出锻造等流程会临时解锁，结束后自动补回
  function relockMouse(delay) {
    const attempt = () => {
      if (isTouch || !world || !run || run.over) return;
      if (overlayMode || forgeMode || heating || settling) return;
      if (!world.mouseLocked) world.requestPointerLock();
    };
    if (delay) setTimeout(attempt, delay);
    else attempt();
  }

  // 在设置面板里丢弃一件持有的遗物（点两次确认，避免误触）
  function discardRelic(btn) {
    if (!run || overlayMode !== 'settings') return;
    const id = btn.dataset.id;
    if (!id) return;
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.classList.add('armed');
      btn.textContent = L('确认丢弃？', 'Confirm?');
      clearTimeout(discardTimer);
      discardTimer = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.armed = '';
        btn.classList.remove('armed');
        btn.textContent = L('丢弃', 'Discard');
      }, 3200);
      audio.ui();
      return;
    }
    clearTimeout(discardTimer);

    const idx = run.relics.indexOf(id);
    if (idx < 0) return;
    const relic = relicById(id);
    run.relics.splice(idx, 1);
    // 护符类遗物丢弃后，它攒下的护盾次数一并作废
    if (id === 'ward') run.shields = 0;
    // 免碎裂遗物丢弃后，攒下的免碎裂次数也一并作废
    if (relic && relic.effects && relic.effects.dailyBreakGuard) run.dailyBreakGuard = 0;

    relicStats = collectStats();
    run.quota = quotaFor(run.day);
    saveGame();
    syncWorld();
    updateHUD();
    audio.ui();
    if (relic) {
      toast(L(`已丢弃 ${relic.zh}`, `Discarded ${relic.en}`), 'danger');
    }
    // 重绘面板（持有列表要少一项），并保持原来的滚动位置
    const scroll = UI.overlayCard.scrollTop;
    UI.overlayCard.innerHTML = overlayHTML();
    UI.overlayCard.scrollTop = scroll;
  }

  function refreshFromConfig() {
    buildPips();
    if (!run) {
      updateHUD();
      return;
    }
    relicStats = collectStats();
    if (run.day > totalDays()) run.day = totalDays();
    run.quota = quotaFor(run.day);
    if (run.anger > angerCap()) run.anger = angerCap();
    if (world) {
      world.setAnger(run.anger);
      const tLog = counterTotal();
      world.setTribute(run.quota, fmtLog(tLog), tLog >= Math.log10(Math.max(1, run.quota)));
    }
    saveGame();
    updateHUD();
    updateForgeUI();
  }

  function onConfigChange(e) {
    const runEl = e.target.closest('[data-run]');
    if (runEl) {
      if (!run) return;
      const key = runEl.dataset.run;
      let v = Number(runEl.value);
      if (!Number.isFinite(v)) return;
      if (key === 'gold') {
        run.gold = Math.max(0, Math.round(v));
      } else if (key === 'anger') {
        run.anger = clamp(Math.round(v), 0, angerCap());
      } else if (key === 'quota') {
        run.quota = Math.max(0, Math.round(v));
      } else if (key === 'day') {
        const d = clamp(Math.round(v), 1, totalDays());
        runEl.value = d;
        if (d !== run.day) {
          run.day = d;
          beginDay();
          const qEl = $('[data-run="quota"]', UI.overlayCard);
          if (qEl) qEl.value = run.quota;
          return;
        }
      }
      saveGame();
      if (world) {
        world.setAnger(run.anger);
        const tLog = counterTotal();
        world.setTribute(run.quota, fmtLog(tLog), tLog >= Math.log10(Math.max(1, run.quota)));
      }
      updateHUD();
      return;
    }

    const cfgEl = e.target.closest('[data-cfg]');
    if (!cfgEl) return;
    const isText = cfgEl.dataset.type === 'text';
    let val = isText ? cfgEl.value : Number(cfgEl.value);
    if (!isText && !Number.isFinite(val)) return;
    if (cfgEl.dataset.scale === 'pct') val = val / 100;
    setAtPath(cfgCurrent, cfgEl.dataset.cfg.split('.'), val);
    applyConfigSnapshot(cfgCurrent);
    persistConfig();
    const ta = $('#cfgJson');
    if (ta && !ta.dataset.dirty) ta.value = JSON.stringify(configSnapshot(), null, 2);
    refreshFromConfig();
    if (cfgEl.dataset.cfg === 'balance.merchantSlots') resizeMerchantStock();
    toast(t('saved'), 'good');
  }

  function applyJsonConfig() {
    const ta = $('#cfgJson');
    if (!ta) return;
    let data = null;
    try {
      data = JSON.parse(ta.value);
    } catch (err) {
      toast(L('JSON 格式有误', 'Invalid JSON'), 'danger');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      toast(L('JSON 格式有误', 'Invalid JSON'), 'danger');
      return;
    }
    applyConfigSnapshot(data);
    persistConfig();
    refreshFromConfig();
    UI.overlayCard.innerHTML = settingsHTML();
    toast(L('配置已应用', 'Config applied'), 'good');
  }

  function resetConfig() {
    // 清掉默认配置里没有的多余键，保证真正回到初始状态
    Object.keys(B).forEach(k => {
      if (!(k in cfgDefaults.balance)) delete B[k];
    });
    applyConfigSnapshot(cfgDefaults);
    cfgCurrent = configSnapshot();
    try {
      localStorage.removeItem(CONFIG_KEY);
    } catch (err) {
      /* ignore */
    }
    refreshFromConfig();
    UI.overlayCard.innerHTML = settingsHTML();
    toast(L('已恢复默认数值', 'Defaults restored'), 'good');
  }

  function revalueSwords() {
    if (!run) return;
    run.swords.forEach(s => { s.lv = baseValueLog(s.level); });
    saveGame();
    syncWorld();
    updateHUD();
    toast(L('已按新公式重算所有剑值', 'Recomputed every blade value'), 'good');
  }

  /* ------------------------------ 全屏覆盖 ------------------------------ */

  function overlayHTML() {
    if (!overlayMode) return '';
    if (overlayMode === 'start') {
      return `<div class="start-kicker">${t('startKicker')}</div>
        <h1 class="start-title">${t('startTitle')}</h1>
        <div class="start-sub">${t('startSub')}</div>
        <p class="start-desc">${t('startDesc', { n: chosenDaysPreview() })}</p>
        <div class="start-facts">
          <div class="start-fact"><b>${chosenDaysPreview()}</b>${t('startFact1Label')}</div>
          <div class="start-fact"><b>${B.baseSwords}</b>${t('startFact2Label')}</div>
          <div class="start-fact"><b>5</b>${t('startFact3Label')}</div>
        </div>
        <div class="start-difficulty">
          <div class="start-difficulty-label">${t('startDifficulty')}</div>
          <div class="difficulty-row">
            ${(CFG.difficulties || []).map(d => `<button class="diff-chip${chosenDifficulty === d.id ? ' on' : ''}" data-act="setDifficulty" data-id="${d.id}">
              <b>${d[lang]}</b><span>${lang === 'zh' ? d.descZh : d.descEn}</span>
            </button>`).join('')}
          </div>
        </div>
        <div class="start-days">
          <div class="start-difficulty-label">${t('startDays')}</div>
          <div class="days-row">
            <input type="number" class="days-input" data-days="1" min="5" max="99" step="1" value="${chosenDays}">
            <span class="days-hint">${t('startDaysHint')}</span>
          </div>
        </div>
        <div class="start-dragons">
          <div class="start-difficulty-label">${t('startDragons')}${chosenDragons.length ? ` <em>×${chosenDragons.length}</em>` : ''}</div>
          <div class="dragon-hint">${t('startDragonsHint')}</div>
          <div class="dragon-grid">
            <button class="dragon-chip none${chosenDragons.length ? '' : ' on'}" data-act="clearDragons">${t('startDragonsNone')}</button>
            ${(CFG.dragons || []).map(d => `<button class="dragon-chip${chosenDragons.includes(d.id) ? ' on' : ''}" data-act="toggleDragon" data-id="${d.id}" title="${lang === 'zh' ? d.descZh : d.descEn}">${d[lang]}</button>`).join('')}
          </div>
          ${chosenDragons.length ? `<div class="dragon-picked">${chosenDragons.map(id => {
            const d = dragonById(id);
            if (!d) return '';
            return `<div class="dragon-picked-row"><b>${d[lang]}</b><span>${lang === 'zh' ? d.descZh : d.descEn}</span></div>`;
          }).join('')}</div>` : ''}
        </div>
        <div class="start-actions">
          <button class="btn primary" data-act="start">${t('startBtn')}</button>
          ${window.self !== window.top ? `<button class="btn ghost" data-act="openWindow">${t('openWindow')}</button>` : ''}
          <button class="btn ghost" data-act="openSettings">${t('settings')}</button>
          <button class="btn ghost" data-act="openAchievements">${t('achBtn')}</button>
          <button class="btn ghost" data-act="toggleLang">${lang === 'zh' ? 'EN' : '中文'}</button>
        </div>
        <div class="start-note">${t('startNote')}</div>`;
    }

    if (overlayMode === 'starter') {
      const cards = CFG.starterRelics.map(id => {
        const r = relicById(id);
        if (!r) return '';
        return `<button class="starter-card" data-act="pickStarter" data-id="${r.id}">
          <span class="glyph"><span>${relicGlyph(r)}</span></span>
          <h4>${r[lang]}</h4>
          <p>${lang === 'zh' ? r.descZh : r.descEn}</p>
          <span class="pick">${t('choose')}</span>
        </button>`;
      }).join('');
      return `<div class="starter-kicker">${t('starterKicker')}</div>
        <h2 class="starter-title">${t('starterTitle')}</h2>
        <p class="starter-sub">${t('starterSub', { n: chosenDaysPreview() })}</p>
        <div class="starter-grid">${cards}</div>`;
    }

    if (overlayMode === 'day') {
      const data = overlayData || { kind: 'start' };
      const isStart = data.kind === 'start';
      const isSuccess = data.kind === 'success';
      const kicker = isStart
        ? `${t('contractDay')} ${run.day} / ${totalDays()}`
        : (isSuccess ? t('daySuccess') : t('dayFail'));
      const quoteKey = isStart
        ? (run.anger >= 2 ? 'dragonLineFurious' : run.anger === 1 ? 'dragonLineAngry' : 'dragonLineCalm')
        : (isSuccess ? 'dragonLineAccept' : (run.anger >= 2 ? 'dragonLineFurious' : 'dragonLineReject'));
      const dateText = dateLabel(run.day);
      let mainLine = '';
      if (isSuccess) mainLine = `+${fmt(data.gain || 0)} G`;
      else if (data.kind === 'fail') mainLine = `${t('dragonAnger')} +1`;
      const merchantLine = isMerchantDay(run.day)
        ? `<div class="start-desc" style="margin-top:8px">${t('toastMerchant')}</div>`
        : '';
      const ev = run.dayEvent ? eventById(run.dayEvent) : null;
      const eventLine = ev
        ? `<div class="day-event">${lang === 'zh' ? ev.zh : ev.en} · ${lang === 'zh' ? ev.descZh : ev.descEn}</div>`
        : '';
      const dragonLine = (run.dragons && run.dragons.length)
        ? `<div class="day-event">${run.dragons.map(id => { const d = dragonById(id); return d ? d[lang] : id; }).join(' · ')} · ${t('dragonLayers')} ${dragonLayers()}</div>`
        : '';
      return `<div class="start-kicker">${kicker}</div>
        <h1 class="day-title" ${data.kind === 'fail' ? 'style="color:#d95a42"' : ''}>${isStart ? t('dayKicker', { n: run.day }) : mainLine}</h1>
        <div class="day-date">${dateText} · ${t('contractDay')} ${run.day} / ${totalDays()} · ${currentDifficulty()[lang]}</div>
        <div class="day-stats">
          <div class="day-stat">${t('tributeDue')}<b>${fmt(run.quota)} G</b></div>
          <div class="day-stat">${t('dayGold')}<b>${fmt(run.gold)} G</b></div>
          <div class="day-stat">${t('daySwords')}<b>${run.lastSupply}</b></div>
          <div class="day-stat">${t('dragonAnger')}<b style="color:#e0715c">${run.anger} / ${angerCap()}</b></div>
        </div>
        ${dragonLine}
        ${merchantLine}
        ${eventLine}
        <div class="end-quote">${t(quoteKey)}</div>
        <div class="start-actions" style="margin-top:18px">
          <button class="btn primary" data-act="closeOverlay">${t('dayContinue')}</button>
        </div>`;
    }

    if (overlayMode === 'help') {
      const steps = ['1', '2', '3', '4', '5', '6'].map((n, i) =>
        `<div class="help-step"><span class="n">${n}</span><p>${t('help' + (i + 1))}</p></div>`
      ).join('');

      let catalog = null;
      try {
        catalog = world && world.renderCatalog ? world.renderCatalog() : null;
      } catch (err) {
        catalog = null;
      }

      const odds = ['break', 'damage', 'hold', 'success', 'great'].map(k => {
        const cap = k.charAt(0).toUpperCase() + k.slice(1);
        const name = t('out' + cap);
        const desc = t('out' + cap + 'Desc');
        return `<div class="codex-odd ${k}">
          <span class="co-name">${name}</span>
          <span class="co-desc">${desc}</span>
        </div>`;
      }).join('');

      const swordCards = (CFG.swordFormInfo || []).map((info, i) => {
        const img = catalog && catalog.swords[info.id];
        const title = lang === 'zh' ? info.zh : info.en;
        const desc = lang === 'zh' ? info.descZh : info.descEn;
        const trait = CFG.formTraits && CFG.formTraits[info.id];
        return `<article class="codex-card sword">
          <div class="codex-thumb">${img
            ? `<img src="${img}" alt="${title}">`
            : `<span class="codex-fallback">${String(i + 1).padStart(2, '0')}</span>`}
            <span class="codex-index">${String(i + 1).padStart(2, '0')}</span>
          </div>
          <h4>${title}</h4>
          <p>${desc}</p>
          ${trait ? `<p class="codex-trait">${lang === 'zh' ? trait.zh : trait.en} · ${lang === 'zh' ? trait.descZh : trait.descEn}</p>` : ''}
        </article>`;
      }).join('');

      const setCards = (CFG.relicSets || []).map(set => {
        const owned = set.relics.filter(id => run && run.relics.includes(id)).length;
        const complete = owned >= set.relics.length;
        const names = set.relics.map(id => {
          const r = relicById(id);
          return r ? r[lang] : id;
        }).join(' · ');
        return `<article class="codex-card set${complete ? ' owned' : ''}">
          <h4>${set[lang]}</h4>
          <p>${lang === 'zh' ? set.descZh : set.descEn}</p>
          <p class="codex-trait">${names}</p>
          <span class="codex-tag">${owned} / ${set.relics.length}</span>
        </article>`;
      }).join('');

      const relicCards = (CFG.relics || []).map((relic, i) => {
        const img = catalog && catalog.relics[relic.id];
        const owned = run && run.relics.includes(relic.id);
        const locked = relic.ach && !unlocks.relics[relic.id];
        const name = lang === 'zh' ? relic.zh : relic.en;
        const desc = lang === 'zh' ? relic.descZh : relic.descEn;
        return `<article class="codex-card relic${owned ? ' owned' : ''}${locked ? ' locked' : ''}">
          <div class="codex-thumb">${img
            ? `<img src="${img}" alt="${name}">`
            : `<span class="codex-fallback">${relicGlyph(relic)}</span>`}
            <span class="codex-index">${relicGlyph(relic) || String(i + 1)}</span>
            ${locked ? `<span class="codex-tag">${t('achLocked')}</span>` : owned ? `<span class="codex-tag">${t('codexOwned')}</span>` : ''}
          </div>
          <h4>${name}</h4>
          <p>${desc}</p>
        </article>`;
      }).join('');

      const itemCards = (CFG.merchantItems || []).map(item => {
        const img = catalog && catalog.items[item.id];
        const name = lang === 'zh' ? item.zh : item.en;
        const desc = lang === 'zh' ? item.descZh : item.descEn;
        return `<article class="codex-card item">
          <div class="codex-thumb">${img
            ? `<img src="${img}" alt="${name}">`
            : `<span class="codex-fallback">${item.glyph}</span>`}
          </div>
          <h4>${name}</h4>
          <p>${desc}</p>
          <span class="codex-cost">${t('codexPrice')} ${fmt(item.cost)} G</span>
        </article>`;
      }).join('');

      return `<div class="end-kicker">${lang === 'zh' ? '锻剑纳贡' : 'FORGE TAX'}</div>
        <h2 class="starter-title">${t('helpTitle')}</h2>
        <p class="starter-sub">${t('helpSub', { n: run ? totalDays() : chosenDays })}</p>
        <div class="help-steps">${steps}</div>

        <section class="codex-section">
          <h3>${t('codexOdds')}</h3>
          <p class="codex-sub">${t('codexOddsSub')}</p>
          <div class="codex-odds">${odds}</div>
        </section>

        <section class="codex-section">
          <h3>${t('codexSwords')}</h3>
          <p class="codex-sub">${t('codexSwordsSub')}</p>
          <div class="codex-grid swords">${swordCards}</div>
        </section>

        <section class="codex-section">
          <h3>${t('codexSets')}</h3>
          <p class="codex-sub">${t('codexSetsSub')}</p>
          <div class="codex-grid sets">${setCards}</div>
        </section>

        <section class="codex-section">
          <h3>${t('codexRelics')}</h3>
          <p class="codex-sub">${t('codexRelicsSub')}</p>
          <div class="codex-grid relics">${relicCards}</div>
        </section>

        <section class="codex-section">
          <h3>${t('codexItems')}</h3>
          <p class="codex-sub">${t('codexItemsSub')}</p>
          <div class="codex-grid items">${itemCards}</div>
        </section>

        <div class="codex-scroll-hint">${t('codexScroll')}</div>
        <div class="start-actions">
          <button class="btn primary" data-act="closeOverlay">${t('helpClose')}</button>
          <button class="btn danger" data-act="resetRun">${resetArmed ? t('clearConfirm') : t('reset')}</button>
        </div>`;
    }

    if (overlayMode === 'achievements') {
      const list = CFG.achievements || [];
      const done = list.filter(a => unlocks.achievements[a.id]).length;
      const cards = list.map(a => {
        const unlocked = !!unlocks.achievements[a.id];
        const target = a.target || 1;
        const val = Math.min(target, achievementValue(a));
        const pct = Math.round((val / target) * 100);
        const relic = a.relic ? relicById(a.relic) : null;
        const reward = relic ? t('achReward', { name: relic[lang] }) : t('achNoReward');
        return `<article class="ach-card${unlocked ? ' done' : ''}">
          <div class="ach-top">
            <span class="ach-state">${unlocked ? '✓' : '—'}</span>
            <div class="ach-copy">
              <h4>${a[lang]}</h4>
              <p>${lang === 'zh' ? a.descZh : a.descEn}</p>
            </div>
          </div>
          <div class="ach-bar"><i style="width:${pct}%"></i></div>
          <div class="ach-foot"><span>${val} / ${target}</span><span class="ach-reward">${reward}</span></div>
        </article>`;
      }).join('');
      return `<div class="start-kicker">${t('achTitle')}</div>
        <h2 class="starter-title">${t('achProgress', { n: done, t: list.length })}</h2>
        <p class="starter-sub">${t('achSub')}</p>
        <div class="ach-grid">${cards}</div>
        <div class="start-actions">
          <button class="btn primary" data-act="closeOverlay">${t('helpClose')}</button>
        </div>`;
    }

    if (overlayMode === 'settings') {
      return settingsHTML();
    }

    if (overlayMode === 'ban') {
      return banHTML();
    }

    const death = overlayMode === 'death';
    const days = death ? run.record.maxDay : totalDays();
    return `<div class="end-kicker">${death ? t('deathKicker') : t('victoryKicker')}</div>
      <h1 class="end-title ${death ? 'death' : ''}">${death ? t('deathTitle') : t('victoryTitle', { n: totalDays() })}</h1>
      <p class="end-desc">${death ? t('deathDesc') : t('victoryDesc')}</p>
      <div class="end-quote">${death ? t('deathQuote') : t('victoryQuote')}</div>
      <div class="end-stats">
        <div class="day-stat">${t('endDays')}<b>${days}</b></div>
        <div class="day-stat">${t('endGold')}<b>${fmt(run.record.totalGold)} G</b></div>
        <div class="day-stat">${t('endBest')}<b>${fmtLog(run.record.bestValueLog || 0)} G</b></div>
        <div class="day-stat">${t('endRelics')}<b>${run.relics.length}</b></div>
      </div>
      <div class="end-actions">
        <button class="btn primary" data-act="newContract">${death ? t('deathRestart') : t('victoryRestart')}</button>
      </div>`;
  }

  function showOverlay(mode, data) {
    if (world) world.exitPointerLock();
    overlayMode = mode;
    overlayData = data || null;
    UI.overlayCard.classList.toggle('wide', mode === 'help' || mode === 'settings' || mode === 'achievements' || mode === 'ban');
    UI.overlayCard.innerHTML = overlayHTML();
    UI.overlay.classList.remove('hidden');
    refreshLock();
    updateChrome();
  }

  function closeOverlay(autoLock) {
    if (!overlayMode) return;
    const relock = autoLock !== false;
    const was = overlayMode;
    const backToStart = (was === 'settings' || was === 'achievements') && settingsReturn === 'start';
    settingsReturn = null;
    overlayMode = null;
    overlayData = null;
    UI.overlay.classList.add('hidden');
    settling = false;
    if (was === 'help') {
      resetArmed = false;
      clearTimeout(resetTimer);
    }
    refreshLock();
    updateChrome();
    updateHUD();
    if (backToStart) {
      showOverlay('start');
      return;
    }
    if (run && !run.over) {
      audio.ui();
      updatePrompt();
      if (!forgeMode && world && relock) world.requestPointerLock();
      if (was === 'day' && isMerchantDay(run.day) && run.merchantStock.length) {
        toast(t('merchantArrive'), 'good');
        audio.relic();
      }
    }
  }

  /* ------------------------------ 开始 / 重置 ------------------------------ */

  function startNewRun(starterId) {
    run = newRunState();
    const diff = difficultyById(chosenDifficulty) || difficultyById('normal');
    if (diff) {
      run.difficulty = diff.id;
      run.gold += diff.startGold || 0;
      run.record.totalGold += diff.startGold || 0;
      run.anger = clamp(run.anger + (diff.startAnger || 0), 0, B.maxAnger);
    }
    // 龙王契约：多选叠加；断日龙缩短契约总天数
    run.dragons = chosenDragons.filter(id => dragonById(id)).slice();
    let days = clamp(Math.round(Number(chosenDays) || B.maxDays), 5, 99);
    if (hasDragon('shortday')) days = Math.max(5, Math.round(days * 0.7));
    run.totalDays = days;
    const relic = relicById(starterId);
    if (relic) run.relics.push(relic.id);
    run.starterChosen = true;
    relicStats = collectStats();
    beginDay();
    saveGame();
    audio.relic();
    showOverlay('day', { kind: 'start' });
  }

  function showStartScreen() {
    run = null;
    relicStats = emptyStats();
    clearChainFrenzy();
    clearAutoHammer();
    forgeMode = false;
    busy = false;
    heating = false;
    settling = false;
    overlayMode = null;
    overlayData = null;
    frenzy.active = false;
    lastLog = '';
    focus = null;
    UI.forgeUI.classList.add('hidden');
    UI.frenzyFlash.classList.remove('on');
    if (world) {
      world.setFrenzy(false);
      world.showStart();
      syncWorld();
      world.setLocked(true);
    }
    showOverlay('start');
    updateChrome();
  }

  function newContract() {
    run = null;
    relicStats = emptyStats();
    saveGame();
    showStartScreen();
    audio.ui();
  }

  function resetRun() {
    resetArmed = false;
    clearTimeout(resetTimer);
    run = null;
    relicStats = emptyStats();
    saveGame();
    showStartScreen();
    audio.ui();
  }

  function showHelp() {
    if (!run || run.over || forgeMode || overlayMode || heating || settling) return;
    resetArmed = false;
    clearTimeout(resetTimer);
    showOverlay('help');
    audio.ui();
  }

  function toggleLang() {
    lang = lang === 'zh' ? 'en' : 'zh';
    langExplicit = true;
    saveGame();
    applyLang();
    audio.ensure();
    audio.ui();
  }

  /* ------------------------------ 覆盖层 / 提示事件 ------------------------------ */

  function onOverlayAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    audio.ensure();
    const act = el.dataset.act;
    if (act === 'start') {
      audio.ui();
      audio.startAmbient();
      showOverlay('starter');
    } else if (act === 'openWindow') {
      window.open(location.href, '_blank');
    } else if (act === 'pickStarter') {
      startNewRun(el.dataset.id);
    } else if (act === 'setDifficulty') {
      chosenDifficulty = el.dataset.id;
      UI.overlayCard.innerHTML = overlayHTML();
      audio.ui();
    } else if (act === 'toggleDragon') {
      const id = el.dataset.id;
      const i = chosenDragons.indexOf(id);
      if (i >= 0) chosenDragons.splice(i, 1);
      else chosenDragons.push(id);
      UI.overlayCard.innerHTML = overlayHTML();
      audio.ui();
    } else if (act === 'clearDragons') {
      chosenDragons = [];
      UI.overlayCard.innerHTML = overlayHTML();
      audio.ui();
    } else if (act === 'toggleQuality') {
      lowQuality = !lowQuality;
      if (world) world.setQuality(lowQuality);
      saveGame();
      UI.overlayCard.innerHTML = overlayHTML();
      audio.ui();
    } else if (act === 'exportSave') {
      exportSave();
    } else if (act === 'closeOverlay') {
      closeOverlay();
    } else if (act === 'newContract') {
      newContract();
    } else if (act === 'openSettings') {
      showSettings();
    } else if (act === 'openAchievements') {
      showAchievements();
    } else if (act === 'discardRelic') {
      discardRelic(el);
    } else if (act === 'banRelic') {
      banRelic(el.dataset.id);
    } else if (act === 'cfgReset') {
      resetConfig();
    } else if (act === 'cfgRevalue') {
      revalueSwords();
    } else if (act === 'cfgApplyJson') {
      applyJsonConfig();
    } else if (act === 'clearCache') {
      clearCacheAndReload();
    } else if (act === 'testSound') {
      audio.ensure();
      audio.hammer(true);
    } else if (act === 'toggleLang') {
      toggleLang();
    } else if (act === 'resetRun') {
      if (!resetArmed) {
        resetArmed = true;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          resetArmed = false;
          if (overlayMode === 'help') UI.overlayCard.innerHTML = overlayHTML();
        }, 3200);
        UI.overlayCard.innerHTML = overlayHTML();
      } else {
        resetRun();
      }
    }
  }

  /* ------------------------------ 触屏摇杆 ------------------------------ */

  function setupJoystick() {
    const j = UI.joystick;
    const knob = UI.joystickKnob;
    if (!j || !knob) return;

    const update = e => {
      const r = j.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width * 0.38);
      let dy = (e.clientY - cy) / (r.height * 0.38);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      joy.x = dx;
      joy.y = dy;
      world.setMoveInput(dx, -dy);
      knob.style.transform = `translate(${dx * (r.width * 0.26)}px, ${dy * (r.height * 0.26)}px)`;
    };

    const end = () => {
      joy.active = false;
      joy.id = null;
      joy.x = 0;
      joy.y = 0;
      world.setMoveInput(0, 0);
      knob.style.transform = 'translate(0px, 0px)';
      j.classList.remove('active');
    };

    j.addEventListener('pointerdown', e => {
      e.stopPropagation();
      joy.active = true;
      joy.id = e.pointerId;
      j.classList.add('active');
      j.setPointerCapture(e.pointerId);
      update(e);
    });
    j.addEventListener('pointermove', e => {
      if (!joy.active || joy.id !== e.pointerId) return;
      e.stopPropagation();
      update(e);
    });
    j.addEventListener('pointerup', e => {
      if (joy.id !== e.pointerId) return;
      e.stopPropagation();
      end();
    });
    j.addEventListener('pointercancel', end);
  }

  /* ------------------------------ DOM / 启动 ------------------------------ */

  function cacheDom() {
    UI.canvas = $('#scene');
    UI.hud = $('#hud');
    UI.dayNum = $('#dayNum');
    UI.dateText = $('#dateText');
    UI.quotaNum = $('#quotaNum');
    UI.offeredNum = $('#offeredNum');
    UI.quotaFill = $('#quotaFill');
    UI.swordCount = $('#swordCount');
    UI.angerPips = $('#angerPips');
    UI.shieldChip = $('#shieldChip');
    UI.merchantChip = $('#merchantChip');
    UI.goldHud = $('#goldHud');
    UI.goldNum = $('#goldNum');
    UI.objective = $('#objective');
    UI.objectiveText = $('#objectiveText');
    UI.heldHud = $('#heldHud');
    UI.heldName = $('#heldName');
    UI.heldMeta = $('#heldMeta');
    UI.relicHud = $('#relicHud');
    UI.buffBar = $('#buffBar');
    UI.crosshair = $('#crosshair');
    UI.lockHint = $('#lockHint');
    UI.interactPrompt = $('#interactPrompt');
    UI.promptKey = $('#promptKey');
    UI.promptTitle = $('#promptTitle');
    UI.promptSub = $('#promptSub');
    UI.promptAlt = $('#promptAlt');
    UI.promptGo = $('#promptGo');
    UI.forgeUI = $('#forgeUI');
    UI.forgePanel = $('.forge-panel');
    UI.fpName = $('#fpName');
    UI.fpLevel = $('#fpLevel');
    UI.fpValue = $('#fpValue');
    UI.fpTrait = $('#fpTrait');
    UI.fpGreatLevel = $('#fpGreatLevel');
    UI.fpGreatGain = $('#fpGreatGain');
    UI.fpPips = $('#fpPips');
    UI.fpChargeText = $('#fpChargeText');
    UI.fpHeatFill = $('#fpHeatFill');
    UI.fpQuota = $('#fpQuota');
    UI.fpLog = $('#fpLog');
    UI.fpInv = $('#fpInv');
    UI.fpTickets = $('#fpTickets');
    UI.fpTicketRow = $('#fpTicketRow');
    UI.fpTicketTotal = $('#fpTicketTotal');
    UI.btnSwing = $('#btnSwing');
    UI.btnSheathe = $('#btnSheathe');
    UI.btnTakeSword = $('#btnTakeSword');
    UI.fpLang = $('#fpLang');
    UI.overlay = $('#overlay');
    UI.overlayCard = $('#overlayCard');
    UI.toast = $('#toast');
    UI.resultBanner = $('#resultBanner');
    UI.resultBannerText = $('#resultBannerText');
    UI.loading = $('#loading');
    UI.frenzyFlash = $('#frenzyFlash');
    UI.damageFlash = $('#damageFlash');
    UI.btnHelp = $('#btnHelp');
    UI.btnSettings = $('#btnSettings');
    UI.btnAch = $('#btnAch');
    UI.maxDayNum = $('#maxDayNum');
    UI.btnLang = $('#btnLang');
    UI.btnSound = $('#btnSound');
    UI.joystick = $('#joystick');
    UI.joystickKnob = $('.joystick-knob');
  }

  function hideLoading() {
    if (!UI.loading) return;
    UI.loading.classList.add('fade');
    setTimeout(() => { UI.loading.style.display = 'none'; }, 700);
  }

  // 被嵌在预览 iframe 里时，浏览器会拒绝指针锁定；提示改用新窗口
  function onPointerLockError() {
    if (window.self === window.top || lockNoticeShown) return;
    lockNoticeShown = true;
    toast(t('lockBlocked'), 'danger');
  }

  // 清除缓存（保留存档）并用新的地址重载，确保拿到最新界面
  function clearCacheAndReload() {
    toast(t('cacheClearing'), 'good');
    const reload = () => {
      const url = new URL(location.href);
      url.searchParams.set('fresh', String(Date.now()));
      location.replace(url.toString());
    };
    try {
      const jobs = [];
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(regs =>
          Promise.all(regs.map(r => r.unregister()))
        ));
      }
      Promise.all(jobs)
        .then(() => {
          try { sessionStorage.clear(); } catch (err) { /* ignore */ }
          setTimeout(reload, 220);
        })
        .catch(() => setTimeout(reload, 220));
    } catch (err) {
      setTimeout(reload, 220);
    }
  }

  function bindEvents() {
    UI.btnHelp.addEventListener('click', showHelp);
    if (UI.btnSettings) UI.btnSettings.addEventListener('click', showSettings);
    if (UI.btnAch) UI.btnAch.addEventListener('click', showAchievements);
    UI.overlayCard.addEventListener('change', e => {
      const fileInput = e.target.closest('[data-save-file]');
      if (fileInput) {
        if (fileInput.files && fileInput.files[0]) importSaveFile(fileInput.files[0]);
        return;
      }
      const daysEl = e.target.closest('[data-days]');
      if (daysEl) {
        chosenDays = clamp(Math.round(Number(daysEl.value) || B.maxDays), 5, 99);
        daysEl.value = chosenDays;
        const fact = UI.overlayCard.querySelector('.start-facts .start-fact b');
        if (fact) fact.textContent = chosenDaysPreview();
        return;
      }
      onConfigChange(e);
    });
    UI.overlayCard.addEventListener('input', e => {
      if (e.target && e.target.id === 'cfgJson') e.target.dataset.dirty = '1';
      if (e.target && e.target.dataset && e.target.dataset.days) {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) chosenDays = clamp(v, 5, 99);
      }
      if (e.target && e.target.dataset && e.target.dataset.vol) {
        volume = clamp(Number(e.target.value) / 100, 0, 1);
        if (audio) {
          audio.ensure();
          audio.setVolume(volume);
        }
        const lab = $('#cfgVolVal');
        if (lab) lab.textContent = Math.round(volume * 100) + '%';
        saveGame();
      }
    });
    UI.btnLang.addEventListener('click', toggleLang);
    if (UI.fpLang) UI.fpLang.addEventListener('click', toggleLang);
    UI.btnSound.addEventListener('click', () => {
      soundOn = !soundOn;
      saveGame();
      audio.setEnabled(soundOn);
      if (soundOn) {
        audio.ensure();
        audio.startAmbient();
        audio.coin();
      }
      UI.btnSound.classList.toggle('muted', !soundOn);
      UI.btnSound.title = soundOn ? t('soundOn') : t('soundOff');
    });

    UI.interactPrompt.addEventListener('click', e => {
      if (e.target.closest('#promptAlt')) return;
      actFocus(focus);
    });
    UI.promptAlt.addEventListener('click', e => {
      e.stopPropagation();
      takeAnvilSword();
    });
    UI.promptGo.addEventListener('click', e => {
      e.stopPropagation();
      actFocus(focus);
    });

    UI.btnSwing.addEventListener('click', () => {
      audio.ensure();
      trySwing();
    });
    UI.btnSheathe.addEventListener('click', () => {
      if (busy) return;
      exitForgeMode();
    });
    UI.btnTakeSword.addEventListener('click', () => {
      if (busy) return;
      takeAnvilSword();
    });

    UI.relicHud.addEventListener('click', onChipClick);
    if (UI.fpInv) UI.fpInv.addEventListener('click', onChipClick);

    UI.overlayCard.addEventListener('click', onOverlayAction);

    document.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        if (overlayMode === 'day' || overlayMode === 'help' || overlayMode === 'settings' || overlayMode === 'achievements') {
          closeOverlay(false);
          e.preventDefault();
        }
      }
    });

    const unlock = () => {
      audio.ensure();
      audio.startAmbient();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && run) saveGame();
      if (document.hidden) saveUnlocks();
    });

    setupJoystick();
  }

  function boot() {
    cacheDom();
    // 先套用玩家自定义数值，再读存档（贡额等要用新的参数）
    loadConfigOverrides();
    loadUnlocks();
    buildPips();
    isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);

    const hasSaved = loadSaved();
    audio = new ForgeAudio();
    audio.setEnabled(soundOn);
    audio.setVolume(volume);
    applyLang();

    try {
      world = new ForgeWorld(UI.canvas, {
        onInteract: f => actFocus(f),
        onForgeSwing: () => trySwing(),
        onForgeExit: () => exitForgeMode(),
        onFocus: f => setFocus(f),
        onTakeAnvil: () => takeAnvilSword(),
        onPointerLock: () => updateChrome(),
        onPointerLockError: () => onPointerLockError()
      });
      world.setLang(lang);
      world.onElfPickup = id => elfPickup(id);
      world.onElfDeposit = id => elfDeposit(id);
      world.setQuality(lowQuality);
    } catch (err) {
      console.error(err);
      UI.loading.querySelector('.loading-text').textContent =
        lang === 'zh' ? '无法启动 3D 场景（需要 WebGL）' : 'Unable to start the 3D scene (WebGL required)';
      return;
    }

    if (run) run.swords.forEach(rememberSwordLevel);
    checkAchievements();

    if (hasSaved && run && run.over) {
      if (!run.quota) run.quota = quotaFor(run.day);
      syncWorld();
      updateHUD();
      updateChrome();
      world.teleportTo('tribute');
      world.setLocked(true);
      showOverlay(run.over);
    } else if (hasSaved && run) {
      if (!run.starterChosen) {
        showOverlay('starter');
      } else {
        if (!run.quota) {
          run.quota = quotaFor(run.day);
          saveGame();
        }
        syncWorld();
        updateHUD();
        updateChrome();
        refreshLock();
        setTimeout(() => toast(t('saved'), 'good'), 900);
      }
    } else {
      showStartScreen();
    }

    bindEvents();
    setInterval(uiTick, 120);
    setTimeout(hideLoading, 650);

    window.__forge = {
      get run() { return run; },
      get relicStats() { return relicStats; },
      get unlocks() { return unlocks; },
      checkAchievements,
      get achievements() { return CFG.achievements; },
      get world() { return world; },
      get forgeMode() { return forgeMode; },
      get frenzy() { return frenzy; },
      get busy() { return busy; },
      get focus() { return focus; },
      get frenzyNeed() { return frenzyNeed(); },
      actFocus,
      pickOrSwap,
      takeAnvilSword,
      heatHeld,
      trySwing,
      beginDay,
      settleTribute,
      addSword,
      useItem,
      recalcRelics() { relicStats = collectStats(); updateHUD(); },
      setGold(n) { if (run) { run.gold = n; updateHUD(); saveGame(); } },
      setDay(n) { if (run) { run.day = n; beginDay(); saveGame(); } },
      startNewRun,
      showOverlay,
      closeOverlay,
      syncWorld,
      updateHUD
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
