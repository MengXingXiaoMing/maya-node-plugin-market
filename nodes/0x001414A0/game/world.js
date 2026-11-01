/* ==========================================================================
   锻剑纳贡 · 3D 铁匠铺
   --------------------------------------------------------------------------
   第一人称场景：铁砧 / 熔炉 / 剑架 / 贡台与巨龙 / 遗物机 / 幽灵商人
   所有模型与贴图均由代码程序化生成，不依赖外部美术资源。
   ========================================================================== */

(function () {
  'use strict';

  const T = window.THREE;
  const CFG = window.FT_CONFIG;
  const B = CFG.balance;
  const TAU = Math.PI * 2;

  /* ------------------------------ 基础工具 ------------------------------ */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - (1 - t) * (1 - t);
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function texFromCanvas(canvas, rx, ry, clampEdge) {
    const tex = new T.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = clampEdge ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    if (rx || ry) tex.repeat.set(rx || 1, ry || 1);
    tex.encoding = T.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  function noiseOverlay(g, w, h, amount) {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      d[i] = clamp(d[i] + n, 0, 255);
      d[i + 1] = clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    }
    g.putImageData(img, 0, 0);
  }

  /* ------------------------------ 程序化贴图 ------------------------------ */

  function makeBrickCanvas() {
    const size = 512;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    // 灰泥底：偏暖的暗棕灰，让砖缝不再死黑
    g.fillStyle = '#2e241c';
    g.fillRect(0, 0, size, size);
    const rows = 8;
    const bh = size / rows;
    const bw = 128;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (bw / 2);
      for (let x = -bw; x < size + bw; x += bw) {
        // 暖棕砖，明度跨度大些，个别砖偏红/偏灰
        const v = 58 + Math.random() * 34;
        const warm = Math.random();
        const rr = v + 26 + warm * 14;
        const gg = v + 12 + warm * 4;
        const bb = v - 2;
        g.fillStyle = `rgb(${rr},${gg},${bb})`;
        g.fillRect(x + offset + 3, r * bh + 3, bw - 6, bh - 6);
        // 砖面纵向渐变：上亮下暗，有体积感
        const grad = g.createLinearGradient(0, r * bh + 3, 0, r * bh + bh - 3);
        grad.addColorStop(0, 'rgba(255,225,190,0.14)');
        grad.addColorStop(0.5, 'rgba(255,225,190,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.3)');
        g.fillStyle = grad;
        g.fillRect(x + offset + 3, r * bh + 3, bw - 6, bh - 6);
        // 砖面斑驳
        for (let k = 0; k < 5; k++) {
          g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,210,170' : '0,0,0'},${0.04 + Math.random() * 0.05})`;
          g.fillRect(x + offset + 4 + Math.random() * (bw - 16), r * bh + 4 + Math.random() * (bh - 12), 4 + Math.random() * 14, 3 + Math.random() * 8);
        }
        // 顶部受光边 / 底部阴影边
        g.fillStyle = 'rgba(255,220,180,0.12)';
        g.fillRect(x + offset + 5, r * bh + 5, bw - 10, 2);
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.fillRect(x + offset + 3, r * bh + bh - 6, bw - 6, 3);
        // 偶发裂缝
        if (Math.random() < 0.2) {
          g.strokeStyle = 'rgba(0,0,0,0.5)';
          g.lineWidth = 1.2;
          g.beginPath();
          let cx = x + offset + 10 + Math.random() * (bw - 20);
          let cy = r * bh + 4;
          g.moveTo(cx, cy);
          for (let s = 0; s < 3; s++) {
            cx += rand(-8, 8);
            cy += bh / 3;
            g.lineTo(cx, cy);
          }
          g.stroke();
        }
      }
    }
    // 整片污渍
    for (let i = 0; i < 6; i++) {
      const grad = g.createRadialGradient(Math.random() * size, Math.random() * size, 4, Math.random() * size, Math.random() * size, 40 + Math.random() * 70);
      grad.addColorStop(0, 'rgba(0,0,0,0.16)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    noiseOverlay(g, size, size, 10);
    return c;
  }

  function makeStoneCanvas() {
    const size = 512;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    // 深缝底
    g.fillStyle = '#171310';
    g.fillRect(0, 0, size, size);
    const cells = 4;
    const s = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        // 不规则石板：每块略微缩进且角部错位
        const jx = rand(-4, 4);
        const jy = rand(-4, 4);
        const v = 56 + Math.random() * 26;
        g.fillStyle = `rgb(${v + 10},${v + 4},${v - 4})`;
        g.beginPath();
        g.moveTo(x * s + 5 + jx, y * s + 6 + jy);
        g.lineTo(x * s + s - 6 + jx * 0.5, y * s + 4 + jy);
        g.lineTo(x * s + s - 4 - jx * 0.5, y * s + s - 6 + jy * 0.5);
        g.lineTo(x * s + 6 - jx, y * s + s - 4 - jy);
        g.closePath();
        g.fill();
        // 石面渐变与磨损高光
        const grad = g.createLinearGradient(x * s, y * s, x * s + s, y * s + s);
        grad.addColorStop(0, 'rgba(255,240,215,0.1)');
        grad.addColorStop(0.6, 'rgba(255,240,215,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = grad;
        g.fillRect(x * s + 4, y * s + 4, s - 8, s - 8);
        // 磨损斑
        for (let k = 0; k < 4; k++) {
          g.fillStyle = `rgba(255,235,200,${0.03 + Math.random() * 0.04})`;
          g.fillRect(x * s + 10 + Math.random() * (s - 30), y * s + 10 + Math.random() * (s - 30), 6 + Math.random() * 18, 3 + Math.random() * 8);
        }
        g.fillStyle = 'rgba(255,245,220,0.07)';
        g.fillRect(x * s + 7, y * s + 7, s - 14, 3);
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let px = Math.random() * size;
      let py = Math.random() * size;
      g.beginPath();
      g.moveTo(px, py);
      for (let j = 0; j < 4; j++) {
        px += rand(-28, 28);
        py += rand(-28, 28);
        g.lineTo(px, py);
      }
      g.stroke();
    }
    noiseOverlay(g, size, size, 9);
    return c;
  }

  // 熔炉石：深色玄武岩砌块 + 烟炱，专贴炉体（比通用石板更暗更小砖）
  function makeForgeStoneCanvas() {
    const size = 512;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    // 灰缝底：近黑的暖灰
    g.fillStyle = '#100c08';
    g.fillRect(0, 0, size, size);
    const rows = 9;
    const bh = size / rows;
    const cols = 3;
    const bw = size / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (bw / 2);
      for (let x = -bw; x < size + bw; x += bw) {
        // 深暖灰岩块，个别偏褐
        const v = 40 + Math.random() * 26;
        const rr = v + 14 + Math.random() * 8;
        const gg = v + 7;
        const bb = v;
        g.fillStyle = `rgb(${rr},${gg},${bb})`;
        g.fillRect(x + offset + 2, r * bh + 2, bw - 4, bh - 4);
        // 块面纵向渐变：上缘受光、下缘压暗
        const grad = g.createLinearGradient(0, r * bh + 2, 0, r * bh + bh - 2);
        grad.addColorStop(0, 'rgba(255,205,155,0.12)');
        grad.addColorStop(0.45, 'rgba(255,205,155,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.36)');
        g.fillStyle = grad;
        g.fillRect(x + offset + 2, r * bh + 2, bw - 4, bh - 4);
        // 岩面麻点
        for (let k = 0; k < 7; k++) {
          g.fillStyle = `rgba(${Math.random() > 0.4 ? '0,0,0' : '255,215,175'},${0.04 + Math.random() * 0.06})`;
          g.fillRect(x + offset + 4 + Math.random() * (bw - 14), r * bh + 4 + Math.random() * (bh - 10), 3 + Math.random() * 10, 2 + Math.random() * 5);
        }
        // 受光边 / 阴影边
        g.fillStyle = 'rgba(255,215,175,0.1)';
        g.fillRect(x + offset + 3, r * bh + 3, bw - 6, 2);
        g.fillStyle = 'rgba(0,0,0,0.42)';
        g.fillRect(x + offset + 2, r * bh + bh - 5, bw - 4, 3);
      }
    }
    // 烟炱：炉石常年熏黑的污渍
    for (let i = 0; i < 7; i++) {
      const sx = Math.random() * size;
      const sy = Math.random() * size;
      const grad = g.createRadialGradient(sx, sy, 4, sx, sy, 50 + Math.random() * 80);
      grad.addColorStop(0, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    noiseOverlay(g, size, size, 10);
    return c;
  }

  function makeWoodCanvas() {
    const w = 512;
    const h = 256;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = '#33200f';
    g.fillRect(0, 0, w, h);
    for (let p = 0; p < 4; p++) {
      const y = p * h / 4;
      const v = 52 + Math.random() * 22;
      g.fillStyle = `rgb(${v + 30},${v + 12},${v - 4})`;
      g.fillRect(0, y + 2, w, h / 4 - 4);
      // 板面渐变：一侧受光
      const grad = g.createLinearGradient(0, y, 0, y + h / 4);
      grad.addColorStop(0, 'rgba(255,215,160,0.12)');
      grad.addColorStop(1, 'rgba(0,0,0,0.24)');
      g.fillStyle = grad;
      g.fillRect(0, y + 2, w, h / 4 - 4);
      for (let i = 0; i < 16; i++) {
        g.strokeStyle = `rgba(30,16,8,${0.1 + Math.random() * 0.14})`;
        g.lineWidth = 1;
        g.beginPath();
        const yy = y + Math.random() * (h / 4);
        g.moveTo(0, yy);
        g.bezierCurveTo(w * 0.3, yy + rand(-4, 4), w * 0.7, yy + rand(-4, 4), w, yy + rand(-3, 3));
        g.stroke();
      }
      // 木节
      if (Math.random() < 0.8) {
        const kx = Math.random() * w;
        const ky = y + 6 + Math.random() * (h / 4 - 12);
        g.strokeStyle = 'rgba(25,12,5,0.55)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.ellipse(kx, ky, 5 + Math.random() * 4, 3 + Math.random() * 2.5, 0, 0, TAU);
        g.stroke();
        g.fillStyle = 'rgba(20,10,4,0.5)';
        g.beginPath();
        g.ellipse(kx, ky, 2, 1.4, 0, 0, TAU);
        g.fill();
      }
    }
    noiseOverlay(g, w, h, 8);
    return c;
  }

  function makeGlowCanvas(color1, color2) {
    const s = 128;
    const c = makeCanvas(s, s);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, color1);
    grad.addColorStop(0.45, color2);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
  }

  // 角落蛛网：从左上角发散的放射丝 + 同心弧
  function makeWebCanvas() {
    const s = 256;
    const c = makeCanvas(s, s);
    const g = c.getContext('2d');
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(206,216,214,0.62)';
    g.lineWidth = 1.2;
    const cx = 6;
    const cy = 6;
    for (let i = 0; i <= 9; i++) {
      const a = (i / 9) * Math.PI / 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 252, cy + Math.sin(a) * 252);
      g.stroke();
    }
    for (let r = 34; r <= 238; r += 34) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI / 2);
      g.stroke();
    }
    return c;
  }

  function makeEnvCanvas() {
    const w = 512;
    const h = 256;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = '#050607';
    g.fillRect(0, 0, w, h);
    let grad = g.createRadialGradient(110, 150, 10, 110, 150, 190);
    grad.addColorStop(0, 'rgba(255,120,45,0.85)');
    grad.addColorStop(0.4, 'rgba(120,45,15,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    grad = g.createRadialGradient(400, 40, 10, 400, 40, 200);
    grad.addColorStop(0, 'rgba(90,130,170,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    grad = g.createLinearGradient(0, h * 0.7, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(35,25,15,0.4)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c;
  }

  /* ------------------------------ 粒子系统 ------------------------------ */

  class ParticleField {
    constructor(scene, max, opts) {
      this.max = max;
      this.gravity = opts.gravity != null ? opts.gravity : 600;
      this.drag = opts.drag != null ? opts.drag : 0.6;
      this.positions = new Float32Array(max * 3);
      this.colors = new Float32Array(max * 3);
      this.vel = new Float32Array(max * 3);
      this.life = new Float32Array(max);
      this.maxLife = new Float32Array(max);
      this.baseColor = [];
      for (let i = 0; i < max; i++) {
        this.positions[i * 3 + 1] = -999;
        this.baseColor.push(new T.Color(0xffffff));
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(this.positions, 3));
      geo.setAttribute('color', new T.BufferAttribute(this.colors, 3));
      const mat = new T.PointsMaterial({
        size: opts.size || 0.035,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: T.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
      });
      this.points = new T.Points(geo, mat);
      this.points.frustumCulled = false;
      scene.add(this.points);
      this.cursor = 0;
    }

    spawn(x, y, z, count, color, power, spread) {
      const col = new T.Color(color);
      const p = power || 1;
      const sp = spread || 1;
      for (let n = 0; n < count; n++) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.max;
        const i3 = i * 3;
        this.positions[i3] = x + rand(-0.04, 0.04) * sp;
        this.positions[i3 + 1] = y + rand(-0.02, 0.02) * sp;
        this.positions[i3 + 2] = z + rand(-0.04, 0.04) * sp;
        const ang = rand(0, TAU);
        const speed = rand(0.3, 1.9) * p;
        const up = rand(0.4, 1.7) * p;
        this.vel[i3] = Math.cos(ang) * speed * 0.65;
        this.vel[i3 + 1] = up;
        this.vel[i3 + 2] = Math.sin(ang) * speed * 0.65;
        this.life[i] = rand(0.25, 0.7);
        this.maxLife[i] = this.life[i];
        this.colors[i3] = col.r;
        this.colors[i3 + 1] = col.g;
        this.colors[i3 + 2] = col.b;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }

    update(dt) {
      let dirty = false;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) continue;
        dirty = true;
        this.life[i] -= dt;
        const i3 = i * 3;
        if (this.life[i] <= 0) {
          this.positions[i3 + 1] = -999;
          this.colors[i3] = 0;
          this.colors[i3 + 1] = 0;
          this.colors[i3 + 2] = 0;
          continue;
        }
        this.vel[i3 + 1] -= this.gravity * dt;
        this.vel[i3] -= this.vel[i3] * this.drag * dt;
        this.vel[i3 + 2] -= this.vel[i3 + 2] * this.drag * dt;
        this.positions[i3] += this.vel[i3] * dt;
        this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
        this.positions[i3 + 2] += this.vel[i3 + 2] * dt;
        const a = clamp(this.life[i] / this.maxLife[i], 0, 1);
        this.colors[i3] *= 1 - dt * 1.8;
        this.colors[i3 + 1] *= 1 - dt * 1.8;
        this.colors[i3 + 2] *= 1 - dt * 1.8;
        if (a < 0.15) {
          this.colors[i3] *= 0.9;
          this.colors[i3 + 1] *= 0.9;
          this.colors[i3 + 2] *= 0.9;
        }
      }
      if (dirty) {
        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;
      }
    }
  }

  /* ------------------------------ 主场景 ------------------------------ */

  class ForgeWorld {
    constructor(canvas, callbacks) {
      this.canvas = canvas;
      this.cb = Object.assign({
        onInteract() {},
        onForgeSwing() {},
        onForgeExit() {},
        onFocus() {},
        onTakeAnvil() {}
      }, callbacks || {});

      this.time = 0;
      this.timeScale = 1;
      this.lang = 'zh';
      this.mode = 'walk';
      this.locked = false;
      this.mouseLocked = false;
      this.focus = null;
      this.merchantVisible = false;
      this.frenzy = false;
      this.frenzyPulse = 0;
      this.frenzySpeed = 1;
      // 泥沼龙：挥击动作整体放慢的倍率
      this.swingSlow = 1;
      this.destroyed = false;
      this.shake = 0;
      this.anger = 0;
      this.tribute = { quota: 0, offered: 0 };
      this.calendarDay = 0;
      this.hammerSwing = null;
      this.heating = null;
      this.bellSwing = 0;
      this.dragonRoar = 0;
      this.jawOpen = 0;
      this.anvilGroup = null;
      this.rackGroups = [];
      this.counterGroups = [];
      // 剑架挂满后多出来的剑：掉在地上（带简易物理）
      this.dropSwords = new Map();
      this.floorHitboxes = [];
      this.floorSig = '';
      this.tempSword = null;
      this.heldGroup = null;
      this.heldSig = '';
      this.hitboxes = [];
      this.raycaster = new T.Raycaster();
      this.raycaster.far = 3.2;
      this.rackSig = '';
      this.counterSig = '';
      this.rackSlots = [];
      this.machineRefreshCost = 208;
      this.merchantItems = [];
      this.anvilFocus = { kind: 'anvil', hasSword: false };
      this.counterFocus = { kind: 'counter' };
      this.bellFocus = { kind: 'bell' };
      this.forgeFocus = { kind: 'forge' };
      this.refreshFocus = { kind: 'refresh' };
      this.machineDepositFocus = { kind: 'machineDeposit' };
      this.banFocus = { kind: 'banRelic' };
      this.machineStored = 0;
      this.heldVisible = true;

      this.player = {
        pos: new T.Vector3(0, 0, 3.3),
        yaw: 0,
        pitch: -0.08,
        bob: 0
      };
      this.keys = {};
      this.drag = null;

      this.initRenderer();
      this.initScene();
      this.initTextures();
      this.initSharedGeometry();
      this.buildRoom();
      this.buildRoomDetails();
      this.buildRoomProps();
      this.buildTicketBoard();
      this.buildForge();
      this.buildAnvil();
      this.buildCageAndCounter();
      this.buildDragon();
      this.buildRack();
      this.buildRelicMachine();
      this.buildElf();
      this.buildGhost();
      this.buildCalendar();
      this.buildInteractables();
      this.initParticles();
      this.initHammer();
      this.initPhantomHammer();
      this.bindInput();
      this.resize();

      this.lastTs = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    /* ---------------------------- 初始化 ---------------------------- */

    initRenderer() {
      this.renderer = new T.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.renderer.outputEncoding = T.sRGBEncoding;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
    }

    // 低画质：关阴影 + 固定 1 倍像素比，给低配和手机减负
    setQuality(low) {
      this.lowQuality = !!low;
      if (!this.renderer) return;
      this.renderer.shadowMap.enabled = !this.lowQuality;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowQuality ? 1 : 1.75));
      if (this.scene) {
        this.scene.traverse(o => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { m.needsUpdate = true; });
        });
      }
      this.resize();
    }

    initScene() {
      this.scene = new T.Scene();
      this.scene.background = new T.Color(0x0a0c10);
      this.scene.fog = new T.FogExp2(0x0a0c10, 0.026);

      this.camera = new T.PerspectiveCamera(70, 1, 0.05, 80);
      this.camera.rotation.order = 'YXZ';
      this.camera.position.set(0, 1.65, 3.3);
      this.scene.add(this.camera);

      this.cameraLight = new T.PointLight(0xffc080, 0.35, 2.4, 2);
      this.cameraLight.position.set(0.35, 0.15, 0.1);
      this.camera.add(this.cameraLight);

      // 半球光：天光冷灰、地面反弹暖棕，奠定冷暖对比基调
      // 强度压低：全局光只负责“看得清”，明暗戏剧感交给局部光
      const hemi = new T.HemisphereLight(0x5a6a80, 0x2a1a10, 0.42);
      this.scene.add(hemi);

      const fill = new T.DirectionalLight(0x8fa8c4, 0.3);
      fill.position.set(3, 5, 4);
      this.scene.add(fill);

      const warmFill = new T.PointLight(0xffa060, 0.45, 8, 2);
      warmFill.position.set(0, 2.6, 2.5);
      this.scene.add(warmFill);

      // 南墙月窗：冷蓝光束斜射进屋，与炉火暖光对冲
      const moonSpot = new T.SpotLight(0x7fa8d8, 1.2, 12, 0.5, 0.55, 1.2);
      moonSpot.position.set(-1.6, 3.4, 4.9);
      moonSpot.target.position.set(0.7, 0.05, 1.2);
      moonSpot.castShadow = true;
      moonSpot.shadow.mapSize.set(1024, 1024);
      moonSpot.shadow.camera.near = 0.5;
      moonSpot.shadow.camera.far = 12;
      moonSpot.shadow.bias = -0.0006;
      this.scene.add(moonSpot);
      this.scene.add(moonSpot.target);
      this.moonSpot = moonSpot;

      const spot = new T.SpotLight(0xffc080, 0.8, 11, 0.6, 0.7, 1.4);
      spot.position.set(0, 3.9, 1.6);
      spot.target.position.set(0, 0.9, 0.1);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.camera.near = 0.5;
      spot.shadow.camera.far = 8;
      spot.shadow.bias = -0.0006;
      this.scene.add(spot);
      this.scene.add(spot.target);
      this.anvilSpot = spot;

      const counterSpot = new T.SpotLight(0xffc080, 1.15, 9, 0.55, 0.8, 1.5);
      counterSpot.position.set(0, 3.6, -1.0);
      counterSpot.target.position.set(0, 0.9, -3.0);
      this.scene.add(counterSpot);
      this.scene.add(counterSpot.target);

      const forgeLight = new T.PointLight(0xff5a12, 0.9, 7.5, 2);
      forgeLight.position.set(-3.85, 1.4, 0.45);
      this.scene.add(forgeLight);
      this.forgeLight = forgeLight;

      const forgeGlow = new T.PointLight(0xffb050, 0.42, 3.6, 2);
      forgeGlow.position.set(-3.85, 1.9, 0.4);
      this.scene.add(forgeGlow);
      this.forgeGlow = forgeGlow;

      const cageFill = new T.PointLight(0x4a8ab0, 0.25, 9, 2);
      cageFill.position.set(0, 2.2, -2.8);
      this.scene.add(cageFill);

      this.eyeLightL = new T.PointLight(0xff2a12, 0.55, 4, 2);
      this.eyeLightL.position.set(-0.42, 1.95, -3.72);
      this.scene.add(this.eyeLightL);
      this.eyeLightR = new T.PointLight(0xff2a12, 0.55, 4, 2);
      this.eyeLightR.position.set(0.42, 1.95, -3.72);
      this.scene.add(this.eyeLightR);

      const calendarLight = new T.PointLight(0xffa050, 0.7, 4.2, 2);
      calendarLight.position.set(-3.95, 2.95, -4.05);
      this.scene.add(calendarLight);

      const relicLight = new T.PointLight(0x55d0cc, 0.75, 3.8, 2);
      relicLight.position.set(3.9, 2.0, -2.2);
      this.scene.add(relicLight);
      this.relicLight = relicLight;

      const ghostLight = new T.PointLight(0x88ddff, 0, 6, 2);
      ghostLight.position.set(-2.9, 1.6, -2.0);
      this.scene.add(ghostLight);
      this.ghostLight = ghostLight;

      this.anvilLight = new T.PointLight(0xff7a20, 0, 3.5, 2);
      this.anvilLight.position.set(0.25, 1.35, 0.25);
      this.scene.add(this.anvilLight);

      this.flashLight = new T.PointLight(0xffd08a, 0, 6, 2);
      this.flashLight.position.set(0.3, 1.25, 0.2);
      this.scene.add(this.flashLight);
    }

    initTextures() {
      this.tex = {};
      this.tex.brick = texFromCanvas(makeBrickCanvas(), 3.2, 1.7);
      this.tex.stone = texFromCanvas(makeStoneCanvas(), 3, 2.6);
      this.tex.wood = texFromCanvas(makeWoodCanvas(), 2, 1);
      this.tex.forgeStone = texFromCanvas(makeForgeStoneCanvas(), 1, 1);

      try {
        const envTex = texFromCanvas(makeEnvCanvas(), 1, 1, true);
        envTex.mapping = T.EquirectangularReflectionMapping;
        const pmrem = new T.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();
        const rt = pmrem.fromEquirectangular(envTex);
        this.scene.environment = rt.texture;
        envTex.dispose();
        pmrem.dispose();
      } catch (e) {
        /* 环境贴图失败时退回纯灯光 */
      }

      this.auraTex = new T.CanvasTexture(makeGlowCanvas('rgba(255,225,170,0.85)', 'rgba(190,120,255,0.35)'));
    }

    initSharedGeometry() {
      const bladeShape = new T.Shape();
      const len = 1.02;
      const half = 0.042;
      const tip = 0.17;
      bladeShape.moveTo(0, -half);
      bladeShape.lineTo(len - tip, -half * 0.92);
      bladeShape.lineTo(len, 0);
      bladeShape.lineTo(len - tip, half * 0.92);
      bladeShape.lineTo(0, half);
      bladeShape.closePath();

      this.geo = {
        blade: new T.ExtrudeGeometry(bladeShape, {
          depth: 0.022,
          bevelEnabled: true,
          bevelThickness: 0.006,
          bevelSize: 0.008,
          bevelSegments: 2,
          steps: 1
        }),
        guard: new T.BoxGeometry(0.05, 0.29, 0.105),
        guardBall: new T.SphereGeometry(0.035, 10, 8),
        grip: new T.CylinderGeometry(0.034, 0.038, 0.24, 8),
        pommel: new T.SphereGeometry(0.05, 10, 8),
        gem: new T.OctahedronGeometry(0.04, 0),
        crack: new T.BoxGeometry(0.035, 0.005, 0.0025),
        rune: new T.BoxGeometry(0.5, 0.008, 0.004)
      };
      this.geo.blade.translate(0, 0, -0.011);
      this.bladeGeoCache = {};

      this.mat = {
        guard: new T.MeshStandardMaterial({ color: 0xa87c3c, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.3 }),
        grip: new T.MeshStandardMaterial({ color: 0x24160f, metalness: 0.1, roughness: 0.9 }),
        gem: new T.MeshStandardMaterial({ color: 0x1a0b2a, emissive: 0x8a5cff, emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.2 }),
        crack: new T.MeshBasicMaterial({ color: 0x0a0705 }),
        rune: new T.MeshStandardMaterial({ color: 0x120a16, emissive: 0x8a5cff, emissiveIntensity: 1.2 }),
        shard: new T.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.35, envMapIntensity: 1 }),
        bone: new T.MeshStandardMaterial({ color: 0xcfc3a4, metalness: 0.1, roughness: 0.65 }),
        stone: new T.MeshStandardMaterial({ color: 0x6a6258, metalness: 0.15, roughness: 0.8 }),
        hit: new T.MeshBasicMaterial({ visible: false })
      };
    }

    /* ---------------------------- 房间 ---------------------------- */

    buildRoom() {
      const wallMat = new T.MeshStandardMaterial({
        map: this.tex.brick,
        bumpMap: this.tex.brick,
        bumpScale: 0.05,
        color: 0xcbb69c,
        roughness: 0.9,
        metalness: 0.04
      });
      const floorMat = new T.MeshStandardMaterial({
        map: this.tex.stone,
        bumpMap: this.tex.stone,
        bumpScale: 0.06,
        color: 0xb6a892,
        roughness: 0.82,
        metalness: 0.08
      });
      // 顶棚改木板：比纯黑更有层次
      const ceilMat = new T.MeshStandardMaterial({
        map: this.tex.wood,
        color: 0x5a4128,
        roughness: 0.95
      });

      const floor = new T.Mesh(new T.PlaneGeometry(10.4, 9.4), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      this.scene.add(floor);

      const ceiling = new T.Mesh(new T.PlaneGeometry(10.4, 9.4), ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = 4.4;
      this.scene.add(ceiling);

      const mkWall = (w, h, x, y, z, ry) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), wallMat);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        m.receiveShadow = true;
        this.scene.add(m);
        return m;
      };

      mkWall(10.4, 4.4, 0, 2.2, -4.72, 0);
      mkWall(10.4, 4.4, 0, 2.2, 4.72, Math.PI);
      mkWall(9.4, 4.4, -5.22, 2.2, 0, Math.PI / 2);
      mkWall(9.4, 4.4, 5.22, 2.2, 0, -Math.PI / 2);

      // 墙脚石基：压住墙面与地面的交界
      const skirtMat = new T.MeshStandardMaterial({
        map: this.tex.stone,
        color: 0x8d8272,
        roughness: 0.9
      });
      const mkSkirt = (w, x, z, ry) => {
        const m = new T.Mesh(new T.BoxGeometry(w, 0.34, 0.1), skirtMat);
        m.position.set(x, 0.17, z);
        m.rotation.y = ry;
        m.receiveShadow = true;
        this.scene.add(m);
      };
      mkSkirt(10.4, 0, -4.66, 0);
      mkSkirt(10.4, 0, 4.66, 0);
      mkSkirt(9.4, -5.16, 0, Math.PI / 2);
      mkSkirt(9.4, 5.16, 0, Math.PI / 2);

      // 顶部木梁：更粗，加斜撑与梁托
      const beamMat = new T.MeshStandardMaterial({ map: this.tex.wood, color: 0x4a3320, roughness: 0.85 });
      const beamEndMat = new T.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.85 });
      for (const z of [-3.2, -1.0, 1.2, 3.4]) {
        const beam = new T.Mesh(new T.BoxGeometry(10.4, 0.3, 0.34), beamMat);
        beam.position.set(0, 4.2, z);
        beam.castShadow = true;
        this.scene.add(beam);
        // 铁箍
        for (const bx of [-3.4, 0, 3.4]) {
          const band = new T.Mesh(new T.BoxGeometry(0.1, 0.32, 0.36), beamEndMat);
          band.position.set(bx, 4.2, z);
          this.scene.add(band);
        }
      }
      // 纵向主梁
      const spine = new T.Mesh(new T.BoxGeometry(0.36, 0.26, 9.4), beamMat);
      spine.position.set(0, 4.08, 0);
      this.scene.add(spine);
      // 梁端斜撑
      for (const z of [-3.2, 1.2]) {
        for (const sx of [-1, 1]) {
          const brace = new T.Mesh(new T.BoxGeometry(0.14, 0.9, 0.14), beamMat);
          brace.position.set(sx * 4.6, 3.75, z);
          brace.rotation.z = sx * 0.6;
          this.scene.add(brace);
        }
      }

      /* 南墙月窗：铁栅窗 + 夜空微光 + 体积光柱 */
      const winG = new T.Group();
      winG.position.set(-1.6, 3.1, 4.66);
      this.scene.add(winG);
      const winFrameMat = new T.MeshStandardMaterial({ map: this.tex.stone, color: 0x9a8d7a, roughness: 0.85 });
      const winHole = new T.Mesh(
        new T.PlaneGeometry(1.1, 1.3),
        new T.MeshBasicMaterial({ color: 0x060a14 })
      );
      winHole.position.z = -0.02;
      winHole.rotation.y = Math.PI;
      winG.add(winHole);
      // 夜空：月亮与星点
      const nightC = makeCanvas(128, 128);
      const ng = nightC.getContext('2d');
      const skyGrad = ng.createLinearGradient(0, 0, 0, 128);
      skyGrad.addColorStop(0, '#1c2c52');
      skyGrad.addColorStop(1, '#0c1428');
      ng.fillStyle = skyGrad;
      ng.fillRect(0, 0, 128, 128);
      const mGrad = ng.createRadialGradient(80, 42, 3, 80, 42, 34);
      mGrad.addColorStop(0, 'rgba(245,250,255,1)');
      mGrad.addColorStop(0.25, 'rgba(215,230,255,0.85)');
      mGrad.addColorStop(0.6, 'rgba(140,170,220,0.3)');
      mGrad.addColorStop(1, 'rgba(120,150,200,0)');
      ng.fillStyle = mGrad;
      ng.fillRect(0, 0, 128, 128);
      ng.fillStyle = '#eef4ff';
      ng.beginPath();
      ng.arc(80, 42, 11, 0, TAU);
      ng.fill();
      ng.fillStyle = 'rgba(190,205,230,0.5)';
      ng.beginPath();
      ng.arc(76, 39, 2.4, 0, TAU);
      ng.arc(84, 46, 1.7, 0, TAU);
      ng.fill();
      for (let i = 0; i < 34; i++) {
        ng.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.6})`;
        ng.fillRect(Math.random() * 128, Math.random() * 128, 1.4, 1.4);
      }
      const nightTex = new T.CanvasTexture(nightC);
      nightTex.encoding = T.sRGBEncoding;
      const night = new T.Mesh(
        new T.PlaneGeometry(1.02, 1.22),
        new T.MeshBasicMaterial({ map: nightTex })
      );
      night.position.z = -0.01;
      night.rotation.y = Math.PI;
      winG.add(night);
      // 窗框
      for (const [w, h, x, y] of [[1.24, 0.12, 0, 0.66], [1.24, 0.12, 0, -0.66], [0.12, 1.44, -0.62, 0], [0.12, 1.44, 0.62, 0]]) {
        const f = new T.Mesh(new T.BoxGeometry(w, h, 0.14), winFrameMat);
        f.position.set(x, y, 0);
        winG.add(f);
      }
      // 铁栅
      const winIron = new T.MeshStandardMaterial({ color: 0x30302e, metalness: 0.85, roughness: 0.4 });
      for (let i = 0; i < 3; i++) {
        const bar = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.26, 6), winIron);
        bar.position.set(-0.3 + i * 0.3, 0, 0.01);
        winG.add(bar);
      }
      const midBar = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.06, 6), winIron);
      midBar.rotation.z = Math.PI / 2;
      midBar.position.set(0, 0.1, 0.01);
      winG.add(midBar);
      // 窗台
      const sill = new T.Mesh(new T.BoxGeometry(1.3, 0.08, 0.22), winFrameMat);
      sill.position.set(-1.6, 2.34, 4.6);
      this.scene.add(sill);

      // 体积光柱：从窗口斜射到地面的冷蓝光锥
      const shaftMat = new T.MeshBasicMaterial({
        color: 0x5a86c0,
        transparent: true,
        opacity: 0.032,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide
      });
      const shaft = new T.Mesh(new T.CylinderGeometry(0.42, 1.15, 4.8, 12, 1, true), shaftMat);
      shaft.position.set(-0.9, 1.3, 2.6);
      shaft.rotation.x = 1.0;
      shaft.rotation.z = -0.16;
      this.scene.add(shaft);
      this.moonShaft = shaft;
      const shaft2 = new T.Mesh(new T.CylinderGeometry(0.2, 0.6, 4.6, 10, 1, true), shaftMat.clone());
      shaft2.material.opacity = 0.045;
      shaft2.position.set(-1.35, 1.4, 2.8);
      shaft2.rotation.x = 1.0;
      shaft2.rotation.z = -0.16;
      this.scene.add(shaft2);
      this.moonShaft2 = shaft2;
      // 地面月光斑
      const moonPatch = new T.Mesh(
        new T.CircleGeometry(0.85, 20),
        new T.MeshBasicMaterial({ color: 0x4a6a9a, transparent: true, opacity: 0.14, blending: T.AdditiveBlending, depthWrite: false })
      );
      moonPatch.rotation.x = -Math.PI / 2;
      moonPatch.scale.set(1, 1.6, 1);
      moonPatch.position.set(0.4, 0.006, 1.25);
      this.scene.add(moonPatch);

      // 吊链
      const chainMat = new T.MeshStandardMaterial({ color: 0x3c3c3e, metalness: 0.9, roughness: 0.45 });
      for (const x of [-2.6, 2.9]) {
        const chain = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 1.8, 5), chainMat);
        chain.position.set(x, 3.3, 3.6);
        this.scene.add(chain);
        const hook = new T.Mesh(new T.TorusGeometry(0.11, 0.02, 6, 12, Math.PI * 1.4), chainMat);
        hook.position.set(x, 2.4, 3.6);
        hook.rotation.z = 0.4;
        this.scene.add(hook);
      }

      // 地面排水沟/阴影
      const dark = new T.Mesh(
        new T.PlaneGeometry(1.2, 8.8),
        new T.MeshBasicMaterial({ color: 0x040404, transparent: true, opacity: 0.4 })
      );
      dark.rotation.x = -Math.PI / 2;
      dark.position.set(2.9, 0.005, 0);
      this.scene.add(dark);
    }

    /* ---------------------------- 墙面细节 / 杂物 ---------------------------- */

    buildRoomDetails() {
      const wood = new T.MeshStandardMaterial({ map: this.tex.wood, color: 0x4a3526, roughness: 0.84 });
      const darkWood = new T.MeshStandardMaterial({ color: 0x24170f, roughness: 0.86 });
      const iron = new T.MeshStandardMaterial({ color: 0x2a2a2d, metalness: 0.85, roughness: 0.4 });
      const brass = new T.MeshStandardMaterial({ color: 0x8a6a38, metalness: 0.85, roughness: 0.32 });
      const stone = new T.MeshStandardMaterial({ color: 0x4a443b, roughness: 0.94 });
      const glassAmber = new T.MeshStandardMaterial({
        color: 0xffb050, emissive: 0xff8a20, emissiveIntensity: 1.1,
        transparent: true, opacity: 0.55, roughness: 0.2
      });

      const add = (geo, mat, x, y, z, ry) => {
        const m = new T.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (ry) m.rotation.y = ry;
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
        return m;
      };

      // 护墙板
      add(new T.BoxGeometry(10.0, 1.0, 0.09), wood, 0, 0.55, -4.64);
      add(new T.BoxGeometry(10.0, 0.08, 0.14), darkWood, 0, 1.08, -4.62);
      add(new T.BoxGeometry(0.09, 1.0, 9.0), wood, -5.14, 0.55, 0);
      add(new T.BoxGeometry(0.14, 0.08, 9.0), darkWood, -5.12, 1.08, 0);
      add(new T.BoxGeometry(0.09, 1.0, 9.0), wood, 5.14, 0.55, 0);
      add(new T.BoxGeometry(0.14, 0.08, 9.0), darkWood, 5.12, 1.08, 0);
      add(new T.BoxGeometry(10.0, 1.0, 0.09), wood, 0, 0.55, 4.64);

      for (let i = -4; i <= 4; i++) {
        add(new T.BoxGeometry(0.05, 0.9, 0.05), darkWood, i * 1.1, 0.55, -4.59);
        add(new T.BoxGeometry(0.05, 0.9, 0.05), darkWood, -5.09, 0.55, i * 1.0);
        add(new T.BoxGeometry(0.05, 0.9, 0.05), darkWood, 5.09, 0.55, i * 1.0);
      }

      // 立柱
      for (const x of [-4.92, -2.46, 0, 2.46, 4.92]) {
        add(new T.BoxGeometry(0.16, 4.25, 0.16), darkWood, x, 2.12, -4.58);
        add(new T.BoxGeometry(0.16, 4.25, 0.16), darkWood, x, 2.12, 4.58);
      }
      for (const z of [-3.1, 3.1]) {
        add(new T.BoxGeometry(0.16, 4.25, 0.16), darkWood, -5.08, 2.12, z);
        add(new T.BoxGeometry(0.16, 4.25, 0.16), darkWood, 5.08, 2.12, z);
      }

      // 笼子外的石拱与铁箍
      const archMat = new T.MeshStandardMaterial({ color: 0x3c3630, roughness: 0.95 });
      for (const x of [-2.12, 2.12]) {
        add(new T.BoxGeometry(0.34, 3.5, 0.22), archMat, x, 1.75, -4.6);
        for (let i = 0; i < 5; i++) {
          add(new T.BoxGeometry(0.38, 0.3, 0.24), archMat, x, 0.5 + i * 0.68, -4.6);
        }
      }
      add(new T.BoxGeometry(4.6, 0.4, 0.24), archMat, 0, 3.5, -4.6);
      add(new T.BoxGeometry(4.7, 0.08, 0.26), iron, 0, 3.28, -4.58);
      for (let i = 0; i < 7; i++) {
        const r = new T.Mesh(new T.SphereGeometry(0.03, 6, 5), brass);
        r.position.set(-1.98 + i * 0.66, 3.28, -4.44);
        this.scene.add(r);
      }

      // 壁灯
      const lantern = (x, y, z, ry) => {
        const g = new T.Group();
        g.position.set(x, y, z);
        if (ry) g.rotation.y = ry;
        const bracket = new T.Mesh(new T.BoxGeometry(0.06, 0.06, 0.3), iron);
        bracket.position.set(0, 0.02, 0.14);
        g.add(bracket);
        const cage = new T.Mesh(new T.BoxGeometry(0.2, 0.3, 0.2), iron);
        cage.position.set(0, -0.16, 0.3);
        g.add(cage);
        const glass = new T.Mesh(new T.BoxGeometry(0.14, 0.22, 0.14), glassAmber);
        glass.position.set(0, -0.16, 0.3);
        g.add(glass);
        const flame = new T.Mesh(
          new T.ConeGeometry(0.045, 0.12, 6),
          new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: T.AdditiveBlending })
        );
        flame.position.set(0, -0.2, 0.3);
        g.add(flame);
        this.scene.add(g);
        const light = new T.PointLight(0xffa050, 0.6, 5, 2);
        light.position.set(x + (ry ? Math.sin(ry) * 0.25 : 0), y - 0.1, z + (ry ? Math.cos(ry) * 0.25 : 0.3));
        this.scene.add(light);
        return light;
      };
      lantern(-5.02, 2.5, 0.4, Math.PI / 2);
      lantern(3.5, 2.55, -4.5, 0);
      lantern(-5.02, 2.15, 2.5, Math.PI / 2);
      lantern(5.02, 2.15, 2.4, -Math.PI / 2);

      // 工具架
      const toolBoard = add(new T.BoxGeometry(0.06, 0.95, 1.7), wood, -5.06, 1.85, 2.0, Math.PI / 2);
      for (let i = 0; i < 4; i++) {
        const peg = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.16, 6), brass);
        peg.rotation.x = Math.PI / 2;
        peg.position.set(-4.98, 2.2 - (i % 2) * 0.55, 1.45 + i * 0.36);
        this.scene.add(peg);
      }
      const hammerHead = new T.Mesh(new T.BoxGeometry(0.12, 0.24, 0.08), iron);
      hammerHead.position.set(-4.95, 1.72, 1.55);
      hammerHead.rotation.x = 0.25;
      this.scene.add(hammerHead);
      const hammerHandle = new T.Mesh(new T.CylinderGeometry(0.022, 0.025, 0.55, 6), wood);
      hammerHandle.position.set(-4.95, 1.45, 1.55);
      this.scene.add(hammerHandle);
      for (const off of [-0.06, 0.06]) {
        const tong = new T.Mesh(new T.BoxGeometry(0.035, 0.8, 0.025), iron);
        tong.position.set(-4.95 + off, 1.7, 2.15);
        tong.rotation.z = off > 0 ? -0.08 : 0.08;
        this.scene.add(tong);
      }

      // 置物架与矿石
      add(new T.BoxGeometry(1.4, 0.06, 0.34), darkWood, -3.95, 1.5, -4.5);
      for (const side of [-1, 1]) {
        add(new T.BoxGeometry(0.06, 0.25, 0.3), iron, -3.95 + side * 0.6, 1.37, -4.5);
      }
      for (let i = 0; i < 5; i++) {
        const m = new T.Mesh(
          new T.BoxGeometry(0.13, 0.07, 0.09),
          i % 2 ? new T.MeshStandardMaterial({ color: 0x8a7a50, metalness: 0.8, roughness: 0.4 })
            : new T.MeshStandardMaterial({ color: 0x4a4a50, metalness: 0.8, roughness: 0.4 })
        );
        m.position.set(-4.4 + i * 0.18, 1.58, -4.48);
        m.rotation.y = i * 0.4;
        this.scene.add(m);
      }
      add(new T.CylinderGeometry(0.05, 0.06, 0.2, 8), new T.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.4 }), -3.5, 1.64, -4.48);

      // 木桶 / 板条箱 / 水桶
      const barrel = (x, z, water) => {
        const g = new T.Group();
        g.position.set(x, 0, z);
        const body = new T.Mesh(new T.CylinderGeometry(0.28, 0.24, 0.66, 12), wood);
        body.position.y = 0.35;
        body.castShadow = true;
        g.add(body);
        for (const y of [0.16, 0.54]) {
          const hoop = new T.Mesh(new T.TorusGeometry(0.27, 0.018, 6, 16), iron);
          hoop.rotation.x = Math.PI / 2;
          hoop.position.y = y;
          g.add(hoop);
        }
        const top = new T.Mesh(new T.CylinderGeometry(0.25, 0.25, 0.03, 12), water ? new T.MeshStandardMaterial({ color: 0x14262e, roughness: 0.15, metalness: 0.3 }) : darkWood);
        top.position.y = 0.68;
        g.add(top);
        if (water) {
          const ladle = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.5, 6), iron);
          ladle.position.set(0.1, 0.95, 0);
          ladle.rotation.z = -0.3;
          g.add(ladle);
        }
        this.scene.add(g);
        return g;
      };
      barrel(-4.25, 3.15, false);
      barrel(1.6, 1.05, true);

      const crate = add(new T.BoxGeometry(0.55, 0.55, 0.55), wood, 4.15, 0.28, 3.15, 0.2);
      for (const y of [-0.22, 0.22]) {
        add(new T.BoxGeometry(0.58, 0.05, 0.58), darkWood, 4.15, 0.28 + y, 3.15, 0.2);
      }
      const bucket = add(new T.CylinderGeometry(0.18, 0.15, 0.28, 10), iron, -1.15, 0.14, 1.7);

      // 煤堆 / 稻草 / 灰烬
      const coalMat = new T.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });
      for (let i = 0; i < 12; i++) {
        const c = new T.Mesh(new T.DodecahedronGeometry(rand(0.04, 0.1), 0), coalMat);
        c.position.set(rand(-3.9, -3.35), rand(0.04, 0.16), rand(0.85, 1.5));
        c.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        c.castShadow = true;
        this.scene.add(c);
      }
      const strawMat = new T.MeshStandardMaterial({ color: 0x8a7444, roughness: 1 });
      for (let i = 0; i < 10; i++) {
        const s = new T.Mesh(new T.BoxGeometry(rand(0.03, 0.06), 0.01, rand(0.2, 0.4)), strawMat);
        s.position.set(rand(-0.9, 0.9), 0.012, rand(1.1, 2.4));
        s.rotation.y = rand(0, 3);
        this.scene.add(s);
      }
      const ash = new T.Mesh(
        new T.CircleGeometry(0.9, 20),
        new T.MeshBasicMaterial({ color: 0x1a1815, transparent: true, opacity: 0.65 })
      );
      ash.rotation.x = -Math.PI / 2;
      ash.position.set(0.2, 0.008, 1.4);
      this.scene.add(ash);

      // 吊灯与铁链
      const chain = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 1.1, 5), iron);
      chain.position.set(-2.2, 3.85, 0.9);
      this.scene.add(chain);
      const hangGlass = new T.Mesh(new T.BoxGeometry(0.22, 0.28, 0.22), glassAmber);
      hangGlass.position.set(-2.2, 3.2, 0.9);
      this.scene.add(hangGlass);
      const hangFrame = new T.Mesh(new T.BoxGeometry(0.28, 0.08, 0.28), iron);
      hangFrame.position.set(-2.2, 3.36, 0.9);
      this.scene.add(hangFrame);
      const hangLight = new T.PointLight(0xffa050, 0.55, 5, 2);
      hangLight.position.set(-2.2, 3.15, 0.9);
      this.scene.add(hangLight);

      /* ---- 后墙旌旗：深红幡面 + 金色徽记 ---- */
      const bannerCanvas = makeCanvas(128, 256);
      const bg = bannerCanvas.getContext('2d');
      const bGrad = bg.createLinearGradient(0, 0, 0, 256);
      bGrad.addColorStop(0, '#7a1a12');
      bGrad.addColorStop(0.7, '#5a120c');
      bGrad.addColorStop(1, '#3a0c08');
      bg.fillStyle = bGrad;
      bg.fillRect(0, 0, 128, 256);
      bg.fillStyle = 'rgba(0,0,0,0.25)';
      bg.fillRect(0, 0, 10, 256);
      bg.fillRect(118, 0, 10, 256);
      // 金边框
      bg.strokeStyle = '#c09a4a';
      bg.lineWidth = 5;
      bg.strokeRect(7, 7, 114, 242);
      // 金徽记：菱形包裹的锤与剑抽象
      bg.strokeStyle = '#d8b25e';
      bg.fillStyle = '#d8b25e';
      bg.lineWidth = 4;
      bg.beginPath();
      bg.moveTo(64, 40); bg.lineTo(100, 96); bg.lineTo(64, 152); bg.lineTo(28, 96);
      bg.closePath();
      bg.stroke();
      bg.beginPath();
      bg.moveTo(64, 58); bg.lineTo(64, 134);
      bg.moveTo(48, 78); bg.lineTo(80, 78);
      bg.stroke();
      bg.beginPath();
      bg.arc(64, 96, 12, 0, TAU);
      bg.fill();
      // 底部流苏缺口
      bg.fillStyle = '#1a0a06';
      bg.beginPath();
      bg.moveTo(0, 256); bg.lineTo(32, 226); bg.lineTo(64, 256); bg.lineTo(96, 226); bg.lineTo(128, 256);
      bg.closePath();
      bg.fill();
      noiseOverlay(bg, 128, 256, 8);
      const bannerTex = new T.CanvasTexture(bannerCanvas);
      bannerTex.encoding = T.sRGBEncoding;
      const bannerMat = new T.MeshStandardMaterial({
        map: bannerTex,
        side: T.DoubleSide,
        roughness: 0.9,
        emissive: 0x402010,
        emissiveIntensity: 0.25
      });
      this.banners = [];
      // 左侧旌旗避开日历，靠向笼架一侧
      for (const bx of [-2.72, 3.3]) {
        const banner = new T.Group();
        banner.position.set(bx, 3.42, -4.5);
        const rod = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.95, 8), brass);
        rod.rotation.z = Math.PI / 2;
        banner.add(rod);
        for (const e of [-0.5, 0.5]) {
          const finial = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), brass);
          finial.position.set(e, 0, 0);
          banner.add(finial);
        }
        const cloth = new T.Mesh(new T.PlaneGeometry(0.85, 1.7, 6, 8), bannerMat);
        cloth.position.y = -0.92;
        banner.add(cloth);
        this.scene.add(banner);
        this.banners.push({ group: banner, cloth, phase: bx });
      }

      /* ---- 西墙盾牌与交叉剑装饰 ---- */
      const shieldAt = (z, y, tint) => {
        const g = new T.Group();
        g.position.set(-5.06, y, z);
        g.rotation.y = Math.PI / 2;
        const face = new T.Mesh(
          new T.CylinderGeometry(0.34, 0.34, 0.05, 20),
          new T.MeshStandardMaterial({ color: tint, metalness: 0.75, roughness: 0.35, envMapIntensity: 1.1 })
        );
        face.rotation.x = Math.PI / 2;
        g.add(face);
        const rim = new T.Mesh(
          new T.TorusGeometry(0.34, 0.028, 8, 24),
          new T.MeshStandardMaterial({ color: 0x9a7438, metalness: 0.9, roughness: 0.3 })
        );
        g.add(rim);
        const boss = new T.Mesh(
          new T.SphereGeometry(0.09, 12, 8),
          new T.MeshStandardMaterial({ color: 0xb08a44, metalness: 0.95, roughness: 0.25, envMapIntensity: 1.3 })
        );
        boss.position.z = 0.05;
        g.add(boss);
        this.scene.add(g);
      };
      shieldAt(-1.9, 2.6, 0x5a1a12);
      shieldAt(-2.75, 2.35, 0x2a3a4a);
      // 交叉旧剑
      const oldSwordMat = new T.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.1 });
      for (const s of [-1, 1]) {
        const blade = new T.Mesh(new T.BoxGeometry(0.045, 1.05, 0.012), oldSwordMat);
        blade.position.set(-5.05, 2.35, -2.32);
        blade.rotation.y = Math.PI / 2;
        blade.rotation.x = s * 0.5;
        this.scene.add(blade);
        const guard = new T.Mesh(new T.BoxGeometry(0.02, 0.2, 0.05), brass);
        guard.position.set(-5.05, 2.35 + s * 0 - 0.45, -2.32 - s * 0.24);
        guard.rotation.x = s * 0.5;
        this.scene.add(guard);
      }

      /* ---- 铁砧上方烛台吊灯 ---- */
      const chandelier = new T.Group();
      chandelier.position.set(0, 3.3, 0.35);
      const chRing = new T.Mesh(new T.TorusGeometry(0.42, 0.03, 8, 24), iron);
      chRing.rotation.x = Math.PI / 2;
      chandelier.add(chRing);
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU;
        const chain = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 1.05, 4), iron);
        chain.position.set(Math.cos(a) * 0.24, 0.52, Math.sin(a) * 0.24);
        chain.rotation.z = Math.cos(a) * 0.4;
        chain.rotation.x = -Math.sin(a) * 0.4;
        chandelier.add(chain);
      }
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU;
        const candle = new T.Mesh(
          new T.CylinderGeometry(0.02, 0.024, 0.11, 8),
          new T.MeshStandardMaterial({ color: 0xd8c9a4, roughness: 0.85 })
        );
        candle.position.set(Math.cos(a) * 0.42, 0.07, Math.sin(a) * 0.42);
        chandelier.add(candle);
        const flame = new T.Mesh(
          new T.ConeGeometry(0.014, 0.05, 5),
          new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.85, blending: T.AdditiveBlending })
        );
        flame.position.set(Math.cos(a) * 0.42, 0.16, Math.sin(a) * 0.42);
        chandelier.add(flame);
      }
      this.scene.add(chandelier);
      this.chandelier = chandelier;
    }

    /* ---------------------------- 场景陈设细化 ---------------------------- */

    buildRoomProps() {
      const wood = new T.MeshStandardMaterial({ map: this.tex.wood, color: 0x4a3526, roughness: 0.85 });
      const darkWood = new T.MeshStandardMaterial({ color: 0x24170f, roughness: 0.88 });
      const iron = new T.MeshStandardMaterial({ color: 0x2a2a2d, metalness: 0.85, roughness: 0.42 });
      const brass = new T.MeshStandardMaterial({ color: 0x8a6a38, metalness: 0.85, roughness: 0.32 });
      const stone = new T.MeshStandardMaterial({ color: 0x4a443b, roughness: 0.95 });
      const leather = new T.MeshStandardMaterial({ color: 0x3a2314, roughness: 0.92 });
      const sackMat = new T.MeshStandardMaterial({ color: 0x6b5838, roughness: 1 });
      const ropeMat = new T.MeshStandardMaterial({ color: 0x7a5a34, roughness: 1 });
      const goldMat = new T.MeshStandardMaterial({ color: 0xc08a34, metalness: 0.9, roughness: 0.28 });
      const boneMat = new T.MeshStandardMaterial({ color: 0xcfc3a4, roughness: 0.75 });
      const waterMat = new T.MeshStandardMaterial({ color: 0x14262e, roughness: 0.14, metalness: 0.3 });
      const coalMat = new T.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });

      const add = (geo, mat, x, y, z, ry, cast) => {
        const m = new T.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (ry) m.rotation.y = ry;
        if (cast) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        this.scene.add(m);
        return m;
      };

      // 四角蛛网（水平贴在梁下）
      const webTex = new T.CanvasTexture(makeWebCanvas());
      webTex.encoding = T.sRGBEncoding;
      const webMat = new T.MeshBasicMaterial({
        map: webTex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: T.DoubleSide
      });
      for (const [x, z, rz] of [[-4.55, -4.05, 0], [4.55, -4.05, Math.PI / 2], [-4.55, 4.05, -Math.PI / 2], [4.55, 4.05, Math.PI]]) {
        const web = new T.Mesh(new T.PlaneGeometry(1.7, 1.7), webMat);
        web.rotation.x = Math.PI / 2;
        web.rotation.z = rz;
        web.position.set(x, 4.16, z);
        this.scene.add(web);
      }

      // 麻袋
      const sack = (x, z, s, ry) => {
        const g = new T.Group();
        g.position.set(x, 0, z);
        g.rotation.y = ry;
        g.scale.setScalar(s);
        const body = new T.Mesh(new T.SphereGeometry(0.22, 10, 8), sackMat);
        body.scale.set(1, 1.18, 0.92);
        body.position.y = 0.24;
        body.castShadow = true;
        g.add(body);
        const neck = new T.Mesh(new T.CylinderGeometry(0.06, 0.1, 0.09, 8), sackMat);
        neck.position.y = 0.47;
        g.add(neck);
        const tie = new T.Mesh(new T.TorusGeometry(0.065, 0.014, 5, 10), darkWood);
        tie.rotation.x = Math.PI / 2;
        tie.position.y = 0.46;
        g.add(tie);
        const top = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), sackMat);
        top.position.y = 0.52;
        g.add(top);
        this.scene.add(g);
      };
      sack(4.4, 3.78, 1.0, 0.5);
      sack(3.82, 3.92, 0.82, -0.4);
      sack(-4.38, -2.55, 0.92, 0.3);

      // 盘绳
      for (let i = 0; i < 3; i++) {
        const rope = new T.Mesh(new T.TorusGeometry(0.23 - i * 0.02, 0.032, 6, 18), ropeMat);
        rope.rotation.x = Math.PI / 2;
        rope.position.set(-4.74, 0.05 + i * 0.055, -3.52);
        this.scene.add(rope);
      }

      // 磨石（左下角）
      const grind = new T.Group();
      grind.position.set(-4.28, 0, 4.02);
      const gBase = new T.Mesh(new T.BoxGeometry(0.72, 0.12, 0.52), darkWood);
      gBase.position.y = 0.06;
      gBase.castShadow = true;
      grind.add(gBase);
      for (const side of [-1, 1]) {
        const post = new T.Mesh(new T.BoxGeometry(0.1, 0.72, 0.13), darkWood);
        post.position.set(side * 0.29, 0.4, 0);
        post.castShadow = true;
        grind.add(post);
      }
      const wheel = new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 0.12, 18), stone);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = 0.56;
      wheel.castShadow = true;
      grind.add(wheel);
      const axle = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.8, 8), iron);
      axle.rotation.z = Math.PI / 2;
      axle.position.y = 0.56;
      grind.add(axle);
      const crankArm = new T.Mesh(new T.BoxGeometry(0.05, 0.28, 0.05), iron);
      crankArm.position.set(0.38, 0.43, 0);
      grind.add(crankArm);
      const crankGrip = new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.16, 8), wood);
      crankGrip.rotation.z = Math.PI / 2;
      crankGrip.position.set(0.46, 0.31, 0);
      grind.add(crankGrip);
      const trough = new T.Mesh(new T.BoxGeometry(0.56, 0.14, 0.34), darkWood);
      trough.position.set(0, 0.12, 0.32);
      grind.add(trough);
      const troughWater = new T.Mesh(new T.PlaneGeometry(0.5, 0.28), waterMat);
      troughWater.rotation.x = -Math.PI / 2;
      troughWater.position.set(0, 0.192, 0.32);
      grind.add(troughWater);
      this.scene.add(grind);

      // 风箱（熔炉旁）
      const bellows = new T.Group();
      bellows.position.set(-4.3, 0, 2.15);
      for (const side of [-1, 1]) {
        const leg = new T.Mesh(new T.BoxGeometry(0.06, 0.44, 0.06), darkWood);
        leg.position.set(side * 0.15, 0.22, 0.26);
        bellows.add(leg);
      }
      const lower = new T.Mesh(new T.BoxGeometry(0.44, 0.06, 0.76), wood);
      lower.position.y = 0.44;
      lower.castShadow = true;
      bellows.add(lower);
      const upper = new T.Mesh(new T.BoxGeometry(0.44, 0.05, 0.64), wood);
      upper.position.y = 0.62;
      upper.rotation.x = -0.12;
      upper.castShadow = true;
      bellows.add(upper);
      for (const side of [-1, 1]) {
        const fold = new T.Mesh(new T.BoxGeometry(0.035, 0.18, 0.62), leather);
        fold.position.set(side * 0.2, 0.53, 0);
        bellows.add(fold);
      }
      const nozzle = new T.Mesh(new T.CylinderGeometry(0.032, 0.045, 0.42, 8), iron);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(0, 0.55, -0.56);
      bellows.add(nozzle);
      const cuff = new T.Mesh(new T.TorusGeometry(0.045, 0.012, 5, 12), brass);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, 0.55, -0.36);
      bellows.add(cuff);
      const handle = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.52, 7), iron);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0, 0.68, 0.5);
      bellows.add(handle);
      const knob = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), brass);
      knob.position.set(0, 0.68, 0.78);
      bellows.add(knob);
      this.scene.add(bellows);

      // 煤斗与柴堆
      const scuttle = new T.Mesh(new T.CylinderGeometry(0.16, 0.12, 0.26, 12), iron);
      scuttle.position.set(-4.32, 0.13, -0.82);
      this.scene.add(scuttle);
      for (let i = 0; i < 4; i++) {
        const lump = new T.Mesh(new T.DodecahedronGeometry(rand(0.035, 0.06), 0), coalMat);
        lump.position.set(-4.32 + rand(-0.1, 0.1), 0.29 + rand(0, 0.05), -0.82 + rand(-0.1, 0.1));
        lump.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        this.scene.add(lump);
      }
      for (let i = 0; i < 3; i++) {
        const log = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.66, 8), wood);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = rand(-0.06, 0.06);
        log.position.set(-4.48, 0.06 + i * 0.09, -1.34 + (i === 2 ? 0.06 : 0));
        if (i === 2) log.position.set(-4.44, 0.15, -1.34);
        log.castShadow = true;
        this.scene.add(log);
      }

      // 后墙置物架：瓶子、草药、蜡烛
      add(new T.BoxGeometry(1.25, 0.06, 0.3), darkWood, 3.2, 1.56, -4.52, 0, true);
      for (const side of [-1, 1]) {
        add(new T.BoxGeometry(0.04, 0.2, 0.26), iron, 3.2 + side * 0.48, 1.44, -4.5);
      }
      const bottleMats = [
        new T.MeshStandardMaterial({ color: 0x2a5a44, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.85 }),
        new T.MeshStandardMaterial({ color: 0x5a3520, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.85 }),
        new T.MeshStandardMaterial({ color: 0x2a3f5a, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.85 })
      ];
      for (let i = 0; i < 3; i++) {
        const bottle = new T.Mesh(new T.CylinderGeometry(0.045, 0.05, 0.18, 10), bottleMats[i]);
        bottle.position.set(2.78 + i * 0.2, 1.69, -4.52);
        this.scene.add(bottle);
        const cork = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.05, 8), darkWood);
        cork.position.set(2.78 + i * 0.2, 1.805, -4.52);
        this.scene.add(cork);
      }
      for (let i = 0; i < 3; i++) {
        const herb = new T.Mesh(new T.ConeGeometry(0.045, 0.24, 6), new T.MeshStandardMaterial({ color: 0x4a5a30, roughness: 0.95 }));
        herb.position.set(3.52 + i * 0.05, 1.66, -4.52);
        herb.rotation.z = 0.3 + i * 0.08;
        this.scene.add(herb);
      }
      const candle = new T.Mesh(new T.CylinderGeometry(0.035, 0.04, 0.14, 10), new T.MeshStandardMaterial({ color: 0xd8c9a4, roughness: 0.85 }));
      candle.position.set(3.72, 1.66, -4.5);
      this.scene.add(candle);
      const candleFlame = new T.Mesh(
        new T.ConeGeometry(0.022, 0.07, 6),
        new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: T.AdditiveBlending })
      );
      candleFlame.position.set(3.72, 1.78, -4.5);
      this.scene.add(candleFlame);

      // 炉口上方的烟熏痕迹
      const sootMat = new T.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.32, depthWrite: false });
      for (const [y, z, r] of [[2.75, 0.5, 0.62], [3.15, 0.95, 0.45], [2.55, -0.15, 0.38]]) {
        const soot = new T.Mesh(new T.CircleGeometry(r, 18), sootMat);
        soot.rotation.y = Math.PI / 2;
        soot.position.set(-5.2, y, z);
        this.scene.add(soot);
      }

      // 笼内财宝与骸骨
      for (let i = 0; i < 26; i++) {
        const coin = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.012, 10), goldMat);
        coin.position.set(rand(-1.45, 1.45), 0.015 + Math.random() * 0.03, rand(-4.5, -4.02));
        coin.rotation.y = rand(0, 3);
        this.scene.add(coin);
      }
      const goblet = (x, z, s) => {
        const cup = new T.Mesh(new T.CylinderGeometry(0.07, 0.045, 0.1, 10), goldMat);
        cup.position.set(x, 0.13 * s, z);
        cup.scale.setScalar(s);
        this.scene.add(cup);
        const stem = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.09, 8), goldMat);
        stem.position.set(x, 0.065 * s, z);
        this.scene.add(stem);
        const foot = new T.Mesh(new T.CylinderGeometry(0.05, 0.055, 0.015, 10), goldMat);
        foot.position.set(x, 0.018, z);
        this.scene.add(foot);
      };
      goblet(-1.15, -4.28, 1);
      goblet(0.95, -4.45, 0.8);
      for (let i = 0; i < 3; i++) {
        const bone = new T.Mesh(new T.CylinderGeometry(0.016, 0.016, 0.26, 6), boneMat);
        bone.rotation.z = Math.PI / 2;
        bone.rotation.y = rand(0, 3);
        bone.position.set(rand(-1.2, 1.2), 0.02, rand(-4.35, -4.05));
        this.scene.add(bone);
      }
      const hoardLight = new T.PointLight(0xffb050, 0.32, 2.6, 2);
      hoardLight.position.set(0.2, 0.4, -4.25);
      this.scene.add(hoardLight);

      // 柜台正面抽屉与包角
      const counterFront = -2.545;
      for (const x of [-1.2, 0, 1.2]) {
        add(new T.BoxGeometry(1.0, 0.6, 0.03), darkWood, x, 0.55, counterFront);
        add(new T.BoxGeometry(0.86, 0.46, 0.035), wood, x, 0.55, counterFront + 0.012);
        const knob = new T.Mesh(new T.SphereGeometry(0.03, 8, 6), brass);
        knob.position.set(x, 0.55, counterFront + 0.04);
        this.scene.add(knob);
      }
      for (const x of [-1.9, 1.9]) {
        add(new T.BoxGeometry(0.09, 0.14, 0.07), iron, x, 0.16, counterFront);
        add(new T.BoxGeometry(0.09, 0.14, 0.07), iron, x, 0.88, counterFront);
      }

      // 柜台上的账本、墨水瓶、羽毛笔、钱币、蜡烛
      add(new T.BoxGeometry(0.3, 0.035, 0.22), leather, 0.5, 1.06, -3.2, 0.12);
      add(new T.BoxGeometry(0.28, 0.022, 0.2), new T.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.9 }), 0.5, 1.08, -3.2, 0.12);
      const ink = new T.Mesh(new T.CylinderGeometry(0.038, 0.045, 0.07, 10), new T.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.3 }));
      ink.position.set(0.95, 1.085, -3.2);
      this.scene.add(ink);
      const quill = new T.Mesh(new T.ConeGeometry(0.012, 0.26, 5), new T.MeshStandardMaterial({ color: 0xe4dcc4, roughness: 0.9 }));
      quill.position.set(1.0, 1.2, -3.18);
      quill.rotation.z = 0.45;
      this.scene.add(quill);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          const coin = new T.Mesh(new T.CylinderGeometry(0.032, 0.032, 0.01, 10), goldMat);
          coin.position.set(-0.55 + i * 0.09, 1.06 + j * 0.012, -3.18);
          this.scene.add(coin);
        }
      }
      const counterCandle = new T.Mesh(new T.CylinderGeometry(0.03, 0.035, 0.13, 10), new T.MeshStandardMaterial({ color: 0xd8c9a4, roughness: 0.85 }));
      counterCandle.position.set(-1.0, 1.11, -3.18);
      this.scene.add(counterCandle);
      const counterFlame = new T.Mesh(
        new T.ConeGeometry(0.02, 0.06, 6),
        new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: T.AdditiveBlending })
      );
      counterFlame.position.set(-1.0, 1.22, -3.18);
      this.scene.add(counterFlame);

      // 地面碎屑：铁钉、木屑、石子、污渍
      const nailMat = new T.MeshStandardMaterial({ color: 0x3a3a3c, metalness: 0.8, roughness: 0.5 });
      for (let i = 0; i < 18; i++) {
        const nail = new T.Mesh(new T.CylinderGeometry(0.006, 0.004, 0.09, 4), nailMat);
        nail.rotation.z = Math.PI / 2;
        nail.rotation.y = rand(0, 3);
        nail.position.set(rand(-4.2, 4.2), 0.008, rand(-4.0, 4.0));
        this.scene.add(nail);
      }
      for (let i = 0; i < 14; i++) {
        const chip = new T.Mesh(new T.BoxGeometry(rand(0.04, 0.09), 0.008, rand(0.02, 0.05)), wood);
        chip.position.set(rand(-4.3, 4.3), 0.005, rand(-4.1, 4.1));
        chip.rotation.y = rand(0, 3);
        this.scene.add(chip);
      }
      for (let i = 0; i < 12; i++) {
        const pebble = new T.Mesh(new T.DodecahedronGeometry(rand(0.018, 0.04), 0), stone);
        pebble.position.set(rand(-4.3, 4.3), 0.015, rand(-4.1, 4.1));
        pebble.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        this.scene.add(pebble);
      }
      const stainMat = new T.MeshBasicMaterial({ color: 0x070605, transparent: true, opacity: 0.22, depthWrite: false });
      for (let i = 0; i < 6; i++) {
        const stain = new T.Mesh(new T.CircleGeometry(rand(0.18, 0.5), 16), stainMat);
        stain.rotation.x = -Math.PI / 2;
        stain.position.set(rand(-3.8, 3.8), 0.004, rand(-3.6, 3.6));
        this.scene.add(stain);
      }
    }

    /* ---------------------------- 签板 ---------------------------- */

    buildTicketBoard() {
      const group = new T.Group();
      group.position.set(-1.75, 0, 1.25);
      group.rotation.y = 0.7;
      const darkWood = new T.MeshStandardMaterial({ color: 0x24170f, roughness: 0.88 });
      const brass = new T.MeshStandardMaterial({ color: 0x8a6a38, metalness: 0.85, roughness: 0.32 });

      for (const side of [-1, 1]) {
        const foot = new T.Mesh(new T.BoxGeometry(0.44, 0.07, 0.36), darkWood);
        foot.position.set(side * 0.52, 0.035, 0.02);
        foot.receiveShadow = true;
        group.add(foot);
        const post = new T.Mesh(new T.BoxGeometry(0.065, 1.56, 0.065), darkWood);
        post.position.set(side * 0.52, 0.8, 0);
        post.castShadow = true;
        group.add(post);
      }

      const frame = new T.Mesh(new T.BoxGeometry(1.34, 0.94, 0.06), darkWood);
      frame.position.set(0, 1.32, 0.02);
      frame.castShadow = true;
      group.add(frame);

      const cap = new T.Mesh(new T.BoxGeometry(1.42, 0.06, 0.12), brass);
      cap.position.set(0, 1.81, 0.02);
      group.add(cap);

      this.ticketCanvas = makeCanvas(640, 440);
      this.ticketTex = new T.CanvasTexture(this.ticketCanvas);
      this.ticketTex.encoding = T.sRGBEncoding;
      this.ticketTex.anisotropy = 4;
      const face = new T.Mesh(
        new T.PlaneGeometry(1.24, 0.85),
        new T.MeshBasicMaterial({ map: this.ticketTex })
      );
      face.position.set(0, 1.32, 0.055);
      group.add(face);

      this.ticketBoardGroup = group;
      this.scene.add(group);
      this.setTicketBoard(null);
    }

    setTicketBoard(data) {
      if (!this.ticketCanvas) return;
      const g = this.ticketCanvas.getContext('2d');
      const W = 640;
      const H = 440;
      const S = CFG.strings[this.lang] || CFG.strings.zh;

      g.clearRect(0, 0, W, H);
      g.fillStyle = '#07100f';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(121,199,196,0.55)';
      g.lineWidth = 4;
      g.strokeRect(10, 10, W - 20, H - 20);

      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.fillStyle = '#b7e6e2';
      g.font = 'bold 30px "Microsoft YaHei", Georgia, serif';
      g.fillText(S.ticketBoardTitle || 'TICKETS', 30, 58);

      g.textAlign = 'right';
      g.font = '18px "Microsoft YaHei", sans-serif';
      g.fillStyle = '#7fb8b3';
      const sub = data && data.level != null
        ? String(S.ticketBoardSword || 'Lv {lv}').replace('{lv}', data.level)
        : (S.ticketBoardBase || '');
      g.fillText(sub, W - 30, 56);

      g.strokeStyle = 'rgba(121,199,196,0.28)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(30, 78);
      g.lineTo(W - 30, 78);
      g.stroke();

      const colors = {
        break: '#ff5a4a',
        damage: '#ff9a5c',
        hold: '#d8c05c',
        success: '#9fe6a8',
        great: '#c9a6ff'
      };
      const names = {
        break: S.outBreak,
        damage: S.outDamage,
        hold: S.outHold,
        success: S.outSuccess,
        great: S.outGreat
      };
      const rows = data && data.rows ? data.rows : [
        { k: 'break', w: 0, pct: 0 },
        { k: 'damage', w: 9.5, pct: 9.5 },
        { k: 'hold', w: 23.8, pct: 23.8 },
        { k: 'success', w: 57.2, pct: 57.2 },
        { k: 'great', w: 9.5, pct: 9.5 }
      ];

      rows.forEach((r, i) => {
        const y = 110 + i * 56;
        if (i % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.035)';
          g.fillRect(26, y - 30, W - 52, 46);
        }
        g.fillStyle = colors[r.k] || '#9fe6a8';
        g.fillRect(30, y - 26, 7, 32);
        g.textAlign = 'left';
        g.font = 'bold 24px "Microsoft YaHei", sans-serif';
        g.fillStyle = '#dcebe8';
        g.fillText(names[r.k] || r.k, 50, y);
        g.textAlign = 'right';
        g.font = 'bold 26px Consolas, monospace';
        g.fillStyle = '#f0e2b8';
        g.fillText((Math.round(r.w * 10) / 10).toFixed(1), 470, y);
        g.font = '18px Consolas, monospace';
        g.fillStyle = '#7fb8b3';
        g.fillText((Math.round(r.pct * 10) / 10).toFixed(1) + '%', 566, y);
      });

      g.textAlign = 'right';
      g.font = '16px "Microsoft YaHei", sans-serif';
      g.fillStyle = '#6f9e9a';
      g.fillText(S.ticketBoardHint || '', 566, 390);
      g.textAlign = 'left';
      g.font = 'bold 24px "Microsoft YaHei", sans-serif';
      g.fillStyle = '#d8cfa8';
      g.fillText(S.ticketBoardTotal || 'Total', 32, 412);
      g.textAlign = 'right';
      g.font = 'bold 30px Consolas, monospace';
      g.fillStyle = '#f0d79c';
      const total = data && typeof data.total === 'number' ? data.total : 100;
      g.fillText((Math.round(total * 10) / 10).toFixed(1), 566, 412);

      this.ticketTex.needsUpdate = true;
    }

    /* ---------------------------- 熔炉 ---------------------------- */

    buildForge() {
      const group = new T.Group();
      group.position.set(-4.75, 0, 0.45);
      this.scene.add(group);

      const stoneMat = new T.MeshStandardMaterial({
        map: this.tex.forgeStone,
        bumpMap: this.tex.forgeStone,
        bumpScale: 0.04,
        color: 0xa89a88,
        roughness: 0.94,
        metalness: 0.04
      });
      const darkStone = new T.MeshStandardMaterial({
        map: this.tex.forgeStone,
        color: 0x584f45,
        roughness: 0.96
      });

      const back = new T.Mesh(new T.BoxGeometry(0.3, 2.6, 2.2), darkStone);
      back.position.set(-0.15, 1.3, 0);
      group.add(back);

      const pillarL = new T.Mesh(new T.BoxGeometry(0.55, 2.6, 0.42), stoneMat);
      pillarL.position.set(0.08, 1.3, -0.95);
      group.add(pillarL);
      const pillarR = pillarL.clone();
      pillarR.position.z = 0.95;
      group.add(pillarR);

      const arch = new T.Mesh(new T.BoxGeometry(0.55, 0.42, 2.2), stoneMat);
      arch.position.set(0.08, 2.45, 0);
      group.add(arch);

      const mantel = new T.Mesh(new T.BoxGeometry(0.9, 0.22, 2.7), new T.MeshStandardMaterial({ map: this.tex.wood, color: 0x3d2c1a, roughness: 0.92 }));
      mantel.position.set(0.22, 1.95, 0);
      mantel.castShadow = true;
      group.add(mantel);

      // 炉膛
      const mouth = new T.Mesh(
        new T.PlaneGeometry(1.55, 1.25),
        new T.MeshBasicMaterial({ color: 0x2a0d04 })
      );
      mouth.position.set(0.24, 0.92, 0);
      mouth.rotation.y = Math.PI / 2;
      group.add(mouth);

      // 炉口光晕（常亮的暖光辉光，呼吸起伏在 updateForge 中驱动）
      const mouthGlowTex = new T.CanvasTexture(makeGlowCanvas('rgba(255,140,40,0.95)', 'rgba(200,50,8,0.4)'));
      const mouthGlow = new T.Sprite(new T.SpriteMaterial({
        map: mouthGlowTex,
        color: 0xff7a20,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: T.AdditiveBlending
      }));
      mouthGlow.scale.set(1.9, 1.35, 1);
      mouthGlow.position.set(0.42, 0.95, 0);
      group.add(mouthGlow);
      this.forgeMouthGlow = mouthGlow;

      // 炭床
      const coalMat = new T.MeshStandardMaterial({
        color: 0x0e0300,
        emissive: 0xff1e00,
        emissiveIntensity: 0.65,
        roughness: 0.94
      });
      this.forgeCoals = [];
      for (let i = 0; i < 12; i++) {
        const coal = new T.Mesh(new T.DodecahedronGeometry(rand(0.045, 0.085), 0), coalMat.clone());
        coal.position.set(rand(0.32, 0.44), rand(0.52, 0.66), rand(-0.5, 0.5));
        coal.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        group.add(coal);
        this.forgeCoals.push(coal);
      }

      // 火焰（叠加锥体）
      const flameMat = new T.MeshBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.1,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide
      });
      this.flames = [];
      for (let i = 0; i < 4; i++) {
        const flame = new T.Mesh(new T.ConeGeometry(rand(0.04, 0.085), rand(0.16, 0.3), 6, 1, true), flameMat.clone());
        flame.position.set(rand(0.32, 0.45), rand(0.68, 0.82), rand(-0.42, 0.42));
        group.add(flame);
        this.flames.push(flame);
      }

      // 铁栅
      const ironMat = new T.MeshStandardMaterial({ color: 0x1b1b1e, metalness: 0.9, roughness: 0.4 });
      for (let i = 0; i < 5; i++) {
        const bar = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 1.2, 6), ironMat);
        bar.position.set(0.5, 0.95, -0.65 + i * 0.32);
        group.add(bar);
      }

      // 烟囱
      const stack = new T.Mesh(
        new T.CylinderGeometry(0.32, 0.42, 1.6, 8),
        new T.MeshStandardMaterial({ map: this.tex.forgeStone, color: 0x7a6e60, roughness: 0.94 })
      );
      stack.position.set(0.15, 3.3, 0);
      group.add(stack);

      this.forgeGroup = group;
    }

    /* ---------------------------- 铁砧 ---------------------------- */

    buildAnvil() {
      const group = new T.Group();
      group.position.set(0, 0, 0.2);
      this.scene.add(group);

      // 木桩：年轮截面 + 烧焦的树皮边
      const stumpTopC = makeCanvas(128, 128);
      const sg = stumpTopC.getContext('2d');
      sg.fillStyle = '#3a2616';
      sg.fillRect(0, 0, 128, 128);
      for (let r = 58; r > 4; r -= 5 + Math.random() * 4) {
        sg.strokeStyle = `rgba(${20 + Math.random() * 30},${12 + Math.random() * 16},6,0.7)`;
        sg.lineWidth = 1.5;
        sg.beginPath();
        sg.ellipse(64, 64, r, r * 0.94, rand(-0.1, 0.1), 0, TAU);
        sg.stroke();
      }
      noiseOverlay(sg, 128, 128, 10);
      const stumpTopTex = new T.CanvasTexture(stumpTopC);
      stumpTopTex.encoding = T.sRGBEncoding;
      const stumpMat = new T.MeshStandardMaterial({ color: 0x35220f, roughness: 0.9 });
      const stump = new T.Mesh(new T.CylinderGeometry(0.46, 0.52, 0.42, 12), stumpMat);
      stump.position.y = 0.21;
      stump.castShadow = true;
      stump.receiveShadow = true;
      group.add(stump);
      const stumpTop = new T.Mesh(
        new T.CircleGeometry(0.455, 24),
        new T.MeshStandardMaterial({ map: stumpTopTex, roughness: 0.85 })
      );
      stumpTop.rotation.x = -Math.PI / 2;
      stumpTop.position.y = 0.425;
      group.add(stumpTop);

      const ironMat = new T.MeshStandardMaterial({
        color: 0x242220,
        metalness: 0.5,
        roughness: 0.58,
        envMapIntensity: 0.3
      });
      const darkIron = new T.MeshStandardMaterial({
        color: 0x1c1a18,
        metalness: 0.6,
        roughness: 0.6,
        envMapIntensity: 0.3
      });

      const base = new T.Mesh(new T.BoxGeometry(0.72, 0.16, 0.52), darkIron);
      base.position.y = 0.5;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const waist = new T.Mesh(new T.BoxGeometry(0.42, 0.24, 0.34), darkIron);
      waist.position.y = 0.69;
      waist.castShadow = true;
      group.add(waist);

      const body = new T.Mesh(new T.BoxGeometry(0.68, 0.16, 0.46), ironMat);
      body.position.y = 0.88;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const top = new T.Mesh(new T.BoxGeometry(1.36, 0.16, 0.5), ironMat);
      top.position.y = 0.98;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      const horn = new T.Mesh(new T.ConeGeometry(0.17, 0.66, 10), ironMat);
      horn.rotation.z = Math.PI / 2;
      horn.position.set(-0.86, 0.98, 0);
      horn.castShadow = true;
      group.add(horn);

      const hardy = new T.Mesh(new T.BoxGeometry(0.09, 0.02, 0.09), new T.MeshBasicMaterial({ color: 0x050505 }));
      hardy.position.set(0.42, 1.065, 0);
      group.add(hardy);

      const edge = new T.Mesh(
        new T.BoxGeometry(1.3, 0.012, 0.03),
        new T.MeshStandardMaterial({ color: 0x6f675c, metalness: 0.7, roughness: 0.35 })
      );
      edge.position.set(0, 1.062, 0.235);
      group.add(edge);

      this.anvilGroup = group;
      this.anvilTop = 1.06;
    }

    /* ---------------------------- 笼子 / 贡台 ---------------------------- */

    buildCageAndCounter() {
      const metal = new T.MeshStandardMaterial({
        color: 0x33333a,
        metalness: 0.88,
        roughness: 0.34,
        envMapIntensity: 1.0
      });

      const cage = new T.Group();
      this.scene.add(cage);

      for (const x of [-1.92, 1.92]) {
        const post = new T.Mesh(new T.BoxGeometry(0.18, 3.5, 0.18), metal);
        post.position.set(x, 1.75, -3.62);
        post.castShadow = true;
        cage.add(post);
        for (let i = 0; i < 5; i++) {
          const rivet = new T.Mesh(new T.SphereGeometry(0.027, 8, 6), new T.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.9, roughness: 0.3 }));
          rivet.position.set(x + 0.1, 0.35 + i * 0.65, -3.62);
          cage.add(rivet);
        }
      }

      const topBeam = new T.Mesh(new T.BoxGeometry(4.05, 0.2, 0.2), metal);
      topBeam.position.set(0, 3.45, -3.62);
      cage.add(topBeam);

      for (let i = 0; i < 7; i++) {
        const bar = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 3.1, 8), metal);
        bar.position.set(-1.5 + i * 0.5, 1.7, -3.58);
        bar.castShadow = true;
        cage.add(bar);
      }
      for (const y of [1.0, 2.25]) {
        const bar = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 3.4, 8), metal);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, y, -3.54);
        cage.add(bar);
      }

      // 笼内黑暗
      const dark = new T.Mesh(
        new T.PlaneGeometry(3.8, 3.4),
        new T.MeshBasicMaterial({ color: 0x010101 })
      );
      dark.position.set(0, 1.7, -4.62);
      this.scene.add(dark);

      // 贡台
      const counter = new T.Group();
      this.scene.add(counter);
      const woodMat = new T.MeshStandardMaterial({
        map: this.tex.wood,
        color: 0x4a3625,
        roughness: 0.85,
        metalness: 0.05
      });
      const body = new T.Mesh(new T.BoxGeometry(3.9, 0.92, 0.82), woodMat);
      body.position.set(0, 0.46, -2.96);
      body.castShadow = true;
      body.receiveShadow = true;
      counter.add(body);

      const top = new T.Mesh(new T.BoxGeometry(4.05, 0.12, 0.94), woodMat);
      top.position.set(0, 0.98, -2.96);
      top.castShadow = true;
      top.receiveShadow = true;
      counter.add(top);

      const trim = new T.Mesh(
        new T.BoxGeometry(4.06, 0.035, 0.98),
        new T.MeshStandardMaterial({ color: 0x95703c, metalness: 0.7, roughness: 0.35 })
      );
      trim.position.set(0, 1.045, -2.96);
      counter.add(trim);

      // 铃铛
      const bellGroup = new T.Group();
      bellGroup.position.set(-1.55, 1.07, -2.92);
      const bellMat = new T.MeshStandardMaterial({
        color: 0xc18a3c,
        metalness: 0.95,
        roughness: 0.24,
        envMapIntensity: 1.4
      });
      const bellBody = new T.Mesh(new T.ConeGeometry(0.16, 0.22, 14, 1, true), bellMat);
      bellBody.position.y = 0.13;
      bellGroup.add(bellBody);
      const bellTop = new T.Mesh(new T.SphereGeometry(0.052, 10, 8), bellMat);
      bellTop.position.y = 0.26;
      bellGroup.add(bellTop);
      const bellBase = new T.Mesh(new T.CylinderGeometry(0.18, 0.2, 0.03, 16), bellMat);
      bellBase.position.y = 0.015;
      bellGroup.add(bellBase);
      counter.add(bellGroup);
      this.bellGroup = bellGroup;

      // 贡台铭牌
      const signCanvas = makeCanvas(512, 256);
      this.tributeCanvas = signCanvas;
      this.tributeTex = new T.CanvasTexture(signCanvas);
      this.tributeTex.encoding = T.sRGBEncoding;
      const signMat = new T.MeshStandardMaterial({
        map: this.tributeTex,
        emissive: 0xffffff,
        emissiveMap: this.tributeTex,
        emissiveIntensity: 0.18,
        roughness: 0.75,
        metalness: 0.2
      });
      const sign = new T.Mesh(new T.PlaneGeometry(1.15, 0.56), signMat);
      sign.position.set(1.28, 0.74, -2.50);
      counter.add(sign);

      const frame = new T.Mesh(
        new T.BoxGeometry(1.22, 0.62, 0.035),
        new T.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.8 })
      );
      frame.position.set(1.28, 0.74, -2.525);
      counter.add(frame);

      this.drawTributeSign(0, 0);
    }

    /* ---------------------------- 巨龙 ---------------------------- */

    buildDragon() {
      const dragon = new T.Group();
      dragon.position.set(0, 1.55, -4.95);
      this.scene.add(dragon);

      const scaleMat = new T.MeshStandardMaterial({
        color: 0x251317,
        metalness: 0.3,
        roughness: 0.78,
        envMapIntensity: 0.5
      });
      // 稍亮一档的鳞甲，用来分层
      const plateMat = new T.MeshStandardMaterial({
        color: 0x37211f,
        metalness: 0.4,
        roughness: 0.62,
        envMapIntensity: 0.7
      });
      const ridgeMat = new T.MeshStandardMaterial({
        color: 0x523526,
        metalness: 0.3,
        roughness: 0.65
      });

      const addMesh = (parent, geo, mat, pos, rot, scl) => {
        const m = new T.Mesh(geo, mat);
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        if (scl) m.scale.set(scl[0], scl[1], scl[2]);
        m.castShadow = true;
        parent.add(m);
        return m;
      };

      /* ---------------- 头骨 ---------------- */
      addMesh(dragon, new T.IcosahedronGeometry(0.82, 2), scaleMat,
        [0, 0.18, 0], null, [0.95, 0.78, 1.25]);

      // 眉骨 / 颧骨 / 鼻梁：让头骨有棱角
      for (const side of [-1, 1]) {
        addMesh(dragon, new T.BoxGeometry(0.34, 0.13, 0.46), ridgeMat,
          [side * 0.3, 0.42, 0.56], [-0.18, side * 0.16, side * 0.22]);
        addMesh(dragon, new T.BoxGeometry(0.2, 0.3, 0.42), plateMat,
          [side * 0.56, 0.06, 0.3], [0.1, side * 0.22, side * 0.12]);
        // 颊侧骨刺
        for (let i = 0; i < 3; i++) {
          addMesh(dragon, new T.ConeGeometry(0.045, 0.2 + i * 0.03, 5), ridgeMat,
            [side * 0.62, -0.02 - i * 0.02, 0.04 - i * 0.16],
            [0, 0, side * (1.15 + i * 0.1)]);
        }
        // 耳鳍：收窄后掠，贴在颅侧不再像耳朵
        addMesh(dragon, new T.ConeGeometry(0.12, 0.4, 4, 1, true), scaleMat,
          [side * 0.6, 0.26, -0.44], [0.85, side * 0.55, side * 1.62], [0.75, 0.26, 0.75]);
      }
      addMesh(dragon, new T.BoxGeometry(0.16, 0.12, 0.62), ridgeMat,
        [0, 0.38, 0.72], [-0.06, 0, 0]);

      // 吻部
      addMesh(dragon, new T.BoxGeometry(0.7, 0.38, 0.72), scaleMat,
        [0, 0.02, 0.82], [0.08, 0, 0]);
      addMesh(dragon, new T.BoxGeometry(0.5, 0.1, 0.34), plateMat,
        [0, 0.22, 0.98], [0.06, 0, 0]);

      /* ---------------- 下颚 / 口腔 ---------------- */
      const jaw = new T.Group();
      jaw.position.set(0, -0.2, 0.35);
      const jawMesh = new T.Mesh(new T.BoxGeometry(0.72, 0.2, 0.95), scaleMat);
      jawMesh.position.z = 0.42;
      jaw.add(jawMesh);
      const jawPlate = new T.Mesh(new T.BoxGeometry(0.58, 0.08, 0.8), plateMat);
      jawPlate.position.set(0, -0.11, 0.42);
      jaw.add(jawPlate);
      const chin = new T.Mesh(new T.ConeGeometry(0.1, 0.26, 5), ridgeMat);
      chin.position.set(0, 0.1, 0.86);
      chin.rotation.x = 0.5;
      jaw.add(chin);
      dragon.add(jaw);
      this.dragonJaw = jaw;

      // 口腔深处的暗腔与微光
      addMesh(dragon, new T.BoxGeometry(0.56, 0.26, 0.62),
        new T.MeshBasicMaterial({ color: 0x120303 }), [0, -0.14, 0.78]);
      const mawLight = new T.PointLight(0xff3a10, 0.85, 1.8, 2);
      mawLight.position.set(0, -0.14, 0.92);
      dragon.add(mawLight);
      this.dragonMawLight = mawLight;

      // 牙齿：上颚 9 颗、下颚 8 颗，长短交错
      const toothMat = new T.MeshStandardMaterial({ color: 0xc4b8a2, roughness: 0.55 });
      for (let i = 0; i < 9; i++) {
        const x = -0.29 + i * 0.0725;
        const big = i % 3 === 0;
        const tooth = new T.Mesh(new T.ConeGeometry(big ? 0.026 : 0.02, big ? 0.17 : 0.115, 5), toothMat);
        tooth.position.set(x, -0.09, 0.9 - Math.abs(x) * 0.35);
        tooth.rotation.x = Math.PI + 0.08;
        dragon.add(tooth);
      }
      for (let i = 0; i < 8; i++) {
        const x = -0.26 + i * 0.074;
        const big = i % 2 === 0;
        const lower = new T.Mesh(new T.ConeGeometry(big ? 0.024 : 0.018, big ? 0.15 : 0.1, 5), toothMat);
        lower.position.set(x, 0.1, 0.86 - Math.abs(x) * 0.3);
        jaw.add(lower);
      }

      /* ---------------- 角 ---------------- */
      const hornMat = new T.MeshStandardMaterial({ color: 0x6b5a46, roughness: 0.55, metalness: 0.25 });
      for (const side of [-1, 1]) {
        // 主角逐段弯曲
        addMesh(dragon, new T.ConeGeometry(0.12, 0.42, 7), hornMat,
          [side * 0.5, 0.62, -0.04], [0.18, 0, side * -0.5]);
        addMesh(dragon, new T.ConeGeometry(0.085, 0.38, 7), hornMat,
          [side * 0.68, 0.9, -0.12], [0.42, 0, side * -0.82]);
        addMesh(dragon, new T.ConeGeometry(0.05, 0.3, 6), hornMat,
          [side * 0.83, 1.13, -0.26], [0.62, 0, side * -1.12]);
        // 角上的环脊
        for (let i = 0; i < 3; i++) {
          addMesh(dragon, new T.TorusGeometry(0.1 - i * 0.022, 0.014, 5, 10), ridgeMat,
            [side * (0.5 + i * 0.09), 0.6 + i * 0.2, -0.04 - i * 0.09],
            [Math.PI / 2, 0, side * -0.6]);
        }
        // 副角
        addMesh(dragon, new T.ConeGeometry(0.06, 0.5, 6), hornMat,
          [side * 0.72, 0.46, -0.28], [0.1, 0, side * -1.32]);
        // 角后小骨刺
        for (let i = 0; i < 3; i++) {
          addMesh(dragon, new T.ConeGeometry(0.03, 0.14, 4), ridgeMat,
            [side * (0.4 + i * 0.1), 0.5 - i * 0.04, -0.42 - i * 0.06],
            [0, 0, side * -1.5]);
        }
      }

      /* ---------------- 眼：双目怒视 ---------------- */
      const eyeMat = new T.MeshBasicMaterial({ color: 0xe00f00 });
      const pupilMat = new T.MeshBasicMaterial({ color: 0x000000 });
      this.dragonEyes = [];
      this.eyeSprites = [];
      const eyeGlowTex = new T.CanvasTexture(makeGlowCanvas('rgba(220,25,10,0.95)', 'rgba(180,5,0,0.35)'));

      for (const side of [-1, 1]) {
        // 眼窝：深陷的暗甲小坑
        addMesh(dragon, new T.BoxGeometry(0.3, 0.16, 0.1), new T.MeshBasicMaterial({ color: 0x080202 }),
          [side * 0.3, 0.28, 0.885], [0, side * 0.28, 0]);
        const eye = new T.Mesh(new T.SphereGeometry(0.115, 20, 14), eyeMat);
        eye.scale.set(1.15, 0.62, 0.5);
        eye.position.set(side * 0.3, 0.28, 0.92);
        eye.rotation.y = side * 0.28;
        dragon.add(eye);
        // 竖瞳
        const pupil = new T.Mesh(new T.BoxGeometry(0.026, 0.13, 0.02), pupilMat);
        pupil.position.set(side * 0.3, 0.28, 0.985);
        pupil.rotation.y = side * 0.28;
        dragon.add(pupil);
        // 怒眉骨：内侧下压，拧出倒八字
        addMesh(dragon, new T.BoxGeometry(0.36, 0.08, 0.2), ridgeMat,
          [side * 0.3, 0.4, 0.86], [-0.22, side * 0.2, side * -0.38]);
        // 下眼睑鳞甲
        addMesh(dragon, new T.BoxGeometry(0.26, 0.05, 0.12), plateMat,
          [side * 0.3, 0.17, 0.9], [0.24, side * 0.24, 0]);

        const glow = new T.Sprite(new T.SpriteMaterial({
          map: eyeGlowTex,
          color: 0xd80a00,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: T.AdditiveBlending
        }));
        glow.scale.set(0.5, 0.3, 1);
        glow.position.set(side * 0.3, 0.28, 0.94);
        dragon.add(glow);
        this.dragonEyes.push(eye);
        this.eyeSprites.push(glow);
      }
      // 眼周伤疤
      addMesh(dragon, new T.BoxGeometry(0.02, 0.3, 0.02), ridgeMat,
        [0.52, 0.2, 0.82], [0.2, 0.3, 0.5]);

      // 鼻孔
      for (const side of [-1, 1]) {
        const nostril = new T.Mesh(
          new T.SphereGeometry(0.03, 6, 6),
          new T.MeshBasicMaterial({ color: 0x020101 })
        );
        nostril.position.set(side * 0.16, 0.12, 1.17);
        dragon.add(nostril);
      }

      /* ---------------- 颈 / 身 ---------------- */
      const neck = new T.Mesh(new T.CylinderGeometry(0.65, 1.1, 2.0, 12), scaleMat);
      neck.position.set(0, -0.4, -1.2);
      neck.rotation.x = -0.7;
      dragon.add(neck);

      // 颈部鳞环
      for (let i = 0; i < 5; i++) {
        const r = 0.68 + i * 0.1;
        const ring = new T.Mesh(new T.TorusGeometry(r, 0.07, 6, 14, Math.PI * 1.25), plateMat);
        ring.position.set(0, -0.02 - i * 0.34, -0.55 - i * 0.32);
        ring.rotation.x = Math.PI / 2 - 0.7;
        ring.rotation.z = Math.PI * 0.12;
        dragon.add(ring);
      }
      // 颈背骨板
      for (let i = 0; i < 4; i++) {
        addMesh(dragon, new T.ConeGeometry(0.09, 0.32 + i * 0.05, 5), ridgeMat,
          [0, 0.34 - i * 0.16, -0.28 - i * 0.42], [-0.75, 0, 0]);
      }

      const body = new T.Mesh(new T.IcosahedronGeometry(1.6, 2), scaleMat);
      body.scale.set(1.2, 0.8, 1.1);
      body.position.set(0, -1.6, -2.4);
      body.castShadow = true;
      dragon.add(body);

      // 肩甲与背脊
      for (const side of [-1, 1]) {
        addMesh(dragon, new T.SphereGeometry(0.6, 12, 10), plateMat,
          [side * 0.95, -1.05, -1.9], [0, 0, side * 0.35], [1, 0.55, 0.9]);
      }
      for (let i = 0; i < 6; i++) {
        addMesh(dragon, new T.ConeGeometry(0.11 + i * 0.012, 0.34 + i * 0.06, 5), ridgeMat,
          [0, -0.62 - i * 0.14, -3.0 - i * 0.16], [-0.95 + i * 0.04, 0, 0]);
      }
      // 胸前碎鳞
      for (let i = 0; i < 10; i++) {
        const a = -0.7 + i * 0.16;
        addMesh(dragon, new T.ConeGeometry(0.055, 0.16, 4), plateMat,
          [Math.sin(a) * 1.3, -1.9 + Math.cos(a) * 0.3, -3.28],
          [-1.35, 0, 0]);
      }

      this.dragon = dragon;
      this.dragonBaseY = 1.55;

      // 笼内逆光：从龙背后上方打一团暗红，把角与颈的轮廓从黑背景里勾出来
      const rimLight = new T.PointLight(0xff2810, 0.8, 3.2, 2);
      rimLight.position.set(0, 2.7, -5.6);
      this.scene.add(rimLight);

      // 烟雾
      this.dragonSmoke = new ParticleField(this.scene, 80, { size: 0.12, gravity: -0.3, drag: 1.4 });
    }

    /* ---------------------------- 剑架 ---------------------------- */

    buildRack() {
      const group = new T.Group();
      this.scene.add(group);
      const wood = new T.MeshStandardMaterial({ map: this.tex.wood, color: 0x4a3728, roughness: 0.82 });
      const boardMat = new T.MeshStandardMaterial({ map: this.tex.wood, color: 0x34251a, roughness: 0.87 });
      const iron = new T.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.85, roughness: 0.42, envMapIntensity: 0.8 });
      const brass = new T.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.0 });
      const leather = new T.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.95 });

      /* 落地式武器架：木脚 + 竖条背板 + 圆木立柱 + 五道横杆 + 铁艺挂件 */
      // 落地底座：两条纵向木脚 + 前踏条
      for (const x of [4.5, 4.9]) {
        const foot = new T.Mesh(new T.BoxGeometry(0.16, 0.14, 5.72), boardMat);
        foot.position.set(x, 0.07, 1.05);
        foot.castShadow = true;
        foot.receiveShadow = true;
        group.add(foot);
      }
      const plinth = new T.Mesh(new T.BoxGeometry(0.62, 0.1, 5.6), wood);
      plinth.position.set(4.72, 0.16, 1.05);
      plinth.receiveShadow = true;
      group.add(plinth);

      // 背板：8 条竖木板拼接，深浅交错，避免整块板的呆板
      for (let i = 0; i < 8; i++) {
        const z = -1.56 + i * 0.66;
        const board = new T.Mesh(new T.BoxGeometry(0.1, 3.7, 0.6), i % 2 ? wood : boardMat);
        board.position.set(4.96, 2.12, z);
        board.castShadow = true;
        group.add(board);
      }
      // 背板横撑（压在板后，制造厚度）
      for (const y of [0.62, 2.12, 3.5]) {
        const brace = new T.Mesh(new T.BoxGeometry(0.06, 0.14, 5.3), boardMat);
        brace.position.set(5.02, y, 1.05);
        group.add(brace);
      }

      // 两根圆木立柱：柱头 + 三道铁箍
      for (const z of [-1.76, 3.86]) {
        const post = new T.Mesh(new T.CylinderGeometry(0.085, 0.095, 3.96, 10), wood);
        post.position.set(4.64, 2.06, z);
        post.castShadow = true;
        group.add(post);
        const cap = new T.Mesh(new T.CylinderGeometry(0.115, 0.115, 0.09, 10), boardMat);
        cap.position.set(4.64, 4.05, z);
        group.add(cap);
        for (const y of [0.8, 2.05, 3.3]) {
          const band = new T.Mesh(new T.CylinderGeometry(0.098, 0.098, 0.055, 10), iron);
          band.position.set(4.64, y, z);
          group.add(band);
        }
      }

      // 五道圆形横杆 + 三角铁托 + 端头铁箍
      for (const y of [0.18, 1.08, 1.98, 2.88, 3.78]) {
        const rail = new T.Mesh(new T.CylinderGeometry(0.052, 0.052, 5.5, 10), wood);
        rail.rotation.x = Math.PI / 2;
        rail.position.set(4.62, y, 1.05);
        rail.castShadow = true;
        group.add(rail);
        for (const z of [-1.2, 1.05, 3.3]) {
          const bracket = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.3), iron);
          bracket.position.set(4.72, y - 0.09, z);
          bracket.rotation.x = Math.PI / 4;
          group.add(bracket);
        }
        for (const z of [-1.72, 3.82]) {
          const ring = new T.Mesh(new T.CylinderGeometry(0.062, 0.062, 0.05, 10), iron);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(4.62, y, z);
          group.add(ring);
        }
      }

      // 每个剑位：背板皮革垫 + 上方铁钩（剑身倚在钩与横杆之间）
      this.rackSlots = [];
      const cols = 9;
      const rows = 4;
      // 优先放在与视线齐平的一排，玩家走近就能看见新剑
      const rowOrder = [1, 2, 0, 3];
      for (const r of rowOrder) {
        for (let c = 0; c < cols; c++) {
          const z = -1.2 + c * 0.6;
          const y = 0.25 + r * 0.9;
          this.rackSlots.push({ z, y });
          const pad = new T.Mesh(new T.BoxGeometry(0.04, 0.3, 0.14), leather);
          pad.position.set(4.92, y - 0.02, z);
          group.add(pad);
          const hook = new T.Mesh(new T.TorusGeometry(0.052, 0.011, 6, 12, Math.PI * 1.35), iron);
          hook.position.set(4.6, y + 0.52, z);
          hook.rotation.set(0, Math.PI / 2, Math.PI * 0.82);
          group.add(hook);
        }
      }

      // 顶部木檐 + 黄铜挂环
      const cornice = new T.Mesh(new T.BoxGeometry(0.78, 0.1, 5.8), wood);
      cornice.position.set(4.7, 4.02, 1.05);
      cornice.castShadow = true;
      group.add(cornice);
      for (const z of [-1.3, 0, 1.3, 2.6]) {
        const ring = new T.Mesh(new T.TorusGeometry(0.07, 0.012, 6, 12), brass);
        ring.position.set(4.52, 3.88, z);
        ring.rotation.y = Math.PI / 2;
        group.add(ring);
      }

      // 壁灯：铁托 + 暖光灯球 + 光晕（与两盏既有光源呼应）
      for (const z of [-1.35, 3.45]) {
        const arm = new T.Mesh(new T.BoxGeometry(0.26, 0.05, 0.05), iron);
        arm.position.set(4.62, 3.5, z);
        group.add(arm);
        const bulb = new T.Mesh(new T.SphereGeometry(0.075, 10, 8), new T.MeshBasicMaterial({ color: 0xffc07a }));
        bulb.position.set(4.48, 3.42, z);
        group.add(bulb);
        const halo = new T.Sprite(new T.SpriteMaterial({
          map: this.auraTex,
          color: 0xffa050,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          blending: T.AdditiveBlending
        }));
        halo.scale.set(0.7, 0.7, 1);
        halo.position.set(4.5, 3.4, z);
        group.add(halo);
      }

      const glow = new T.PointLight(0xffa050, 0.8, 5.5, 2);
      glow.position.set(3.9, 2.35, 1.2);
      this.scene.add(glow);
      const glow2 = new T.PointLight(0xffb070, 0.5, 4.5, 2);
      glow2.position.set(3.9, 1.1, 3.2);
      this.scene.add(glow2);
    }

    /* ---------------------------- 遗物机 ---------------------------- */

    buildRelicMachine() {
      const group = new T.Group();
      group.position.set(4.18, 0, -2.2);
      group.rotation.y = -Math.PI / 2;
      this.scene.add(group);

      const bodyMat = new T.MeshStandardMaterial({
        color: 0x23282a,
        metalness: 0.7,
        roughness: 0.45,
        envMapIntensity: 0.7
      });
      const trimMat = new T.MeshStandardMaterial({
        color: 0x967444,
        metalness: 0.85,
        roughness: 0.3,
        envMapIntensity: 1.1
      });

      const body = new T.Mesh(new T.BoxGeometry(1.95, 2.65, 0.72), bodyMat);
      body.position.y = 1.33;
      body.castShadow = true;
      group.add(body);

      const base = new T.Mesh(new T.BoxGeometry(2.15, 0.2, 0.92), trimMat);
      base.position.y = 0.1;
      group.add(base);

      for (const side of [-1, 1]) {
        const pipe = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 2.2, 8), bodyMat);
        pipe.position.set(side * 1.02, 1.35, -0.1);
        group.add(pipe);
        const cap = new T.Mesh(new T.SphereGeometry(0.06, 8, 6), trimMat);
        cap.position.set(side * 1.02, 2.45, -0.1);
        group.add(cap);
      }

      const vent = new T.Mesh(new T.BoxGeometry(1.2, 0.28, 0.05), new T.MeshBasicMaterial({ color: 0x050505 }));
      vent.position.set(0, 0.55, 0.375);
      group.add(vent);
      for (let i = 0; i < 5; i++) {
        const slat = new T.Mesh(new T.BoxGeometry(1.05, 0.02, 0.02), trimMat);
        slat.position.set(0, 0.45 + i * 0.05, 0.39);
        group.add(slat);
      }

      const top = new T.Mesh(new T.BoxGeometry(2.05, 0.12, 0.82), trimMat);
      top.position.y = 2.67;
      group.add(top);

      const glassMat = new T.MeshStandardMaterial({
        color: 0x0e2b28,
        emissive: 0x1e6f66,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.15,
        roughness: 0.15,
        metalness: 0.2,
        depthWrite: false
      });

      this.machineCases = [];
      const pedestalMat = new T.MeshStandardMaterial({ color: 0x4a3a22, metalness: 0.75, roughness: 0.35 });
      const caseCount = 4;
      for (let i = 0; i < caseCount; i++) {
        const x = -0.66 + i * 0.44;
        const frame = new T.Mesh(new T.BoxGeometry(0.4, 0.58, 0.06), trimMat);
        frame.position.set(x, 1.98, 0.38);
        group.add(frame);
        for (const dx of [-0.16, 0.16]) {
          for (const dy of [-0.24, 0.24]) {
            const rivet = new T.Mesh(new T.SphereGeometry(0.014, 6, 5), trimMat);
            rivet.position.set(x + dx, 1.98 + dy, 0.415);
            group.add(rivet);
          }
        }
        const glass = new T.Mesh(new T.PlaneGeometry(0.33, 0.5), glassMat.clone());
        glass.position.set(x, 1.98, 0.415);
        group.add(glass);

        const pedestal = new T.Mesh(new T.CylinderGeometry(0.09, 0.12, 0.06, 12), pedestalMat);
        pedestal.position.set(x, 1.7, 0.5);
        group.add(pedestal);

        const labelCanvas = makeCanvas(256, 72);
        const labelTex = new T.CanvasTexture(labelCanvas);
        labelTex.encoding = T.sRGBEncoding;
        const label = new T.Mesh(
          new T.PlaneGeometry(0.42, 0.13),
          new T.MeshBasicMaterial({ map: labelTex })
        );
        label.position.set(x, 1.6, 0.385);
        group.add(label);

        this.machineCases.push({
          frame, glass, baseX: x,
          labelCanvas, labelTex, label,
          pedestal, model: null
        });
      }

      this.machineLabelCanvas = makeCanvas(512, 128);
      this.machineLabelTex = new T.CanvasTexture(this.machineLabelCanvas);
      this.machineLabelTex.encoding = T.sRGBEncoding;
      const label = new T.Mesh(
        new T.PlaneGeometry(1.5, 0.24),
        new T.MeshBasicMaterial({ map: this.machineLabelTex })
      );
      label.position.set(0, 2.45, 0.375);
      group.add(label);

      this.refreshLabelCanvas = makeCanvas(256, 72);
      this.refreshLabelTex = new T.CanvasTexture(this.refreshLabelCanvas);
      this.refreshLabelTex.encoding = T.sRGBEncoding;
      const refreshLabel = new T.Mesh(
        new T.PlaneGeometry(0.52, 0.15),
        new T.MeshBasicMaterial({ map: this.refreshLabelTex })
      );
      refreshLabel.position.set(0.62, 0.92, 0.385);
      group.add(refreshLabel);

      // 封禁按钮：消耗 1 把存剑，让指定遗物不再出现在货架上
      this.banLabelCanvas = makeCanvas(256, 72);
      this.banLabelTex = new T.CanvasTexture(this.banLabelCanvas);
      this.banLabelTex.encoding = T.sRGBEncoding;
      const banLabel = new T.Mesh(
        new T.PlaneGeometry(0.5, 0.14),
        new T.MeshBasicMaterial({ map: this.banLabelTex })
      );
      banLabel.position.set(0.03, 0.92, 0.385);
      group.add(banLabel);
      const banBase = new T.Mesh(new T.CylinderGeometry(0.085, 0.095, 0.045, 14), trimMat);
      banBase.rotation.x = Math.PI / 2;
      banBase.position.set(0.03, 1.15, 0.39);
      group.add(banBase);
      const banButton = new T.Mesh(
        new T.CylinderGeometry(0.055, 0.055, 0.03, 14),
        new T.MeshStandardMaterial({ color: 0x2a1240, emissive: 0x9a5cff, emissiveIntensity: 0.9, roughness: 0.35 })
      );
      banButton.rotation.x = Math.PI / 2;
      banButton.position.set(0.03, 1.15, 0.415);
      group.add(banButton);
      this.machineBanButton = banButton;

      // 投剑口
      const slot = new T.Mesh(new T.BoxGeometry(0.54, 0.14, 0.06), new T.MeshBasicMaterial({ color: 0x030303 }));
      slot.position.set(-0.55, 1.18, 0.38);
      group.add(slot);

      const slotTrim = new T.Mesh(new T.BoxGeometry(0.62, 0.22, 0.04), trimMat);
      slotTrim.position.set(-0.55, 1.18, 0.35);
      group.add(slotTrim);

      // 存剑口：存入的剑才能用来换遗物
      this.machineDepositCanvas = makeCanvas(256, 64);
      this.machineDepositTex = new T.CanvasTexture(this.machineDepositCanvas);
      this.machineDepositTex.encoding = T.sRGBEncoding;
      const depositLabel = new T.Mesh(
        new T.PlaneGeometry(0.5, 0.125),
        new T.MeshBasicMaterial({ map: this.machineDepositTex })
      );
      depositLabel.position.set(-0.55, 1.02, 0.385);
      group.add(depositLabel);
      this.machineDepositGlow = new T.Mesh(
        new T.PlaneGeometry(0.5, 0.12),
        new T.MeshBasicMaterial({ color: 0x2aa79c, transparent: true, opacity: 0.18 })
      );
      this.machineDepositGlow.position.set(-0.55, 1.18, 0.412);
      group.add(this.machineDepositGlow);

      // 红按钮
      const buttonBase = new T.Mesh(new T.CylinderGeometry(0.11, 0.12, 0.05, 16), trimMat);
      buttonBase.rotation.x = Math.PI / 2;
      buttonBase.position.set(0.62, 1.15, 0.39);
      group.add(buttonBase);
      const button = new T.Mesh(
        new T.CylinderGeometry(0.075, 0.075, 0.035, 16),
        new T.MeshStandardMaterial({ color: 0x5a0d08, emissive: 0xff2a12, emissiveIntensity: 1.1, roughness: 0.3 })
      );
      button.rotation.x = Math.PI / 2;
      button.position.set(0.62, 1.15, 0.42);
      group.add(button);
      this.machineButton = button;

      this.machineGroup = group;
    }

    /* ---------------------------- 家养小精灵 ---------------------------- */

    // 霍格沃兹风格的小家伙：大耳朵、细手脚、粗布麻衣，站在售货机旁边
    buildElf() {
      const group = new T.Group();
      this.elfHome = new T.Vector3(3.3, 0, -3.42);
      this.elfDeposit = new T.Vector3(3.54, 0, -2.74);
      group.position.copy(this.elfHome);
      group.rotation.y = -1.1;
      this.scene.add(group);

      const skin = new T.MeshStandardMaterial({ color: 0xb2967a, roughness: 0.8, metalness: 0 });
      const skinDark = new T.MeshStandardMaterial({ color: 0x8f7457, roughness: 0.85 });
      const tunic = new T.MeshStandardMaterial({ color: 0x2c2218, roughness: 0.98 });
      const tunicDark = new T.MeshStandardMaterial({ color: 0x191410, roughness: 1 });
      const eyeMat = new T.MeshStandardMaterial({
        color: 0xe4f0c8, emissive: 0x93b45a, emissiveIntensity: 0.55, roughness: 0.35
      });
      const pupilMat = new T.MeshStandardMaterial({ color: 0x1b2112, roughness: 0.5 });

      // 细腿
      const mkLeg = side => {
        const hip = new T.Group();
        hip.position.set(side * 0.055, 0.25, 0);
        const leg = new T.Mesh(new T.CylinderGeometry(0.02, 0.016, 0.23, 8), skinDark);
        leg.position.y = -0.115;
        leg.castShadow = true;
        hip.add(leg);
        const foot = new T.Mesh(new T.SphereGeometry(0.032, 8, 6), skinDark);
        foot.scale.set(0.9, 0.55, 1.5);
        foot.position.set(0, -0.235, 0.018);
        hip.add(foot);
        group.add(hip);
        return hip;
      };
      const legL = mkLeg(-1);
      const legR = mkLeg(1);

      // 躯干 + 粗布麻衣 + 麻绳腰带
      const torso = new T.Mesh(new T.SphereGeometry(0.105, 12, 10), skin);
      torso.scale.set(1, 1.35, 0.86);
      torso.position.y = 0.44;
      torso.castShadow = true;
      group.add(torso);
      const robe = new T.Mesh(new T.CylinderGeometry(0.122, 0.2, 0.34, 12), tunic);
      robe.position.y = 0.365;
      robe.castShadow = true;
      group.add(robe);
      // 领口 / 下摆 / 斜挎麻绳，让粗布衣更好认
      const collar = new T.Mesh(new T.TorusGeometry(0.128, 0.014, 6, 16), tunicDark);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.528;
      group.add(collar);
      const hem = new T.Mesh(new T.TorusGeometry(0.202, 0.016, 6, 18), tunicDark);
      hem.rotation.x = Math.PI / 2;
      hem.position.y = 0.2;
      group.add(hem);
      const strap = new T.Mesh(new T.BoxGeometry(0.028, 0.3, 0.014), tunicDark);
      strap.position.set(0.012, 0.42, 0.15);
      strap.rotation.z = 0.62;
      group.add(strap);
      const rope = new T.Mesh(
        new T.TorusGeometry(0.176, 0.012, 6, 16),
        new T.MeshStandardMaterial({ color: 0x6b5636, roughness: 0.95 })
      );
      rope.rotation.x = Math.PI / 2;
      rope.position.y = 0.335;
      group.add(rope);

      // 手臂
      const mkArm = side => {
        const shoulder = new T.Group();
        shoulder.position.set(side * 0.105, 0.52, 0);
        shoulder.rotation.z = side * 0.24;
        const arm = new T.Mesh(new T.CylinderGeometry(0.017, 0.014, 0.24, 8), skin);
        arm.position.y = -0.12;
        arm.castShadow = true;
        shoulder.add(arm);
        const hand = new T.Mesh(new T.SphereGeometry(0.024, 8, 6), skin);
        hand.position.y = -0.245;
        shoulder.add(hand);
        group.add(shoulder);
        return shoulder;
      };
      const armL = mkArm(-1);
      const armR = mkArm(1);

      // 脑袋 + 蝙蝠耳 + 大眼睛
      const head = new T.Group();
      head.position.y = 0.64;
      group.add(head);
      const skull = new T.Mesh(new T.SphereGeometry(0.112, 14, 12), skin);
      skull.scale.set(1, 0.94, 0.92);
      skull.castShadow = true;
      head.add(skull);
      const earMat = new T.MeshStandardMaterial({ color: 0xc09a78, roughness: 0.82 });
      const earInnerMat = new T.MeshStandardMaterial({ color: 0x9d7a5c, roughness: 0.9 });
      const mkEar = side => {
        const ear = new T.Group();
        ear.position.set(side * 0.112, -0.005, 0.006);
        ear.rotation.z = side * 1.16;
        ear.rotation.x = -0.06;
        const outer = new T.Mesh(new T.ConeGeometry(0.05, 0.23, 7), earMat);
        outer.scale.set(1, 1, 0.38);
        outer.position.y = 0.105;
        outer.castShadow = true;
        ear.add(outer);
        const inner = new T.Mesh(new T.ConeGeometry(0.032, 0.18, 7), earInnerMat);
        inner.scale.set(1, 1, 0.28);
        inner.position.set(0, 0.098, 0.014);
        ear.add(inner);
        head.add(ear);
        return ear;
      };
      const earL = mkEar(-1);
      const earR = mkEar(1);
      for (const side of [-1, 1]) {
        const eye = new T.Mesh(new T.SphereGeometry(0.034, 10, 8), eyeMat);
        eye.scale.set(0.9, 1.12, 0.85);
        eye.position.set(side * 0.043, 0.004, 0.083);
        head.add(eye);
        const pupil = new T.Mesh(new T.SphereGeometry(0.015, 8, 6), pupilMat);
        pupil.position.set(side * 0.045, 0.002, 0.106);
        head.add(pupil);
      }
      const nose = new T.Mesh(new T.SphereGeometry(0.02, 8, 6), skin);
      nose.scale.set(0.8, 0.8, 1.5);
      nose.position.set(0, -0.035, 0.1);
      head.add(nose);

      this.elf = {
        group,
        head,
        earL,
        earR,
        armL,
        armR,
        legL,
        legR,
        home: this.elfHome.clone(),
        deposit: this.elfDeposit.clone(),
        target: this.elfHome.clone(),
        state: 'idle',
        phase: 0,
        swordId: 0,
        carriedIds: [],
        carriedGroups: [],
        carriedGroup: null
      };
      this.elfCarryLimit = 1;
      this.elfEnabled = false;
      this.onElfPickup = null;
      this.onElfDeposit = null;
      this.elfFocus = { kind: 'elf' };
    }

    setElfEnabled(on) {
      this.elfEnabled = !!on;
    }

    // 一次能抱几把剑（精灵背篓遗物可以提升，不设上限）
    setElfCarry(n) {
      this.elfCarryLimit = Math.max(1, Math.floor(Number(n) || 1));
    }

    // 在落地的剑里挑一把最近的（只挑已经落稳的）
    pickElfTarget() {
      const e = this.elf;
      let best = null;
      let bestD = Infinity;
      for (const d of this.dropSwords.values()) {
        if (!d.rest) continue;
        const dx = d.group.position.x - e.group.position.x;
        const dz = d.group.position.z - e.group.position.z;
        const dist = dx * dx + dz * dz;
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    }

    makeElfCarried(info) {
      const e = this.elf;
      const wrap = new T.Group();
      const sw = this.makeSword(info ? info.level : 0, {
        form: info ? info.form : 'longsword',
        variant: info ? info.variant : 0,
        cracks: info ? info.cracks : 0
      });
      sw.scale.setScalar(0.32);
      sw.rotation.set(0, 0, Math.PI / 2);
      wrap.add(sw);
      const idx = e.carriedGroups.length;
      wrap.position.set((idx % 2 ? 0.03 : -0.03), 0.45 + idx * 0.05, 0.2 - idx * 0.02);
      wrap.rotation.set(-0.18, (idx - 1) * 0.28, idx % 2 ? 0.06 : -0.05);
      wrap.userData.bladeMat = sw.userData.bladeMat;
      e.group.add(wrap);
      e.carriedGroups.push(wrap);
      e.carriedGroup = wrap;
      e.armL.rotation.x = -1.15;
      e.armR.rotation.x = -1.15;
      return wrap;
    }

    clearElfCarried() {
      const e = this.elf;
      if (!e) return;
      for (const wrap of e.carriedGroups) {
        e.group.remove(wrap);
        const mat = wrap.userData.bladeMat;
        if (mat) mat.dispose();
      }
      e.carriedGroups = [];
      e.carriedGroup = null;
    }

    updateElf(dt) {
      const e = this.elf;
      if (!e) return;
      const g = e.group;

      const walkPose = () => {
        e.phase += dt * 9;
        const sw = Math.sin(e.phase);
        e.legL.rotation.x = sw * 0.6;
        e.legR.rotation.x = -sw * 0.6;
        if (e.carriedGroup) {
          e.armL.rotation.x = -1.15;
          e.armR.rotation.x = -1.15;
        } else {
          e.armL.rotation.x = -sw * 0.35;
          e.armR.rotation.x = sw * 0.35;
        }
        g.position.y = Math.abs(Math.sin(e.phase)) * 0.014;
        e.earL.rotation.z = -1.16 - Math.sin(e.phase * 0.8) * 0.09;
        e.earR.rotation.z = 1.16 + Math.sin(e.phase * 0.8) * 0.09;
        e.head.rotation.y = Math.sin(e.phase * 0.45) * 0.06;
      };
      const idlePose = () => {
        e.phase += dt * 1.7;
        g.position.y = Math.sin(e.phase) * 0.006;
        e.legL.rotation.x *= 0.92;
        e.legR.rotation.x *= 0.92;
        e.armL.rotation.x *= 0.92;
        e.armR.rotation.x *= 0.92;
        e.earL.rotation.z = -1.16 + Math.sin(e.phase * 0.9) * 0.05;
        e.earR.rotation.z = 1.16 - Math.sin(e.phase * 0.9) * 0.05;
      };

      if (e.state === 'idle') {
        idlePose();
        if (this.elfEnabled && e.carriedIds.length < this.elfCarryLimit) {
          const d = this.pickElfTarget();
          if (d) {
            e.state = 'toSword';
            e.swordId = d.id;
            e.target.set(d.group.position.x, 0, d.group.position.z);
          }
        }
        return;
      }

      const dx = e.target.x - g.position.x;
      const dz = e.target.z - g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.02) {
        const step = Math.min(dist, 1.15 * dt);
        g.position.x += dx / dist * step;
        g.position.z += dz / dist * step;
        const want = Math.atan2(dx, dz);
        const diff = ((want - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        g.rotation.y += diff * Math.min(1, dt * 9);
        walkPose();
        return;
      }

      if (e.state === 'toSword') {
        const d = this.dropSwords.get(e.swordId);
        const info = d ? d.info : null;
        const ok = this.onElfPickup ? this.onElfPickup(e.swordId) : false;
        if (ok) {
          if (e.swordId) e.carriedIds.push(e.swordId);
          this.makeElfCarried(info);
          e.swordId = 0;
          // 还能抱并且地上还有剑，就继续找下一把；否则送去售货机
          if (this.elfEnabled && e.carriedIds.length < this.elfCarryLimit) {
            const next = this.pickElfTarget();
            if (next) {
              e.state = 'toSword';
              e.swordId = next.id;
              e.target.set(next.group.position.x, 0, next.group.position.z);
              return;
            }
          }
          e.state = 'toMachine';
          e.target.copy(e.deposit);
        } else if (e.carriedIds.length) {
          // 手里已经有剑：不空跑，直接去售货机
          e.state = 'toMachine';
          e.target.copy(e.deposit);
        } else if (this.elfEnabled) {
          // 目标被玩家拿走了：立刻在原地重新找一把，不白跑一趟
          e.state = 'idle';
          e.swordId = 0;
        } else {
          e.state = 'home';
          e.target.copy(e.home);
        }
        return;
      }

      if (e.state === 'toMachine') {
        if (this.onElfDeposit) {
          for (const id of e.carriedIds) this.onElfDeposit(id);
        }
        e.carriedIds = [];
        this.clearElfCarried();
        e.swordId = 0;
        e.state = 'home';
        e.target.copy(e.home);
        return;
      }

      if (e.state === 'home') {
        e.state = 'idle';
        idlePose();
      }
    }

    /* ---------------------------- 幽灵商人 ---------------------------- */

    buildGhost() {
      const group = new T.Group();
      group.position.set(-2.9, 0, -2.2);
      group.visible = false;
      this.scene.add(group);

      // 地面法阵（不随身体浮动）
      const runeCanvas = makeCanvas(512, 512);
      const rg = runeCanvas.getContext('2d');
      rg.clearRect(0, 0, 512, 512);
      rg.strokeStyle = 'rgba(120,235,255,0.9)';
      rg.lineWidth = 4;
      for (const r of [236, 210, 150, 92]) {
        rg.beginPath();
        rg.arc(256, 256, r, 0, Math.PI * 2);
        rg.stroke();
      }
      rg.lineWidth = 3;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const inner = i % 3 === 0 ? 150 : 210;
        rg.beginPath();
        rg.moveTo(256 + Math.cos(a) * inner, 256 + Math.sin(a) * inner);
        rg.lineTo(256 + Math.cos(a) * 236, 256 + Math.sin(a) * 236);
        rg.stroke();
      }
      rg.font = 'bold 46px "Microsoft YaHei", serif';
      rg.textAlign = 'center';
      rg.textBaseline = 'middle';
      const glyphs = ['魂', '契', '价', '影', '偿'];
      glyphs.forEach((ch, i) => {
        const a = (i / glyphs.length) * Math.PI * 2 - Math.PI / 2;
        rg.fillStyle = 'rgba(160,245,255,0.85)';
        rg.fillText(ch, 256 + Math.cos(a) * 122, 256 + Math.sin(a) * 122);
      });
      const runeTex = new T.CanvasTexture(runeCanvas);
      runeTex.encoding = T.sRGBEncoding;
      const ghostRuneMat = new T.MeshBasicMaterial({
        map: runeTex,
        color: 0x6fe4ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide
      });
      const ghostRune = new T.Mesh(new T.PlaneGeometry(1.9, 1.9), ghostRuneMat);
      ghostRune.rotation.x = -Math.PI / 2;
      ghostRune.position.y = 0.02;
      group.add(ghostRune);
      this.ghostRune = ghostRune;
      this.ghostRuneMat = ghostRuneMat;

      // 升腾的雾柱
      const ghostFogMat = new T.MeshBasicMaterial({
        color: 0x57c8e8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide
      });
      const ghostFog = new T.Mesh(new T.ConeGeometry(0.85, 2.3, 14, 1, true), ghostFogMat);
      ghostFog.position.y = 1.15;
      group.add(ghostFog);
      this.ghostFog = ghostFog;
      this.ghostFogMat = ghostFogMat;

      // 身体（会上下浮动）
      const bodyGroup = new T.Group();
      group.add(bodyGroup);
      this.ghostBody = bodyGroup;

      const ghostMat = new T.MeshStandardMaterial({
        color: 0xaee6f2,
        emissive: 0x3fa9bf,
        emissiveIntensity: 1.05,
        transparent: true,
        opacity: 0.4,
        roughness: 0.5,
        metalness: 0.05,
        depthWrite: false,
        side: T.DoubleSide
      });
      const veilMat = new T.MeshStandardMaterial({
        color: 0x7fc4d4,
        emissive: 0x2a7f96,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.26,
        roughness: 0.7,
        metalness: 0.0,
        depthWrite: false,
        side: T.DoubleSide
      });

      const body = new T.Mesh(new T.SphereGeometry(0.34, 16, 14), ghostMat);
      body.scale.set(1, 1.25, 1);
      body.position.y = 1.32;
      bodyGroup.add(body);

      const robe = new T.Mesh(new T.CylinderGeometry(0.36, 0.1, 1.1, 14, 1, true), ghostMat);
      robe.position.y = 0.78;
      bodyGroup.add(robe);

      const hood = new T.Mesh(new T.ConeGeometry(0.38, 0.55, 14, 1, true), ghostMat);
      hood.position.y = 1.58;
      bodyGroup.add(hood);
      // 兜帽边缘的破布
      for (let i = 0; i < 5; i++) {
        const rag = new T.Mesh(new T.ConeGeometry(0.07, 0.24, 4, 1, true), veilMat);
        rag.position.set(Math.cos(i * 1.26) * 0.3, 1.36, Math.sin(i * 1.26) * 0.3);
        rag.rotation.z = rand(-0.4, 0.4);
        bodyGroup.add(rag);
      }

      const voidMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.92 });
      const voidSphere = new T.Mesh(new T.SphereGeometry(0.2, 12, 10), voidMat);
      voidSphere.position.set(0, 1.4, 0.12);
      voidSphere.scale.set(1, 1.15, 0.75);
      bodyGroup.add(voidSphere);

      // 兜帽里的两点幽光
      const eyeTex = new T.CanvasTexture(makeGlowCanvas('rgba(190,255,255,1)', 'rgba(60,200,230,0.35)'));
      eyeTex.encoding = T.sRGBEncoding;
      this.ghostEyeMats = [];
      for (const side of [-1, 1]) {
        const mat = new T.SpriteMaterial({
          map: eyeTex,
          color: 0x9ff6ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: T.AdditiveBlending
        });
        const eye = new T.Sprite(mat);
        eye.scale.set(0.18, 0.18, 1);
        eye.position.set(side * 0.075, 1.42, 0.3);
        bodyGroup.add(eye);
        this.ghostEyeMats.push(mat);
      }

      // 漂浮的商品：最多 6 个可交互槽位
      this.merchantItems = [];
      const itemSpots = [
        [-0.7, 1.48, 0.3],
        [0.7, 1.48, 0.3],
        [-0.62, 1.92, 0.2],
        [0.62, 1.92, 0.2],
        [-0.42, 2.32, 0.1],
        [0.42, 2.32, 0.1]
      ];
      for (let i = 0; i < itemSpots.length; i++) {
        const holder = new T.Group();
        holder.position.set(itemSpots[i][0], itemSpots[i][1], itemSpots[i][2]);
        bodyGroup.add(holder);
        this.merchantItems.push({
          group: holder,
          mesh: null,
          base: itemSpots[i],
          phase: Math.random() * TAU,
          itemId: null
        });
        // 商品底下的幽光托
        const padMat = new T.SpriteMaterial({
          map: eyeTex,
          color: 0x66e0ff,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          blending: T.AdditiveBlending
        });
        const pad = new T.Sprite(padMat);
        pad.scale.set(0.34, 0.34, 1);
        pad.position.set(0, -0.2, 0);
        holder.add(pad);
      }

      // 底部雾尾
      for (let i = 0; i < 4; i++) {
        const wisp = new T.Mesh(new T.ConeGeometry(0.12, 0.55, 6, 1, true), veilMat);
        wisp.position.set(rand(-0.22, 0.22), 0.16, rand(-0.16, 0.16));
        wisp.rotation.x = Math.PI;
        wisp.rotation.z = rand(-0.3, 0.3);
        bodyGroup.add(wisp);
      }

      // 两侧悬灯
      for (const side of [-1, 1]) {
        const chain = new T.Mesh(
          new T.CylinderGeometry(0.008, 0.008, 0.5, 4),
          new T.MeshBasicMaterial({ color: 0x6fd8ee, transparent: true, opacity: 0.5 })
        );
        chain.position.set(side * 0.78, 2.18, 0);
        bodyGroup.add(chain);
        const lampMat = new T.SpriteMaterial({
          map: eyeTex,
          color: 0x7fe6ff,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: T.AdditiveBlending
        });
        const lamp = new T.Sprite(lampMat);
        lamp.scale.set(0.3, 0.3, 1);
        lamp.position.set(side * 0.78, 1.9, 0);
        bodyGroup.add(lamp);
      }

      // 招牌
      const signCanvas = makeCanvas(512, 160);
      const sg = signCanvas.getContext('2d');
      sg.clearRect(0, 0, 512, 160);
      sg.textAlign = 'center';
      sg.textBaseline = 'middle';
      sg.shadowColor = 'rgba(120,235,255,0.9)';
      sg.shadowBlur = 18;
      sg.fillStyle = 'rgba(190,250,255,0.95)';
      sg.font = 'bold 62px "Microsoft YaHei", serif';
      sg.fillText('幽灵商人', 256, 62);
      sg.shadowBlur = 8;
      sg.font = '22px "Georgia", serif';
      sg.fillStyle = 'rgba(150,220,235,0.75)';
      sg.fillText('G H O S T   M E R C H A N T', 256, 122);
      const signTex = new T.CanvasTexture(signCanvas);
      signTex.encoding = T.sRGBEncoding;
      const ghostSignMat = new T.MeshBasicMaterial({
        map: signTex,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const ghostSign = new T.Mesh(new T.PlaneGeometry(1.12, 0.35), ghostSignMat);
      ghostSign.position.set(0, 2.5, 0.08);
      group.add(ghostSign);
      this.ghostSignMat = ghostSignMat;

      this.ghostGroup = group;
      this.ghostOpacity = 0;
      this.ghostTarget = 0;
      this.ghostMats = [ghostMat, veilMat];
      group.traverse(o => {
        if (o.isMesh && o.material === ghostMat && !this.ghostMats.includes(o.material)) {
          this.ghostMats.push(o.material);
        }
      });
    }

    /* ---------------------------- 日历 ---------------------------- */

    buildCalendar() {
      const group = new T.Group();
      // 左移到笼柱视线之外，并略微缩小，避免被立柱挡住右边一列
      group.position.set(-4.05, 2.75, -4.56);
      group.scale.setScalar(0.85);
      this.scene.add(group);

      this.calendarCanvas = makeCanvas(512, 384);
      this.calendarTex = new T.CanvasTexture(this.calendarCanvas);
      this.calendarTex.encoding = T.sRGBEncoding;

      const paper = new T.Mesh(
        new T.PlaneGeometry(1.9, 1.43),
        new T.MeshStandardMaterial({
          map: this.calendarTex,
          emissive: 0xffffff,
          emissiveMap: this.calendarTex,
          emissiveIntensity: 0.22,
          roughness: 0.85
        })
      );
      group.add(paper);

      const frameMat = new T.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.8 });
      const topBar = new T.Mesh(new T.BoxGeometry(2.0, 0.06, 0.04), frameMat);
      topBar.position.set(0, 0.74, 0.01);
      group.add(topBar);
      const bottomBar = topBar.clone();
      bottomBar.position.y = -0.74;
      group.add(bottomBar);
      for (const x of [-0.98, 0.98]) {
        const side = new T.Mesh(new T.BoxGeometry(0.06, 1.52, 0.04), frameMat);
        side.position.set(x, 0, 0.01);
        group.add(side);
      }

      this.drawCalendar(1);
    }

    /* ---------------------------- 场景交互命中盒 ---------------------------- */

    buildInteractables() {
      const add = (parent, size, pos, focus, active) => {
        const mesh = new T.Mesh(new T.BoxGeometry(size[0], size[1], size[2]), this.mat.hit);
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.userData.focus = focus;
        mesh.userData.active = active !== false;
        parent.add(mesh);
        this.hitboxes.push(mesh);
        return mesh;
      };

      // 熔炉 / 铁砧 / 贡台 / 铃铛 / 剑架背板
      add(this.scene, [0.5, 1.5, 1.7], [-4.2, 1.0, 0.45], this.forgeFocus);
      add(this.scene, [1.5, 0.5, 0.85], [0, 1.12, 0.2], this.anvilFocus);
      add(this.scene, [3.9, 0.12, 0.95], [0, 1.03, -2.96], this.counterFocus);
      add(this.scene, [0.55, 0.55, 0.45], [-1.55, 1.2, -2.92], this.bellFocus);
      this.rackFocus = { kind: 'rack' };
      add(this.scene, [0.1, 3.6, 5.1], [4.84, 2.0, 1.05], this.rackFocus);

      // 遗物机四个玻璃柜 + 红色刷新按钮
      this.machineCaseHitboxes = [];
      for (let i = 0; i < this.machineCases.length; i++) {
        const focus = { kind: 'relic', index: i };
        const h = add(this.machineGroup, [0.4, 0.7, 0.24], [this.machineCases[i].baseX, 1.98, 0.5], focus);
        this.machineCaseHitboxes.push(h);
      }
      add(this.machineGroup, [0.36, 0.36, 0.24], [0.62, 1.15, 0.5], this.refreshFocus);
      add(this.machineGroup, [0.56, 0.4, 0.24], [-0.55, 1.15, 0.5], this.machineDepositFocus);
      add(this.machineGroup, [0.3, 0.36, 0.24], [0.03, 1.1, 0.5], this.banFocus);

      // 家养小精灵：会跟着它在店里走动
      if (this.elf) {
        add(this.elf.group, [0.44, 0.88, 0.44], [0, 0.46, 0], this.elfFocus);
      }

      // 幽灵商人漂浮商品（与槽位数量一致）
      this.merchantHitboxes = [];
      for (let i = 0; i < this.merchantItems.length; i++) {
        const focus = { kind: 'merchant', index: i };
        const item = this.merchantItems[i];
        const h = add(this.ghostGroup, [0.4, 0.4, 0.34], item.base, focus, false);
        this.merchantHitboxes.push(h);
      }

      this.staticHitboxes = this.hitboxes.slice();
    }

    /* ---------------------------- 粒子 / 锤子 ---------------------------- */

    initParticles() {
      this.sparks = new ParticleField(this.scene, 260, { size: 0.038, gravity: 680, drag: 0.7 });
      this.embers = new ParticleField(this.scene, 90, { size: 0.045, gravity: -18, drag: 0.35 });
      this.dust = new ParticleField(this.scene, 80, { size: 0.05, gravity: -4, drag: 1.2 });

      this.fragments = [];
      for (let i = 0; i < 16; i++) {
        const mesh = new T.Mesh(new T.BoxGeometry(rand(0.035, 0.09), rand(0.08, 0.22), rand(0.008, 0.02)), this.mat.shard);
        mesh.visible = false;
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.fragments.push({ mesh, vel: new T.Vector3(), spin: new T.Vector3(), life: 0 });
      }

      this.waves = [];
      for (let i = 0; i < 3; i++) {
        const mesh = new T.Mesh(
          new T.RingGeometry(0.5, 0.56, 40),
          new T.MeshBasicMaterial({
            color: 0xffd08a,
            transparent: true,
            opacity: 0,
            blending: T.AdditiveBlending,
            side: T.DoubleSide,
            depthWrite: false
          })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0.25, 1.08, 0.2);
        mesh.visible = false;
        this.scene.add(mesh);
        this.waves.push({ mesh, life: 0, max: 0.5 });
      }

      // 环境余烬
      for (let i = 0; i < 24; i++) {
        this.embers.spawn(rand(-4.4, -3.4), rand(0.5, 1.8), rand(-0.5, 1.4), 1, 0xff7a24, 0.25, 1);
      }
      for (let i = 0; i < 20; i++) {
        this.dust.spawn(rand(-3, 3), rand(0.3, 2.5), rand(-3, 3), 1, 0x5a4a38, 0.05, 1);
      }
    }

    initHammer() {
      const group = new T.Group();
      group.position.set(1.48, 1.70, 0.62);
      group.visible = false;
      this.scene.add(group);

      const handleMat = new T.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.85 });
      const handle = new T.Mesh(new T.CylinderGeometry(0.026, 0.032, 0.66, 8), handleMat);
      handle.position.y = -0.33;
      group.add(handle);

      const wrapMat = new T.MeshStandardMaterial({ color: 0x1a0f08, roughness: 0.9 });
      for (let i = 0; i < 5; i++) {
        const wrap = new T.Mesh(new T.TorusGeometry(0.032, 0.008, 6, 10), wrapMat);
        wrap.rotation.x = Math.PI / 2;
        wrap.position.y = -0.12 - i * 0.09;
        group.add(wrap);
      }

      const headMat = new T.MeshStandardMaterial({
        color: 0x6b747e,
        metalness: 0.88,
        roughness: 0.32,
        envMapIntensity: 1.1
      });
      const head = new T.Mesh(new T.BoxGeometry(0.3, 0.13, 0.16), headMat);
      head.position.y = -0.7;
      head.castShadow = true;
      group.add(head);

      const face = new T.Mesh(new T.BoxGeometry(0.035, 0.13, 0.16), new T.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.9, roughness: 0.25 }));
      face.position.set(-0.16, -0.7, 0);
      group.add(face);

      const band = new T.Mesh(new T.BoxGeometry(0.05, 0.14, 0.17), new T.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.7 }));
      band.position.y = -0.7;
      group.add(band);

      this.hammer = group;
      this.hammerRest = -1.0;
      this.hammerHit = -1.02;
      this.hammerRestPos = new T.Vector3(1.9, 2.42, 0.66);
      this.hammerHitPos = new T.Vector3(0.95, 1.45, 0.52);
      group.rotation.z = this.hammerRest;
    }

    /* ---------------------------- 幽灵锤 ---------------------------- */

    // 幻影锤击遗物：每持有一件就多一把幽灵锤，数量不设上限
    phantomAnchor(i) {
      const side = i % 2 ? 1 : -1;
      const ring = Math.floor(i / 2);
      return new T.Vector3(
        side * Math.min(1.6, 0.72 + ring * 0.13),
        0.98 + (ring % 2) * 0.16 + (i % 3) * 0.03,
        0.58 - Math.min(0.32, ring * 0.03)
      );
    }

    ensurePhantoms(n) {
      // 前六把带点光源，再多只加模型，避免灯太多拖慢渲染
      while (this.phantoms.length < n) {
        const i = this.phantoms.length;
        const group = new T.Group();
        const mat = new T.MeshStandardMaterial({
          color: 0xcfeaff,
          emissive: 0x69c7ff,
          emissiveIntensity: 1.15,
          transparent: true,
          opacity: 0.42,
          roughness: 0.45,
          metalness: 0.25,
          depthWrite: false
        });
        const head = new T.Mesh(new T.BoxGeometry(0.28, 0.12, 0.15), mat);
        group.add(head);
        const face = new T.Mesh(new T.BoxGeometry(0.03, 0.12, 0.15), mat);
        face.position.set(0.155, 0, 0);
        group.add(face);
        const handle = new T.Mesh(new T.CylinderGeometry(0.021, 0.026, 0.62, 7), mat);
        handle.position.y = 0.36;
        group.add(handle);
        const pommel = new T.Mesh(new T.SphereGeometry(0.032, 8, 6), mat);
        pommel.position.y = 0.68;
        group.add(pommel);
        let glow = null;
        if (i < 6) {
          glow = new T.PointLight(0x6fd0ff, 0, 1.4, 2);
          glow.position.set(0, 0.1, 0);
          group.add(glow);
        }
        const idle = this.phantomAnchor(i);
        group.position.copy(idle);
        group.scale.setScalar(0.78 + (i % 3) * 0.05);
        group.visible = false;
        this.scene.add(group);
        this.phantoms.push({
          group,
          mat,
          glow,
          idle,
          target: new T.Vector3(),
          active: false,
          hit: false,
          t: 0,
          dur: 0.42,
          delay: 0,
          phase: Math.random() * Math.PI * 2,
          seed: i * 1.71 + 0.45
        });
      }
      // 兼容旧调试接口：第一把幽灵锤
      if (!this.phantom && this.phantoms.length) this.phantom = this.phantoms[0];
    }

    initPhantomHammer() {
      this.phantoms = [];
      this.phantom = null;
      this.ensurePhantoms(6);
      this.phantomCount = 0;
      this.phantomEnabled = false;
    }

    setPhantomHammer(count) {
      const n = Math.max(0, Math.floor(Number(count) || 0));
      if (n > this.phantoms.length) this.ensurePhantoms(n);
      this.phantomCount = n;
      this.phantomEnabled = n > 0;
      this.phantoms.forEach((p, i) => {
        if (i >= n) {
          p.active = false;
          p.group.visible = false;
          if (p.glow) p.glow.intensity = 0;
        } else if (!p.active) {
          p.group.visible = true;
          p.group.position.copy(p.idle);
          p.group.rotation.set(0, 0, 0);
          p.mat.opacity = 0.42;
        }
      });
    }

    // 每把幽灵锤各选一个剑身落点，按序补锤
    phantomStrike() {
      if (!this.phantomCount) return false;
      for (let i = 0; i < this.phantomCount; i++) {
        const p = this.phantoms[i];
        p.active = true;
        p.hit = false;
        p.t = 0;
        p.delay = i * 0.075;
        p.mat.opacity = 0.5;
        p.group.visible = true;
        const x = -0.34 + Math.random() * 0.98;
        const z = 0.34 + (Math.random() - 0.5) * 0.1;
        p.target.set(x, 1.15, z);
        p.group.position.set(x + 0.26, 1.38, z + 0.04);
        p.group.rotation.set(0, 0, -0.55);
        if (p.glow) p.glow.intensity = 0;
      }
      return true;
    }

    updatePhantom(dt) {
      if (!this.phantoms) return;
      for (let i = 0; i < this.phantoms.length; i++) {
        const p = this.phantoms[i];
        if (i >= this.phantomCount) continue;
        p.phase += dt;
        if (!p.active) {
          // 围绕锻造台缓慢漂浮，每把锤子的轨迹与相位都不同
          const t = p.phase * 0.9 + p.seed;
          p.group.position.set(
            p.idle.x + Math.sin(t * 0.7) * 0.13,
            p.idle.y + Math.sin(t * 1.3) * 0.07,
            p.idle.z + Math.cos(t * 0.55) * 0.09
          );
          p.group.rotation.set(0, Math.sin(t * 0.5) * 0.5, Math.sin(t * 1.1) * 0.14);
          p.mat.opacity = 0.36 + Math.sin(t * 1.7) * 0.07;
          continue;
        }
        p.t += dt;
        if (p.t < p.delay) continue;
        const k = clamp((p.t - p.delay) / p.dur, 0, 1);
        const e = clamp(k / 0.4, 0, 1);
        const ease = e * e * (3 - 2 * e);
        p.group.position.x = lerp(p.target.x + 0.26, p.target.x, ease);
        p.group.position.y = lerp(1.38, p.target.y, ease);
        p.group.position.z = lerp(p.target.z + 0.04, p.target.z, ease);
        p.group.rotation.z = lerp(-0.55, 0.08, ease);
        if (!p.hit && k >= 0.4) {
          p.hit = true;
          if (p.glow) p.glow.intensity = 1.4;
          this.sparks.spawn(p.target.x, p.target.y + 0.02, p.target.z, 12, 0x9fd9ff, 0.9, 1.0);
          this.shake = Math.max(this.shake, 0.08);
        }
        if (k > 0.8) p.mat.opacity = 0.5 * (1 - (k - 0.8) / 0.2);
        if (k >= 1) {
          p.active = false;
          p.mat.opacity = 0.42;
          if (p.glow) p.glow.intensity = 0;
          p.group.position.copy(p.idle);
          p.group.rotation.set(0, 0, 0);
        }
      }
    }

    /* ---------------------------- 输入 ---------------------------- */

    bindInput() {
      this._onKeyDown = e => {
        if (this.locked) return;
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          this.keys[e.code] = true;
          e.preventDefault();
          return;
        }
        if (this.mode === 'forge') {
          if (e.code === 'Space') {
            e.preventDefault();
            this.cb.onForgeSwing();
          } else if (e.code === 'Escape') {
            e.preventDefault();
            this.cb.onForgeExit();
          } else if (e.code === 'KeyF') {
            e.preventDefault();
            this.cb.onTakeAnvil();
          }
          return;
        }
        if (e.code === 'KeyE' && this.focus) {
          e.preventDefault();
          this.cb.onInteract(this.focus);
        } else if (e.code === 'KeyF' && this.focus && this.focus.kind === 'anvil') {
          e.preventDefault();
          this.cb.onTakeAnvil();
        }
      };
      this._onKeyUp = e => {
        this.keys[e.code] = false;
      };
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);

      // 指针锁定：鼠标被画面捕获后直接移动环视，Esc 释放
      this._onPointerLockChange = () => {
        const locked = document.pointerLockElement === this.canvas;
        if (locked === this.mouseLocked) return;
        this.mouseLocked = locked;
        if (locked) this.drag = null;
        if (this.cb.onPointerLock) this.cb.onPointerLock(locked);
      };
      document.addEventListener('pointerlockchange', this._onPointerLockChange);

      this._onPointerLockError = () => {
        this.mouseLocked = false;
        this._lockClick = false;
        if (this.cb.onPointerLockError) this.cb.onPointerLockError();
      };
      document.addEventListener('pointerlockerror', this._onPointerLockError);

      this._onMouseMove = e => {
        if (!this.mouseLocked || this.locked || this.mode !== 'walk') return;
        this.player.yaw -= (e.movementX || 0) * 0.0024;
        this.player.pitch = clamp(this.player.pitch - (e.movementY || 0) * 0.0022, -1.08, 1.08);
      };
      document.addEventListener('mousemove', this._onMouseMove);

      this.canvas.addEventListener('pointerdown', e => {
        if (this.locked) return;
        if (this.mode === 'forge') {
          this.cb.onForgeSwing();
          return;
        }
        if (!this.mouseLocked) {
          this._lockClick = true;
          this.requestPointerLock();
        }
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          /* 某些嵌入环境不支持指针捕获，忽略即可 */
        }
      });

      this.canvas.addEventListener('pointermove', e => {
        if (this.mouseLocked) return;
        if (!this.drag || this.drag.id !== e.pointerId) return;
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        if (this.mode === 'walk') {
          this.player.yaw -= dx * 0.0032;
          this.player.pitch = clamp(this.player.pitch - dy * 0.0028, -1.08, 1.08);
        }
      });

      this.canvas.addEventListener('pointerup', e => {
        if (!this.drag) return;
        const wasClick = this.drag.moved < 7;
        const suppress = this._lockClick;
        this._lockClick = false;
        this.drag = null;
        if (wasClick && !suppress && this.mode === 'walk' && this.focus) {
          this.cb.onInteract(this.focus);
        }
      });

      this.canvas.addEventListener('pointercancel', () => {
        this.drag = null;
      });

      window.addEventListener('resize', () => this.resize());
    }

    /* ---------------------------- 尺寸 ---------------------------- */

    resize() {
      const w = Math.max(1, this.canvas.clientWidth);
      const h = Math.max(1, this.canvas.clientHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    /* ---------------------------- 对外 API ---------------------------- */

    setLang(lang) {
      this.lang = lang === 'en' ? 'en' : 'zh';
      this.drawCalendar(this.calendarDay || 1);
      this.drawTributeSign(this.tribute.quota, this.tribute.offered);
      this.drawMachineLabels();
    }

    setLocked(locked) {
      this.locked = !!locked;
      if (locked) {
        this.keys = {};
        if (this.focus) {
          this.focus = null;
          this.cb.onFocus(null);
        }
      }
    }

    requestPointerLock() {
      if (this.locked || this.mode !== 'walk') return null;
      if (document.pointerLockElement === this.canvas) return null;
      try {
        const p = this.canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            this.mouseLocked = false;
            this._lockClick = false;
            if (this.cb.onPointerLockError) this.cb.onPointerLockError();
          });
        }
        return p;
      } catch (err) {
        /* 浏览器拒绝时继续用拖拽视角 */
        return null;
      }
    }

    exitPointerLock() {
      if (document.pointerLockElement === this.canvas) {
        try { document.exitPointerLock(); } catch (err) { /* ignore */ }
      }
    }

    setAnger(anger) {
      this.anger = clamp(anger || 0, 0, 3);
      if (this.eyeSprites) {
        this.eyeSprites.forEach(s => { s.material.opacity = 0.55 + this.anger * 0.12; });
      }
      const light = 0.4 + this.anger * 0.45;
      this.eyeLightL.intensity = light;
      this.eyeLightR.intensity = light;
    }

    setFrenzySpeed(v) {
      this.frenzySpeed = clamp(Number(v) || 1, 1, 3);
    }

    // 泥沼龙：1 = 正常，数值越大挥锤越慢
    setSwingSlow(v) {
      this.swingSlow = clamp(Number(v) || 1, 1, 4);
    }

    setFrenzy(on) {
      this.frenzy = !!on;
      if (!this.frenzy) this.frenzyPulse = 0;
      if (this.anvilSword) {
        const aura = this.anvilSword.userData.aura;
        if (aura) aura.visible = !!on || this.anvilSword.userData.highTier;
      }
    }

    setMachineSwords(n) {
      const count = Math.max(0, Math.floor(Number(n) || 0));
      if (count === this.machineStored) return;
      this.machineStored = count;
      if (this.machineDepositGlow) {
        this.machineDepositGlow.material.opacity = count > 0 ? 0.38 : 0.12;
      }
      this.drawMachineLabels();
    }

    setMerchantVisible(v) {
      this.merchantVisible = !!v;
      this.ghostTarget = v ? 1 : 0;
      if (v) {
        this.ghostGroup.visible = true;
        this.ghostGroup.position.set(-2.9, 0, -2.2);
      }
    }

    setOffers(offers, refreshCost) {
      if (!this.machineCases) return;
      this.offers = offers || [];
      if (refreshCost != null) this.machineRefreshCost = refreshCost;
      this.machineCases.forEach((c, i) => {
        const offer = this.offers[i];
        const live = offer && !offer.sold;
        if (c.model) {
          this.machineGroup.remove(c.model);
          this.disposeRelicModel(c.model);
          c.model = null;
        }
        if (live) {
          const relic = CFG.relics.find(r => r.id === offer.relicId);
          if (relic) {
            c.model = this.makeRelicModel(relic.id);
            // 放到柜门外侧，避免被机身与玻璃框挡住
            c.model.position.set(c.baseX, 1.98, 0.54);
            this.machineGroup.add(c.model);
          }
        }
        c.glass.material.opacity = live ? 0.1 : 0.04;
        c.glass.material.emissiveIntensity = live ? 0.22 : 0.08;
      });
      this.drawMachineLabels();
    }

    disposeRelicModel(group) {
      group.traverse(o => {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        }
      });
    }

    makeRelicModel(relicId) {
      const g = new T.Group();
      const gold = new T.MeshStandardMaterial({
        color: 0x9a7434, emissive: 0xffc060, emissiveIntensity: 0.75,
        metalness: 0.85, roughness: 0.28
      });
      const teal = new T.MeshStandardMaterial({
        color: 0x2a5a58, emissive: 0x5cd8cc, emissiveIntensity: 0.9,
        metalness: 0.5, roughness: 0.3
      });
      const red = new T.MeshStandardMaterial({
        color: 0x4a0a05, emissive: 0xff2a12, emissiveIntensity: 1.1,
        metalness: 0.4, roughness: 0.3
      });
      const bone = new T.MeshStandardMaterial({ color: 0xd6c9a8, roughness: 0.6, metalness: 0.1 });
      const stone = new T.MeshStandardMaterial({ color: 0x6a6a68, roughness: 0.85 });
      const dark = new T.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8, metalness: 0.2 });

      const add = (geo, mat, x, y, z, sx, sy, sz, rx, ry, rz) => {
        const m = new T.Mesh(geo, mat);
        m.position.set(x || 0, y || 0, z || 0);
        if (sx != null) m.scale.set(sx, sy != null ? sy : sx, sz != null ? sz : sx);
        if (rx) m.rotation.x = rx;
        if (ry) m.rotation.y = ry;
        if (rz) m.rotation.z = rz;
        g.add(m);
        return m;
      };

      switch (relicId) {
        case 'dragonHeart':
          add(new T.OctahedronGeometry(0.09, 0), red, 0, 0, 0, 1.1, 1.25, 0.8);
          add(new T.TorusGeometry(0.115, 0.012, 6, 20), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          break;
        case 'ward':
          add(new T.BoxGeometry(0.15, 0.19, 0.035), teal, 0, 0, 0);
          add(new T.SphereGeometry(0.035, 10, 8), gold, 0, 0.02, 0.03);
          add(new T.ConeGeometry(0.07, 0.07, 5), teal, 0, -0.13, 0, 1, 1, 1, Math.PI);
          break;
        case 'luckyDice':
        case 'gambler': {
          add(new T.BoxGeometry(0.12, 0.12, 0.12), relicId === 'gambler' ? red : bone, 0, 0, 0, 1, 1, 1, 0.3, 0.5, 0);
          for (let i = 0; i < 4; i++) {
            add(new T.SphereGeometry(0.012, 6, 5), dark, -0.035 + (i % 2) * 0.07, -0.035 + Math.floor(i / 2) * 0.07, 0.062);
          }
          break;
        }
        case 'oath':
          add(new T.TorusGeometry(0.06, 0.015, 6, 14), gold, -0.035, 0, 0, 1, 1, 1, 0, 0.5);
          add(new T.TorusGeometry(0.06, 0.015, 6, 14), gold, 0.045, 0.02, 0, 1, 1, 1, 0.4, 0.2);
          add(new T.BoxGeometry(0.01, 0.02, 0.02), dark, 0.005, 0.01, 0);
          break;
        case 'apron':
          add(new T.BoxGeometry(0.14, 0.18, 0.025), dark, 0, -0.01, 0);
          add(new T.BoxGeometry(0.03, 0.1, 0.02), dark, -0.055, 0.13, 0, 1, 1, 1, 0, 0, 0.35);
          add(new T.BoxGeometry(0.03, 0.1, 0.02), dark, 0.055, 0.13, 0, 1, 1, 1, 0, 0, -0.35);
          add(new T.TorusGeometry(0.025, 0.008, 6, 10), gold, 0, -0.04, 0.02);
          break;
        case 'brokenHoly':
          add(new T.BoxGeometry(0.045, 0.22, 0.015), gold, 0.02, 0.02, 0, 1, 1, 1, 0, 0, 0.3);
          add(new T.BoxGeometry(0.045, 0.1, 0.015), gold, 0.075, -0.08, 0, 1, 1, 1, 0, 0, 0.9);
          add(new T.BoxGeometry(0.15, 0.02, 0.03), gold, 0.02, -0.1, 0, 1, 1, 1, 0, 0, 0.3);
          break;
        case 'chalice':
          add(new T.CylinderGeometry(0.08, 0.045, 0.1, 12), gold, 0, 0.05, 0);
          add(new T.CylinderGeometry(0.02, 0.02, 0.1, 8), gold, 0, -0.06, 0);
          add(new T.CylinderGeometry(0.07, 0.09, 0.02, 12), gold, 0, -0.12, 0);
          break;
        case 'taxCut':
          add(new T.CylinderGeometry(0.045, 0.045, 0.24, 10), bone, 0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2);
          add(new T.CylinderGeometry(0.05, 0.05, 0.02, 10), gold, -0.12, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2);
          add(new T.CylinderGeometry(0.05, 0.05, 0.02, 10), gold, 0.12, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2);
          break;
        case 'supply':
          add(new T.BoxGeometry(0.16, 0.12, 0.12), new T.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8 }), 0, -0.02, 0);
          add(new T.BoxGeometry(0.02, 0.22, 0.02), gold, 0.0, 0.06, 0.03, 1, 1, 1, 0, 0, 0.2);
          break;
        case 'frenzyRune':
          add(new T.BoxGeometry(0.16, 0.18, 0.03), teal, 0, 0, 0);
          add(new T.TorusGeometry(0.045, 0.008, 6, 14), gold, 0, 0, 0.02);
          add(new T.BoxGeometry(0.012, 0.12, 0.012), gold, 0, -0.02, 0.02, 1, 1, 1, 0, 0, 0.6);
          break;
        case 'swiftEmber':
          add(new T.DodecahedronGeometry(0.09, 0), red, 0, 0, 0);
          add(new T.TorusGeometry(0.11, 0.01, 5, 16), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          break;
        case 'successIdol':
          add(new T.SphereGeometry(0.045, 10, 8), gold, 0, 0.07, 0);
          add(new T.ConeGeometry(0.07, 0.15, 8), gold, 0, -0.04, 0);
          break;
        case 'holdStone':
          add(new T.DodecahedronGeometry(0.1, 0), stone, 0, 0, 0);
          break;
        case 'greatCrown':
          add(new T.TorusGeometry(0.085, 0.018, 6, 18), gold, 0, -0.02, 0, 1, 1, 1, Math.PI / 2);
          for (let i = 0; i < 3; i++) {
            add(new T.ConeGeometry(0.022, 0.07, 6), gold, -0.055 + i * 0.055, 0.06, 0);
          }
          break;
        case 'gildedAnvil':
          add(new T.BoxGeometry(0.15, 0.03, 0.07), gold, 0, 0.04, 0);
          add(new T.BoxGeometry(0.06, 0.06, 0.05), gold, 0, -0.01, 0);
          add(new T.ConeGeometry(0.035, 0.08, 8), gold, -0.1, 0.04, 0, 1, 1, 1, 0, 0, Math.PI / 2);
          break;
        case 'ghostPact':
          add(new T.SphereGeometry(0.09, 10, 8), teal, 0, 0, 0, 1, 1.1, 0.8);
          add(new T.SphereGeometry(0.04, 8, 6), dark, 0, -0.01, 0.06, 1, 1.2, 0.5);
          break;
        case 'relicEye':
          add(new T.SphereGeometry(0.09, 12, 10), bone, 0, 0, 0, 1, 1, 0.8);
          add(new T.SphereGeometry(0.04, 10, 8), teal, 0, 0, 0.055);
          add(new T.SphereGeometry(0.02, 8, 6), dark, 0, 0, 0.08);
          break;
        case 'dragonScale':
          add(new T.ConeGeometry(0.09, 0.13, 7), red, 0, 0, 0, 1, 1, 0.5, Math.PI);
          add(new T.TorusGeometry(0.1, 0.01, 5, 16), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          break;
        case 'ashenBreath':
          add(new T.ConeGeometry(0.08, 0.2, 7), new T.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0x6a6a6a, emissiveIntensity: 0.4, roughness: 0.9 }), 0, 0, 0, 1, 1, 1, 0, 0, 0.3);
          add(new T.ConeGeometry(0.05, 0.13, 7), stone, 0.06, -0.02, 0, 1, 1, 1, 0, 0, -0.4);
          break;
        case 'emberTongs':
          add(new T.BoxGeometry(0.035, 0.26, 0.025), gold, -0.035, 0, 0, 1, 1, 1, 0, 0, 0.22);
          add(new T.BoxGeometry(0.035, 0.26, 0.025), gold, 0.035, 0, 0, 1, 1, 1, 0, 0, -0.22);
          add(new T.TorusGeometry(0.025, 0.008, 6, 10), dark, 0, 0.1, 0.01);
          break;
        case 'quenchVat':
          add(new T.CylinderGeometry(0.09, 0.075, 0.17, 12), dark, 0, -0.02, 0);
          add(new T.CylinderGeometry(0.082, 0.082, 0.015, 12), teal, 0, 0.06, 0);
          add(new T.TorusGeometry(0.088, 0.012, 5, 14), gold, 0, 0.06, 0, 1, 1, 1, Math.PI / 2);
          break;
        case 'coalDevourer':
          add(new T.DodecahedronGeometry(0.095, 0), dark, 0, 0, 0);
          add(new T.SphereGeometry(0.045, 10, 8), red, 0, -0.01, 0.07, 1, 0.8, 0.6);
          break;
        case 'tributeBanner':
          add(new T.CylinderGeometry(0.012, 0.012, 0.3, 6), gold, -0.09, 0, 0);
          add(new T.BoxGeometry(0.16, 0.12, 0.012), red, 0.0, 0.06, 0);
          add(new T.ConeGeometry(0.03, 0.05, 6), gold, -0.09, 0.17, 0);
          break;
        case 'dragonTooth':
          add(new T.ConeGeometry(0.06, 0.24, 7), bone, 0, 0.02, 0, 1, 1, 0.7, 0, 0, 0.28);
          add(new T.TorusGeometry(0.075, 0.012, 5, 14), gold, 0, -0.09, 0, 1, 1, 1, Math.PI / 2);
          break;
        case 'sootLung':
          add(new T.SphereGeometry(0.085, 10, 8), dark, 0, 0.01, 0, 1, 1.1, 0.9);
          add(new T.CylinderGeometry(0.018, 0.018, 0.12, 6), stone, -0.01, 0.12, 0, 1, 1, 1, 0, 0, 0.25);
          add(new T.CylinderGeometry(0.018, 0.018, 0.12, 6), stone, 0.035, 0.1, 0, 1, 1, 1, 0, 0, -0.3);
          add(new T.SphereGeometry(0.025, 8, 6), red, 0, -0.02, 0.075);
          break;
        case 'ancestorAsh':
          add(new T.CylinderGeometry(0.07, 0.085, 0.16, 10), stone, 0, -0.03, 0);
          add(new T.CylinderGeometry(0.05, 0.06, 0.05, 10), stone, 0, 0.08, 0);
          add(new T.SphereGeometry(0.055, 10, 8), new T.MeshStandardMaterial({ color: 0x7a7a78, roughness: 1 }), 0, 0.11, 0, 1, 0.5, 1);
          break;
        case 'taxSeal':
          add(new T.BoxGeometry(0.15, 0.04, 0.15), gold, 0, -0.08, 0);
          add(new T.CylinderGeometry(0.028, 0.032, 0.14, 8), dark, 0, 0.02, 0);
          add(new T.SphereGeometry(0.045, 10, 8), gold, 0, 0.1, 0);
          add(new T.CylinderGeometry(0.03, 0.03, 0.006, 10), red, 0, -0.02, 0.06, 1, 1, 1, Math.PI / 2);
          break;
        case 'stormAnvil':
          add(new T.BoxGeometry(0.14, 0.03, 0.07), teal, 0, 0.02, 0);
          add(new T.BoxGeometry(0.055, 0.07, 0.05), teal, 0, -0.05, 0);
          add(new T.BoxGeometry(0.02, 0.09, 0.02), gold, 0.01, 0.15, 0, 1, 1, 1, 0, 0, 0.4);
          break;
        case 'graveTax':
          for (let i = 0; i < 3; i++) {
            add(new T.CylinderGeometry(0.07 - i * 0.008, 0.07 - i * 0.008, 0.02, 14), gold, 0, -0.08 + i * 0.022, 0);
          }
          add(new T.BoxGeometry(0.02, 0.2, 0.02), stone, 0.1, 0.02, 0, 1, 1, 1, 0, 0, -0.2);
          add(new T.ConeGeometry(0.045, 0.08, 6), stone, 0.12, 0.13, 0, 1, 1, 1, 0, 0, -0.2);
          break;
        case 'moltenHeart':
          add(new T.SphereGeometry(0.06, 10, 8), red, -0.035, 0.03, 0);
          add(new T.SphereGeometry(0.06, 10, 8), red, 0.035, 0.03, 0);
          add(new T.ConeGeometry(0.09, 0.14, 8), red, 0, -0.07, 0, 1, 1, 1, Math.PI);
          add(new T.TorusGeometry(0.11, 0.008, 5, 16), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          break;
        case 'forgeSpirit':
          add(new T.ConeGeometry(0.075, 0.18, 7), teal, 0, 0.02, 0, 1, 1, 1, 0, 0, 0.15);
          add(new T.ConeGeometry(0.04, 0.1, 6), gold, 0.02, -0.01, 0.01);
          add(new T.TorusGeometry(0.1, 0.01, 5, 16), gold, 0, -0.09, 0, 1, 1, 1, Math.PI / 2);
          break;
        default: {
          // 新遗物用确定性的多形状兜底，避免全部长得一样
          let seed = 0;
          const key = String(relicId || '');
          for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i);
          const v = seed % 6;
          if (v === 0) {
            add(new T.OctahedronGeometry(0.09, 0), teal, 0, 0, 0);
            add(new T.TorusGeometry(0.11, 0.01, 6, 16), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          } else if (v === 1) {
            add(new T.DodecahedronGeometry(0.095, 0), stone, 0, 0, 0);
            add(new T.TorusGeometry(0.115, 0.01, 5, 16), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          } else if (v === 2) {
            add(new T.SphereGeometry(0.09, 12, 10), teal, 0, 0, 0, 1.1, 0.9, 0.8);
            add(new T.BoxGeometry(0.18, 0.02, 0.03), gold, 0, 0, 0);
          } else if (v === 3) {
            add(new T.BoxGeometry(0.14, 0.16, 0.05), bone, 0, 0, 0, 1, 1, 1, 0, 0.3, 0.2);
            add(new T.TorusGeometry(0.1, 0.01, 5, 16), gold, 0, 0, 0, 1, 1, 1, Math.PI / 2);
          } else if (v === 4) {
            add(new T.ConeGeometry(0.085, 0.18, 7), red, 0, 0, 0);
            add(new T.TorusGeometry(0.11, 0.01, 5, 16), gold, 0, -0.05, 0, 1, 1, 1, Math.PI / 2);
          } else {
            add(new T.TorusGeometry(0.075, 0.014, 6, 16), gold, -0.03, 0, 0, 1, 1, 1, 0, 0.5);
            add(new T.TorusGeometry(0.075, 0.014, 6, 16), teal, 0.03, 0, 0, 1, 1, 1, 0.4, 0.2);
          }
          break;
        }
      }
      g.scale.setScalar(1.15);
      return g;
    }

    drawMachineLabels() {
      const S = CFG.strings[this.lang] || CFG.strings.zh;

      if (this.machineLabelCanvas) {
        const g = this.machineLabelCanvas.getContext('2d');
        g.fillStyle = '#0c1111';
        g.fillRect(0, 0, 512, 128);
        g.strokeStyle = 'rgba(121,199,196,0.5)';
        g.lineWidth = 4;
        g.strokeRect(8, 8, 496, 112);
        g.fillStyle = '#b7e6e2';
        g.font = 'bold 46px "Microsoft YaHei", Georgia, serif';
        g.textAlign = 'center';
        g.fillText(S.machineLabel || '遗物售货机', 256, 78);
        this.machineLabelTex.needsUpdate = true;
      }

      this.machineCases.forEach((c, i) => {
        const g = c.labelCanvas.getContext('2d');
        const offer = this.offers && this.offers[i];
        const relic = offer ? CFG.relics.find(r => r.id === offer.relicId) : null;
        g.fillStyle = '#081211';
        g.fillRect(0, 0, 256, 72);
        g.strokeStyle = 'rgba(121,199,196,0.35)';
        g.lineWidth = 3;
        g.strokeRect(4, 4, 248, 64);
        g.textAlign = 'center';
        g.fillStyle = offer && offer.sold ? '#6b7a78' : '#b7e6e2';
        g.font = 'bold 20px "Microsoft YaHei", sans-serif';
        const name = !offer ? (S.machineEmpty || '今日货架已空') : offer.sold ? (S.promptSold || '已售出') : (relic ? relic[this.lang] : '—');
        g.fillText(name, 128, 34, 232);
        if (offer && !offer.sold) {
          const cost = Math.max(1, Math.floor(Number(relic && relic.swordCost) || 1));
          g.fillStyle = '#7fb8b3';
          g.font = '16px "Microsoft YaHei", sans-serif';
          g.fillText((S.machineCost || '{n} 把剑').replace('{n}', cost), 128, 58);
        }
        c.labelTex.needsUpdate = true;
      });

      if (this.machineDepositCanvas) {
        const g = this.machineDepositCanvas.getContext('2d');
        g.fillStyle = '#081211';
        g.fillRect(0, 0, 256, 64);
        g.strokeStyle = this.machineStored > 0 ? 'rgba(121,199,196,0.65)' : 'rgba(121,199,196,0.25)';
        g.lineWidth = 3;
        g.strokeRect(4, 4, 248, 56);
        g.fillStyle = this.machineStored > 0 ? '#9fe3dc' : '#6b8b88';
        g.font = 'bold 20px "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        g.fillText((S.machineDepositLabel || '存剑 {n}').replace('{n}', this.machineStored), 128, 42);
        this.machineDepositTex.needsUpdate = true;
      }

      if (this.refreshLabelCanvas) {
        const g = this.refreshLabelCanvas.getContext('2d');
        g.fillStyle = '#081211';
        g.fillRect(0, 0, 256, 72);
        g.strokeStyle = 'rgba(121,199,196,0.35)';
        g.lineWidth = 3;
        g.strokeRect(4, 4, 248, 64);
        g.fillStyle = '#b7e6e2';
        g.font = 'bold 20px "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        g.fillText((S.machineRefresh || '刷新') + '  ' + this.machineRefreshCost + ' G', 128, 44);
        this.refreshLabelTex.needsUpdate = true;
      }

      if (this.banLabelCanvas) {
        const g = this.banLabelCanvas.getContext('2d');
        g.fillStyle = '#0d0812';
        g.fillRect(0, 0, 256, 72);
        g.strokeStyle = 'rgba(154,92,255,0.5)';
        g.lineWidth = 3;
        g.strokeRect(4, 4, 248, 64);
        g.fillStyle = '#c9aaff';
        g.font = 'bold 19px "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        g.fillText(S.machineBanLabel || '封禁 1 剑', 128, 45);
        this.banLabelTex.needsUpdate = true;
      }
    }

    makeMerchantIcon(itemId) {
      const g = new T.Group();
      const teal = new T.MeshStandardMaterial({
        color: 0x2a5a58,
        emissive: 0x5cc7d4,
        emissiveIntensity: 1.1,
        roughness: 0.4,
        metalness: 0.4
      });
      const gold = new T.MeshStandardMaterial({
        color: 0x6a4a20,
        emissive: 0xffb050,
        emissiveIntensity: 0.7,
        roughness: 0.4,
        metalness: 0.5
      });
      const brass = new T.MeshStandardMaterial({
        color: 0x8a6a38,
        metalness: 0.85,
        roughness: 0.32
      });
      const dark = new T.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8, metalness: 0.2 });
      if (itemId === 'incense') {
        const stick = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.36, 6), this.mat.grip);
        stick.position.y = 0;
        g.add(stick);
        const tip = new T.Mesh(new T.SphereGeometry(0.03, 8, 6), gold);
        tip.position.y = 0.2;
        g.add(tip);
        const base = new T.Mesh(new T.CylinderGeometry(0.06, 0.07, 0.03, 10), this.mat.stone);
        base.position.y = -0.19;
        g.add(base);
      } else if (itemId === 'spare') {
        const blade = new T.Mesh(new T.BoxGeometry(0.04, 0.38, 0.012), teal);
        blade.position.y = 0.05;
        g.add(blade);
        const guard = new T.Mesh(new T.BoxGeometry(0.16, 0.025, 0.03), gold);
        guard.position.y = -0.15;
        g.add(guard);
        const grip = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.16, 6), this.mat.grip);
        grip.position.y = -0.24;
        g.add(grip);
      } else if (itemId === 'wardCharm') {
        const ring = new T.Mesh(new T.TorusGeometry(0.1, 0.016, 6, 18), teal);
        g.add(ring);
        const gem = new T.Mesh(new T.OctahedronGeometry(0.055, 0), gold);
        g.add(gem);
      } else if (itemId === 'coinPouch') {
        const bag = new T.Mesh(new T.SphereGeometry(0.11, 10, 8), this.mat.grip);
        bag.scale.set(1, 1.15, 0.85);
        bag.position.y = -0.03;
        g.add(bag);
        const neck = new T.Mesh(new T.CylinderGeometry(0.032, 0.05, 0.07, 8), this.mat.grip);
        neck.position.y = 0.11;
        g.add(neck);
        const coin = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.016, 14), gold);
        coin.rotation.x = Math.PI / 2;
        coin.position.set(0.09, 0.04, 0.06);
        g.add(coin);
        const tie = new T.Mesh(new T.TorusGeometry(0.042, 0.01, 6, 12), gold);
        tie.rotation.x = Math.PI / 2;
        tie.position.y = 0.075;
        g.add(tie);
      } else if (itemId === 'whetstone') {
        const block = new T.Mesh(new T.BoxGeometry(0.26, 0.075, 0.11), this.mat.stone);
        block.position.y = -0.03;
        g.add(block);
        const top = new T.Mesh(new T.BoxGeometry(0.24, 0.02, 0.09), teal);
        top.position.y = 0.018;
        g.add(top);
        const chip = new T.Mesh(new T.BoxGeometry(0.1, 0.09, 0.1), gold);
        chip.position.set(-0.1, 0.09, 0.02);
        chip.rotation.z = 0.4;
        g.add(chip);
      } else if (itemId === 'oil') {
        const bottle = new T.Mesh(new T.CylinderGeometry(0.075, 0.085, 0.2, 10), teal);
        bottle.position.y = -0.04;
        g.add(bottle);
        const neck = new T.Mesh(new T.CylinderGeometry(0.028, 0.05, 0.09, 8), teal);
        neck.position.y = 0.1;
        g.add(neck);
        const cork = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.045, 8), this.mat.grip);
        cork.position.y = 0.16;
        g.add(cork);
        const band = new T.Mesh(new T.TorusGeometry(0.078, 0.01, 6, 14), gold);
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.02;
        g.add(band);
      } else if (itemId === 'charm') {
        const paper = new T.Mesh(new T.BoxGeometry(0.11, 0.24, 0.012), new T.MeshStandardMaterial({
          color: 0xd8cfae,
          emissive: 0x6a5a30,
          emissiveIntensity: 0.5,
          roughness: 0.8
        }));
        g.add(paper);
        const seal = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.014, 12), gold);
        seal.rotation.x = Math.PI / 2;
        seal.position.set(0, 0.055, 0.014);
        g.add(seal);
        const cord = new T.Mesh(new T.TorusGeometry(0.045, 0.008, 6, 14), teal);
        cord.rotation.x = Math.PI / 2;
        cord.position.y = 0.14;
        g.add(cord);
      } else if (itemId === 'crackedScale') {
        const shard = new T.Mesh(new T.ConeGeometry(0.1, 0.22, 5), new T.MeshStandardMaterial({
          color: 0x4a1410,
          emissive: 0xff3a20,
          emissiveIntensity: 0.7,
          roughness: 0.45,
          metalness: 0.5
        }));
        shard.rotation.z = 0.35;
        g.add(shard);
        const crack = new T.Mesh(new T.BoxGeometry(0.012, 0.16, 0.012), gold);
        crack.position.set(0.02, 0.01, 0.055);
        crack.rotation.z = -0.3;
        g.add(crack);
      } else if (itemId === 'regretClockwork') {
        const ring = new T.Mesh(new T.TorusGeometry(0.1, 0.022, 6, 18), brass);
        g.add(ring);
        for (let i = 0; i < 6; i++) {
          const tooth = new T.Mesh(new T.BoxGeometry(0.028, 0.04, 0.03), brass);
          const a = (i / 6) * Math.PI * 2;
          tooth.position.set(Math.cos(a) * 0.115, Math.sin(a) * 0.115, 0);
          tooth.rotation.z = a;
          g.add(tooth);
        }
        const hand = new T.Mesh(new T.BoxGeometry(0.012, 0.075, 0.012), dark);
        hand.position.set(0, 0.035, 0.03);
        g.add(hand);
      } else if (itemId === 'redChalk') {
        const stick = new T.Mesh(new T.CylinderGeometry(0.026, 0.032, 0.24, 8), new T.MeshStandardMaterial({
          color: 0x8a2a22, emissive: 0xff4a3a, emissiveIntensity: 0.25, roughness: 0.9
        }));
        stick.rotation.z = 0.3;
        g.add(stick);
        const tip = new T.Mesh(new T.ConeGeometry(0.026, 0.05, 8), new T.MeshStandardMaterial({ color: 0xd85a4a, roughness: 0.9 }));
        tip.position.set(-0.036, 0.14, 0);
        tip.rotation.z = 0.3;
        g.add(tip);
      } else if (itemId === 'powderBag') {
        const bag = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), new T.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 }));
        bag.scale.set(1, 1.1, 0.9);
        bag.position.y = -0.03;
        g.add(bag);
        const cord = new T.Mesh(new T.TorusGeometry(0.04, 0.008, 5, 10), gold);
        cord.rotation.x = Math.PI / 2;
        cord.position.y = 0.07;
        g.add(cord);
        const puff = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), new T.MeshStandardMaterial({
          color: 0xd8c8a8, transparent: true, opacity: 0.7, roughness: 1
        }));
        puff.position.set(0.06, 0.12, 0.02);
        g.add(puff);
      } else if (itemId === 'coldStar') {
        const star = new T.Mesh(new T.OctahedronGeometry(0.1, 0), teal);
        g.add(star);
        const ring = new T.Mesh(new T.TorusGeometry(0.115, 0.01, 5, 16), gold);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
      } else if (itemId === 'ghostDelivery') {
        const paper = new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.24, 8), new T.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.9 }));
        paper.rotation.z = Math.PI / 2;
        g.add(paper);
        const ribbon = new T.Mesh(new T.TorusGeometry(0.032, 0.008, 5, 10), teal);
        ribbon.rotation.y = Math.PI / 2;
        ribbon.position.x = 0.05;
        g.add(ribbon);
        const seal = new T.Mesh(new T.SphereGeometry(0.028, 8, 6), gold);
        seal.position.x = -0.09;
        g.add(seal);
      } else {
        const orb = new T.Mesh(new T.IcosahedronGeometry(0.1, 0), teal);
        g.add(orb);
      }
      g.scale.setScalar(1.15);
      return g;
    }

    setMerchantStock(stock) {
      this.merchantStock = stock || [];
      this.merchantItems.forEach((item, i) => {
        const entry = this.merchantStock[i];
        const live = entry && !entry.sold;
        const id = live ? entry.itemId : null;
        const qty = live ? Math.max(1, Math.min(9, Math.floor(Number(entry.qty) || 1))) : 0;
        const key = id ? `${id}:${qty}` : '';
        if (item.shownKey === key) {
          if (item.mesh) item.mesh.visible = !!id;
          if (this.merchantHitboxes && this.merchantHitboxes[i]) this.merchantHitboxes[i].userData.active = !!id;
          return;
        }
        if (item.mesh) {
          item.group.remove(item.mesh);
          item.mesh.traverse(o => {
            if (o.isMesh && o.geometry) o.geometry.dispose();
          });
          item.mesh = null;
        }
        if (item.countSprite) {
          item.group.remove(item.countSprite);
          item.countSprite = null;
        }
        item.shownKey = key;
        item.shownId = id;
        if (id) {
          const mesh = this.makeMerchantIcon(id);
          item.group.add(mesh);
          item.mesh = mesh;
          mesh.visible = true;
          if (qty > 1) {
            const sprite = new T.Sprite(new T.SpriteMaterial({
              map: this.merchantQtyTexture(qty),
              color: 0xbff4ff,
              transparent: true,
              depthWrite: false,
              blending: T.AdditiveBlending
            }));
            sprite.scale.set(0.22, 0.11, 1);
            sprite.position.set(0.1, -0.2, 0.12);
            item.group.add(sprite);
            item.countSprite = sprite;
          }
        }
        if (this.merchantHitboxes && this.merchantHitboxes[i]) {
          this.merchantHitboxes[i].userData.active = !!id;
        }
      });
    }

    merchantQtyTexture(n) {
      if (!this._qtyTex) this._qtyTex = {};
      if (this._qtyTex[n]) return this._qtyTex[n];
      const c = makeCanvas(128, 64);
      const g = c.getContext('2d');
      g.clearRect(0, 0, 128, 64);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = 'rgba(140, 240, 255, 0.9)';
      g.shadowBlur = 12;
      g.fillStyle = 'rgba(225, 255, 255, 0.95)';
      g.font = 'bold 46px "Microsoft YaHei", sans-serif';
      g.fillText('×' + n, 64, 34);
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      this._qtyTex[n] = tex;
      return tex;
    }

    setHeldSword(data) {
      const sig = data
        ? `${data.id}:${data.level}:${data.form}:${data.variant}:${data.heated ? 1 : 0}:${data.cracks}`
        : '';
      if (sig === this.heldSig && this.heldGroup) {
        this.heldGroup.visible = this.heldVisible && !!data;
        if (data) this.applyHeldHeat(data);
        return;
      }
      this.heldSig = sig;

      if (this.heldGroup) {
        this.camera.remove(this.heldGroup);
        if (this.heldGroup.userData.bladeMat) this.heldGroup.userData.bladeMat.dispose();
        this.heldGroup = null;
      }
      if (!data) return;

      const g = this.makeSword(data.level, {
        form: data.form,
        variant: data.variant,
        cracks: data.cracks
      });
      g.scale.setScalar(0.42);
      g.position.set(0.5, -0.52, -0.85);
      g.rotation.set(0.12, 0.28, 2.15);
      g.traverse(o => {
        if (o.isMesh) o.castShadow = false;
      });

      // 一只粗糙的皮手套
      const hand = new T.Group();
      const leather = new T.MeshStandardMaterial({ color: 0x24160f, roughness: 0.9 });
      const palm = new T.Mesh(new T.BoxGeometry(0.075, 0.11, 0.09), leather);
      palm.position.set(-0.19, -0.01, 0);
      hand.add(palm);
      const forearm = new T.Mesh(new T.CylinderGeometry(0.05, 0.065, 0.3, 8), leather);
      forearm.rotation.z = 0.9;
      forearm.position.set(-0.31, -0.16, 0);
      hand.add(forearm);
      g.add(hand);

      this.camera.add(g);
      this.heldGroup = g;
      this.heldVisible = true;
      g.visible = true;
      this.applyHeldHeat(data);
    }

    applyHeldHeat(data) {
      if (!this.heldGroup) return;
      const mat = this.heldGroup.userData.bladeMat;
      if (!mat) return;
      const tier = this.tierForLevel(data.level);
      if (data.heated) {
        mat.emissive.setHex(0xff5a12);
        mat.emissiveIntensity = 0.45;
      } else {
        mat.emissive.setHex(tier.emissive);
        mat.emissiveIntensity = tier.glow ? 0.4 : 0;
      }
      const aura = this.heldGroup.userData.aura;
      if (aura) aura.visible = data.level >= 20;
    }

    hideHeld(hidden) {
      this.heldVisible = !hidden;
      if (this.heldGroup) this.heldGroup.visible = !hidden;
    }

    setTribute(quota, offered, met) {
      this.tribute.quota = quota;
      this.tribute.offered = offered;
      this.drawTributeSign(quota, offered, met);
    }

    updateCalendar(day) {
      if (day === this.calendarDay) return;
      this.calendarDay = day;
      this.drawCalendar(day);
    }

    teleportTo(id) {
      const st = this.stations.find(s => s.id === id);
      if (!st) return;
      if (this.mode === 'forge') this.exitForge(false);
      this.mode = 'walk';
      this.locked = false;
      this.camTween = null;
      this.player.pos.set(st.approach[0], 0, st.approach[1]);
      this.player.yaw = st.yaw;
      this.player.pitch = st.pitch;
      this.player.bob = 0;
      this.updateCamera(0);
      this.updateFocus();
    }

    enterForge(sword) {
      this.mode = 'forge';
      // 锻造面板要用鼠标点按钮/道具，所以这里释放指针锁定；退出时会自动恢复
      this.exitPointerLock();
      this.locked = false;
      this.hammer.visible = false;
      this.hammer.position.copy(this.hammerRestPos);
      this.hammer.rotation.z = this.hammerRest;
      this.drag = null;
      this.player.pos.set(0, 0, 1.7);
      this.player.yaw = 0;
      this.player.pitch = -0.1;
      const toPos = this.forgeCameraPos();
      const toLook = new T.Vector3(0, 1.3, 0.18);
      this.startTween(toPos, toLook, 0.65);
      if (sword) this.setAnvilSword(sword);
    }

    exitForge(tween) {
      this.mode = 'walk';
      this.locked = false;
      this.hammer.visible = false;
      this.frenzy = false;
      this.anvilLight.intensity = 0;
      if (tween === false) {
        this.camTween = null;
        this.player.pos.set(0, 0, 1.7);
        this.player.yaw = 0;
        this.player.pitch = -0.18;
        this.updateCamera(0);
        return;
      }
      const toPos = new T.Vector3(this.player.pos.x, 1.65, this.player.pos.z);
      const dir = this.lookPoint(this.player.yaw, this.player.pitch, 5);
      this.startTween(toPos, dir, 0.55);
    }

    heatSword(swordData, onDone) {
      this.hideHeld(true);
      this.heating = {
        t: 0,
        dur: 1.55,
        onDone,
        sword: this.makeSword(swordData.level, {
          form: swordData.form,
          variant: swordData.variant,
          heat: 0.15
        })
      };
      const g = this.heating.sword;
      g.position.set(-4.05, 1.06, 0.42);
      g.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
      g.scale.setScalar(0.72);
      this.scene.add(g);
      this.tempSword = g;
      this.hammer.visible = false;
    }

    swing(onImpact, onDone) {
      if (this.mode !== 'forge' || this.hammerSwing) return false;
      const dur = (this.frenzy ? 0.34 / (this.frenzySpeed || 1) : 0.54) * (this.swingSlow || 1);
      this.hammerSwing = { t: 0, dur, fired: false, onImpact, onDone };
      this.hammer.visible = true;
      this.hammer.position.copy(this.hammerRestPos);
      this.hammer.rotation.z = this.hammerRest;
      // 幽灵锤同时补一记，落点在剑身上随机
      if (this.phantomEnabled) this.phantomStrike();
      return true;
    }

    isSwinging() {
      return !!this.hammerSwing;
    }

    playOutcome(type) {
      const pos = { x: 0.25, y: 1.11, z: 0.2 };
      const colors = {
        success: 0x9fe6a8,
        great: 0xd6b8ff,
        hold: 0xc9b05c,
        damage: 0xff8a45,
        break: 0xff5a35
      };
      const col = colors[type] || 0xffd08a;
      const count = type === 'great' ? 34 : type === 'break' ? 26 : 16;
      this.sparks.spawn(pos.x, pos.y, pos.z, count, col, type === 'great' ? 1.5 : 1, 1);
      this.flashLight.color.setHex(col);
      this.flashLight.intensity = type === 'great' ? 2.4 : 1.2;
      this.shake = Math.max(this.shake, type === 'great' ? 0.3 : 0.16);
      // 入神时每一锤都给一次短促震动脉冲
      if (this.frenzy) this.frenzyPulse = 1;

      if (type === 'great') {
        this.sparks.spawn(pos.x, pos.y + 0.1, pos.z, 20, 0xffe0a0, 2, 1.2);
      } else if (type === 'break') {
        this.breakAnvilSword();
      } else if (type === 'damage') {
        this.sparks.spawn(pos.x, pos.y, pos.z, 12, 0x8a4a22, 0.6, 1.4);
      }
    }

    spawnWave(color, life) {
      const w = this.waves.find(x => x.life <= 0) || this.waves[0];
      w.life = life;
      w.max = life;
      w.mesh.material.color.setHex(color);
      w.mesh.material.opacity = 0.7;
      w.mesh.scale.setScalar(0.3);
      w.mesh.visible = true;
    }

    ringBell() {
      this.bellSwing = 0.8;
      this.bellGroup.rotation.z = 0;
    }

    roar() {
      this.dragonRoar = 1.4;
      this.shake = 0.5;
      this.flashLight.color.setHex(0xff3a1a);
      this.flashLight.intensity = 3.2;
      this.sparks.spawn(0, 1.4, -3.4, 20, 0xff4a22, 1.2, 2);
      this.dragonSmoke.spawn(0, 1.9, -3.7, 10, 0x3a2a22, 0.5, 2.2);
    }

    showStart() {
      this.mode = 'walk';
      this.player.pos.set(0, 0, 3.35);
      this.player.yaw = 0;
      this.player.pitch = -0.06;
      this.camTween = null;
      this.hammer.visible = false;
      this.updateCamera(0);
    }

    /* ---------------------------- 锻造剑模型 ---------------------------- */

    tierForLevel(level) {
      let out = CFG.tiers[0];
      for (const t of CFG.tiers) if (level >= t.min) out = t;
      return out;
    }

    bladeGeometry(form) {
      if (!this._bladeGeos) this._bladeGeos = {};
      if (this._bladeGeos[form]) return this._bladeGeos[form];

      const s = new T.Shape();
      let len = 1.02;

      if (form === 'greatsword') {
        len = 1.12;
        s.moveTo(0, -0.06);
        s.lineTo(0.86, -0.052);
        s.lineTo(1.12, 0);
        s.lineTo(0.86, 0.052);
        s.lineTo(0, 0.06);
        s.closePath();
      } else if (form === 'scimitar') {
        len = 1.04;
        s.moveTo(0, -0.036);
        s.quadraticCurveTo(0.55, -0.05, 0.94, -0.105);
        s.lineTo(1.04, 0.012);
        s.quadraticCurveTo(0.55, 0.055, 0, 0.036);
        s.closePath();
      } else if (form === 'rapier') {
        len = 1.08;
        s.moveTo(0, -0.018);
        s.lineTo(0.96, -0.014);
        s.lineTo(1.08, 0);
        s.lineTo(0.96, 0.014);
        s.lineTo(0, 0.018);
        s.closePath();
      } else if (form === 'cleaver') {
        len = 0.96;
        s.moveTo(0, -0.052);
        s.lineTo(0.9, -0.052);
        s.lineTo(0.96, 0.03);
        s.lineTo(0.9, 0.105);
        s.lineTo(0, 0.09);
        s.closePath();
      } else if (form === 'broken') {
        len = 0.92;
        s.moveTo(0, -0.042);
        s.lineTo(0.3, -0.04);
        s.lineTo(0.34, -0.02);
        s.lineTo(0.4, -0.048);
        s.lineTo(0.46, -0.018);
        s.lineTo(0.9, -0.028);
        s.lineTo(0.92, 0.02);
        s.lineTo(0.78, 0.022);
        s.lineTo(0.75, 0.045);
        s.lineTo(0.52, 0.036);
        s.lineTo(0.47, 0.014);
        s.lineTo(0.42, 0.042);
        s.lineTo(0.35, 0.022);
        s.lineTo(0, 0.04);
        s.closePath();
      } else if (form === 'bonesaw') {
        len = 1.0;
        s.moveTo(0, -0.04);
        s.lineTo(0.97, -0.032);
        s.lineTo(1.0, 0);
        s.lineTo(0.9, 0.045);
        for (let i = 0; i < 5; i++) {
          const x = 0.9 - i * 0.15;
          s.lineTo(x, 0.02);
          s.lineTo(x - 0.06, 0.075);
        }
        s.lineTo(0, 0.04);
        s.closePath();
      } else if (form === 'fang') {
        len = 0.84;
        s.moveTo(0, -0.055);
        s.quadraticCurveTo(0.42, -0.075, 0.7, -0.02);
        s.lineTo(0.84, 0.015);
        s.quadraticCurveTo(0.44, 0.105, 0, 0.06);
        s.closePath();
      } else if (form === 'executioner') {
        len = 1.02;
        s.moveTo(0, -0.06);
        s.lineTo(0.82, -0.06);
        s.quadraticCurveTo(1.02, 0.02, 0.84, 0.105);
        s.lineTo(0, 0.095);
        s.closePath();
      } else if (form === 'tombstone') {
        len = 0.94;
        s.moveTo(0, -0.075);
        s.lineTo(0.72, -0.075);
        s.quadraticCurveTo(0.94, -0.07, 0.92, 0.02);
        s.quadraticCurveTo(0.9, 0.075, 0.68, 0.088);
        s.lineTo(0, 0.088);
        s.closePath();
      } else if (form === 'flamberge') {
        len = 1.06;
        s.moveTo(0, -0.045);
        for (let i = 0; i < 4; i++) {
          const x = 0.14 + i * 0.2;
          s.quadraticCurveTo(x, -0.085, x + 0.1, -0.045);
        }
        s.lineTo(1.06, 0);
        for (let i = 3; i >= 0; i--) {
          const x = 0.14 + i * 0.2;
          s.quadraticCurveTo(x + 0.1, 0.075, x + 0.02, 0.04);
        }
        s.lineTo(0, 0.04);
        s.closePath();
      } else {
        len = 1.02;
        s.moveTo(0, -0.042);
        s.lineTo(0.85, -0.039);
        s.lineTo(1.02, 0);
        s.lineTo(0.85, 0.039);
        s.lineTo(0, 0.042);
        s.closePath();
      }

      const geo = new T.ExtrudeGeometry(s, {
        depth: 0.022,
        bevelEnabled: true,
        bevelThickness: 0.006,
        bevelSize: 0.008,
        bevelSegments: 2,
        steps: 1
      });
      geo.translate(0, 0, -0.011);
      this._bladeGeos[form] = { geo, len };
      return this._bladeGeos[form];
    }

    buildHilt(form, level, variant) {
      const g = new T.Group();
      const v = variant || 0;
      const bone = form === 'bonesaw' || form === 'fang';
      const stone = form === 'tombstone';
      const gm = bone ? this.mat.bone : stone ? this.mat.stone : this.mat.guard;

      let guardScale = 1;
      let gripLen = 0.24;
      if (form === 'greatsword') { guardScale = 1.3; gripLen = 0.28; }
      if (form === 'rapier') { guardScale = 0.7; gripLen = 0.2; }
      if (form === 'cleaver' || form === 'executioner') guardScale = 1.15;
      if (form === 'flamberge') { guardScale = 1.25; gripLen = 0.3; }
      if (form === 'fang') { guardScale = 0.75; gripLen = 0.17; }

      const guard = new T.Mesh(this.geo.guard, gm);
      guard.position.x = 0.12;
      guard.scale.setScalar(guardScale);
      guard.castShadow = true;
      g.add(guard);

      if (form === 'rapier') {
        const ring = new T.Mesh(new T.TorusGeometry(0.105, 0.012, 6, 20), gm);
        ring.position.set(0.13, 0, 0);
        g.add(ring);
        const bow = new T.Mesh(new T.TorusGeometry(0.13, 0.008, 5, 18, Math.PI), gm);
        bow.position.set(0.02, 0, 0);
        bow.rotation.z = Math.PI / 2;
        g.add(bow);
      } else if (form === 'scimitar' || form === 'flamberge') {
        for (const s of [-1, 1]) {
          const wing = new T.Mesh(new T.BoxGeometry(0.045, 0.18, 0.08), gm);
          wing.position.set(0.12, s * 0.14, 0);
          wing.rotation.z = s * 0.42;
          g.add(wing);
        }
      } else if (form === 'broken') {
        const gap = new T.Mesh(new T.BoxGeometry(0.015, 0.07, 0.02), this.mat.crack);
        gap.position.set(0.12, 0.03, 0.03);
        g.add(gap);
      } else if (form === 'bonesaw') {
        for (const y of [-0.13, 0, 0.13]) {
          const knuckle = new T.Mesh(new T.SphereGeometry(0.038, 8, 6), this.mat.bone);
          knuckle.position.set(0.12, y, 0);
          g.add(knuckle);
        }
      } else if (form === 'tentacle') {
        const shell = new T.Mesh(new T.TorusGeometry(0.14, 0.035, 7, 18), this.mat.guard);
        shell.position.set(0.12, 0, 0);
        g.add(shell);
      } else {
        for (const s of [-1, 1]) {
          const ball = new T.Mesh(this.geo.guardBall, gm);
          ball.position.set(0.12, s * 0.15 * guardScale, 0);
          g.add(ball);
        }
      }

      const grip = new T.Mesh(this.geo.grip, this.mat.grip);
      grip.rotation.z = Math.PI / 2;
      grip.scale.y = gripLen / 0.24;
      grip.position.x = -0.02;
      g.add(grip);
      if (form === 'flamberge' || form === 'greatsword') {
        for (let i = 0; i < 3; i++) {
          const ring = new T.Mesh(new T.TorusGeometry(0.036, 0.007, 5, 10), this.mat.guard);
          ring.rotation.y = Math.PI / 2;
          ring.position.set(-0.08 + i * 0.055, 0, 0);
          g.add(ring);
        }
      }

      if (form === 'executioner') {
        const ring = new T.Mesh(new T.TorusGeometry(0.06, 0.017, 7, 16), gm);
        ring.position.x = -0.2;
        g.add(ring);
      } else if (form === 'tombstone') {
        const cube = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.09), this.mat.stone);
        cube.position.x = -0.19;
        cube.rotation.z = 0.3;
        g.add(cube);
      } else if (form === 'tentacle') {
        const shell = new T.Mesh(new T.SphereGeometry(0.07, 10, 8), this.mat.bone);
        shell.position.x = -0.19;
        g.add(shell);
      } else {
        const pommel = new T.Mesh(this.geo.pommel, gm);
        pommel.position.x = -0.19;
        g.add(pommel);
      }

      if (level >= 12) {
        const gem = new T.Mesh(this.geo.gem, this.mat.gem.clone());
        const colors = [0x8a5cff, 0x5cc7d4, 0xffb050];
        gem.material.emissive.setHex(level >= 20 ? (v % 2 ? 0x5cc7d4 : 0xb98cff) : colors[v % 3]);
        gem.material.emissiveIntensity = 1.2;
        gem.position.set(0.12, 0, 0.05);
        g.add(gem);
      }
      return g;
    }

    makeSword(level, opts) {
      const o = opts || {};
      const tier = this.tierForLevel(level);
      const form = o.form || 'longsword';
      const variant = o.variant || 0;
      const group = new T.Group();

      const bladeMat = new T.MeshStandardMaterial({
        color: tier.color,
        metalness: tier.metalness,
        roughness: tier.roughness,
        emissive: tier.emissive,
        emissiveIntensity: tier.glow ? 0.5 : 0,
        envMapIntensity: 1.35
      });

      let bladeLen = 1.02;
      if (form === 'tentacle') {
        bladeLen = 1.06;
        const segs = [
          [0.24, 0.05, 0.045, 0.28],
          [0.47, 0.045, 0.036, 0.27],
          [0.69, 0.036, 0.026, 0.26],
          [0.88, 0.026, 0.014, 0.22]
        ];
        segs.forEach((s, i) => {
          const seg = new T.Mesh(new T.CylinderGeometry(s[1], s[2], s[3], 8), bladeMat);
          seg.rotation.z = Math.PI / 2;
          seg.position.set(s[0], Math.sin(i * 1.1) * 0.018, 0);
          seg.castShadow = true;
          group.add(seg);
        });
        const tip = new T.Mesh(new T.ConeGeometry(0.025, 0.16, 7), bladeMat);
        tip.rotation.z = -Math.PI / 2;
        tip.position.set(1.03, 0.015, 0);
        group.add(tip);
        for (let i = 0; i < 5; i++) {
          const cup = new T.Mesh(new T.SphereGeometry(0.022, 6, 6), this.mat.bone);
          cup.position.set(0.32 + i * 0.14, -0.038, 0.01);
          group.add(cup);
        }
      } else {
        const data = this.bladeGeometry(form);
        bladeLen = data.len;
        const blade = new T.Mesh(data.geo, bladeMat);
        blade.position.x = 0.14;
        blade.castShadow = true;
        group.add(blade);

        if (['longsword', 'greatsword', 'executioner', 'tombstone'].includes(form)) {
          const fuller = new T.Mesh(
            new T.BoxGeometry(0.58, 0.012, 0.026),
            new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
          );
          fuller.position.set(0.52, 0, 0);
          group.add(fuller);
        }
      }

      group.add(this.buildHilt(form, level, variant));

      if (level >= 16) {
        const rune = new T.Mesh(this.geo.rune, this.mat.rune.clone());
        rune.position.set(0.62, 0, 0.017);
        group.add(rune);
        const rune2 = new T.Mesh(this.geo.rune, this.mat.rune.clone());
        rune2.position.set(0.62, 0, -0.017);
        group.add(rune2);
      }

      const cracks = o.cracks || 0;
      if (cracks > 0) {
        const pts = [
          [0.32, 0.012],
          [0.32 + bladeLen * 0.22, -0.008],
          [0.32 + bladeLen * 0.4, 0.01],
          [0.32 + bladeLen * 0.55, -0.004]
        ];
        for (let i = 0; i < Math.min(cracks, 4); i++) {
          const crack = new T.Mesh(this.geo.crack, this.mat.crack);
          crack.position.set(pts[i][0], pts[i][1], 0.012);
          crack.rotation.z = rand(-0.6, 0.6);
          group.add(crack);
          const crack2 = crack.clone();
          crack2.position.z = -0.012;
          group.add(crack2);
        }
      }

      const aura = new T.Sprite(new T.SpriteMaterial({
        map: this.auraTex,
        color: level >= 30 ? 0xc9a6ff : 0xffb26b,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: T.AdditiveBlending
      }));
      aura.scale.set(1.8, 0.7, 1);
      aura.position.set(0.55, 0, 0);
      aura.visible = level >= 20;
      group.add(aura);

      group.userData = {
        bladeMat,
        aura,
        highTier: level >= 20,
        level,
        cracks,
        form,
        variant,
        bladeLen,
        tierColor: tier.color
      };
      return group;
    }

    /* ---------------------------- 图鉴预览 ---------------------------- */

    renderCatalog() {
      if (this.catalogCache) return this.catalogCache;

      const size = 240;
      const renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(1);
      renderer.setSize(size, size);
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.setClearAlpha(0);

      const scene = new T.Scene();
      const cam = new T.PerspectiveCamera(34, 1, 0.05, 40);
      cam.position.set(0, 0, 3.4);
      cam.lookAt(0, 0, 0);
      scene.add(new T.HemisphereLight(0xb9d2ea, 0x2a1c12, 1.6));
      const key = new T.DirectionalLight(0xfff3dc, 2.4);
      key.position.set(2.6, 3.6, 3.2);
      scene.add(key);
      const fill = new T.DirectionalLight(0x8fc4ff, 1.1);
      fill.position.set(-3.2, -1.2, 2.2);
      scene.add(fill);
      const rim = new T.DirectionalLight(0xffab5e, 1.3);
      rim.position.set(-1.2, 2.4, -3.4);
      scene.add(rim);

      const shoot = (group, camZ) => {
        cam.position.z = camZ;
        cam.lookAt(0, 0, 0);
        scene.add(group);
        renderer.render(scene, cam);
        const url = renderer.domElement.toDataURL('image/png');
        scene.remove(group);
        return url;
      };

      const out = { swords: {}, relics: {}, items: {} };

      (CFG.swordFormInfo || []).forEach((info, i) => {
        const holder = new T.Group();
        const g = this.makeSword(18, { form: info.id, variant: i % 3 });
        g.position.x = -0.52;
        holder.add(g);
        holder.rotation.set(0.16, 0.24, -0.52);
        holder.scale.setScalar(1.08);
        out.swords[info.id] = shoot(holder, 3.3);
      });

      (CFG.relics || []).forEach(relic => {
        const holder = new T.Group();
        const m = this.makeRelicModel(relic.id);
        m.scale.setScalar(3.1);
        m.rotation.set(0.2, 0.5, 0.05);
        holder.add(m);
        out.relics[relic.id] = shoot(holder, 2.15);
      });

      (CFG.merchantItems || []).forEach(item => {
        const holder = new T.Group();
        const m = this.makeMerchantIcon(item.id);
        m.scale.setScalar(2.6);
        m.rotation.set(0.12, 0.4, 0);
        holder.add(m);
        out.items[item.id] = shoot(holder, 2.3);
      });

      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();

      this.catalogCache = out;
      return out;
    }

    setAnvilSword(data) {
      if (this.anvilSword) {
        this.scene.remove(this.anvilSword);
        if (this.anvilSword.userData.bladeMat) this.anvilSword.userData.bladeMat.dispose();
        this.anvilSword = null;
      }
      if (!data) {
        if (this.anvilLight) this.anvilLight.intensity = 0;
        return;
      }
      const g = this.makeSword(data.level, {
        form: data.form,
        variant: data.variant,
        cracks: data.cracks,
        heat: data.heated ? 0.5 : 0
      });
      g.position.set(-0.48, 1.085, 0.2);
      g.rotation.set(-Math.PI / 2, 0, 0.015);
      this.scene.add(g);
      this.anvilSword = g;
      this.applySwordHeat();
    }

    applySwordHeat() {
      if (!this.anvilSword) return;
      const mat = this.anvilSword.userData.bladeMat;
      if (!mat) return;
      if (this.frenzy) {
        const hue = (this.time * 0.55) % 1;
        mat.color.setHSL(hue, 0.9, 0.6);
        mat.emissive.setHSL(hue, 0.9, 0.5);
        mat.emissiveIntensity = 2.2;
        this.anvilLight.color.setHSL(hue, 0.85, 0.55);
        this.anvilLight.intensity = 1.8;
      } else {
        const heat = this.mode === 'forge' ? 0.55 + Math.sin(this.time * 2.6) * 0.08 : 0.25;
        mat.color.setHex(this.anvilSword.userData.tierColor || 0x8b8576);
        mat.emissive.setHex(0xff5a12);
        mat.emissiveIntensity = heat;
        this.anvilLight.color.setHex(0xff7a20);
        this.anvilLight.intensity = this.mode === 'forge' ? 0.75 : 0.3;
      }
      const aura = this.anvilSword.userData.aura;
      if (aura) {
        aura.visible = this.frenzy || this.anvilSword.userData.highTier;
        if (this.frenzy) {
          aura.material.color.setHSL((this.time * 0.55) % 1, 0.85, 0.6);
          aura.material.opacity = 0.9;
          aura.scale.set(2.2, 0.9, 1);
        } else {
          aura.material.color.setHex(this.anvilSword.userData.level >= 30 ? 0xc9a6ff : 0xffb26b);
          aura.material.opacity = 0.5;
          aura.scale.set(1.8, 0.7, 1);
        }
      }
    }

    breakAnvilSword() {
      if (!this.anvilSword) return;
      const g = this.anvilSword;
      const mat = g.userData.bladeMat;
      const basePos = new T.Vector3(0.0, 1.12, 0.2);
      this.fragments.forEach((f, i) => {
        const m = f.mesh;
        m.visible = true;
        if (m.material && m.material !== this.mat.shard) m.material.dispose();
        m.material = mat.clone();
        m.position.set(basePos.x + rand(-0.2, 0.5), basePos.y + rand(-0.03, 0.04), basePos.z + rand(-0.05, 0.05));
        m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        m.scale.set(rand(0.5, 1.2), rand(0.6, 1.3), 1);
        f.vel.set(rand(-1.6, 1.6), rand(0.5, 2.6), rand(-1.2, 1.2));
        f.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
        f.life = rand(1.2, 2.2);
      });
      this.scene.remove(g);
      if (mat) mat.dispose();
      this.anvilSword = null;
      this.anvilLight.intensity = 0;
    }

    /* ---------------------------- 同步 ---------------------------- */

    sync(state) {
      this.state = state;
      if (state.lang && state.lang !== this.lang) this.setLang(state.lang);
      this.setAnger(state.anger);
      this.setMerchantVisible(state.merchant);
      this.setOffers(state.offers, state.refreshCost);
      this.setMerchantStock(state.merchantStock || []);
      this.setMachineSwords(state.machineSwords || 0);
      this.setElfEnabled(!!state.elfOn);
      this.setElfCarry(state.elfCarry || 1);
      this.setPhantomHammer(Number(state.phantomHammer) || (state.phantomHammer ? 1 : 0));
      this.updateCalendar(state.day);
      this.setTribute(state.quota, state.offered, state.offeredMet);

      const rack = state.swords.filter(s =>
        s.location === 'rack' && Number.isInteger(s.rackSlot) && s.rackSlot >= 0 && s.rackSlot < 36
      );
      const counterSwords = (state.counterIds || [])
        .map(id => state.swords.find(s => s.id === id))
        .filter(s => s && Number.isInteger(s.counterSlot) && s.counterSlot >= 0 && s.counterSlot < 5);

      const rackSig = rack.map(s => `${s.id}:${s.rackSlot}:${s.level}:${s.form}:${s.variant}:${s.cracks}:${s.heated ? 1 : 0}`).join('|');
      const counterSig = counterSwords.map(s => `${s.id}:${s.counterSlot}:${s.level}:${s.form}:${s.variant}:${s.cracks}:${s.heated ? 1 : 0}`).join('|');
      // 剑架 / 贡台都放不下的剑 → 落地
      const floorSwords = state.swords.filter(s =>
        s.location === 'rack' && (!Number.isInteger(s.rackSlot) || s.rackSlot < 0 || s.rackSlot >= 36)
      );

      // 剑架武器墙
      if (rackSig !== this.rackSig) {
        this.rackSig = rackSig;
        this.rackGroups.forEach(g => {
          this.scene.remove(g);
          if (g.userData.bladeMat) g.userData.bladeMat.dispose();
        });
        this.rackGroups = [];
        this.rackHitboxes = [];
        rack.forEach((s, i) => {
          const slot = this.rackSlots[s.rackSlot];
          if (!slot) return;
          const outer = new T.Group();
          outer.position.set(4.62, slot.y + 0.12, slot.z);
          outer.rotation.y = -Math.PI / 2;
          outer.rotation.z = -0.06;
          const sword = this.makeSword(s.level, {
            form: s.form,
            variant: s.variant,
            cracks: s.cracks
          });
          sword.rotation.z = Math.PI / 2;
          sword.scale.setScalar(0.58);
          outer.add(sword);
          outer.userData.bladeMat = sword.userData.bladeMat;
          this.scene.add(outer);
          this.rackGroups.push(outer);
          if (s.heated) {
            sword.userData.bladeMat.emissive.setHex(0xff5a12);
            sword.userData.bladeMat.emissiveIntensity = 0.3;
          }
          this.rackHitboxes.push(this.addSwordHit(sword, { kind: 'sword', id: s.id, source: 'rack' }));
        });
      }

      // 贡台
      if (counterSig !== this.counterSig) {
        this.counterSig = counterSig;
        this.counterGroups.forEach(g => {
          this.scene.remove(g);
          if (g.userData.bladeMat) g.userData.bladeMat.dispose();
        });
        this.counterGroups = [];
        this.counterHitboxes = [];
        counterSwords.forEach((s, i) => {
          const slot = s.counterSlot;
          const g = this.makeSword(s.level, {
            form: s.form,
            variant: s.variant,
            cracks: s.cracks
          });
          g.position.set(-0.86 + slot * 0.44, 1.075 + slot * 0.012, -2.9);
          g.rotation.set(-Math.PI / 2, 0, 0.02 * (slot - 2));
          g.scale.setScalar(0.62);
          this.scene.add(g);
          this.counterGroups.push(g);
          if (s.heated) {
            g.userData.bladeMat.emissive.setHex(0xff5a12);
            g.userData.bladeMat.emissiveIntensity = 0.25;
          }
          this.counterHitboxes.push(this.addSwordHit(g, { kind: 'sword', id: s.id, source: 'counter' }));
        });
      }

      // 铁砧
      const anvilData = state.swords.find(s => s.id === state.anvilId);
      this.anvilFocus.hasSword = !!anvilData;
      if (anvilData) {
        this.setAnvilSword(anvilData);
      } else {
        this.setAnvilSword(null);
      }

      // 手持
      const held = state.swords.find(s => s.location === 'hand');
      this.setHeldSword(held || null);

      // 溢出到地面的剑
      this.syncFloorSwords(floorSwords);

      this.hitboxes = this.staticHitboxes.concat(
        this.rackHitboxes || [],
        this.counterHitboxes || [],
        this.floorHitboxes || []
      );
    }

    /* ---------------------- 剑架溢出：落地剑 ---------------------- */

    // 地面落点网格：在房间可用地面内平铺，排满一层再叠层，永不掉到墙外
    dropAnchor(index) {
      const xMin = -4.1, xMax = 3.95, dx = 0.62;
      const zMin = -2.1, zMax = 3.9, dz = 0.72;
      const cols = Math.floor((xMax - xMin) / dx) + 1;
      const rows = Math.floor((zMax - zMin) / dz) + 1;
      const perLayer = cols * rows;
      const i = index % perLayer;
      const layer = Math.floor(index / perLayer);
      const col = Math.floor(i / rows);
      const row = i % rows;
      return {
        x: clamp(xMax - col * dx - (layer % 3) * 0.05, xMin, xMax),
        z: clamp(zMin + row * dz + (layer % 2) * 0.04, zMin, zMax)
      };
    }

    syncFloorSwords(list) {
      const sig = list.map(s => `${s.id}:${s.level}:${s.form}:${s.variant}:${s.cracks}:${s.heated ? 1 : 0}`).join('|');
      if (sig === this.floorSig) return;
      this.floorSig = sig;

      const alive = new Set(list.map(s => s.id));
      for (const [id, d] of Array.from(this.dropSwords)) {
        if (alive.has(id)) continue;
        this.scene.remove(d.group);
        if (d.group.userData.bladeMat) d.group.userData.bladeMat.dispose();
        this.dropSwords.delete(id);
      }

      const sorted = list.slice().sort((a, b) => a.id - b.id);
      this.floorHitboxes = [];
      sorted.forEach((s, i) => {
        let d = this.dropSwords.get(s.id);
        if (!d) {
          d = this.createDropSword(s, i);
          this.dropSwords.set(s.id, d);
        }
        const mat = d.group.userData.bladeMat;
        if (mat) {
          if (s.heated) {
            mat.emissive.setHex(0xff5a12);
            mat.emissiveIntensity = 0.3;
          } else if (mat.emissive) {
            mat.emissiveIntensity = 0;
          }
        }
        this.floorHitboxes.push(d.hit);
      });
    }

    // 从架子高度抛下：先自由落体 + 弹跳，落定后归位到网格点并压平躺地
    createDropSword(s, index) {
      const target = this.dropAnchor(index);
      const group = new T.Group();
      const sword = this.makeSword(s.level, { form: s.form, variant: s.variant, cracks: s.cracks });
      sword.scale.setScalar(0.62);
      group.add(sword);

      const startX = 4.34;
      const startY = 2.05 + rand(0, 0.75);
      const fall = Math.max(0.25, Math.sqrt(2 * (startY - 0.05) / 16));
      group.position.set(startX, startY, clamp(target.z + rand(-0.16, 0.16), -4.35, 4.35));
      group.rotation.set(0, rand(0, TAU), rand(-0.45, 0.45));
      group.userData.bladeMat = sword.userData.bladeMat;
      this.scene.add(group);

      const hit = this.addSwordHit(group, { kind: 'sword', id: s.id, source: 'floor' });
      return {
        id: s.id,
        info: { level: s.level, form: s.form, variant: s.variant, cracks: s.cracks },
        group,
        hit,
        target,
        jitterX: rand(-0.1, 0.1),
        jitterZ: rand(-0.1, 0.1),
        vel: new T.Vector3((target.x - startX) / fall, 0, 0),
        spin: new T.Vector3(rand(-2.2, 2.2), 0, rand(-3, 3)),
        bounce: 0,
        rest: false,
        restRotZ: 0
      };
    }

    updateDrops(dt) {
      if (!this.dropSwords.size) return;
      const restY = 0.05;
      for (const d of this.dropSwords.values()) {
        const g = d.group;
        if (d.rest) {
          // 落定后缓慢滑回格位，姿态压平贴地
          const k = Math.min(1, dt * 3.2);
          const tx = clamp(d.target.x + d.jitterX, -4.5, 4.45);
          const tz = clamp(d.target.z + d.jitterZ, -4.35, 4.35);
          g.position.x += (tx - g.position.x) * k;
          g.position.z += (tz - g.position.z) * k;
          g.rotation.x += (0 - g.rotation.x) * Math.min(1, dt * 6);
          g.rotation.z += (d.restRotZ - g.rotation.z) * Math.min(1, dt * 6);
          continue;
        }
        d.vel.y -= 16 * dt;
        g.position.x += d.vel.x * dt;
        g.position.z += d.vel.z * dt;
        g.position.y += d.vel.y * dt;
        // 超出房间就贴边，避免弹出墙外
        g.position.x = clamp(g.position.x, -4.5, 4.45);
        g.position.z = clamp(g.position.z, -4.35, 4.35);
        g.rotation.x += d.spin.x * dt;
        g.rotation.z += d.spin.z * dt;
        if (g.position.y <= restY) {
          g.position.y = restY;
          if (Math.abs(d.vel.y) > 1.1 && d.bounce < 2) {
            // 反弹一次，水平速度与翻滚一起衰减
            d.vel.y = -d.vel.y * 0.3;
            d.vel.x *= 0.5;
            d.vel.z *= 0.5;
            d.spin.x *= 0.35;
            d.spin.z *= 0.35;
            d.bounce += 1;
          } else {
            d.rest = true;
            d.vel.set(0, 0, 0);
            d.restRotZ = g.rotation.z > 0 ? Math.PI : 0;
          }
        }
      }
    }

    addSwordHit(parent, focus) {
      const mesh = new T.Mesh(new T.BoxGeometry(1.35, 0.34, 0.16), this.mat.hit);
      mesh.position.set(0.55, 0, 0);
      mesh.userData.focus = focus;
      mesh.userData.active = true;
      parent.add(mesh);
      return mesh;
    }

    /* ---------------------------- 日历 / 铭牌 ---------------------------- */

    drawCalendar(day) {
      if (!this.calendarCanvas) return;
      const g = this.calendarCanvas.getContext('2d');
      const w = 512;
      const h = 384;
      const S = CFG.strings[this.lang] || CFG.strings.zh;

      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#d8c5a0');
      bg.addColorStop(1, '#a98e65');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);

      g.strokeStyle = 'rgba(40,24,10,0.25)';
      g.lineWidth = 8;
      g.strokeRect(4, 4, w - 8, h - 8);

      g.fillStyle = '#3a2a18';
      g.font = 'bold 42px Georgia, serif';
      g.textAlign = 'center';
      const title = day + 14 > 30
        ? (this.lang === 'zh' ? S.monthMay : S.monthMayEn)
        : (this.lang === 'zh' ? S.monthApril : S.monthAprilEn);
      g.fillText(title, w / 2, 52);

      g.font = 'bold 16px "Microsoft YaHei", sans-serif';
      g.fillStyle = 'rgba(58,42,24,0.65)';
      g.fillText(S.calendarTitle + ' · ' + S.calendarNote, w / 2, 76);

      // 四月 1-30
      const cols = 7;
      const startX = 42;
      const startY = 108;
      const cellW = 60;
      const cellH = 42;
      const currentAbs = 15 + (day - 1);
      const isMay = currentAbs > 30;
      const current = isMay ? currentAbs - 30 : currentAbs;

      g.font = 'bold 17px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      const dayLabels = this.lang === 'zh'
        ? ['一', '二', '三', '四', '五', '六', '日']
        : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      g.fillStyle = 'rgba(58,42,24,0.5)';
      dayLabels.forEach((d, i) => g.fillText(d, startX + i * cellW + cellW / 2, startY - 12));

      for (let d = 1; d <= 30; d++) {
        const idx = d - 1;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = startX + col * cellW;
        const y = startY + row * cellH;
        const contract = d >= 15;
        g.fillStyle = contract ? 'rgba(45,30,15,0.85)' : 'rgba(45,30,15,0.32)';
        g.fillText(String(d), x + cellW / 2, y + 20);
        if (contract && (isMay || d < currentAbs)) {
          g.strokeStyle = 'rgba(140,28,18,0.8)';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x + 12, y + 4);
          g.lineTo(x + cellW - 12, y + 34);
          g.moveTo(x + cellW - 12, y + 4);
          g.lineTo(x + 12, y + 34);
          g.stroke();
        }
        if (contract && (d % 3 === 0)) {
          g.fillStyle = 'rgba(40,80,130,0.55)';
          g.font = '13px Georgia, serif';
          g.fillText('☩', x + cellW / 2, y + 38);
          g.font = 'bold 17px "Microsoft YaHei", sans-serif';
        }
      }

      // 五月 1-5
      g.font = 'bold 15px Georgia, serif';
      g.fillStyle = 'rgba(58,42,24,0.75)';
      g.textAlign = 'left';
      g.fillText(this.lang === 'zh' ? '五月' : 'MAY', startX, 348);
      g.textAlign = 'center';
      g.font = 'bold 17px "Microsoft YaHei", sans-serif';
      for (let d = 1; d <= 5; d++) {
        const x = startX + 62 + (d - 1) * 52;
        g.fillStyle = 'rgba(45,30,15,0.85)';
        g.fillText(String(d), x, 348);
        if (isMay && d < current) {
          g.strokeStyle = 'rgba(140,28,18,0.8)';
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(x - 12, 331);
          g.lineTo(x + 12, 351);
          g.moveTo(x + 12, 331);
          g.lineTo(x - 12, 351);
          g.stroke();
        }
      }

      // 今日红圈
      if (isMay) {
        const x = startX + 62 + (current - 1) * 52;
        g.strokeStyle = 'rgba(150,30,18,0.9)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(x, 342, 16, 0, TAU);
        g.stroke();
      } else if (current >= 15) {
        const idx = current - 1;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = startX + col * cellW + cellW / 2;
        const y = startY + row * cellH + 14;
        g.strokeStyle = 'rgba(150,30,18,0.9)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(x, y, 17, 0, TAU);
        g.stroke();
      }

      noiseOverlay(g, w, h, 8);
      this.calendarTex.needsUpdate = true;
    }

    drawTributeSign(quota, offered, met) {
      if (!this.tributeCanvas) return;
      const g = this.tributeCanvas.getContext('2d');
      const w = 512;
      const h = 256;
      const S = CFG.strings[this.lang] || CFG.strings.zh;
      // offered 可能是已经格式化好的字符串（数值极大时）
      const qText = typeof quota === 'string' ? quota : this.fmt(quota);
      const oText = typeof offered === 'string' ? offered : this.fmt(offered);
      const isMet = met != null ? !!met : (typeof offered === 'number' && offered >= quota);

      g.fillStyle = '#0c0a09';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(214,173,103,0.35)';
      g.lineWidth = 4;
      g.strokeRect(8, 8, w - 16, h - 16);

      g.textAlign = 'left';
      g.fillStyle = '#8d7a60';
      g.font = 'bold 18px "Microsoft YaHei", sans-serif';
      g.fillText(S.tributeDue, 28, 58);
      g.fillStyle = '#f1dcb1';
      g.font = 'bold 42px "Bahnschrift", "Microsoft YaHei", sans-serif';
      g.fillText(qText, 26, 106);

      g.fillStyle = '#8d7a60';
      g.font = 'bold 18px "Microsoft YaHei", sans-serif';
      g.fillText(S.offered, 28, 158);
      g.fillStyle = isMet ? '#8fd19a' : '#d0a15c';
      g.font = 'bold 38px "Bahnschrift", "Microsoft YaHei", sans-serif';
      g.fillText(oText, 26, 204);

      g.textAlign = 'right';
      g.fillStyle = '#5e4a36';
      g.font = '16px Georgia, serif';
      g.fillText('G', w - 28, 204);
      g.fillText(S.dayShort + ' ' + (this.state ? this.state.day : 1), w - 28, 58);

      this.tributeTex.needsUpdate = true;
    }

    fmt(n) {
      return CFG.fmtNumber(n, this.lang);
    }

    /* ---------------------------- 相机 / 移动 ---------------------------- */

    lookPoint(yaw, pitch, dist) {
      const cp = Math.cos(pitch);
      return new T.Vector3(
        this.player.pos.x - Math.sin(yaw) * cp * dist,
        1.65 + Math.sin(pitch) * dist,
        this.player.pos.z - Math.cos(yaw) * cp * dist
      );
    }

    forgeCameraPos() {
      // 竖屏时自动后退，保证整把剑都在画面内
      const aspect = Math.max(0.42, this.camera.aspect || 1);
      const dist = clamp(1.9 / (1.4 * aspect), 1.35, 3.1);
      return new T.Vector3(0, 1.62, 0.2 + dist);
    }

    startTween(toPos, toLook, dur) {
      const fromLook = new T.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(4).add(this.camera.position);
      this.camTween = {
        t: 0,
        dur,
        fromPos: this.camera.position.clone(),
        toPos: toPos.clone(),
        fromLook,
        toLook: toLook.clone()
      };
    }

    updateMovement(dt) {
      if (this.mode !== 'walk' || this.locked) return;
      const speed = B.moveSpeed || 2.35;
      let fx = this.moveInput ? this.moveInput.x : 0;
      let fz = this.moveInput ? this.moveInput.z : 0;
      if (this.keys.KeyW || this.keys.ArrowUp) fz += 1;
      if (this.keys.KeyS || this.keys.ArrowDown) fz -= 1;
      if (this.keys.KeyA || this.keys.ArrowLeft) fx -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) fx += 1;
      if (Math.hypot(fx, fz) < 0.08) {
        this.player.bob *= 0.9;
        return;
      }
      const len = Math.max(1, Math.hypot(fx, fz));
      fx /= len;
      fz /= len;
      const sin = Math.sin(this.player.yaw);
      const cos = Math.cos(this.player.yaw);
      const dx = (fx * cos - fz * sin) * speed * dt;
      const dz = (fx * -sin - fz * cos) * speed * dt;
      const nx = clamp(this.player.pos.x + dx, -4.6, 4.6);
      const nz = clamp(this.player.pos.z + dz, -3.7, 3.9);
      if (!this.blocked(nx, this.player.pos.z)) this.player.pos.x = nx;
      if (!this.blocked(this.player.pos.x, nz)) this.player.pos.z = nz;
      this.player.bob += dt * 8.5;
    }

    blocked(x, z) {
      if (Math.hypot(x - 0, z - 0.2) < 0.95) return true;
      if (x < -3.25 && z > -1.1 && z < 1.7) return true;
      if (x > 3.55 && z > -1.7 && z < 3.9) return true;
      if (x > 3.15 && z < -1.1 && z > -3.2) return true;
      if (z < -2.25 && Math.abs(x) < 2.25) return true;
      return false;
    }

    updateFocus() {
      if (this.mode !== 'walk' || this.locked) {
        if (this.focus) {
          this.focus = null;
          this.focusKey = '';
          this.cb.onFocus(null);
        }
        return;
      }

      this.camera.updateMatrixWorld();
      this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
      const list = this.hitboxes.filter(h => h.userData.active !== false);
      const hits = this.raycaster.intersectObjects(list, false);
      let next = null;
      for (const h of hits) {
        if (h.distance > 3.2) continue;
        if (h.object.userData.focus) { next = h.object.userData.focus; break; }
      }
      const key = next
        ? `${next.kind}:${next.id != null ? next.id : next.index != null ? next.index : ''}:${next.source || ''}`
        : '';
      if (key !== this.focusKey) {
        this.focusKey = key;
        this.focus = next;
        this.cb.onFocus(next);
      }
    }

    updateCamera(dt) {
      if (this.camTween) {
        const tw = this.camTween;
        tw.t += dt;
        const p = clamp(tw.t / tw.dur, 0, 1);
        const e = easeInOut(p);
        this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
        const look = new T.Vector3().lerpVectors(tw.fromLook, tw.toLook, e);
        this.camera.lookAt(look);
        if (p >= 1) this.camTween = null;
        return;
      }

      if (this.mode === 'forge') {
        this.camera.position.copy(this.forgeCameraPos());
        // 视线抬高：把铁砧和剑压到面板下方的可视区
        this.camera.lookAt(0, 1.3, 0.2);
      } else if (this.mode === 'walk') {
        const bobY = Math.sin(this.player.bob) * 0.018;
        this.camera.position.set(this.player.pos.x, 1.65 + bobY, this.player.pos.z);
        this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
      }

      if (this.shake > 0) {
        const amp = this.shake * 0.045;
        this.camera.position.x += rand(-amp, amp);
        this.camera.position.y += rand(-amp, amp);
        this.camera.position.z += rand(-amp, amp) * 0.5;
      }

      // 入神：持续的低幅震动 + 每锤一次的短促脉冲
      if (this.frenzy) {
        const pulse = this.frenzyPulse || 0;
        const amp = (this.mode === 'forge' ? 0.014 : 0.006) + pulse * 0.022;
        const t = this.time;
        const sx = Math.sin(t * 37) * 0.65 + Math.sin(t * 61 + 1.7) * 0.35;
        const sy = Math.cos(t * 43) * 0.65 + Math.sin(t * 71 + 0.6) * 0.35;
        const sz = Math.sin(t * 53 + 2.1) * 0.5;
        this.camera.position.x += sx * amp;
        this.camera.position.y += sy * amp * 0.72;
        this.camera.position.z += sz * amp * 0.45;
        this.camera.rotation.z += Math.sin(t * 29) * amp * 0.16;
      }
    }

    /* ---------------------------- 逐帧更新 ---------------------------- */

    updateHammer(dt) {
      if (!this.hammerSwing) return;
      const s = this.hammerSwing;
      s.t += dt;
      const p = clamp(s.t / s.dur, 0, 1);
      let e;
      if (p < 0.32) {
        e = easeInOut(p / 0.32);
      } else if (p < 0.5) {
        e = 1;
      } else {
        e = 1 - easeInOut((p - 0.5) / 0.5);
      }
      this.hammer.position.lerpVectors(this.hammerRestPos, this.hammerHitPos, e);
      this.hammer.rotation.z = lerp(this.hammerRest, this.hammerHit, e);

      if (!s.fired && p >= 0.32) {
        s.fired = true;
        this.shake = Math.max(this.shake, 0.2);
        if (s.onImpact) s.onImpact();
      }
      if (p >= 1) {
        const done = s.onDone;
        this.hammerSwing = null;
        this.hammer.position.copy(this.hammerRestPos);
        this.hammer.rotation.z = this.hammerRest;
        this.hammer.visible = false;
        if (done) done();
      }
    }

    updateHeating(dt) {
      if (!this.heating) return;
      const h = this.heating;
      h.t += dt;
      const p = clamp(h.t / h.dur, 0, 1);
      if (h.sword) {
        const mat = h.sword.userData.bladeMat;
        if (mat) {
          mat.emissive.setHex(0xff5a12);
          mat.emissiveIntensity = 0.3 + p * 1.6;
        }
      }
      this.forgeLight.intensity = 1.3 + Math.sin(this.time * 12) * 0.14 + p * 0.5;
      this.sparks.spawn(-4.1 + rand(-0.2, 0.2), 1.0, 0.4 + rand(-0.35, 0.35), 1, 0xff7a24, 0.7, 1);
      if (p >= 1) {
        if (this.tempSword) {
          this.scene.remove(this.tempSword);
          if (this.tempSword.userData.bladeMat) this.tempSword.userData.bladeMat.dispose();
          this.tempSword = null;
        }
        const done = h.onDone;
        this.heating = null;
        this.forgeLight.intensity = 1.3;
        this.hideHeld(false);
        if (done) done();
      }
    }

    updateDragon(dt) {
      if (!this.dragon) return;
      const t = this.time;
      this.dragon.position.y = 1.55 + Math.sin(t * 0.7) * 0.025;
      this.dragon.rotation.y = Math.sin(t * 0.3) * 0.04;
      const pulse = 2.6 + Math.sin(t * 2.2) * 0.5 + this.anger * 0.7;
      if (this.eyeSprites) {
        const glow = 0.5 + Math.sin(t * 2.2) * 0.1 + this.anger * 0.1;
        this.eyeSprites.forEach(s => { s.material.opacity = glow; });
      }
      this.eyeLightL.intensity = 0.4 + pulse * 0.32;
      this.eyeLightR.intensity = 0.4 + pulse * 0.32;
      if (this.dragonMawLight) {
        this.dragonMawLight.intensity = 0.32 + Math.sin(t * 3.1) * 0.08 + this.anger * 0.14;
      }

      if (this.dragonRoar > 0) {
        this.dragonRoar = Math.max(0, this.dragonRoar - dt);
        const p = this.dragonRoar / 1.4;
        this.dragonJaw.rotation.x = Math.sin((1 - p) * 14) * 0.2 * p + 0.25 * p;
        this.dragon.position.z = -4.95 + Math.sin(this.time * 30) * 0.02 * p;
      } else {
        this.dragonJaw.rotation.x *= 0.9;
        this.dragon.position.z += (-4.95 - this.dragon.position.z) * 0.1;
      }

      if (Math.random() < dt * 8) {
        this.dragonSmoke.spawn(rand(-0.15, 0.15), 1.72, -3.7, 1, 0x2a2522, 0.35, 0.6);
      }
      this.dragonSmoke.update(dt);
    }

    updateGhost(dt) {
      if (!this.ghostGroup) return;
      const target = this.merchantVisible ? 1 : 0;
      this.ghostOpacity += (target - this.ghostOpacity) * Math.min(1, dt * 3.5);
      if (this.ghostOpacity < 0.01) {
        this.ghostGroup.visible = false;
        this.ghostLight.intensity = 0;
        return;
      }
      this.ghostGroup.visible = true;
      const o = this.ghostOpacity;
      if (this.ghostBody) {
        this.ghostBody.position.y = Math.sin(this.time * 1.4) * 0.05;
        this.ghostBody.rotation.y = Math.sin(this.time * 0.4) * 0.12;
      }
      this.ghostMats.forEach(m => {
        m.opacity = o * (m === this.ghostMats[0] ? 0.4 : 0.26);
      });
      if (this.ghostRuneMat) {
        this.ghostRuneMat.opacity = o * 0.7;
        this.ghostRune.rotation.z += dt * 0.16;
        this.ghostRune.scale.setScalar(1 + Math.sin(this.time * 1.1) * 0.03);
      }
      if (this.ghostFogMat) this.ghostFogMat.opacity = o * 0.09;
      if (this.ghostFog) this.ghostFog.rotation.y += dt * 0.22;
      if (this.ghostSignMat) this.ghostSignMat.opacity = o * 0.95;
      if (this.ghostEyeMats) {
        this.ghostEyeMats.forEach((m, i) => {
          m.opacity = o * (0.62 + Math.sin(this.time * 3 + i * 1.6) * 0.22);
        });
      }
      this.ghostLight.intensity = o * 1.7;
      this.merchantItems.forEach((it, i) => {
        if (!it.mesh) return;
        it.mesh.rotation.y += dt * (0.6 + i * 0.12);
        it.mesh.rotation.x += dt * 0.2;
        it.mesh.position.y = Math.sin(this.time * 1.2 + it.phase) * 0.035;
      });
    }

    setMoveInput(x, z) {
      this.moveInput = { x: clamp(x || 0, -1, 1), z: clamp(z || 0, -1, 1) };
    }

    updateMachine(dt) {
      if (!this.machineCases) return;
      this.machineCases.forEach((c, i) => {
        if (!c.model) return;
        c.model.rotation.y += dt * (0.5 + i * 0.15);
        c.model.rotation.x += dt * 0.15;
        c.model.position.y = 1.98 + Math.sin(this.time * 1.4 + i) * 0.025;
      });
      const p = 0.5 + Math.sin(this.time * 2) * 0.2;
      this.relicLight.intensity = 0.7 + p * 0.2;
    }

    updateWaves(dt) {
      this.waves.forEach(w => {
        if (w.life <= 0) return;
        w.life -= dt;
        if (w.life <= 0) {
          w.mesh.visible = false;
          return;
        }
        const p = 1 - w.life / w.max;
        w.mesh.scale.setScalar(0.3 + p * 2.2);
        w.mesh.material.opacity = (1 - p) * 0.7;
      });
    }

    updateFragments(dt) {
      this.fragments.forEach(f => {
        if (f.life <= 0) return;
        f.life -= dt;
        if (f.life <= 0) {
          f.mesh.visible = false;
          return;
        }
        f.vel.y -= 9.8 * dt;
        f.mesh.position.addScaledVector(f.vel, dt);
        f.mesh.rotation.x += f.spin.x * dt;
        f.mesh.rotation.y += f.spin.y * dt;
        f.mesh.rotation.z += f.spin.z * dt;
        if (f.mesh.position.y < 0.04) {
          f.mesh.position.y = 0.04;
          f.vel.y *= -0.3;
          f.vel.x *= 0.7;
          f.vel.z *= 0.7;
          f.spin.multiplyScalar(0.7);
        }
      });
    }

    updateForge(dt) {
      const flicker = 0.85 + Math.sin(this.time * 9.3) * 0.08 + Math.sin(this.time * 3.1) * 0.06;
      this.forgeLight.intensity = (this.heating ? 1.35 : 0.9) * flicker;
      this.forgeGlow.intensity = 0.22 * flicker;
      if (this.forgeMouthGlow) {
        this.forgeMouthGlow.material.opacity = (this.heating ? 0.7 : 0.5) * flicker;
        const gs = 1 + Math.sin(this.time * 5.2) * 0.04;
        this.forgeMouthGlow.scale.set(1.9 * gs, 1.35 * gs, 1);
      }
      this.forgeCoals.forEach((c, i) => {
        const p = 0.5 + Math.sin(this.time * 3 + i * 1.7) * 0.2;
        c.material.emissiveIntensity = p;
      });
      this.flames.forEach((f, i) => {
        const p = 0.7 + Math.sin(this.time * 4 + i * 2.1) * 0.3;
        f.material.opacity = 0.04 + p * 0.06;
        f.scale.y = 0.7 + p * 0.3;
        f.position.y = 0.66 + p * 0.06;
      });
      if (Math.random() < dt * 20) {
        this.embers.spawn(-4.05 + rand(-0.25, 0.25), 1.0, 0.4 + rand(-0.4, 0.4), 1, 0xff8a3a, 0.35, 0.8);
      }
    }

    updateBell(dt) {
      if (this.bellSwing > 0) {
        this.bellSwing = Math.max(0, this.bellSwing - dt);
        const p = this.bellSwing / 0.8;
        this.bellGroup.rotation.z = Math.sin(this.time * 40) * 0.2 * p;
      } else {
        this.bellGroup.rotation.z *= 0.9;
      }
    }

    // 旌旗轻微摆动 + 月光柱里持续飘尘
    updateAmbience(dt) {
      if (this.banners) {
        for (const b of this.banners) {
          const sway = Math.sin(this.time * 0.9 + b.phase) * 0.03;
          b.cloth.rotation.x = -0.04 + sway;
          b.cloth.rotation.y = Math.sin(this.time * 0.6 + b.phase * 2) * 0.04;
        }
      }
      if (this.chandelier) {
        this.chandelier.rotation.y = Math.sin(this.time * 0.4) * 0.05;
      }
      if (this.moonShaft) {
        this.moonShaft.material.opacity = 0.03 + Math.sin(this.time * 0.7) * 0.009;
      }
      // 光柱中的浮尘
      if (Math.random() < dt * 6) {
        this.dust.spawn(rand(-1.6, -0.1), rand(0.4, 2.8), rand(0.8, 3.6), 1, 0x8aa0c0, 0.05, 1.2);
      }
      // 全屋缓慢浮尘
      if (Math.random() < dt * 3) {
        this.dust.spawn(rand(-4, 4), rand(0.5, 3.2), rand(-4, 4), 1, 0x6a5a44, 0.04, 1);
      }
    }

    loop(ts) {
      if (this.destroyed) return;
      const now = ts || performance.now();
      let dt = (now - this.lastTs) / 1000;
      this.lastTs = now;
      dt = clamp(dt, 0, 0.05) * this.timeScale;
      this.time += dt;

      this.updateMovement(dt);
      this.updateCamera(dt);
      this.updateFocus();
      this.updateHammer(dt);
      this.updatePhantom(dt);
      this.updateHeating(dt);
      this.updateForge(dt);
      this.updateDragon(dt);
      this.updateGhost(dt);
      this.updateMachine(dt);
      this.updateWaves(dt);
      this.updateFragments(dt);
      this.sparks.update(dt);
      this.embers.update(dt);
      this.dust.update(dt);
      this.updateBell(dt);
      this.updateAmbience(dt);
      this.updateDrops(dt);
      this.updateElf(dt);

      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.8);
      if (this.frenzyPulse > 0) this.frenzyPulse = Math.max(0, this.frenzyPulse - dt * 8);
      if (this.flashLight.intensity > 0) {
        this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 9);
      }

      if (this.anvilSword) this.applySwordHeat();

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    /* 站点表 */
    get stations() {
      if (!this._stations) {
        this._stations = [
          { id: 'anvil', pos: new T.Vector3(0, 1.0, 0.2), approach: [0, 1.72], yaw: 0, pitch: -0.34, radius: 2.1 },
          { id: 'forge', pos: new T.Vector3(-4.1, 1.1, 0.45), approach: [-2.72, 0.72], yaw: 1.32, pitch: -0.1, radius: 2.4 },
          { id: 'tribute', pos: new T.Vector3(0, 1.0, -2.95), approach: [0, -1.34], yaw: 0, pitch: -0.34, radius: 2.2 },
          { id: 'rack', pos: new T.Vector3(4.4, 1.4, 0.0), approach: [2.92, 0.0], yaw: -1.57, pitch: -0.02, radius: 2.4 },
          { id: 'relic', pos: new T.Vector3(4.1, 1.3, -2.2), approach: [2.3, -2.0], yaw: -1.42, pitch: 0.0, radius: 2.4 },
          { id: 'merchant', pos: new T.Vector3(-2.9, 1.2, -2.2), approach: [-1.35, -1.95], yaw: 1.4, pitch: -0.04, radius: 2.3 }
        ];
      }
      return this._stations;
    }
  }

  window.ForgeWorld = ForgeWorld;
})();
