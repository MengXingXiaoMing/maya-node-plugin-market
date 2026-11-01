/* ==========================================================================
   锻剑纳贡 · ForgeTax
   数值 / 遗物 / 剑名 / 文案配置
   --------------------------------------------------------------------------
   想改数值：balance
   想加遗物：relics（并在 game.js 的 collectStats 中处理新字段）
   想改剑名：namePrefix / nameNoun
   ========================================================================== */

window.FT_CONFIG = {
  saveKey: 'forgeTax.save.v1',
  configKey: 'forgeTax.config.v1',
  unlockKey: 'forgeTax.unlocks.v1',
  startDate: { month: 4, day: 15 },

  balance: {
    maxDays: 21,
    baseSwords: 3,
    baseQuota: 1800,
    finalQuota: 232000,
    maxAnger: 3,
    baseValue: 320,
    valueGrowth: 1.5,
    // 0 表示等级无上限
    maxLevel: 0,
    // 高等级破坏叠层：从 breakTierStart 级起每 breakTierStep 级叠 1 层，每层 +breakTierChance 破坏概率
    breakTierStart: 8,
    breakTierStep: 5,
    breakTierChance: 0.025,
    // 入神格子随等级增长：每 frenzyTierStride 级判定一次，每次以 frenzyTierChance 概率多要 1 格
    frenzyTierStride: 10,
    frenzyTierChance: 0.25,
    // 入神时长随等级缩短：每 frenzyTimeStride 级判定一次，命中一次少 frenzyTimeStep 秒
    frenzyTimeStride: 25,
    frenzyTimeChance: 0.35,
    frenzyTimeStep: 0.1,
    frenzyCharge: 10,
    frenzySeconds: 4,
    normalSwingMs: 520,
    frenzySwingMs: 280,
    goldBase: 360,
    goldPerDay: 90,
    goldExcessRate: 0.0015,
    refreshCost: 208,
    refreshGrowth: 90,
    maxCounter: 5,
    merchantEvery: 3,
    merchantSlots: 3,
    moveSpeed: 3.2,
    counterSlots: [-0.95, -0.32, 0.32, 0.95, 1.55]
  },

  // 大数缩写单位：中文按万进（万/亿/兆…），英文按千进（K/M/B…）
  fmtUnits: {
    zh: [
      [1e4, '万'], [1e8, '亿'], [1e12, '兆'], [1e16, '京'], [1e20, '垓'],
      [1e24, '秭'], [1e28, '穰'], [1e32, '沟'], [1e36, '涧'], [1e40, '正'],
      [1e44, '载'], [1e48, '极'], [1e52, '恒河沙'], [1e56, '阿僧祇'],
      [1e60, '那由他'], [1e64, '不可思议'], [1e68, '无量']
    ],
    en: [
      [1e3, 'K'], [1e6, 'M'], [1e9, 'B'], [1e12, 'T'], [1e15, 'Qa'],
      [1e18, 'Qi'], [1e21, 'Sx'], [1e24, 'Sp'], [1e27, 'Oc'], [1e30, 'No'],
      [1e33, 'Dc'], [1e36, 'Ud'], [1e39, 'Dd'], [1e42, 'Td'], [1e45, 'Qad'],
      [1e48, 'Qid'], [1e51, 'Sxd'], [1e54, 'Spd'], [1e57, 'Ocd'], [1e60, 'Nod'],
      [1e63, 'Vg']
    ]
  },

  // 数字显示：单位起点以下保留千分位，以上缩写（1.23万 / 4.5M）
  // 超过最大单位后改用「系数×最大单位」叠乘（1万×无量），可以无限堆叠
  fmtNumber(n, lang) {
    let v = Number(n);
    if (!isFinite(v)) return '∞';
    const neg = v < 0;
    v = Math.abs(Math.floor(v));
    const en = lang === 'en';
    const list = this.fmtUnits[en ? 'en' : 'zh'];
    const base = en ? 1e3 : 1e4;
    const sign = neg ? '-' : '';
    if (v < base) return sign + v.toLocaleString('en-US');

    // 去掉小数尾零：1.50 → 1.5，2.00 → 2
    const tidy = s => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    const top = list[list.length - 1];

    // 超出最大单位的整数倍范围：把最大单位当“乘数”反复叠上去
    if (v >= top[0] * base) {
      let k = 1;
      while (v >= Math.pow(top[0], k + 1)) k += 1;
      // 除法会有浮点噪声（1e72/1e63 可能算出 999999999.99），收敛到 12 位有效数字
      const c = Number((v / Math.pow(top[0], k)).toPrecision(12));
      const coef = this.fmtNumber(c, lang);
      // 同名单位叠多次时写成上标次方：无量×无量×无量 → 无量³
      let tail = top[1];
      if (k > 1) {
        const supMap = '⁰¹²³⁴⁵⁶⁷⁸⁹';
        tail += String(k).split('').map(d => supMap[+d] || d).join('');
      }
      return sign + coef + '×' + tail;
    }

    let idx = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (v >= list[i][0]) { idx = i; break; }
    }
    const pick = i => {
      const x = v / list[i][0];
      return tidy(x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
    };
    let num = pick(idx);
    // 四舍五入顶到 1000 时进位到下一档（英文 999999 显示 1M，而不是 1000K）
    // 但下一档系数不足 1 时保持原档，避免出现“0.1亿”这种别扭写法
    if (num === '1000' && idx < list.length - 1 && v >= list[idx + 1][0]) {
      idx += 1;
      num = pick(idx);
    }
    return sign + num + list[idx][1];
  },

  // 以 log10 表示的数值格式化：剑值可能远超 Number 上限，用对数保存
  fmtLog(l, lang) {
    if (!isFinite(l)) return '∞';
    if (l <= 0) return '0';
    if (l < 15) return this.fmtNumber(Math.round(Math.pow(10, l)), lang);
    const en = lang === 'en';
    const list = this.fmtUnits[en ? 'en' : 'zh'];
    const base = en ? 1e3 : 1e4;
    const top = list[list.length - 1];
    const unitLog = Math.log10(top[0]);
    if (l < Math.log10(top[0] * base)) {
      return this.fmtNumber(Math.round(Math.pow(10, l)), lang);
    }
    const k = Math.floor(l / unitLog);
    const m = l - k * unitLog;
    const coef = this.fmtNumber(Math.round(Math.pow(10, m)), lang);
    let tail = top[1];
    if (k > 1) {
      const supMap = '⁰¹²³⁴⁵⁶⁷⁸⁹';
      tail += String(k).split('').map(d => supMap[+d] || d).join('');
    }
    return coef + '×' + tail;
  },

  // 每天贡额：从 baseQuota 指数增长到 finalQuota
  // maxDays 可覆盖本局总天数（开局设置 / 断日龙）
  quotaForDay(day, maxDays) {
    const b = this.balance;
    const baseMax = Math.max(1, b.maxDays | 0);
    const max = Math.max(1, Math.floor(Number(maxDays) || baseMax));
    const d = Math.min(Math.max(day, 1), max);
    const t = max > 1 ? (d - 1) / (max - 1) : 0;
    const v = b.baseQuota * Math.pow(Math.max(1, b.finalQuota) / Math.max(1, b.baseQuota), t);
    return Math.round(v / 10) * 10;
  },

  // 未修正的破碎概率锚点（官方公开数据 + 曲线延伸）
  breakTable: [
    [0, 0], [1, 0.015], [2, 0.059], [3, 0.15], [4, 0.248], [5, 0.297],
    [6, 0.335], [7, 0.368], [8, 0.398], [9, 0.43], [10, 0.467],
    [14, 0.52], [18, 0.554], [20, 0.575], [30, 0.68], [50, 0.8], [99, 0.92]
  ],

  // 非破碎签的固定比例（与官方截图一致）
  nonBreakShare: { damage: 0.095, hold: 0.238, success: 0.572, great: 0.095 },

  tiers: [
    { min: 0,  zh: '锈铁', en: 'Rusted',   color: 0x8b8576, metalness: 0.68, roughness: 0.55, emissive: 0x000000, glow: 0 },
    { min: 4,  zh: '黑铁', en: 'Iron',     color: 0xaeb4ba, metalness: 0.8,  roughness: 0.4,  emissive: 0x000000, glow: 0 },
    { min: 8,  zh: '精钢', en: 'Steel',    color: 0xcdd8e4, metalness: 0.9,  roughness: 0.28, emissive: 0x000000, glow: 0 },
    { min: 12, zh: '白银', en: 'Silver',   color: 0xe9f1fa, metalness: 0.95, roughness: 0.2,  emissive: 0x05080c, glow: 0 },
    { min: 16, zh: '黄金', en: 'Gold',     color: 0xe8c06a, metalness: 0.95, roughness: 0.22, emissive: 0x1a0e00, glow: 0 },
    { min: 20, zh: '黑曜', en: 'Obsidian', color: 0x5b4a7a, metalness: 0.85, roughness: 0.3,  emissive: 0x2a1440, glow: 1 },
    { min: 30, zh: '奥术', en: 'Arcane',   color: 0xc39bff, metalness: 0.9,  roughness: 0.22, emissive: 0x4a1f7a, glow: 1 }
  ],

  namePrefix: [
    { zh: '锈蚀', en: 'Rusted' },
    { zh: '深海', en: 'Abyssal' },
    { zh: '珊瑚', en: 'Coral' },
    { zh: '龙脊', en: 'Dragonbone' },
    { zh: '月蚀', en: 'Eclipse' },
    { zh: '灰烬', en: 'Ashen' },
    { zh: '血誓', en: 'Bloodsworn' },
    { zh: '霜噬', en: 'Frostbite' },
    { zh: '星陨', en: 'Starfall' },
    { zh: '骸骨', en: 'Bone' },
    { zh: '熔心', en: 'Emberheart' },
    { zh: '幽影', en: 'Umbra' },
    { zh: '王权', en: 'Regal' },
    { zh: '饥荒', en: 'Famine' },
    { zh: '黎明', en: 'Dawn' },
    { zh: '葬火', en: 'Pyre' },
    { zh: '雷鸣', en: 'Thunder' },
    { zh: '黑潮', en: 'Blacktide' },
    { zh: '残月', en: 'Waning' },
    { zh: '赤潮', en: 'Crimson' }
  ],

  nameNoun: [
    { zh: '长剑', en: 'Longsword' },
    { zh: '巨刃', en: 'Greatblade' },
    { zh: '弯刀', en: 'Scimitar' },
    { zh: '细剑', en: 'Rapier' },
    { zh: '阔剑', en: 'Broadsword' },
    { zh: '断刃', en: 'Broken Edge' },
    { zh: '骨锯', en: 'Bonesaw' },
    { zh: '獠牙', en: 'Fang' },
    { zh: '裁决', en: 'Verdict' },
    { zh: '墓碑', en: 'Tombstone' },
    { zh: '祭坛刃', en: 'Altar Blade' },
    { zh: '触须', en: 'Tentacle' }
  ],

  // 与 nameNoun 一一对应的剑形
  swordForms: [
    'longsword', 'greatsword', 'scimitar', 'rapier', 'cleaver', 'broken',
    'bonesaw', 'fang', 'executioner', 'tombstone', 'flamberge', 'tentacle'
  ],

  // 剑形图鉴（与 swordForms 一一对应）
  swordFormInfo: [
    { id: 'longsword', zh: '长剑', en: 'Longsword', descZh: '均衡的双刃直剑，剑脊开有血槽，是铁匠最熟悉的起手形制。', descEn: 'A balanced double-edged straight blade with a fuller — the smith\'s baseline.' },
    { id: 'greatsword', zh: '巨刃', en: 'Greatblade', descZh: '加宽加厚的巨剑，刃口沉重，护手横向张开，劈砍时能听见风声。', descEn: 'A widened, thickened greatsword with a broad crossguard and a heavy edge.' },
    { id: 'scimitar', zh: '弯刀', en: 'Scimitar', descZh: '弧线刃身向一侧扬起，翼形护手护住指节，适合快速拖割。', descEn: 'A sweeping curved edge with winged quillons for fast draw cuts.' },
    { id: 'rapier', zh: '细剑', en: 'Rapier', descZh: '细长如针的刺剑，配环护手与弓形护指，轻得几乎没有重量。', descEn: 'A needle-thin thrusting blade with a ring guard and swept knuckle bow.' },
    { id: 'cleaver', zh: '阔剑', en: 'Broadsword', descZh: '厚背方头的宽刃，更像一把屠刀，靠重量而不是锋利取胜。', descEn: 'A broad, thick-spined chopper that wins by weight rather than sharpness.' },
    { id: 'broken', zh: '断刃', en: 'Broken Edge', descZh: '刃身中段已经崩断，露出参差的缺口，却仍被当作贡品。', descEn: 'The blade is snapped mid-length, leaving a jagged break — still fit for tribute.' },
    { id: 'bonesaw', zh: '骨锯', en: 'Bonesaw', descZh: '刃背排满骨刺锯齿，护手缠着骨珠，挥动时像在锯开空气。', descEn: 'A spine of bone teeth and a bone-bead guard, made to saw through air.' },
    { id: 'fang', zh: '獠牙', en: 'Fang', descZh: '整块材料弯成一颗巨大獠牙，尖端内扣，像是从什么生物嘴里拔下来的。', descEn: 'A single curved fang with an inward hook, as if pulled from some beast.' },
    { id: 'executioner', zh: '裁决', en: 'Verdict', descZh: '厚重的处刑刃，刃头外扩成斧形，环首用来平衡前端重量。', descEn: 'A heavy executioner blade flaring into an axe head, balanced by a ring pommel.' },
    { id: 'tombstone', zh: '墓碑', en: 'Tombstone', descZh: '四四方方的墓碑形重刃，几乎没有刃口，只剩压迫感。', descEn: 'A slab-like tombstone blade with barely an edge — pure menace.' },
    { id: 'flamberge', zh: '祭坛刃', en: 'Altar Blade', descZh: '刃身呈火焰般的波浪起伏，据说锻打时混进了祭坛的灰。', descEn: 'A flamberge with a flame-like wave, said to be quenched in altar ash.' },
    { id: 'tentacle', zh: '触须', en: 'Tentacle', descZh: '分节的柔软触须代替了刀身，尖端收细，握久了会自己动。', descEn: 'A segmented, fleshy tendril instead of a blade; it moves when held too long.' }
  ],

  // 剑形被动：同一种剑形固定一个特性，锻这把剑时生效
  formTraits: {
    longsword: {
      zh: '均衡', en: 'Balance',
      descZh: '成功与大成功的剑值 +8%。',
      descEn: 'Success and Great value +8%.',
      valueMult: 0.08
    },
    greatsword: {
      zh: '重劈', en: 'Heavy Cleave',
      descZh: '大成功额外 +1 级，但破碎概率 +3%。',
      descEn: 'Great grants +1 extra level, but break chance +3%.',
      greatLevels: 1, breakDelta: 0.03
    },
    scimitar: {
      zh: '连斩', en: 'Flurry',
      descZh: '每 2 次成功额外 +1 级。',
      descEn: 'Every 2nd Success grants +1 extra level.',
      successEvery2: 1
    },
    rapier: {
      zh: '穿刺', en: 'Thrust',
      descZh: '维持签权重 ×1.4。',
      descEn: 'Hold ticket weight ×1.4.',
      holdWeight: 1.4
    },
    cleaver: {
      zh: '蛮力', en: 'Brute Force',
      descZh: '成功剑值 +15%，但大成功倍率 -15%。',
      descEn: 'Success value +15%, but Great multiplier -15%.',
      valueMult: 0.15, greatMult: 0.85
    },
    broken: {
      zh: '残响', en: 'Echo',
      descZh: '破碎后仍把 20% 等级留给下一把剑。',
      descEn: 'Breaking still passes 20% of its level to the next blade.',
      inheritOnBreak: 0.2
    },
    bonesaw: {
      zh: '锯骨', en: 'Bone Saw',
      descZh: '损伤时剑值仍 +30%。',
      descEn: 'Damage still adds +30% value.',
      damageValue: 0.3
    },
    fang: {
      zh: '噬咬', en: 'Bite',
      descZh: '大成功倍率 ×1.3。',
      descEn: 'Great multiplier ×1.3.',
      greatMult: 1.3
    },
    executioner: {
      zh: '断罪', en: 'Verdict',
      descZh: '7 级以上的成功额外 +1 级。',
      descEn: 'Success at level 7+ grants +1 extra level.',
      highSuccess: 1
    },
    tombstone: {
      zh: '镇魂', en: 'Requiem',
      descZh: '破碎概率 -4%。',
      descEn: 'Break chance -4%.',
      breakDelta: -0.04
    },
    flamberge: {
      zh: '祭火', en: 'Altar Fire',
      descZh: '每次正面结果额外 +1 入神充能。',
      descEn: 'Every positive strike grants +1 extra Frenzy charge.',
      charge: 1
    },
    tentacle: {
      zh: '缠绕', en: 'Coil',
      descZh: '维持剑值 ×1.5。',
      descEn: 'Hold value ×1.5.',
      holdMult: 1.5
    }
  },

  // 遗物套装：集齐指定遗物时额外生效
  relicSets: [
    {
      id: 'heartForge', zh: '炉心', en: 'Heart of the Forge',
      relics: ['dragonHeart', 'moltenHeart', 'gildedAnvil'],
      descZh: '成功剑值额外 +15%。',
      descEn: 'Success value +15% more.',
      bonus: { successBonus: 0.15 }
    },
    {
      id: 'stillChamber', zh: '静室', en: 'Still Chamber',
      relics: ['steadyBell', 'tierWard'],
      descZh: '入神格子不再随等级增长。',
      descEn: 'Frenzy charge no longer grows with level.',
      bonus: { frenzyTierCut: 1 }
    },
    {
      id: 'oathbound', zh: '誓约', en: 'Oathbound',
      relics: ['trueOath', 'lowOath'],
      descZh: '破坏概率再 -5%，破碎时保留 25% 等级。',
      descEn: 'Break chance -5% more; breaking keeps 25% of its level.',
      bonus: { breakChanceFlat: -0.05, inheritOnBreak: 0.25 }
    },
    {
      id: 'ghostWorkshop', zh: '幽灵工坊', en: 'Ghost Workshop',
      relics: ['phantomHammer', 'ghostPact'],
      descZh: '幽灵锤每次挥锤多敲一下。',
      descEn: 'The phantom hammer strikes one extra time per swing.',
      bonus: { phantomExtra: 1 }
    }
  ],

  // 开局难度：只影响贡额曲线与开局资源
  difficulties: [
    {
      id: 'easy', zh: '轻松', en: 'Easy',
      descZh: '贡额 ×0.85，开局 600 G，每天额外 1 层破碎保护',
      descEn: 'Quota ×0.85, start with 600 G and +1 break shield each day',
      quotaMult: 0.85, startGold: 600, shieldBonus: 1
    },
    {
      id: 'normal', zh: '标准', en: 'Standard',
      descZh: '按原始贡额与规则进行',
      descEn: 'The intended quota curve and rules',
      quotaMult: 1
    },
    {
      id: 'hard', zh: '残酷', en: 'Brutal',
      descZh: '贡额 ×1.25，开局巨龙怒气 +1',
      descEn: 'Quota ×1.25, dragon starts with +1 anger',
      quotaMult: 1.25, startAnger: 1
    }
  ],

  // 开局可选的多条「龙王」：纯负面，强度随本局累计破碎层数持续增长
  // 说明里的「每层」都指本局累计的破碎层数（锻造时取得，只增不减）
  dragons: [
    { id: 'doom', zh: '焚世龙', en: 'Doom', theme: '贡额', descZh: '贡额 +45%，每层再 +0.5%。', descEn: 'Quota +45%, another +0.5% per layer.' },
    { id: 'erode', zh: '岁蚀龙', en: 'Erode', theme: '贡额', descZh: '每过 5 天贡额再 +12%，每层 +0.4%。', descEn: 'Every 5th day quota +12%, +0.4% per layer.' },
    { id: 'feast', zh: '贪食龙', en: 'Feast', theme: '贡额', descZh: '每次上贡成功，之后贡额 +10%，每层 +0.3%。', descEn: 'Each tribute adds +10% quota, +0.3% per layer.' },
    { id: 'shortday', zh: '断日龙', en: 'Shortday', theme: '天数', descZh: '契约总天数缩短 30%。', descEn: 'Contract length -30%.' },
    { id: 'soul', zh: '噬魂龙', en: 'Soulrend', theme: '怒气', descZh: '怒气上限降为 1；每 20 层贡额 +4%。', descEn: 'Anger cap 1; quota +4% per 20 layers.' },
    { id: 'blood', zh: '血怒龙', en: 'Bloodrage', theme: '怒气', descZh: '上贡失败怒气 +2，每层 +0.02。', descEn: 'Failed tribute anger +2, +0.02 per layer.' },
    { id: 'nopardon', zh: '死契龙', en: 'Deadpact', theme: '死亡', descZh: '免死/赦免/护盾/免碎裂全部失效；每 20 层贡额 +4%。', descEn: 'No death saves, shields or guards; quota +4% per 20 layers.' },
    { id: 'frost', zh: '寒狱龙', en: 'Frosthell', theme: '死亡', descZh: '失败不加怒气，改为销毁剑架上一半的剑（每层 +0.5%）。', descEn: 'Failure destroys half your rack instead of anger (+0.5% per layer).' },
    { id: 'reverse', zh: '玄冥龙', en: 'Reverse', theme: '破碎', descZh: '破碎 +25%，每层 +0.5%，破碎不继承等级。', descEn: 'Break +25%, +0.5% per layer, no inheritance.' },
    { id: 'bone', zh: '骨龙', en: 'Bonelord', theme: '破碎', descZh: '破碎层数 ×2，每 20 层再 +10% 破碎。', descEn: 'Break layers ×2, +10% break per 20 layers.' },
    { id: 'fester', zh: '毒牙龙', en: 'Fester', theme: '损伤', descZh: '损伤多掉 2 级，30% 转破碎，每层 +0.4%。', descEn: 'Damage -2 extra levels, 30% turn to break, +0.4% per layer.' },
    { id: 'crack', zh: '铁鳞龙', en: 'Ironcrack', theme: '破碎', descZh: '每次成功累积裂痕，满 3 道自碎，每 20 层阈值 -1。', descEn: 'Successes stack cracks; 3 cracks break the blade, -1 per 20 layers.' },
    { id: 'chain', zh: '碎星龙', en: 'Chainstar', theme: '连坐', descZh: '碎一把剑时再裂 1 把，每 25 层 +1。', descEn: 'A break also cracks 1 more blade, +1 per 25 layers.' },
    { id: 'starve', zh: '龙食龙', en: 'Starvemaw', theme: '供给', descZh: '每天吞掉 1 把最高级剑，每 25 层 +1；无剑则怒气 +1。', descEn: 'Eats your best blade daily, +1 per 25 layers; none means +1 anger.' },
    { id: 'hollow', zh: '空巢龙', en: 'Hollow', theme: '供给', descZh: '每日补给 -1，新剑等级上限 3，每 30 层 -1。', descEn: 'Daily supply -1, new blades cap at 3, -1 per 30 layers.' },
    { id: 'barren', zh: '贫瘠龙', en: 'Barren', theme: '成长', descZh: '新剑初始 -2 级，每 20 层再 -1；新剑升级遗物失效。', descEn: 'New blades start -2 levels, -1 per 20 layers; new-blade relics disabled.' },
    { id: 'shackle', zh: '锁链龙', en: 'Shackle', theme: '槽位', descZh: '柜台槽位降为 3，每 40 层再 -1。', descEn: 'Counter slots 3, -1 per 40 layers.' },
    { id: 'toll', zh: '逆鳞龙', en: 'Toll', theme: '损失', descZh: '上贡成功后收走剑架 1 把，每 25 层 +1。', descEn: 'Successful tribute takes 1 rack blade, +1 per 25 layers.' },
    { id: 'wither', zh: '蚀骨龙', en: 'Wither', theme: '入神', descZh: '本局无法进入入神；每 20 层贡额 +4%。', descEn: 'No Frenzy this run; quota +4% per 20 layers.' },
    { id: 'mire', zh: '泥沼龙', en: 'Mire', theme: '节奏', descZh: '挥击间隔 +70%，每层 +1%（封顶 +250%）。', descEn: 'Swing interval +70%, +1% per layer (cap +250%).' },
    { id: 'chaos', zh: '逆时龙', en: 'Chaos', theme: '入神', descZh: '入神充能 +6，每 20 层 +1；入神 -2 秒。', descEn: 'Frenzy charge +6 (+1 per 20 layers), duration -2s.' },
    { id: 'hex', zh: '蛊龙', en: 'Hex', theme: '入神', descZh: '入神中的大成功有 20% 概率碎剑，每层 +0.5%。', descEn: 'Frenzy great successes may shatter: 20%, +0.5% per layer.' },
    { id: 'tax', zh: '抽成龙', en: 'Tax', theme: '金币', descZh: '每天结束收走 30% 金币（每层 +0.3%），遗物价 +50%。', descEn: 'Daily 30% gold tax (+0.3% per layer), relics +50% cost.' },
    { id: 'emptybox', zh: '空匣龙', en: 'Emptybox', theme: '售货机', descZh: '售货机只留 1 个货位，刷新上限 1 次，遗物每 20 层 +15% 价。', descEn: 'One offer per day, refresh limit 1, relics +15% per 20 layers.' },
    { id: 'buyban', zh: '禁器龙', en: 'Buyban', theme: '遗物', descZh: '本局无法购买遗物；每 20 层贡额 +4%。', descEn: 'Cannot buy relics; quota +4% per 20 layers.' },
    { id: 'rot', zh: '腐化龙', en: 'Rot', theme: '遗物', descZh: '所有遗物效果减半，每 25 层再 -5%（最低 20%）。', descEn: 'Relic effects halved, another -5% per 25 layers (min 20%).' },
    { id: 'mist', zh: '迷雾龙', en: 'Mist', theme: '信息', descZh: '隐藏剑的等级/估值/概率，每 15 层多遮一项。', descEn: 'Hides level, value and odds; one more per 15 layers.' },
    { id: 'blind', zh: '盲龙', en: 'Blind', theme: '信息', descZh: '结果延迟 1 秒揭晓，每 20 层 +0.4 秒。', descEn: 'Results reveal 1s late, +0.4s per 20 layers.' },
    { id: 'scale', zh: '秤龙', en: 'Scale', theme: '结算', descZh: '上贡价值按 70% 结算，每层 -0.5%。', descEn: 'Tribute counts at 70% value, -0.5% per layer.' },
    { id: 'fickle', zh: '诡龙', en: 'Fickle', theme: '遗物', descZh: '每天封印 2 件遗物，每 25 层 +1。', descEn: 'Seals 2 relics each day, +1 per 25 layers.' }
  ],

  // 每日随机事件：每天有概率发生一件
  dailyEvents: [
    {
      id: 'anger', zh: '巨龙躁动', en: 'Dragon Stirred',
      descZh: '巨龙提前发怒，怒气 +1',
      descEn: 'The dragon\'s anger rises by 1'
    },
    {
      id: 'quota', zh: '加急订单', en: 'Rush Order',
      descZh: '今日贡额 +30%',
      descEn: 'Today\'s quota +30%'
    },
    {
      id: 'supply', zh: '补货', en: 'Restock',
      descZh: '今日额外发下 2 把基础剑',
      descEn: '2 extra base blades today'
    },
    {
      id: 'great', zh: '炉火通明', en: 'Bright Forge',
      descZh: '今日大成功签 +6',
      descEn: '+6 Great tickets today'
    },
    {
      id: 'gold', zh: '路过的赏钱', en: 'Passing Coins',
      descZh: '立即获得 400 G',
      descEn: 'Gain 400 G immediately'
    }
  ],

  relicGlyphsZh: [
    '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾',
    '拾壹', '拾贰', '拾叁', '拾肆', '拾伍', '拾陆', '拾柒', '拾捌', '拾玖', '贰拾',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '叁拾',
    '卅一', '卅二'
  ],

  /* ------------------------------ 遗物 ------------------------------ */

  relics: [
    {
      id: 'dragonHeart', glyph: 'I',
      zh: '龙之心', en: 'Dragon Heart',
      descZh: '成功与大成功的剑值额外 +12%。',
      descEn: 'Success and Great success grant +12% extra blade value.',
      effects: { successBonus: 0.12 }
    },
    {
      id: 'ward', glyph: 'II', swordCost: 2,
      zh: '守誓护符', en: 'Oathbound Ward',
      descZh: '每天获得 1 次破碎保护，破碎转为损伤。',
      descEn: 'Gain 1 break protection each day; a break becomes damage.',
      effects: { shield: 1 }
    },
    {
      id: 'luckyDice', glyph: 'III',
      zh: '赌徒骰子', en: "Gambler's Dice",
      descZh: '大成功签 +6，维持 -4，成功 -2。',
      descEn: '+6 Great tickets, -4 Hold, -2 Success.',
      effects: { tickets: { great: 6, hold: -4, success: -2 } }
    },
    {
      id: 'oath', glyph: 'IV', swordCost: 2,
      zh: '不屈誓言', en: 'Unbroken Oath',
      descZh: '每次损伤有 70% 概率恢复失去的等级。',
      descEn: '70% chance to restore the level lost to damage.',
      effects: { damageRestore: 0.7 }
    },
    {
      id: 'apron', glyph: 'V',
      zh: '铁匠围裙', en: "Smith's Apron",
      descZh: '每次损伤额外获得 +140 G 剑值。',
      descEn: 'Each damage still adds +140 G of value.',
      effects: { damageFlat: 140 }
    },
    {
      id: 'brokenHoly', glyph: 'VI', swordCost: 2,
      zh: '残破圣剑', en: 'Broken Holy Sword',
      descZh: '剑破碎时，50% 强化等级传给下一把新剑。',
      descEn: 'On break, pass 50% of the level to the next new blade.',
      effects: { inheritOnBreak: 0.5 }
    },
    {
      id: 'chalice', glyph: 'VII', swordCost: 2,
      zh: '掘墓人圣杯', en: "Undertaker's Chalice",
      descZh: '剑破碎时，返还其 30% 价值为金币。',
      descEn: 'On break, recover 30% of the blade value as gold.',
      effects: { scrapGold: 0.3 }
    },
    {
      id: 'taxCut', glyph: 'VIII', swordCost: 2,
      zh: '减税敕令', en: 'Tax Decree',
      descZh: '每日贡额 -10%。',
      descEn: 'Daily tribute quota -10%.',
      effects: { quotaMult: 0.9 }
    },
    {
      id: 'supply', glyph: 'IX', swordCost: 2,
      zh: '额外口粮', en: 'Extra Ration',
      descZh: '每天多获得 1 把基础剑。',
      descEn: '+1 base sword each morning.',
      effects: { extraSword: 1 }
    },
    {
      id: 'frenzyRune', glyph: 'X',
      zh: '入神符文', en: 'Frenzy Rune',
      descZh: '入神持续时间 +2 秒。',
      descEn: 'Frenzy lasts 2 seconds longer.',
      effects: { frenzyBonus: 2 }
    },
    {
      id: 'swiftEmber', glyph: 'XI',
      zh: '疾风炭', en: 'Swift Ember',
      descZh: '每次锤击额外 +1 入神充能。',
      descEn: '+1 additional Frenzy charge per strike.',
      effects: { chargeBonus: 1 }
    },
    {
      id: 'successIdol', glyph: 'XII', swordCost: 2,
      zh: '成功神像', en: 'Idol of Success',
      descZh: '成功签 +10，维持 -10；破碎权重 ×0.95。',
      descEn: '+10 Success tickets, -10 Hold; break weight ×0.95.',
      effects: { tickets: { success: 10, hold: -10 }, breakMult: 0.95 }
    },
    {
      id: 'holdStone', glyph: 'XIII',
      zh: '滞涩之石', en: 'Stone of Holding',
      descZh: '维持签 +10，损伤 -10；每次维持剑值 +5%。',
      descEn: '+10 Hold tickets, -10 Damage; each Hold adds +5% value.',
      effects: { tickets: { hold: 10, damage: -10 }, holdValue: 0.05 }
    },
    {
      id: 'greatCrown', glyph: 'XIV', swordCost: 2,
      zh: '大成功之冠', en: 'Crown of Greatness',
      descZh: '大成功额外 +1 级。',
      descEn: 'Great success grants +1 additional level.',
      effects: { greatExtra: 1 }
    },
    {
      id: 'gildedAnvil', glyph: 'XV', swordCost: 2,
      zh: '鎏金铁砧', en: 'Gilded Anvil',
      descZh: '所有剑值 +15%。',
      descEn: 'All blade values +15%.',
      effects: { valueMult: 0.15 }
    },
    {
      id: 'ghostPact', glyph: 'XVI', swordCost: 2,
      zh: '幽灵契约', en: 'Ghost Pact',
      descZh: '幽灵商人价格 -25%。',
      descEn: 'Ghost merchant prices -25%.',
      effects: { merchantDiscount: 0.25 }
    },
    {
      id: 'relicEye', glyph: 'XVII',
      zh: '遗物之眼', en: 'Relic Eye',
      descZh: '遗物机刷新费用 -50%。',
      descEn: 'Relic machine refresh cost -50%.',
      effects: { refreshDiscount: 0.5 }
    },
    {
      id: 'dragonScale', glyph: 'XVIII',
      zh: '龙鳞护符', en: 'Dragon Scale',
      descZh: '每次进贡成功额外 +300 G。',
      descEn: '+300 G each successful tribute.',
      effects: { tributeGold: 300 }
    },
    {
      id: 'ashenBreath', glyph: 'XIX',
      zh: '灰烬之息', en: 'Ashen Breath',
      descZh: '每把新剑起始 +2 级。',
      descEn: 'Each new blade starts at +2 level.',
      effects: { nextSwordLevel: 2 }
    },
    {
      id: 'gambler', glyph: 'XX',
      zh: '赌徒之骰', en: "Gambler's Die",
      descZh: '大成功的剑值倍率改为 3 倍。',
      descEn: 'Great success value multiplier becomes ×3.',
      effects: { greatValue: 3 }
    },
    {
      id: 'emberTongs', glyph: '21',
      zh: '余烬铁钳', en: 'Ember Tongs',
      descZh: '新到手的剑已经烧红，无需再加热。',
      descEn: 'Fresh blades arrive already heated.',
      effects: { startHeated: true }
    },
    {
      id: 'quenchVat', glyph: '22',
      zh: '淬火水槽', en: 'Quench Vat',
      descZh: '每次维持额外 +8% 剑值。',
      descEn: 'Each Hold adds +8% extra blade value.',
      effects: { holdValue: 0.08 }
    },
    {
      id: 'coalDevourer', glyph: '23',
      zh: '噬煤兽', en: 'Coal Devourer',
      descZh: '每把新剑起始 +3 级。',
      descEn: 'Each new blade starts at +3 level.',
      effects: { nextSwordLevel: 3 }
    },
    {
      id: 'tributeBanner', glyph: '24',
      zh: '纳贡旗', en: 'Tribute Banner',
      descZh: '每次上贡成功额外 +800 G。',
      descEn: '+800 G each successful tribute.',
      effects: { tributeGold: 800 }
    },
    {
      id: 'dragonTooth', glyph: '25',
      zh: '龙牙', en: 'Dragon Tooth',
      descZh: '大成功额外 +1 级，但破碎权重 +5%。',
      descEn: 'Great success +1 extra level, but break weight +5%.',
      effects: { greatExtra: 1, breakMult: 1.05 }
    },
    {
      id: 'sootLung', glyph: '26',
      zh: '烟肺', en: 'Soot Lung',
      descZh: '入神所需充能 -3，入神持续 -1 秒。',
      descEn: 'Frenzy needs 3 less charge, but lasts 1 second shorter.',
      effects: { frenzyCost: 3, frenzyBonus: -1 }
    },
    {
      id: 'ancestorAsh', glyph: '27',
      zh: '先祖之灰', en: 'Ancestor Ash',
      descZh: '剑破碎时 25% 等级继承，并返还 20% 价值金币。',
      descEn: 'On break, inherit 25% of the level and recover 20% value as gold.',
      effects: { inheritOnBreak: 0.25, scrapGold: 0.2 }
    },
    {
      id: 'taxSeal', glyph: '28',
      zh: '税吏之印', en: "Tax Collector's Seal",
      descZh: '每日贡额 -15%，但每天少发 1 把剑。',
      descEn: 'Daily quota -15%, but one less blade each morning.',
      effects: { quotaMult: 0.85, extraSword: -1 }
    },
    {
      id: 'stormAnvil', glyph: '29',
      zh: '雷砧', en: 'Storm Anvil',
      descZh: '每次大成功额外 +2 入神充能。',
      descEn: '+2 additional Frenzy charge on a Great success.',
      effects: { greatCharge: 2 }
    },
    {
      id: 'graveTax', glyph: '30',
      zh: '墓税令', en: 'Grave Tax Edict',
      descZh: '剑破碎时返还 50% 价值金币。',
      descEn: 'On break, recover 50% of the blade value as gold.',
      effects: { scrapGold: 0.5 }
    },
    {
      id: 'moltenHeart', glyph: '31',
      zh: '熔心', en: 'Molten Heart',
      descZh: '所有剑值 +10%，但每日贡额 +5%。',
      descEn: 'All blade values +10%, but daily quota +5%.',
      effects: { valueMult: 0.1, quotaMult: 1.05 }
    },
    {
      id: 'forgeSpirit', glyph: '32',
      zh: '炉灵', en: 'Forge Spirit',
      descZh: '每天清晨额外获得 250 G。',
      descEn: '+250 G every morning.',
      effects: { dailyGold: 250 }
    },
    {
      id: 'bedrock', glyph: '33', ach: true, swordCost: 2,
      zh: '坚定基石', en: 'Bedrock',
      descZh: '每把剑的第一次断裂会变成伤害。',
      descEn: 'The first break of each blade becomes damage.',
      effects: { firstBreakGuard: 1 }
    },
    {
      id: 'dawnScabbard', glyph: '34', ach: true, swordCost: 3,
      zh: '道恩·斯卡伯德', en: 'Dawn Scabbard',
      descZh: '破碎时 50% 强化传给下一把剑，并让新剑获得 6 点入神充能。',
      descEn: 'On break, pass 50% of the level to the next blade and give it 6 Frenzy charge.',
      effects: { inheritOnBreak: 0.5, inheritCharge: 6 }
    },
    {
      id: 'endlessShaft', glyph: '35', ach: true, swordCost: 3,
      zh: '无尽传动轴', en: 'Endless Driveshaft',
      descZh: '同一把剑每 2 次成功，额外 +1 级。',
      descEn: 'Every 2 Successes on the same blade grant +1 extra level.',
      effects: { successEvery2Level: 1 }
    },
    {
      id: 'dragonHeartElder', glyph: '36', ach: true, swordCost: 2,
      zh: '龙心', en: 'Dragon Heart',
      descZh: '剑达到 +7 后，每次成功或大成功额外 +25% 剑值。',
      descEn: 'At +7 or higher, each Success or Great success adds +25% blade value.',
      effects: { highLevelSuccessValue: 0.25 }
    },
    {
      id: 'perfectCore', glyph: '37', ach: true, swordCost: 2,
      zh: '完美魔力核心', en: 'Perfect Mana Core',
      descZh: '入神期间大成功签 +10。',
      descEn: '+10 Great tickets while in Frenzy.',
      effects: { frenzyGreatTickets: 10 }
    },
    {
      id: 'twinSeal', glyph: '38', ach: true, swordCost: 3,
      zh: '双胞胎之印', en: 'Twin Seal',
      descZh: '每次存活下来的敲击有 5% 概率复制当前剑。',
      descEn: 'Each surviving strike has a 5% chance to duplicate the blade.',
      effects: { duplicateChance: 0.05 }
    },
    {
      id: 'eternalSeed', glyph: '39', ach: true, swordCost: 2,
      zh: '永恒之种', en: 'Eternal Seed',
      descZh: '维持签 +10；每次维持额外 +80 剑值。',
      descEn: '+10 Hold tickets; each Hold adds +80 blade value.',
      effects: { tickets: { hold: 10 }, holdFlat: 80 }
    },
    {
      id: 'abyssPearl', glyph: '40', ach: true, swordCost: 2,
      zh: '深渊珍珠', en: 'Abyssal Pearl',
      descZh: '损伤签 +3；每把剑前 3 次损伤不降低等级。',
      descEn: '+3 Damage tickets; the first 3 damages on each blade do not reduce its level.',
      effects: { tickets: { damage: 3 }, damageGuard: 3 }
    },
    {
      id: 'funeralLedger', glyph: '41', ach: true, swordCost: 3,
      zh: '殡葬师账本', en: "Undertaker's Ledger",
      descZh: '+7 以上的剑破碎后，第二天额外获得 1 把剑（每天最多 2 把）。',
      descEn: 'When a +7 blade breaks, gain 1 extra blade next morning (max 2 per day).',
      effects: { funeralSword: 1 }
    },
    {
      id: 'scytheHammer', glyph: '42', ach: true, swordCost: 4,
      zh: '镰刀与锤子', en: 'Scythe & Hammer',
      descZh: '所有结果的基础签数都设为 6。',
      descEn: 'Set the base ticket count of every outcome to 6.',
      effects: { flatTickets: 6 }
    },
    {
      id: 'clumsy', glyph: '43', ach: true, swordCost: 2,
      zh: '笨拙', en: 'Clumsy',
      descZh: '维持签 +3；成功签 +5。',
      descEn: '+3 Hold tickets; +5 Success tickets.',
      effects: { tickets: { hold: 3, success: 5 } }
    },
    {
      id: 'undyingWick', glyph: '44', ach: true, swordCost: 2,
      zh: '不死的灯芯', en: 'Undying Wick',
      descZh: '入神持续时间 +2 秒。',
      descEn: 'Frenzy lasts 2 seconds longer.',
      effects: { frenzyBonus: 2 }
    },
    {
      id: 'royalChange', glyph: '45', ach: true, swordCost: 3,
      zh: '王室变更', en: 'Royal Change',
      descZh: '成功纳贡后，多余贡品的 50% 抵扣下一天贡额（最多 -50%）。',
      descEn: 'After a successful tribute, 50% of the excess offsets tomorrow\'s quota (max -50%).',
      effects: { excessCarry: 0.5, excessCap: 0.5 }
    },
    {
      id: 'dragonPardon', glyph: '46', ach: true, swordCost: 3,
      zh: '龙之赦免', en: "Dragon's Pardon",
      descZh: '每局一次：免除死亡，怒气 -1，然后失效。',
      descEn: 'Once per run: prevent death, reduce anger by 1, then it is spent.',
      effects: { pardon: 1 }
    },
    {
      id: 'wanderingLedger', glyph: '47', ach: true, swordCost: 4,
      zh: '流浪幽灵账本', en: 'Wandering Ghost Ledger',
      descZh: '幽灵商人每次多带 2 件货。',
      descEn: 'The ghost merchant brings 2 extra offers.',
      effects: { extraMerchant: 2 }
    },
    {
      id: 'lifetimeContract', glyph: '48', ach: true, swordCost: 4,
      zh: '终身合同', en: 'Lifetime Contract',
      descZh: '新剑起始 +9 级，且不再需要加热。',
      descEn: 'New blades start at +9 and no longer need heating.',
      effects: { nextSwordLevel: 9, startHeated: true }
    },
    {
      id: 'crackedJoint', glyph: '49',
      zh: '开裂的接合片', en: 'Cracked Joint',
      descZh: '每点损伤使该剑的断裂几率 -15%，最多 -60%。',
      descEn: 'Each damage reduces that blade\'s break chance by 15%, up to 60%.',
      effects: { damageBreakCut: 0.15, damageBreakCap: 0.6 }
    },
    {
      id: 'giantSpine', glyph: '50', swordCost: 2,
      zh: '巨人脊骨', en: "Giant's Spine",
      descZh: '累计 2 点损伤转化为 1 次破碎保护。',
      descEn: 'Every 2 damage taken grants 1 break shield.',
      effects: { damageToShield: 1 }
    },
    {
      id: 'ironBand', glyph: '51',
      zh: '牢固铁箍', en: 'Iron Band',
      descZh: '断裂权重 -2。',
      descEn: 'Break weight -2.',
      effects: { breakWeightFlat: -2 }
    },
    {
      id: 'urnSheath', glyph: '52',
      zh: '骨灰王之鞘', en: "Ash King's Sheath",
      descZh: '+7 以上的剑破碎时，本局之后的断裂权重永久 +1。',
      descEn: 'When a +7 blade breaks, permanently add +1 break weight for the rest of the run.',
      effects: { breakOnHighLossMark: 1 }
    },
    {
      id: 'thornWeight', glyph: '53',
      zh: '荆棘砝码', en: 'Thorn Weight',
      descZh: '维持签 -2，损伤签 +2。',
      descEn: '-2 Hold tickets, +2 Damage tickets.',
      effects: { tickets: { hold: -2, damage: 2 } }
    },
    {
      id: 'deepPearl', glyph: '54', swordCost: 2,
      zh: '深海遗珠', en: 'Deep Sea Pearl',
      descZh: '损伤签 +3；每把剑前 2 次损伤不降低等级。',
      descEn: '+3 Damage tickets; the first 2 damages on each blade do not reduce its level.',
      effects: { tickets: { damage: 3 }, damageGuard: 2 }
    },
    {
      id: 'dragonScaleTongs', glyph: '55', swordCost: 2,
      zh: '龙鳞钳', en: 'Dragonscale Tongs',
      descZh: '+6 及以上时，断裂几率 -25%。',
      descEn: 'At +6 or higher, break chance -25%.',
      effects: { highLevelBreakCut: 0.25 }
    },
    {
      id: 'phoenixAsh', glyph: '56', swordCost: 3,
      zh: '凤凰灰烬', en: 'Phoenix Ash',
      descZh: '每把剑可抵抗一次断裂，代价是损失 40% 剑值。',
      descEn: 'Each blade resists one break, losing 40% of its value instead.',
      effects: { breakValueResist: 0.4 }
    },
    {
      id: 'blackKnot', glyph: '57',
      zh: '黑绳结', en: 'Black Knot',
      descZh: '断裂几率 -10%。',
      descEn: 'Break chance -10%.',
      effects: { breakMult: 0.9 }
    },
    {
      id: 'wrappedScabbard', glyph: '58',
      zh: '线缠剑鞘', en: 'Wrapped Scabbard',
      descZh: '每天第一次断裂会变成伤害；当天没用的会累积到第二天。',
      descEn: 'The first break each day becomes damage. Unused guards carry over.',
      effects: { dailyBreakGuard: 1 }
    },
    {
      id: 'crackedCrown', glyph: '59',
      zh: '裂冠', en: 'Cracked Crown',
      descZh: '每次损伤有 30% 概率不降低等级。',
      descEn: '30% chance to keep the level when damaged.',
      effects: { damageRestore: 0.3 }
    },
    {
      id: 'twinMark', glyph: '60',
      zh: '双生印', en: 'Twin Mark',
      descZh: '每次损伤额外 +80 剑值。',
      descEn: 'Each damage still adds +80 blade value.',
      effects: { damageFlat: 80 }
    },
    {
      id: 'quickHammer', glyph: '61',
      zh: '疾风锤簧', en: 'Gale Hammer Spring',
      descZh: '入神时自动锤击速度 +50%。',
      descEn: 'Auto-hammer 50% faster during Frenzy.',
      effects: { autoHammer: 0.5 }
    },
    {
      id: 'stillwaterRing', glyph: '62',
      zh: '静水护环', en: 'Stillwater Ring',
      descZh: '破碎权重 -3。',
      descEn: 'Break weight -3.',
      effects: { breakWeightFlat: -3 }
    },
    {
      id: 'lowOath', glyph: '63',
      zh: '守炉人誓', en: "Keeper's Oath",
      descZh: '剑在 +7 以下时，破碎几率 -30%。',
      descEn: 'Break chance -30% while the blade is below +7.',
      effects: { lowLevelBreakCut: 0.3 }
    },
    {
      id: 'quenchTrough', glyph: '64',
      zh: '淬火槽', en: 'Quench Trough',
      descZh: '连续维持每层使破碎几率 -2%，最多 -20%。',
      descEn: 'Each consecutive Hold reduces break chance by 2%, up to 20%.',
      effects: { holdBreakCut: 0.02, holdBreakCap: 0.2 }
    },
    {
      id: 'successShield', glyph: '65', swordCost: 2,
      zh: '凯旋护符', en: 'Triumph Ward',
      descZh: '同一把剑每 3 次成功，获得 1 次破碎保护。',
      descEn: 'Every 3 Successes on the same blade grant 1 break shield.',
      effects: { successShield: 1 }
    },
    {
      id: 'tierWard', glyph: '66', swordCost: 2,
      zh: '静层护符', en: 'Tier Ward',
      descZh: '等级叠层带来的破坏概率 -50%。',
      descEn: 'Break chance from level tiers -50%.',
      effects: { breakTierCut: 0.5 }
    },
    {
      id: 'trueOath', glyph: '67', swordCost: 2,
      zh: '无量誓约', en: 'Measureless Oath',
      descZh: '破坏概率直接 -5%（不随等级变化）。',
      descEn: 'Break chance -5% outright, regardless of level.',
      effects: { breakChanceFlat: -0.05 }
    },
    {
      id: 'steadyBell', glyph: '68', swordCost: 2,
      zh: '定心铃', en: 'Steady Bell',
      descZh: '入神所需格子随等级增长的概率 -60%。',
      descEn: 'Level-based Frenzy charge growth chance -60%.',
      effects: { frenzyTierCut: 0.6 }
    },
    {
      id: 'frenzyEcho', glyph: '69', swordCost: 2,
      zh: '入神余韵', en: 'Frenzy Echo',
      descZh: '入神期间的每次大成功额外 +1 入神充能，结束后仍会保留。',
      descEn: 'Each Great during Frenzy grants +1 charge that carries over.',
      effects: { frenzyGreatCharge: 1 }
    },
    {
      id: 'phantomHammer', glyph: '70', swordCost: 2,
      zh: '幻影锤击', en: 'Phantom Strike',
      descZh: '锻造台边多出一把幽灵锤；每挥一锤，它会像正常锤一样独立判定一次（可能加级、损伤甚至打碎剑）。',
      descEn: 'A spectral hammer haunts the anvil: every swing, it rolls its own outcome like a normal strike (may add levels, damage, or even shatter the blade).',
      effects: { phantomHammer: 1 }
    },
    {
      id: 'slowHourglass', glyph: '71', swordCost: 2,
      zh: '缓时沙漏', en: 'Hourglass of Delay',
      descZh: '入神时间随等级缩短的概率 -60%。',
      descEn: 'Level-based Frenzy duration loss chance -60%.',
      effects: { frenzyTimeCut: 0.6 }
    },
    {
      id: 'elfSatchel', glyph: '72', swordCost: 2,
      zh: '精灵背篓', en: 'Elf Satchel',
      descZh: '小精灵每次可以多抱 1 把剑（可叠加）。',
      descEn: 'The house elf carries 1 extra blade per trip (stacks).',
      effects: { elfCarry: 1 }
    }
  ],

  starterRelics: ['dragonHeart', 'ward', 'luckyDice'],

  /* ------------------------------ 成就 ------------------------------ */

  // form: 对应剑形；kind: 统计条件；relic: 永久解锁并加入售货机的遗物
  achievements: [
    { id: 'achFamilyLongsword', zh: '锻造家族之刃 +20', en: 'Forge the Family Blade to +20', descZh: '把「长剑」锻到 +20。', descEn: 'Forge a Longsword to +20.', form: 'longsword', target: 20, relic: 'bedrock' },
    { id: 'achFamilyGreatsword', zh: '锻造城堡剑 +20', en: 'Forge the Castle Sword to +20', descZh: '把「巨刃」锻到 +20。', descEn: 'Forge a Greatblade to +20.', form: 'greatsword', target: 20, relic: 'dawnScabbard' },
    { id: 'achFamilyBonesaw', zh: '锻造锯刃 +20', en: 'Forge the Saw Blade to +20', descZh: '把「骨锯」锻到 +20。', descEn: 'Forge a Bonesaw to +20.', form: 'bonesaw', target: 20, relic: 'endlessShaft' },
    { id: 'achFamilyFang', zh: '锻造龙牙 +20', en: 'Forge the Dragon Fang to +20', descZh: '把「獠牙」锻到 +20。', descEn: 'Forge a Fang to +20.', form: 'fang', target: 20, relic: 'dragonHeartElder' },
    { id: 'achFamilyFlamberge', zh: '锻造符文之刃 +20', en: 'Forge the Rune Blade to +20', descZh: '把「祭坛刃」锻到 +20。', descEn: 'Forge an Altar Blade to +20.', form: 'flamberge', target: 20, relic: 'perfectCore' },
    { id: 'achFamilyScimitar', zh: '锻造分刃 +20', en: 'Forge the Split Blade to +20', descZh: '把「弯刀」锻到 +20。', descEn: 'Forge a Scimitar to +20.', form: 'scimitar', target: 20, relic: 'twinSeal' },
    { id: 'achFamilyTentacle', zh: '锻造世界树 +20', en: 'Forge the World Tree to +20', descZh: '把「触须」锻到 +20。', descEn: 'Forge a Tentacle to +20.', form: 'tentacle', target: 20, relic: 'eternalSeed' },
    { id: 'achFamilyRapier', zh: '锻造鱼刃 +20', en: 'Forge the Fish Blade to +20', descZh: '把「细剑」锻到 +20。', descEn: 'Forge a Rapier to +20.', form: 'rapier', target: 20, relic: 'abyssPearl' },
    { id: 'achFamilyTombstone', zh: '锻造葬礼剑 +20', en: 'Forge the Funeral Sword to +20', descZh: '把「墓碑」锻到 +20。', descEn: 'Forge a Tombstone to +20.', form: 'tombstone', target: 20, relic: 'funeralLedger' },
    { id: 'achWinContract', zh: '坚持到第21天并完成合同', en: 'Reach day 21 and fulfil the contract', descZh: '在第 21 天完成纳贡。', descEn: 'Complete the tribute on day 21.', kind: 'win', target: 1, relic: 'scytheHammer' },
    { id: 'achBreak10', zh: '一次跑动中打断10把剑', en: 'Break 10 blades in one run', descZh: '单局累计破碎 10 把剑。', descEn: 'Break 10 blades in a single run.', kind: 'runBreak', target: 10, relic: 'clumsy' },
    { id: 'achFrenzy5', zh: '一次游戏中进入狂暴五次', en: 'Enter Frenzy 5 times in one run', descZh: '单局累计进入入神 5 次。', descEn: 'Enter Frenzy 5 times in a single run.', kind: 'runFrenzy', target: 5, relic: 'undyingWick' },
    { id: 'achTripleTribute', zh: '支付至少三倍贡品要求', en: 'Offer at least 3× the quota', descZh: '单次上贡达到贡额的 3 倍。', descEn: 'Offer at least 3× the daily quota in one tribute.', kind: 'runTriple', target: 1, relic: 'royalChange' },
    { id: 'achFinalAnger', zh: '在最后愤怒阶段全额致敬', en: 'Fulfil the tribute at max anger', descZh: '怒气达到上限时仍完成纳贡。', descEn: 'Complete a tribute while anger is at maximum.', kind: 'runFinalAnger', target: 1, relic: 'dragonPardon' },
    { id: 'achMerchantClear', zh: '在一次商人访问中买下所有库存', en: 'Buy out the merchant in one visit', descZh: '一次商人来访中买空全部货位。', descEn: 'Buy every item during a single merchant visit.', kind: 'runMerchantClear', target: 1, relic: 'wanderingLedger' },
    { id: 'achFullTribute3', zh: '合同完成后全额支付三次贡品', en: 'Fulfil the quota three times', descZh: '单局累计 3 次达到贡额。', descEn: 'Meet the quota 3 times in one run.', kind: 'runFullTribute', target: 3, relic: 'lifetimeContract' },
    { id: 'achFirstTribute', zh: '第一次纳贡', en: 'First Tribute', descZh: '完成任意一天的纳贡。', descEn: 'Complete any day\'s tribute.', kind: 'runFirstTribute', target: 1, relic: null },
    { id: 'achHundredHammers', zh: '百炼成钢', en: 'Hundred Hammers', descZh: '累计挥锤 100 次。', descEn: 'Swing the hammer 100 times in total.', kind: 'globalSwings', target: 100, relic: null },
    { id: 'achRelicCollector', zh: '遗物收藏家', en: 'Relic Collector', descZh: '单局持有 12 种不同遗物。', descEn: 'Own 12 different relics in one run.', kind: 'runRelicKinds', target: 12, relic: null }
  ],

  /* ------------------------------ 商人 ------------------------------ */

  merchantItems: [
    {
      id: 'incense', glyph: '香',
      zh: '遗忘香', en: 'Incense of Oblivion',
      descZh: '使巨龙的怒气 -1。',
      descEn: 'Reduce dragon anger by 1.',
      cost: 900
    },
    {
      id: 'spare', glyph: '剑',
      zh: '备用剑', en: 'Spare Blade',
      descZh: '立刻获得 1 把基础剑。',
      descEn: 'Gain 1 base sword immediately.',
      cost: 450
    },
    {
      id: 'wardCharm', glyph: '符',
      zh: '守护符', en: 'Ward Charm',
      descZh: '今日获得 1 次破碎保护。',
      descEn: 'Gain 1 break protection for today.',
      cost: 700
    },
    {
      id: 'coinPouch', glyph: '金',
      zh: '贡金袋', en: 'Tribute Pouch',
      descZh: '立即获得 1200 G。',
      descEn: 'Gain 1200 G immediately.',
      cost: 500
    },
    {
      id: 'whetstone', glyph: '磨',
      zh: '磨刀石', en: 'Whetstone',
      descZh: '下一次挥锤必定大成功（+2 级）。',
      descEn: 'Your next strike is a guaranteed Great success (+2 levels).',
      cost: 800
    },
    {
      id: 'oil', glyph: '油',
      zh: '淬火油', en: 'Quenching Oil',
      descZh: '今日所有剑值 +20%。',
      descEn: 'All blade values +20% for today.',
      cost: 650
    },
    {
      id: 'charm', glyph: '静',
      zh: '静心符', en: 'Calming Talisman',
      descZh: '今日大成功签 +8。',
      descEn: '+8 Great tickets for today.',
      cost: 750
    },
    {
      id: 'crackedScale', glyph: '鳞',
      zh: '开裂的龙鳞', en: 'Cracked Dragonscale',
      descZh: '下一次敲击不会破碎，无论结果如何都会消耗。',
      descEn: 'Your next strike cannot break; consumed no matter the result.',
      cost: 1100
    },
    {
      id: 'regretClockwork', glyph: '悔',
      zh: '悔恨的发条', en: 'Clockwork of Regret',
      descZh: '撤销上一次敲击，即使那把剑已经破碎。',
      descEn: 'Undo the last strike, even if the blade was destroyed.',
      cost: 2400
    },
    {
      id: 'redChalk', glyph: '粉',
      zh: '红粉笔', en: 'Red Chalk',
      descZh: '下一次敲击的大成功券翻倍。',
      descEn: 'Double the Great tickets of your next strike.',
      cost: 1400
    },
    {
      id: 'powderBag', glyph: '末',
      zh: '粉末袋', en: 'Powder Bag',
      descZh: '下一次敲击：成功/大成功变为大成功，其他结果变为破碎。',
      descEn: 'Next strike: Success/Great become Great, everything else becomes Break.',
      cost: 2000
    },
    {
      id: 'coldStar', glyph: '星',
      zh: '冷星碎片', en: 'Cold Star Shard',
      descZh: '立即获得 3 点入神充能（入神期间无法使用）。',
      descEn: 'Gain 3 Frenzy charge (cannot be used during Frenzy).',
      cost: 1600
    },
    {
      id: 'ghostDelivery', glyph: '送',
      zh: '幽灵送货单', en: 'Ghost Delivery Note',
      descZh: '下一次补给额外获得 2 把基础剑。',
      descEn: 'Your next supply brings 2 extra base blades.',
      cost: 1500
    }
  ],

  /* ------------------------------ 文案 ------------------------------ */

  strings: {
    zh: {
      loading: '铁匠铺正在苏醒…',
      contractDay: '契约日',
      tributeDue: '今日贡额',
      offered: '已上贡',
      swordsHeld: '持剑',
      dragonAnger: '巨龙怒气',
      relicsBtn: '遗物',
      helpBtn: '玩法',

      stationRack: '剑架',
      stationForge: '熔炉',
      stationAnvil: '铁砧',
      stationTribute: '贡台',
      stationRelic: '遗物机',
      stationMerchant: '幽灵商人',

      forgingNow: '正在锻造',
      tributeValue: '贡品价值',
      greatPreview: '大成功',
      outBreak: '破坏',
      outDamage: '损伤',
      outHold: '维持',
      outSuccess: '成功',
      outGreat: '大成功',
      ticketPanel: '本锤签数',
      swing: '挥锤',
      sheathe: '收锤',
      takeSword: '取下',
      removeSword: '取下',
      forgeHint: '点击画面或按空格挥锤 · Esc 收锤 · 按 F 或点“取下”把剑拿在手上',

      startKicker: '黑暗第一人称锻造',
      startTitle: '锻剑纳贡',
      startSub: '锻剑 · 纳贡 · 求生',
      startDesc: '你被一条巨龙囚禁在铁匠铺里。它每天索要一把够价的剑——交不上，就承受它的怒火。<b>活过 {n} 天</b>，或者死在这里。',
      startFact1: '21', startFact1Label: '天契约',
      startFact2: '3', startFact2Label: '把剑 / 天',
      startFact3: '5', startFact3Label: '种锤击结果',
      startBtn: '签订契约',
      openWindow: '在新窗口打开（可锁鼠标）',
      lockBlocked: '当前预览窗口不支持锁定鼠标，请在“设置 → 在新窗口打开”里用新窗口游玩',
      cacheClearing: '正在清除缓存并重载（存档保留）…',
      continueBtn: '继续契约',
      startNote: '点击画面锁定鼠标 · WASD 移动 · Esc 释放鼠标 · 准星对准物件按 E 互动 · 铁砧上的剑按 F 取下',

      starterKicker: '契约之前',
      starterTitle: '选择一件初始遗物',
      starterSub: '巨龙允许你从囚室里带走一件旧物。它会在接下来的 {n} 天里改变你的运气。',
      choose: '选择',

      dayKicker: '第 {n} 天',
      dayQuota: '今日贡额',
      dayGold: '金币',
      daySwords: '新发剑坯',
      dayContinue: '开始锻造',
      daySuccess: '贡品已收下',
      dayFail: '贡品不足',

      rackTitle: '剑架',
      rackSub: '这里是你全部的剑。加热后才能上砧；放上贡台后，才会在敲铃时献出。',
      forgeTitle: '熔炉',
      forgeSub: '把剑坯烧到工作温度。加热只需一次，不会随挥锤消耗。',
      anvilTitle: '铁砧',
      anvilSub: '把加热的剑放上铁砧，开始挥锤。每一次锤击都会从签池中抽签。',
      tributeTitle: '贡台',
      tributeSub: '把剑放上贡台，合计价值达到今日贡额后敲铃。未放上贡台的剑会留到明天。',
      relicTitle: '遗物售货机',
      relicSub: '机器不收金币，只收剑。每换走一件遗物，你就少一把能献给巨龙的剑。',
      merchantTitle: '幽灵商人',
      merchantSub: '它只在特定的日子出现。金币能买到剑、护符，或者一点喘息的时间。',
      relicsOwnedTitle: '已持有遗物',
      relicsOwnedSub: '遗物会改变签池、剑值与贡品结算。',
      noRelics: '还没有遗物。去遗物机用剑换一件。',

      heat: '加热',
      heatAll: '全部加热',
      placeAnvil: '放上铁砧',
      enterForge: '继续锻造',
      takeBack: '取回',
      placeTribute: '放上贡台',
      ringBell: '敲铃进贡',
      retrieve: '取回',
      sacrifice: '换取',
      confirm: '确认',
      cancel: '取消',
      close: '关闭',
      refresh: '刷新',
      buy: '购买',
      chooseSword: '选择一把剑',
      noSwords: '没有可用的剑',
      noHeated: '没有加热的剑',
      noRaw: '没有未加热的剑',
      noCounter: '贡台上还没有剑',
      noOffers: '今天的货架空了',
      notEnoughGold: '金币不足',
      soldOut: '已售出',
      stateRack: '剑架',
      stateAnvil: '铁砧',
      stateCounter: '贡台',
      stateHeated: '已加热',
      stateCold: '未加热',
      value: '价值',
      level: '等级',

      heldLabel: '手持',
      heldHeated: '已加热',
      heldCold: '未加热',
      lockHint: '点击画面锁定鼠标 · 按 Esc 释放',
      lockHintOn: '鼠标已锁定 · 按 Esc 释放',
      buffShield: '免破碎',
      buffTimes: '次',
      buffShieldDesc: '今日剩余的破碎保护：破碎会改为损伤，用掉一次就少一次',
      buffFrenzy: '入神',
      buffFrenzyDesc: '入神期间不会破碎',
      buffInherit: '继承',
      buffInheritDesc: '下一把新剑会继承的强化等级',
      buffForce: '必大成功',
      buffForceDesc: '下一次挥锤必定大成功，每锤消耗 1 次',
      buffValue: '淬火',
      buffValueDesc: '今日所有剑值额外提升',
      buffTickets: '静心',
      buffTicketsDesc: '今日大成功签额外增加',
      promptInteract: '互动',
      actPick: '拾取',
      actSwap: '交换',
      actTake: '取回',
      actHang: '收起',
      actHeat: '加热',
      actPlaceAnvil: '放上铁砧',
      actForge: '继续锻造',
      actTakeAnvil: '取下',
      actPlaceCounter: '放上贡台',
      actRing: '敲铃',
      actRingAgain: '再按一次',
      actBuyRelic: '以剑换取',
      actRefresh: '刷新',
      actBuy: '购买',
      actInfo: '查看',
      promptNeedSword: '需要手持一把剑',
      promptNeedHeat: '先在熔炉加热',
      promptAnvilBusy: '铁砧上已经有一把剑',
      promptCounterFull: '贡台已经放满',
      promptSold: '已售出',
      promptNoGold: '金币不足',
      promptNotNeeded: '现在不需要',
      promptNoOffer: '今日货架已空',
      promptRingWarn: '贡品不足，敲铃会让巨龙发怒',
      promptRingAgain: '再按一次 E 确认',
      promptHandFull: '手上已经有一把剑',
      promptHeatDone: '这把剑已经加热',
      promptRackInfo: '对准剑身按 E 拿起',
      promptCounterInfo: '已上贡 {offered} / {quota} G',
      promptBellInfo: '已上贡 {offered} / {quota} G',
      promptRelicCost: '代价：{n} 把剑',
      promptRelicRepeat: '可重复购买',
      promptRelicRefreshHint: '刷新货架后可再次出现',
      promptRelicStored: '已存入 {have} 把',
      promptMachineNeed: '存剑口里需要 {n} 把剑',
      promptMachineEmpty: '存剑口里还没有剑',
      machineDepositTitle: '存剑口',
      machineDepositInfo: '已存入 {n} 把剑',
      machineDepositLabel: '存剑 {n}',
      actMachineDeposit: '存入 {name}',
      actMachineWithdraw: '取回一把',
      toastMachineDeposit: '{name} 已存入存剑口',
      toastMachineWithdraw: '取回了 {name}',
      elfTitle: '家养小精灵',
      elfInfo: '地上还有 {n} 把剑，它每次能抱 {cap} 把送进售货机',
      actElfHelp: '让它帮忙收剑',
      actElfStop: '让它先歇着',
      toastElfOn: '小精灵开始把地上的剑送进售货机',
      toastElfOff: '小精灵回到了售货机旁',
      phantomOutSuccess: '幻影·成功',
      phantomOutGreat: '幻影·大成功',
      phantomOutHold: '幻影·维持',
      phantomOutDamage: '幻影·损伤',
      phantomOutBreak: '幻影·破碎',
      promptRefreshCost: '费用：{cost} G',
      promptItemCost: '{cost} G',
      promptItemStore: '购买后放入道具栏',
      promptAnvilInfo: '{name} · +{level} · {value} G',
      machineLabel: '遗物售货机',
      machineRefresh: '刷新',
      machineBan: '封禁遗物',
      machineBanLabel: '封禁 1 剑',
      promptBanTitle: '封禁遗物',
      promptBanInfo: '消耗 1 把剑，让一个遗物不再出现在售货机',
      promptBanNeed: '存剑口里需要 1 把剑',
      banTitle: '封禁遗物',
      banHint: '消耗 1 把剑，被选中的遗物本局不再出现在售货机；已持有的遗物不受影响。',
      banNeedSword: '存剑口里至少要有 1 把剑',
      banEmpty: '没有可封禁的遗物了',
      banOwned: '已持有 {n}',
      banBanned: '已封禁',
      actBan: '封禁',
      toastBanned: '{name} 已被封禁，不再出现',
      machineEmpty: '今日货架已空',
      machineCost: '{n} 把剑',
      toastPicked: '拿起了 {name}',
      toastSwapped: '交换了 {name}',
      toastTookAnvil: '{name} 已拿在手上',
      toastTookCounter: '{name} 已拿在手上',
      toastPlacedAnvil2: '{name} 已放上铁砧',
      toastCounterFull: '贡台已经放满',
      toastHeating: '正在加热 {name}…',
      toastMachineRefresh: '货架已刷新，花费 {gold} G',
      toastNoOffer: '今天的货架空了',
      toastAnvilEmpty: '铁砧上已经没有剑',
      toastRackFull: '剑架已经放满，剑被放在了贡台',
      toastHandFull: '手上已经有一把剑',

      costSword: '1 把剑',
      refreshCost: '刷新费用',
      shopRefresh: '刷新货架',
      refreshLeft: '今日还可刷新 {n} 次',
      noEligibleSword: '没有可作为代价的剑',
      ringWarn: '贡品总值不足。现在敲铃会失败，巨龙怒气 +1。',
      ringAnyway: '仍然敲铃',
      sacrificeTitle: '换取 {name}',
      sacrificeSub: '选择一把剑投入机器。它会永远消失。',
      sacrificeConfirm: '投入并换取',
      machineStock: '货架',
      ticketBoardTitle: '签 · 今日签池',
      ticketBoardBase: '基础签池',
      ticketBoardSword: '当前剑 Lv {lv}',
      ticketBoardTotal: '总签',
      ticketBoardHint: '每锤按权重抽取',
      achBtn: '成就',
      achTitle: '成就',
      achSub: '共 19 个成就，其中 16 个会永久解锁遗物并加入所有存档的售货机。',
      achProgress: '已解锁 {n} / {t}',
      achDone: '已解锁',
      achLocked: '未解锁',
      achReward: '奖励遗物：{name}',
      achNoReward: '无遗物奖励',
      achUnlockedToast: '成就解锁：{name}',
      achRelicJoin: '遗物「{name}」已加入所有存档的售货机',
      ownedLabel: '已拥有',
      shieldLabel: '护符',
      dayShort: '天',
      goldShort: 'G',
      angerShort: '怒气',
      newQuota: '明日贡额',
      dragonLineCalm: '“交上来。”',
      dragonLineAngry: '“你在考验我的耐心。”',
      dragonLineFurious: '“最后一次机会。”',
      dragonLineAccept: '“勉强……够格。”',
      dragonLineReject: '“这就是你的贡品？”',
      dragonLineDeath: '“没用的东西。”',

      toastHeated: '{name} 已烧至工作温度',
      toastPlacedAnvil: '{name} 已放上铁砧',
      toastRemovedAnvil: '{name} 已取回剑架',
      toastPlacedCounter: '{name} 已放上贡台',
      toastRemovedCounter: '{name} 已取回',
      toastNeedHeated: '这把剑还没加热',
      toastTributeSuccess: '贡品已收下。获得 {gold} G。',
      toastTributeFail: '贡品不足。巨龙怒气 +1。',
      toastAngerMax: '巨龙已经忍无可忍。',
      toastBreak: '{name} 断了。',
      toastShield: '护符挡下了破碎，剑身受损。',
      toastInherit: '残破圣剑保住了 {n} 级强化',
      toastScrap: '回收了 {gold} G 残值',
      toastRelic: '获得遗物：{name}',
      toastMerchant: '幽灵商人出现了。',
      toastItem: '已购买：{name}',
      toastItemStored: '已放入道具栏：{name}',
      toastItemUsed: '已使用：{name}',
      toastNoUndo: '没有可撤销的敲击',
      toastFrenzyNoItem: '入神期间无法使用',
      toastCrackedScale: '龙鳞护佑：下一锤不会破碎',
      toastRedChalk: '红粉笔：下一锤大成功券翻倍',
      toastPowder: '粉末袋：下一锤结果将被改写',
      toastColdStar: '冷星碎片：获得 3 点入神充能',
      toastDelivery: '幽灵送货单：下一次补给 +2 把剑',
      toastPardon: '龙之赦免：免除死亡，怒气 -1',
      toastDuplicate: '双胞胎之印：复制了 {name}',
      toastFirstBreak: '坚定基石：第一次断裂被化解为伤害',
      toastPhoenix: '凤凰灰烬：损失 40% 剑值，保住了剑',
      toastDailyGuard: '线缠剑鞘：免碎裂 -1（剩余 {n}）',
      buffCrackedScale: '龙鳞',
      buffCrackedScaleDesc: '下一次敲击不会破碎，无论结果都会消耗',
      buffPowder: '粉末',
      buffPowderDesc: '下一次敲击：成功/大成功变大成功，其余变破碎',
      buffChalk: '红粉笔',
      buffChalkDesc: '下一次敲击的大成功券翻倍',
      buffPardon: '赦免',
      buffPardonDesc: '每局一次的免死机会',
      toastAngerZero: '怒气已经是 0',
      toastNoSpace: '剑架和贡台都满了，暂时用不了备用剑',
      itemsLabel: '道具',
      relicsLabel: '遗物（被动）',
      startDragons: '龙王契约',
      startDragonsHint: '可多选或不选；每条负面同时生效，强度随本局累计破碎层数持续增长',
      startDragonsNone: '不选择任何龙',
      startDays: '结束天数',
      startDaysHint: '可设置本局总天数（5 ~ 99）',
      dragonLayers: '龙之层数',
      frenzyBanned: '入神已封锁',
      toastRefreshCap: '今天的刷新次数已用尽',
      toastDragonFrost: '寒狱龙：失败摧毁了剑架 {n} 把剑',
      toastDragonStarve: '龙食龙：吞掉了 {n} 把剑',
      toastDragonToll: '逆鳞龙：收走剑架 {n} 把剑',
      toastDragonChain: '碎星龙：连坐裂开 {n} 把剑',
      toastDragonCrack: '铁鳞龙：裂痕已满，剑碎了',
      toastDragonHex: '蛊龙：入神反噬，剑碎了',
      toastDragonFester: '毒牙龙：损伤转为破碎',
      toastDragonTax: '抽成龙：收走 {gold} G',
      toastDragonBuyban: '禁器龙：本局无法购买遗物',
      toastDragonSealed: '诡龙封印了 {n} 件遗物：{names}',
      invItemEmpty: '暂无道具',
      invRelicEmpty: '暂无遗物',
      itemClickUse: '点击使用',
      toastFrenzy: '入神！{n} 秒内自动锤击，且不会破碎',
      toastFrenzyEnd: '入神结束，破碎风险恢复',
      toastSwordLevel: '新剑起始 +{n} 级',
      toastNoSword: '没有可用的剑',
      toastNoGold: '金币不足',
      toastHeatAll: '所有未加热的剑已烧红',
      toastNoHeatNeeded: '所有剑都已加热',
      toastNoShield: '护符已经用完了',
      toastAngerReduced: '巨龙怒气 -1',

      helpTitle: '锻造与纳贡',
      helpSub: '活过 {n} 天。所有互动都在场景里完成：走近、用准星看准物件、按 E。没有背包，也没有额外的操作页面。',
      help1: '<b>拿剑</b>：走近剑架，用准星看准一把剑，按 E 拿起。手上一次只能拿一把。',
      help2: '<b>加热</b>：带着剑走到熔炉前，对准炉口按 E 烧红。没有加热的剑不能上砧。',
      help3: '<b>上砧</b>：把加热的剑对准铁砧按 E 放上。点击画面或按空格挥锤，Esc 收锤。',
      help4: '<b>抽签</b>：每锤抽一个结果——成功 +1 级、大成功 +2 级、维持不变、损伤 -1 级、破坏毁剑。',
      help5: '<b>取下</b>：锻完后按 F，或点面板上的“取下”，把剑拿在手上。剑架上的剑可以按 E 交换。',
      help6: '<b>纳贡</b>：把剑放到贡台，对准铃铛按 E 敲铃。遗物机旁有存剑口：先把剑存入，才能用存入的剑换遗物；幽灵商人每 3 天出现。',
      helpClose: '明白了',

      codexOdds: '五签',
      codexOddsSub: '每挥一锤只抽一个结果，签池随剑的等级与遗物变化。',
      outBreakDesc: '剑当场碎裂，等级归零，只能重打一把。',
      outDamageDesc: '等级 -1，剑身出现裂纹，价值随之下降。',
      outHoldDesc: '等级不变，锤子像打在棉花上。',
      outSuccessDesc: '等级 +1，剑值按等级成长。',
      outGreatDesc: '等级 +2，并且按 2.5 倍结算本锤剑值。',
      codexSwords: '剑谱 · 十二形',
      codexSwordsSub: '基础剑会随机长成这十二种形制之一，每种形制自带一个特性，锻它时自动生效。',
      codexSets: '遗物套装',
      codexSetsSub: '集齐同一套的遗物后自动获得额外效果。',
      startDifficulty: '契约难度',
      codexRelics: '遗物图鉴',
      codexRelicsSub: '遗物机里投一把剑换一件，效果整局永久叠加；开局还能三选一。',
      codexItems: '幽灵商人货单',
      codexItemsSub: '每逢第 3、6、9… 天飘进铁匠铺，用金币交易；买下的道具会放进道具栏，可在锻造面板或右侧点击使用。',
      codexPrice: '售价',
      codexOwned: '已持有',
      codexScroll: '向下滚动查看全部',
      merchantChip: '幽灵商人到访',
      merchantArrive: '幽灵商人飘进了铁匠铺，去看看他的货。',

      deathKicker: '契约终结',
      deathTitle: '葬身龙腹',
      deathDesc: '你没能凑齐最后的贡品。铁栏后的庞然大物失去了耐心。',
      deathQuote: '“你的锤子，归我了。”',
      deathRestart: '重新签约',
      victoryKicker: '契约完成',
      victoryTitle: '活过第 {n} 天',
      victoryDesc: '最后一天的贡品被收下了。巨龙闭上眼，铁栏后的黑暗重新归于沉寂。',
      victoryQuote: '“还算……有点用。”',
      victoryRestart: '再签一份契约',
      endDays: '坚持天数',
      endGold: '累计金币',
      endBest: '最高剑值',
      endRelics: '遗物数量',

      resBreak: '破碎',
      resDamage: '损伤',
      resHold: '维持',
      resSuccess: '成功',
      resGreat: '大成功',
      resFrenzy: '入神',
      logReady: '等待下一锤',
      logLast: '上一锤：{outcome} · {detail}',
      logFrenzy: '入神剩余 {s} 秒',
      logBroken: '剑已断裂',
      logNoSword: '铁砧是空的',

      objPick: '走到剑架前，用准星看准一把剑按 E 拿起',
      objHeat: '带着剑走到熔炉前，对准炉口按 E 加热',
      objAnvil: '把加热的剑对准铁砧按 E 放上',
      objCarry: '把锻好的剑放上贡台，或放回铁砧继续锻造',
      objForgeAnvil: '按 E 继续锻造 · 按 F 取下',
      objForge: '挥锤锻造，凑够今日贡额',
      objCounter: '把剑放上贡台 · 已上贡 {offered} / {quota} G',
      objBell: '贡品已够，对准铃铛按 E 敲铃',
      objBroken: '剑断了，去剑架再拿一把',
      objNoSword: '没有可用的剑了，等明天巨龙发剑',

      monthApril: '四月',
      monthMay: '五月',
      monthAprilEn: 'APRIL',
      monthMayEn: 'MAY',
      calendarTitle: '契约日历',
      calendarNote: '每日贡额',
      confirmReset: '确定要放弃当前契约，重新开始吗？',
      reset: '重开契约',
      clearConfirm: '再点一次确认重开',
      settings: '设置',
      saved: '已保存',
      noSave: '没有找到契约存档',
      soundOn: '关闭音效',
      soundOff: '开启音效'
    },

    en: {
      loading: 'The forge is waking…',
      contractDay: 'Contract day',
      tributeDue: 'Tribute due',
      offered: 'Offered',
      swordsHeld: 'Blades',
      dragonAnger: 'Dragon anger',
      relicsBtn: 'Relics',
      helpBtn: 'Help',

      stationRack: 'Rack',
      stationForge: 'Forge',
      stationAnvil: 'Anvil',
      stationTribute: 'Tribute',
      stationRelic: 'Relic',
      stationMerchant: 'Merchant',

      forgingNow: 'Forging',
      tributeValue: 'Tribute value',
      greatPreview: 'Great',
      outBreak: 'Break',
      outDamage: 'Damage',
      outHold: 'Hold',
      outSuccess: 'Success',
      outGreat: 'Great',
      ticketPanel: 'DRAW TICKETS',
      swing: 'Strike',
      sheathe: 'Sheathe',
      takeSword: 'Take',
      removeSword: 'Take off',
      forgeHint: 'Click or Space to strike · Esc to sheathe · F / Take to carry the blade',

      startKicker: 'A dark first-person forging roguelite',
      startTitle: 'FORGE TAX',
      startSub: 'FORGE TAX',
      startDesc: 'A dragon keeps you chained to its forge. Every day it demands a blade worth its price. Fail, and feel its wrath. <b>Survive {n} days</b>, or die here.',
      startFact1: '21', startFact1Label: 'day contract',
      startFact2: '3', startFact2Label: 'blades / day',
      startFact3: '5', startFact3Label: 'strike outcomes',
      startBtn: 'Sign the contract',
      openWindow: 'Open in new window (mouse lock)',
      lockBlocked: 'This preview frame blocks mouse lock — use “Settings → Open in new window”.',
      cacheClearing: 'Clearing cache and reloading (save kept)…',
      continueBtn: 'Continue contract',
      startNote: 'Click the scene to capture the mouse · WASD to move · Esc releases · aim and press E · F takes the blade from the anvil',

      starterKicker: 'Before the contract',
      starterTitle: 'Choose a starting relic',
      starterSub: 'The dragon lets you keep one old trinket from your cell. It will bend your luck for the next {n} days.',
      choose: 'Choose',

      dayKicker: 'Day {n}',
      dayQuota: 'Tribute due',
      dayGold: 'Gold',
      daySwords: 'New blades',
      dayContinue: 'Begin forging',
      daySuccess: 'Tribute accepted',
      dayFail: 'Tribute insufficient',

      rackTitle: 'Blade Rack',
      rackSub: 'Every blade you own. Heat a blade before it can touch the anvil; place it on the tribute counter before the bell.',
      forgeTitle: 'The Forge',
      forgeSub: 'Bring a blank to working temperature. Heating is one-time and is not consumed by hammer strikes.',
      anvilTitle: 'The Anvil',
      anvilSub: 'Place a heated blade and start hammering. Every strike draws a ticket from the pool.',
      tributeTitle: 'Tribute Counter',
      tributeSub: 'Place blades here. When the total reaches the quota, ring the bell. Blades left off the counter stay with you.',
      relicTitle: 'Relic Machine',
      relicSub: 'The machine does not take gold. It takes swords. Every relic costs you a blade that could have paid the dragon.',
      merchantTitle: 'Ghost Merchant',
      merchantSub: 'It appears only on certain days. Gold buys blades, wards, or a little more time.',
      relicsOwnedTitle: 'Owned Relics',
      relicsOwnedSub: 'Relics bend the ticket pool, blade value, and tribute.',
      noRelics: 'No relics yet. Trade a blade at the relic machine.',

      heat: 'Heat',
      heatAll: 'Heat all',
      placeAnvil: 'Place on anvil',
      enterForge: 'Keep forging',
      takeBack: 'Take back',
      placeTribute: 'Place on counter',
      ringBell: 'Ring the bell',
      retrieve: 'Retrieve',
      sacrifice: 'Trade',
      confirm: 'Confirm',
      cancel: 'Cancel',
      close: 'Close',
      refresh: 'Refresh',
      buy: 'Buy',
      chooseSword: 'Choose a blade',
      noSwords: 'No blades available',
      noHeated: 'No heated blades',
      noRaw: 'No unheated blades',
      noCounter: 'Nothing on the counter',
      noOffers: 'The shelves are empty',
      notEnoughGold: 'Not enough gold',
      soldOut: 'Sold',
      stateRack: 'Rack',
      stateAnvil: 'Anvil',
      stateCounter: 'Counter',
      stateHeated: 'Heated',
      stateCold: 'Cold',
      value: 'Value',
      level: 'Level',

      heldLabel: 'Held',
      heldHeated: 'Heated',
      heldCold: 'Cold',
      lockHint: 'Click the scene to capture the mouse · Esc to release',
      lockHintOn: 'Mouse captured · Esc to release',
      buffShield: 'Break shield',
      buffTimes: 'left',
      buffShieldDesc: 'Remaining break protection today: a break becomes damage; each use consumes one',
      buffFrenzy: 'Frenzy',
      buffFrenzyDesc: 'No break while frenzy lasts',
      buffInherit: 'Inherit',
      buffInheritDesc: 'Levels the next new blade will inherit',
      buffForce: 'Sure Great',
      buffForceDesc: 'Your next strikes are guaranteed Great successes; each strike spends one',
      buffValue: 'Quenched',
      buffValueDesc: 'All blade values boosted for today',
      buffTickets: 'Calm',
      buffTicketsDesc: 'Extra Great tickets for today',
      promptInteract: 'Interact',
      actPick: 'Pick up',
      actSwap: 'Swap',
      actTake: 'Take back',
      actHang: 'Hang up',
      actHeat: 'Heat',
      actPlaceAnvil: 'Place on anvil',
      actForge: 'Keep forging',
      actTakeAnvil: 'Take',
      actPlaceCounter: 'Place on counter',
      actRing: 'Ring',
      actRingAgain: 'Press again',
      actBuyRelic: 'Trade blade',
      actRefresh: 'Refresh',
      actBuy: 'Buy',
      actInfo: 'Inspect',
      promptNeedSword: 'You need a blade in hand',
      promptNeedHeat: 'Heat it at the forge first',
      promptAnvilBusy: 'The anvil already holds a blade',
      promptCounterFull: 'The counter is full',
      promptSold: 'Sold',
      promptNoGold: 'Not enough gold',
      promptNotNeeded: 'Not needed now',
      promptNoOffer: 'The shelves are empty today',
      promptRingWarn: 'The tribute is short — ringing will anger the dragon',
      promptRingAgain: 'Press E again to confirm',
      promptHandFull: 'You are already holding a blade',
      promptHeatDone: 'This blade is already heated',
      promptRackInfo: 'Aim at a blade and press E to take it',
      promptCounterInfo: 'Offered {offered} / {quota} G',
      promptBellInfo: 'Offered {offered} / {quota} G',
      promptRelicCost: 'Cost: {n} swords',
      promptRelicRepeat: 'Repeatable',
      promptRelicRefreshHint: 'Refresh the stock to see it again',
      promptRelicStored: 'Stored: {have}',
      promptMachineNeed: 'The vault needs {n} blades',
      promptMachineEmpty: 'The blade vault is empty',
      machineDepositTitle: 'BLADE VAULT',
      machineDepositInfo: '{n} blades stored',
      machineDepositLabel: 'STORED {n}',
      actMachineDeposit: 'Store {name}',
      actMachineWithdraw: 'Withdraw one',
      toastMachineDeposit: '{name} stored in the vault',
      toastMachineWithdraw: 'Withdrew {name}',
      elfTitle: 'HOUSE ELF',
      elfInfo: '{n} blades on the floor — it carries {cap} per trip to the machine',
      actElfHelp: 'Ask the elf for help',
      actElfStop: 'Let the elf rest',
      toastElfOn: 'The elf starts carrying floor blades to the machine',
      toastElfOff: 'The elf returns to the machine',
      phantomOutSuccess: 'Phantom · Success',
      phantomOutGreat: 'Phantom · Great',
      phantomOutHold: 'Phantom · Hold',
      phantomOutDamage: 'Phantom · Damage',
      phantomOutBreak: 'Phantom · Break',
      promptRefreshCost: 'Cost: {cost} G',
      promptItemCost: '{cost} G',
      promptItemStore: 'stored in your pouch',
      promptAnvilInfo: '{name} · +{level} · {value} G',
      machineLabel: 'RELIC MACHINE',
      machineRefresh: 'REFRESH',
      machineBan: 'BAN RELIC',
      machineBanLabel: 'BAN · 1 BLADE',
      promptBanTitle: 'Ban a relic',
      promptBanInfo: 'Spend 1 blade to remove a relic from the machine pool',
      promptBanNeed: 'The vault needs 1 blade',
      banTitle: 'BAN A RELIC',
      banHint: 'Spend 1 blade to keep the chosen relic out of the machine for the rest of this run. Relics you already own are unaffected.',
      banNeedSword: 'At least 1 blade must be in the vault',
      banEmpty: 'Nothing left to ban',
      banOwned: 'Owned {n}',
      banBanned: 'Banned',
      actBan: 'Ban',
      toastBanned: '{name} is banned and will not appear again',
      machineEmpty: 'Empty',
      machineCost: '{n} SWORDS',
      toastPicked: 'Picked up {name}',
      toastSwapped: 'Swapped {name}',
      toastTookAnvil: '{name} is in hand',
      toastTookCounter: '{name} is in hand',
      toastPlacedAnvil2: '{name} is on the anvil',
      toastCounterFull: 'The counter is full',
      toastHeating: 'Heating {name}…',
      toastMachineRefresh: 'Stock refreshed · {gold} G',
      toastNoOffer: 'The shelves are empty today',
      toastAnvilEmpty: 'The anvil is empty',
      toastRackFull: 'The rack is full — the blade was put on the counter',
      toastHandFull: 'You are already holding a blade',

      costSword: '1 sword',
      refreshCost: 'Refresh cost',
      shopRefresh: 'Refresh stock',
      refreshLeft: '{n} refreshes left today',
      noEligibleSword: 'No blade can be spent',
      ringWarn: 'The tribute is short. Ringing now will fail and raise the dragon\'s anger by 1.',
      ringAnyway: 'Ring anyway',
      sacrificeTitle: 'Trade for {name}',
      sacrificeSub: 'Choose a blade to feed the machine. It will be gone forever.',
      sacrificeConfirm: 'Feed the machine',
      machineStock: 'Stock',
      ticketBoardTitle: 'TICKETS · TODAY',
      ticketBoardBase: 'Base pool',
      ticketBoardSword: 'Current blade Lv {lv}',
      ticketBoardTotal: 'Total',
      ticketBoardHint: 'Each strike draws by weight',
      achBtn: 'Achievements',
      achTitle: 'Achievements',
      achSub: '19 achievements in total. 16 of them permanently unlock a relic and add it to the vending machine of every save.',
      achProgress: 'Unlocked {n} / {t}',
      achDone: 'Unlocked',
      achLocked: 'Locked',
      achReward: 'Reward relic: {name}',
      achNoReward: 'No relic reward',
      achUnlockedToast: 'Achievement unlocked: {name}',
      achRelicJoin: 'Relic "{name}" is now available in every save\'s vending machine',
      ownedLabel: 'Owned',
      shieldLabel: 'Ward',
      dayShort: 'days',
      goldShort: 'G',
      angerShort: 'Anger',
      newQuota: 'Tomorrow',
      dragonLineCalm: '"Bring it."',
      dragonLineAngry: '"You test my patience."',
      dragonLineFurious: '"One last chance."',
      dragonLineAccept: '"Barely... worthy."',
      dragonLineReject: '"This is your tribute?"',
      dragonLineDeath: '"Worthless."',

      toastHeated: '{name} is at working temperature',
      toastPlacedAnvil: '{name} is on the anvil',
      toastRemovedAnvil: '{name} returned to the rack',
      toastPlacedCounter: '{name} placed on the counter',
      toastRemovedCounter: '{name} taken back',
      toastNeedHeated: 'This blade is not heated',
      toastTributeSuccess: 'Tribute accepted. +{gold} G.',
      toastTributeFail: 'Tribute insufficient. Dragon anger +1.',
      toastAngerMax: 'The dragon has no patience left.',
      toastBreak: '{name} shattered.',
      toastShield: 'A ward shattered instead of the blade.',
      toastInherit: 'Broken Holy Sword preserved {n} levels',
      toastScrap: 'Recovered {gold} G of scrap',
      toastRelic: 'Relic acquired: {name}',
      toastMerchant: 'The ghost merchant has appeared.',
      toastItem: 'Purchased: {name}',
      toastItemStored: 'Stored in your item pouch: {name}',
      toastItemUsed: 'Used: {name}',
      toastNoUndo: 'There is no strike to undo',
      toastFrenzyNoItem: 'Cannot be used during Frenzy',
      toastCrackedScale: 'Dragonscale ward: your next strike cannot break',
      toastRedChalk: 'Red chalk: next strike has doubled Great tickets',
      toastPowder: 'Powder bag: your next strike outcome is rewritten',
      toastColdStar: 'Cold star: +3 Frenzy charge',
      toastDelivery: 'Ghost delivery: next supply +2 blades',
      toastPardon: "Dragon's Pardon: death prevented, anger -1",
      toastDuplicate: 'Twin Seal: duplicated {name}',
      toastFirstBreak: 'Bedrock: the first break became damage',
      toastPhoenix: 'Phoenix Ash: lost 40% value, the blade survived',
      toastDailyGuard: 'Wrapped Scabbard: break guarded ({n} left)',
      buffCrackedScale: 'Ward',
      buffCrackedScaleDesc: 'Next strike cannot break; consumed regardless of result',
      buffPowder: 'Powder',
      buffPowderDesc: 'Next strike: Success/Great become Great, all else becomes Break',
      buffChalk: 'Chalk',
      buffChalkDesc: 'Next strike has doubled Great tickets',
      buffPardon: 'Pardon',
      buffPardonDesc: 'One death prevention per run',
      toastAngerZero: 'Anger is already 0',
      toastNoSpace: 'Rack and counter are full — cannot use the spare blade',
      itemsLabel: 'ITEMS',
      relicsLabel: 'RELICS (PASSIVE)',
      startDragons: 'DRAGON PACTS',
      startDragonsHint: 'Pick any number (or none). Every penalty stacks and scales with the layers gained this run.',
      startDragonsNone: 'No dragons',
      startDays: 'Contract length',
      startDaysHint: 'Set the total days of this run (5 ~ 99)',
      dragonLayers: 'Dragon layers',
      frenzyBanned: 'Frenzy sealed',
      toastRefreshCap: 'No refreshes left today',
      toastDragonFrost: 'Frosthell: failure shattered {n} rack blades',
      toastDragonStarve: 'Starvemaw: devoured {n} blades',
      toastDragonToll: 'Toll: took {n} rack blades',
      toastDragonChain: 'Chainstar: cracked {n} more blades',
      toastDragonCrack: 'Ironcrack: cracks filled, the blade shattered',
      toastDragonHex: 'Hex: frenzy backlash shattered the blade',
      toastDragonFester: 'Fester: damage turned into a break',
      toastDragonTax: 'Tax: took {gold} G',
      toastDragonBuyban: 'Buyban: relics cannot be bought this run',
      toastDragonSealed: 'Fickle sealed {n} relics: {names}',
      invItemEmpty: 'No items',
      invRelicEmpty: 'No relics',
      itemClickUse: 'click to use',
      toastFrenzy: 'Frenzy! Auto-hammering for {n} seconds with no break risk',
      toastFrenzyEnd: 'Frenzy over — break risk returns',
      toastSwordLevel: 'New blade starts at +{n}',
      toastNoSword: 'No blades available',
      toastNoGold: 'Not enough gold',
      toastHeatAll: 'All cold blades are glowing',
      toastNoHeatNeeded: 'Every blade is already heated',
      toastNoShield: 'No wards left',
      toastAngerReduced: 'Dragon anger -1',

      helpTitle: 'Forging & Tribute',
      helpSub: 'Survive {n} days. Everything happens in the room: walk up, aim with the crosshair, press E. No inventory, no extra screens.',
      help1: '<b>Pick up</b>: walk to the rack, aim at a blade, press E. You can carry one blade at a time.',
      help2: '<b>Heat</b>: carry the blade to the forge, aim at the mouth and press E. A cold blade cannot be forged.',
      help3: '<b>Anvil</b>: aim at the anvil and press E to place the heated blade. Click or Space to strike, Esc to sheathe.',
      help4: '<b>Draw</b>: every strike draws Success +1, Great +2, Hold, Damage -1, or Break.',
      help5: '<b>Take</b>: press F, or use the Take button, to carry the forged blade. Aim at another rack blade and press E to swap.',
      help6: '<b>Tribute</b>: place the blade on the counter, aim at the bell and press E. The relic machine has a blade vault — store blades there first, then spend the stored ones on relics. The ghost appears every 3 days.',
      helpClose: 'Understood',

      codexOdds: 'THE FIVE DRAWS',
      codexOddsSub: 'Each hammer blow draws one result; the pool shifts with blade level and relics.',
      outBreakDesc: 'The blade shatters and its level is lost. Start a new one.',
      outDamageDesc: 'Level -1 and a crack forms; value drops with it.',
      outHoldDesc: 'No change. The hammer lands like it hit cloth.',
      outSuccessDesc: 'Level +1; value grows with level.',
      outGreatDesc: 'Level +2, and this blow pays out at 2.5x value.',
      codexSwords: 'BLADE CODEX · 12 FORMS',
      codexSwordsSub: 'Every blade takes one of these twelve forms; each form has its own passive that applies while forging it.',
      codexSets: 'RELIC SETS',
      codexSetsSub: 'Collect every relic in a set to gain its extra effect.',
      startDifficulty: 'CONTRACT DIFFICULTY',
      codexRelics: 'RELIC CODEX',
      codexRelicsSub: 'Feed a blade to the machine for one relic. Effects stack for the whole run; you also start with one of three.',
      codexItems: 'GHOST MERCHANT STOCK',
      codexItemsSub: 'Drifts in on days 3, 6, 9… and trades for gold; bought items go to your pouch and can be used from the forge panel or the right-side bar.',
      codexPrice: 'Price',
      codexOwned: 'Owned',
      codexScroll: 'Scroll for the full list',
      merchantChip: 'GHOST MERCHANT HERE',
      merchantArrive: 'The ghost merchant drifted in. Go see his wares.',

      deathKicker: 'Contract ended',
      deathTitle: 'DEVOURED',
      deathDesc: 'You could not pay the final tribute. The thing behind the bars ran out of patience.',
      deathQuote: '"Your hammer is mine now."',
      deathRestart: 'Sign again',
      victoryKicker: 'Contract complete',
      victoryTitle: 'SURVIVED DAY {n}',
      victoryDesc: 'The final tribute was accepted. The dragon closes its eyes, and the dark behind the bars goes quiet.',
      victoryQuote: '"Barely... useful."',
      victoryRestart: 'Sign a new contract',
      endDays: 'Days survived',
      endGold: 'Total gold',
      endBest: 'Best blade',
      endRelics: 'Relics',

      resBreak: 'BREAK',
      resDamage: 'DAMAGE',
      resHold: 'HOLD',
      resSuccess: 'SUCCESS',
      resGreat: 'GREAT',
      resFrenzy: 'FRENZY',
      logReady: 'Ready for the next strike',
      logLast: 'Last: {outcome} · {detail}',
      logFrenzy: 'Frenzy {s}s remaining',
      logBroken: 'The blade is broken',
      logNoSword: 'The anvil is empty',

      objPick: 'Walk to the rack, aim at a blade and press E',
      objHeat: 'Carry it to the forge and press E at the mouth',
      objAnvil: 'Aim at the anvil and press E to place the heated blade',
      objCarry: 'Put the forged blade on the counter, or back on the anvil to keep forging',
      objForgeAnvil: 'E to keep forging · F to take the blade',
      objForge: 'Keep hammering toward the quota',
      objCounter: 'Place blades on the counter · {offered} / {quota} G',
      objBell: 'The tribute is ready — aim at the bell and press E',
      objBroken: 'The blade broke — take another from the rack',
      objNoSword: 'No blades left — wait for tomorrow',

      monthApril: 'APRIL',
      monthMay: 'MAY',
      monthAprilEn: 'APRIL',
      monthMayEn: 'MAY',
      calendarTitle: 'CONTRACT',
      calendarNote: 'daily tribute',
      confirmReset: 'Abandon this contract and start over?',
      reset: 'Restart contract',
      clearConfirm: 'Click again to confirm',
      settings: 'Settings',
      saved: 'Saved',
      noSave: 'No contract save found',
      soundOn: 'Mute sound',
      soundOff: 'Unmute sound'
    }
  }
};
