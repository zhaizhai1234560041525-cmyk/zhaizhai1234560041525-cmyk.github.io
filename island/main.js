// MŒBIUS ISLE — 莫比斯风格 3D 开放场景（仅场景与建筑）
// 渲染管线：法线/深度 pass → 色彩 pass(平涂 cel 着色 + 阴影排线) → 合成 pass(墨线描边 + 手绘抖动 + 纸张颗粒)
import * as THREE from 'three';
import { Sound } from '/island/sound.js?v=3';

THREE.ColorManagement.enabled = false; // 直接以显示色值作画，保持平涂色准确

// ---------------------------------------------------------------- 基础
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 9000);

const PAL = {
  ink: '#1d1a33',
  skyTop: '#3f8ea4', skyMid: '#79b5b8', skyHorizon: '#c6dbc2',
  fog: '#bfd6c0',
  seaNear: '#283766', seaFar: '#3e7590', seaLight: '#5a92a6', seaDark: '#1f2a55',
  foam: '#f2e4c0',
};

const sunDir = new THREE.Vector3(0.55, 0.62, 0.56).normalize();
const shared = {
  uSun: { value: sunDir },
  uFog: { value: new THREE.Color(PAL.fog) },
  uFogD: { value: 1 / 2600 },
  uInk: { value: new THREE.Color(PAL.ink) },
  uDpr: { value: renderer.getPixelRatio() },
  uTime: { value: 0 },
};

// ---------------------------------------------------------------- 噪声
function hash2(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x, y) * amp; norm += amp; x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; amp *= 0.5; }
  return s / norm;
}
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smin = (a, b, k) => { const h = Math.min(Math.max(0.5 + 0.5 * (b - a) / k, 0), 1); return b + (a - b) * h - k * h * (1 - h); };

// ---------------------------------------------------------------- 材质
const VS = /* glsl */`
  uniform float uBase;
  varying vec3 vN; varying vec3 vW; varying float vVZ;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize((normalMatrix * normal) * mat3(viewMatrix)); // 世界空间法线（兼容非均匀缩放）
    if (w.y < uBase) { w.y = uBase; n = vec3(0.0, -1.0, 0.0); }   // 云底压平
    vW = w.xyz; vN = n;
    vec4 mv = viewMatrix * w; vVZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const TOON_FS = /* glsl */`
  uniform vec3 uLit, uMid, uShade, uInk, uSun, uFog;
  uniform float uHatch, uFogAmt, uFogD, uDpr;
  varying vec3 vN; varying vec3 vW;
  void main(){
    float d = dot(normalize(vN), uSun);
    float tLit = smoothstep(0.40, 0.44, d);
    float tMid = smoothstep(-0.03, 0.01, d);
    vec3 c = mix(uShade, mix(uMid, uLit, tLit), tMid);
    if (uHatch > 0.0) {                              // 莫比斯式阴影排线
      vec2 fc = gl_FragCoord.xy / uDpr;
      float h = abs(fract((fc.x - fc.y) * 0.19) - 0.5);
      float line = 1.0 - smoothstep(0.07, 0.15, h);
      float deep = 1.0 - smoothstep(-0.35, -0.05, d);
      c = mix(c, uInk, line * (1.0 - tMid) * uHatch * (0.18 + 0.25 * deep));
    }
    float dist = length(vW - cameraPosition);
    float f = 1.0 - exp(-pow(dist * uFogD, 2.0));
    gl_FragColor = vec4(mix(c, uFog, f * uFogAmt), 1.0);
  }`;

const NORMAL_FS = /* glsl */`
  varying vec3 vN; varying float vVZ;
  void main(){ gl_FragColor = vec4(normalize(mat3(viewMatrix) * normalize(vN)) * 0.5 + 0.5, vVZ); }`;

function pair(colorMat, uniforms) {
  const normal = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: NORMAL_FS });
  return { color: colorMat, normal };
}
function toon({ lit, mid, shade, hatch = 1, fog = 1, base = -1e9 }) {
  const u = {
    ...shared,
    uLit: { value: new THREE.Color(lit) }, uMid: { value: new THREE.Color(mid) }, uShade: { value: new THREE.Color(shade) },
    uHatch: { value: hatch }, uFogAmt: { value: fog }, uBase: { value: base },
  };
  return pair(new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: TOON_FS }), u);
}

const M = {
  rock:    toon({ lit: '#6c71b2', mid: '#50538f', shade: '#36376a' }),
  rockDk:  toon({ lit: '#5b5f9c', mid: '#43457c', shade: '#2d2d5a' }),
  sand:    toon({ lit: '#f0c590', mid: '#d99a6c', shade: '#a6625a' }),
  pink:    toon({ lit: '#eaa58c', mid: '#c97b6f', shade: '#8c4d5b' }),
  peach:   toon({ lit: '#f7b66a', mid: '#e8904f', shade: '#b5633f' }),
  cream:   toon({ lit: '#f8e0b2', mid: '#ecc38e', shade: '#c08b66' }),
  window:  toon({ lit: '#2c2852', mid: '#242047', shade: '#1b1838', hatch: 0 }),
  red:     toon({ lit: '#df5b3e', mid: '#ba4330', shade: '#7f2d2b', hatch: 0 }),
  white:   toon({ lit: '#f6eedb', mid: '#e3d3b5', shade: '#b5a08a' }),
};
function cloudMat(base) {
  return toon({ lit: '#f9eac8', mid: '#f1ddb0', shade: '#dfc597', hatch: 0, fog: 0.18, base });
}

// ---------------------------------------------------------------- 注册表
const inked = [];   // 参与描边的网格
const inkless = []; // 不参与描边（浪花、天空）
function addMesh(geo, mat, parent = scene) {
  const m = new THREE.Mesh(geo, mat.color);
  m.userData.pair = mat;
  parent.add(m);
  inked.push(m);
  return m;
}
function mergeGeos(geos) {
  const pos = [], nor = [];
  for (let g of geos) {
    if (g.index) g = g.toNonIndexed();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

// ---------------------------------------------------------------- 天空
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(8000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(PAL.skyTop) }, uMid: { value: new THREE.Color(PAL.skyMid) },
      uHor: { value: new THREE.Color(PAL.skyHorizon) }, uSea: { value: new THREE.Color(PAL.seaFar) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uMid, uHor, uSea; varying vec3 vW;
      void main(){
        float y = normalize(vW - cameraPosition).y;
        vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.16, y));
        c = mix(c, uTop, smoothstep(0.12, 0.65, y));
        if (y < 0.0) c = uSea;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
sky.frustumCulled = false;
scene.add(sky);
inkless.push(sky);

// ---------------------------------------------------------------- 流星
// 稀疏、缓慢：同屏最多两颗，挂在天穹上随相机移动；云和岛会自然遮挡它们
const METEOR_R = 6000;
const meteorMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uCore: { value: new THREE.Color('#fffbee') }, uInk: shared.uInk },
  vertexShader: `attribute vec2 aUv; uniform float uLife; varying vec2 vUv; void main(){ vUv = aUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uCore, uInk; uniform float uLife; varying vec2 vUv;
    void main(){
      float along = vUv.x;                 // 0 = 头, 1 = 尾
      float w = abs(vUv.y - 0.5) * 2.0;    // 0 = 中线, 1 = 边缘
      float taper = mix(1.0, 0.15, along);
      if (w > taper) discard;
      float e = w / taper;
      vec3 c = mix(uCore, uInk, smoothstep(0.55, 0.75, e) * 0.85);  // 墨线包边
      float a = (1.0 - smoothstep(0.15, 1.0, along)) * uLife;
      gl_FragColor = vec4(c, a);
    }`,
});
const meteors = [];
let meteorTimer = 3;
function spawnMeteor() {
  // 在相机视锥内生成：从画面上方偏斜划过，慢慢走完
  const basis = new THREE.Matrix4().extractRotation(camera.matrixWorld);
  const right = new THREE.Vector3(1, 0, 0).applyMatrix4(basis);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(basis);
  const fwd = new THREE.Vector3(0, 0, -1).applyMatrix4(basis);
  const tanV = Math.tan((camera.fov * 0.5) * Math.PI / 180);
  const tanH = tanV * camera.aspect;
  const ox = (Math.random() * 2 - 1) * tanH * 0.55;
  const oy = (0.25 + Math.random() * 0.65) * tanV;
  const start = camera.position.clone()
    .addScaledVector(fwd, METEOR_R)
    .addScaledVector(right, ox * METEOR_R)
    .addScaledVector(up, oy * METEOR_R);
  const dir = up.clone().multiplyScalar(-1)
    .addScaledVector(right, (Math.random() * 2 - 1) * 0.85)
    .addScaledVector(fwd, -0.2 * Math.random())
    .normalize();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const mat = meteorMat.clone();
  mat.uniforms.uInk = shared.uInk;
  mat.uniforms.uLife = { value: 0 };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 1;
  scene.add(mesh); inkless.push(mesh);
  meteors.push({ mesh, start, dir, t: 0, dur: 5.5 + Math.random() * 3,
    speed: 130 + Math.random() * 80, len: 900 + Math.random() * 500, width: 48 + Math.random() * 32 });
}
const _h = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3();
function updateMeteors(dt) {
  if ((meteorTimer -= dt) <= 0) {
    if (meteors.length < 2) spawnMeteor();
    meteorTimer = 7 + Math.random() * 11;
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.t += dt;
    const k = m.t / m.dur;
    if (k >= 1) {
      scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose();
      inkless.splice(inkless.indexOf(m.mesh), 1); meteors.splice(i, 1);
      continue;
    }
    m.mesh.material.uniforms.uLife.value = 0.92 * Math.min(k / 0.15, 1) * (1 - Math.max(0, (k - 0.7) / 0.3));
    const grow = Math.min(1, k * 2.5);                 // 尾巴先拉长再划过
    _h.copy(m.start).addScaledVector(m.dir, m.speed * m.t);
    _t.copy(_h).addScaledVector(m.dir, -m.len * grow);
    _n.copy(m.dir).cross(_h).normalize();
    const p = m.mesh.geometry.attributes.position, w = m.width, wt = w * 0.5;
    p.setXYZ(0, _h.x + _n.x * w, _h.y + _n.y * w, _h.z + _n.z * w);
    p.setXYZ(1, _h.x - _n.x * w, _h.y - _n.y * w, _h.z - _n.z * w);
    p.setXYZ(2, _t.x + _n.x * wt, _t.y + _n.y * wt, _t.z + _n.z * wt);
    p.setXYZ(3, _t.x - _n.x * wt, _t.y - _n.y * wt, _t.z - _n.z * wt);
    p.needsUpdate = true;
    m.mesh.position.copy(camera.position);
  }
}

// ---------------------------------------------------------------- 海面
const seaU = {
  ...shared,
  uBase: { value: -1e9 },
  uNear: { value: new THREE.Color(PAL.seaNear) }, uFar: { value: new THREE.Color(PAL.seaFar) },
  uLight: { value: new THREE.Color(PAL.seaLight) }, uDark: { value: new THREE.Color(PAL.seaDark) },
};
const seaMat = pair(new THREE.ShaderMaterial({
  uniforms: seaU, vertexShader: VS,
  fragmentShader: /* glsl */`
    uniform vec3 uNear, uFar, uLight, uDark; uniform float uTime;
    varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float dash(vec2 p, float seed, float density){
      vec2 c = floor(p), f = fract(p);
      float r = h(c + seed);
      if (r > density) return 0.0;
      vec2 o = vec2(0.2 + 0.6 * h(c + seed + 3.1), 0.25 + 0.5 * h(c + seed + 7.7));
      vec2 d = (f - o) / vec2(0.33 * (0.5 + h(c + 1.3)), 0.09);
      return 1.0 - smoothstep(0.6, 1.0, dot(d, d));
    }
    void main(){
      float dist = length(vW.xz - cameraPosition.xz);
      vec3 c = mix(uNear, uFar, smoothstep(40.0, 2600.0, dist));
      float fade = 1.0 - smoothstep(90.0, 520.0, dist);
      vec2 p = vW.xz * vec2(0.11, 0.42);
      float a = dash(p + vec2(uTime * 0.25, 0.0), 0.0, 0.32);
      float b = dash(p * 1.37 + vec2(-uTime * 0.18, 5.0), 11.0, 0.22);
      c = mix(c, uLight, a * fade * 0.75);
      c = mix(c, uDark, b * fade * 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
}), seaU);
const sea = addMesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), seaMat);
sea.frustumCulled = false;

// ---------------------------------------------------------------- 岛屿
const islands = []; // { cx, cz, h(xLocal,zLocal) }
function groundHeight(x, z) {
  let g = -Infinity;
  for (const is of islands) {
    const dx = x - is.cx, dz = z - is.cz;
    if (dx * dx + dz * dz < is.reach * is.reach) g = Math.max(g, is.h(dx, dz));
  }
  return g;
}

function makeIsland({ cx, cz, R, H, seed, crag = 6, cragScale = 0.05, exp = 1.2, plateau = null, rings = 50, segs = 140, mat = M.rock, foam = true }) {
  const h = (x, z) => {
    const r = Math.hypot(x, z), th = Math.atan2(z, x);
    const n = fbm(Math.cos(th) * 1.4 + seed * 7.1, Math.sin(th) * 1.4 + seed * 3.3, 3);
    const Re = R * (0.72 + 0.55 * n);
    const t = 1 - r / Re;
    let y = t > 0 ? H * Math.pow(t, exp) : t * Re * 0.32;
    y += (fbm(x * cragScale + seed * 13, z * cragScale - seed * 5, 4) - 0.5) * 2 * crag * Math.min(Math.max((t + 0.15) * 3, 0), 1);
    if (plateau !== null) y = smin(y, plateau, 4);
    return y;
  };
  const rand = mulberry(seed * 977);
  const Rmax = R * 1.45;
  const grid = [];
  for (let i = 0; i <= rings; i++) {
    const row = [];
    for (let j = 0; j < segs; j++) {
      const r = Rmax * Math.pow(i / rings, 1.1);
      const th = (j / segs) * Math.PI * 2;
      const jit = i === 0 || i === rings ? 0 : (Rmax / rings) * 0.45;
      const x = Math.cos(th) * r + (rand() - 0.5) * jit;
      const z = Math.sin(th) * r + (rand() - 0.5) * jit;
      row.push([x, h(x, z), z]);
    }
    grid.push(row);
  }
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      const a = grid[i][j], b = grid[i][j2], c = grid[i + 1][j], d = grid[i + 1][j2];
      if (i === 0) { tri(grid[0][0], d, c); continue; }
      tri(a, d, c); tri(a, b, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals(); // 非索引 → 刻面化，墨线会勾出岩石褶皱
  const mesh = addMesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  const is = { cx, cz, h, reach: Rmax };
  islands.push(is);
  if (foam) makeFoam(is, R);
  return is;
}

// 岸线浪花：沿岸一圈实线 + 一圈断续虚线
const foamMat = new THREE.MeshBasicMaterial({ color: PAL.foam });
const foamRings = [];
function makeFoam(is, R) {
  const segs = 220;
  const shore = [];
  for (let j = 0; j < segs; j++) {
    const th = (j / segs) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    let r = 0;
    while (r < R * 2 && is.h(c * r, s * r) > 0) r += 0.4;
    shore.push([c, s, r]);
  }
  const ribbon = (off, width, dashed, seed) => {
    const pos = [];
    for (let j = 0; j < segs; j++) {
      if (dashed && vnoise(j * 0.35, seed) < 0.48) continue;
      const [c0, s0, r0] = shore[j], [c1, s1, r1] = shore[(j + 1) % segs];
      const a0 = r0 + off, b0 = r0 + off + width, a1 = r1 + off, b1 = r1 + off + width;
      pos.push(c0 * a0, 0, s0 * a0, c1 * a1, 0, s1 * a1, c0 * b0, 0, s0 * b0);
      pos.push(c1 * a1, 0, s1 * a1, c1 * b1, 0, s1 * b1, c0 * b0, 0, s0 * b0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, foamMat);
    m.material.side = THREE.DoubleSide;
    m.position.set(is.cx, 0.12, is.cz);
    scene.add(m); inkless.push(m);
    return m;
  };
  const scale = Math.max(R / 120, 0.35);
  ribbon(-0.3, 1.6 * scale, false, 0);
  foamRings.push({ mesh: ribbon(4 * scale, 0.9 * scale, true, is.cx * 0.01), phase: is.cx * 0.13 });
  foamRings.push({ mesh: ribbon(9 * scale, 0.7 * scale, true, is.cz * 0.01 + 4), phase: is.cz * 0.11 + 2 });
}

function makeSpire(x, z, height, radius, seed, mat) {
  const g = new THREE.CylinderGeometry(radius * 0.32, radius, height, 7, 9);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const t = vy / height + 0.5;
    const k = 1 + (fbm(vx * 0.15 + seed, vy * 0.08 + vz * 0.15, 3) - 0.5) * 0.7;
    const bend = Math.sin(t * 2.4 + seed) * radius * 0.35 * t;
    p.setXYZ(i, vx * k + bend, vy, vz * k);
  }
  const geo = g.toNonIndexed(); geo.computeVertexNormals();
  const m = addMesh(geo, mat);
  m.position.set(x, height / 2 - 6, z);
  m.rotation.y = seed;
  return m;
}

function makeMesa(x, z, R, H, seed) {
  const tiers = [
    { r0: 1.0, r1: 0.9, h: 0.38, mat: M.pink },
    { r0: 0.88, r1: 0.8, h: 0.22, mat: M.sand },
    { r0: 0.8, r1: 0.74, h: 0.28, mat: M.pink },
    { r0: 0.74, r1: 0.7, h: 0.12, mat: M.sand },
  ];
  let y = -10;
  tiers.forEach((t, i) => {
    const hh = t.h * H;
    const g = new THREE.CylinderGeometry(R * t.r1, R * t.r0, hh, 22, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k);
      const a = Math.atan2(vz, vx);
      const w = 1 + (fbm(Math.cos(a) * 2 + seed + i * 0.3, Math.sin(a) * 2 + vy * 0.004, 3) - 0.5) * 0.35;
      p.setXYZ(k, vx * w, vy, vz * w);
    }
    const geo = g.toNonIndexed(); geo.computeVertexNormals();
    addMesh(geo, t.mat).position.set(x, y + hh / 2, z);
    y += hh;
  });
}

function makeArch(x, z, rotY) {
  const g = new THREE.TorusGeometry(80, 17, 7, 22, Math.PI);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = (fbm(vx * 0.05 + 3, vy * 0.05 + vz * 0.05, 3) - 0.5) * 14;
    p.setXYZ(i, vx + k * 0.6, vy + k, vz + k * 0.8);
  }
  const geo = g.toNonIndexed(); geo.computeVertexNormals();
  const m = addMesh(geo, M.rockDk);
  m.position.set(x, -14, z);
  m.rotation.y = rotY;
}

// ---------------------------------------------------------------- 云
function makeCumulus(cx, base, cz, size, seed, count = 26, detail = 4, flatten = 0.75) {
  const rand = mulberry(seed);
  const geos = [];
  for (let i = 0; i < count; i++) {
    const u = Math.min(1, (i / count) * 1.05 + rand() * 0.08);
    const rad = size * (0.42 - 0.22 * u) * (0.8 + 0.4 * rand());
    const spread = size * (0.95 - 0.65 * u);
    const a = rand() * Math.PI * 2, rr = spread * Math.sqrt(rand());
    const g = new THREE.IcosahedronGeometry(rad, detail);
    g.scale(1, flatten + rand() * 0.2, 1);
    g.translate(Math.cos(a) * rr - u * size * 0.35, base + u * size * 1.35 + rad * 0.25, cz * 0 + Math.sin(a) * rr * 0.55);
    geos.push(g);
  }
  const m = addMesh(mergeGeos(geos), cloudMat(base));
  m.position.set(cx, 0, cz);
  return m;
}
function makeHorizonBand(radius, count, seed) {
  const rand = mulberry(seed);
  const geos = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.1;
    const r = radius * (0.9 + rand() * 0.2);
    const g = new THREE.IcosahedronGeometry(1, 3);
    g.scale(220 + rand() * 360, 26 + rand() * 50, 90 + rand() * 80);
    g.rotateY(-a + Math.PI / 2);
    g.translate(Math.cos(a) * r, 6 + rand() * 18, Math.sin(a) * r);
    geos.push(g);
  }
  addMesh(mergeGeos(geos), cloudMat(8));
}

// ---------------------------------------------------------------- 建筑
const PLATEAU = 36;
function box(parent, w, h, d, x, y, z, mat) {
  const m = addMesh(new THREE.BoxGeometry(w, h, d), mat, parent);
  m.position.set(x, y + h / 2, z);
  return m;
}
function cyl(parent, rTop, rBot, h, x, y, z, mat, seg = 20) {
  const m = addMesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, parent);
  m.position.set(x, y + h / 2, z);
  return m;
}

function buildVilla() {
  const g = new THREE.Group();
  g.position.set(0, PLATEAU, 0);
  scene.add(g);

  // 基座与挡土墙
  box(g, 50, 16, 32, 0, -15, 0, M.cream);
  box(g, 54, 2.5, 36, 0, 0, 0, M.cream);
  for (let x = -25.5; x <= 25.5; x += 3) box(g, 0.22, 1.1, 0.22, x, 2.5, 17.7, M.cream);
  box(g, 54, 0.25, 0.25, 0, 3.6, 17.7, M.cream);

  // 主厅 + 带形窗
  box(g, 40, 7, 22, -2, 2.5, 0, M.peach);
  box(g, 36, 2.1, 0.3, -2, 4.8, 11.05, M.window);
  box(g, 36, 2.1, 0.3, -2, 4.8, -11.05, M.window);
  for (let x = -19; x <= 15; x += 3) box(g, 0.35, 2.1, 0.5, x, 4.8, 11.1, M.peach);
  box(g, 2.4, 4.2, 0.35, -15.5, 2.5, 11.15, M.red);

  // 悬挑屋面板 + 立柱（伸出悬崖）
  box(g, 68, 1.4, 26, -11, 9.5, 0, M.cream);
  box(g, 68, 0.5, 0.6, -11, 9.0, 13.1, M.peach);
  for (const x of [-30, -40]) for (const z of [-10, 10]) cyl(g, 0.6, 0.6, 26, x, -16.5, z, M.cream, 10);

  // 二层体量
  box(g, 24, 5.5, 15, 8, 10.9, -1, M.peach);
  box(g, 20, 1.5, 0.3, 8, 13, 6.55, M.window);
  for (let x = -2; x <= 18; x += 2.5) box(g, 0.3, 0.3, 1.6, x, 16.6, 7.2, M.cream);

  // 顶部长臂 + 端头舱 + 碟形天线
  box(g, 2.4, 1.1, 2.4, 0, 16.4, -1, M.cream);
  box(g, 2.4, 1.1, 2.4, 16, 16.4, -1, M.cream);
  box(g, 50, 1.4, 3.2, -6, 17.5, -1, M.cream);
  box(g, 5, 3.2, 5, -30, 14.5, -1, M.peach);
  box(g, 5.2, 0.8, 0.3, -30, 16, 1.6, M.window);
  const dish = addMesh(new THREE.SphereGeometry(3, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), M.white, g);
  dish.position.set(-22, 21.5, -1); dish.rotation.set(Math.PI * 0.85, 0, -0.5);
  cyl(g, 0.25, 0.35, 2.8, -22, 18.9, -1, M.cream, 8);

  // 右侧塔楼：竖向遮阳鳍片 + 阶梯顶
  box(g, 8, 18, 10, 24, 2.5, 3, M.peach);
  box(g, 6.5, 3, 8, 24, 20.5, 3, M.cream);
  box(g, 4, 2, 5, 24.5, 23.5, 3, M.peach);
  for (let i = 0; i < 5; i++) box(g, 0.3, 15, 1.7, 20.6 + i * 1.7, 3.5, 8.9, M.cream);
  for (const z of [0, 3, 6]) box(g, 0.3, 12, 1.1, 28.05, 5, z, M.window);
  cyl(g, 0.22, 0.3, 13, 24.5, 25.5, 3, M.cream, 8);
  box(g, 5, 0.22, 0.22, 24.5, 34, 3, M.cream);
  const beacon = addMesh(new THREE.SphereGeometry(0.75, 12, 8), M.red, g);
  beacon.position.set(24.5, 38.8, 3);

  // 筒仓 + 穹顶
  cyl(g, 4.2, 4.2, 12, 17, 2.5, -12, M.peach, 24);
  addMesh(new THREE.SphereGeometry(4.2, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.cream, g).position.set(17, 14.5, -12);
  for (let i = 0; i < 4; i++) cyl(g, 4.45, 4.45, 0.45, 17, 4 + i * 2.6, -12, M.cream, 24);
  addMesh(new THREE.SphereGeometry(3.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.white, g).position.set(13, 16.4, -3);

  // 下岸阶梯（沿地形下行）+ 码头
  const stepGeos = [];
  let x = -18, z = 18, y = PLATEAU + 0.5, i = 0;
  while (y > 1.3 && i < 140) {
    x = -18 + Math.sin(i * 0.11) * 6;
    z = 18 + i * 1.3;
    const ground = groundHeight(x, z);
    y = Math.min(y - 0.25, Math.max(ground + 0.35, y - 1.1));
    const s = new THREE.BoxGeometry(3.4, 4, 1.4);
    s.translate(x, y - 2, z);
    stepGeos.push(s);
    i++;
  }
  addMesh(mergeGeos(stepGeos), M.cream);
  const pier = new THREE.BoxGeometry(4.5, 1.1, 22).translate(x, 0.75, z + 11);
  const posts = [];
  for (let k = 0; k < 6; k++) for (const sx of [-1.9, 1.9]) posts.push(new THREE.CylinderGeometry(0.3, 0.3, 4, 8).translate(x + sx, -1, z + 2 + k * 4));
  addMesh(mergeGeos([pier, ...posts]), M.peach);
  box(scene, 0.4, 3, 0.4, x + 1.8, 1.3, z + 21.5, M.red);

  return g;
}

function buildLighthouse(is) {
  const top = is.h(0, 0);
  const g = new THREE.Group(); g.position.set(is.cx, top - 1, is.cz); scene.add(g);
  cyl(g, 2.2, 3, 22, 0, 0, 0, M.white, 16);
  cyl(g, 2.68, 2.78, 2.5, 0, 9, 0, M.red, 16);
  cyl(g, 2.6, 2.6, 1, 0, 22, 0, M.peach, 16);
  cyl(g, 1.6, 1.6, 2.6, 0, 23, 0, M.window, 12);
  addMesh(new THREE.ConeGeometry(2.2, 2.4, 12), M.peach, g).position.set(0, 26.8, 0);
  box(g, 6, 3, 5, 4, -1, 0, M.cream);
}

// ---------------------------------------------------------------- 草坪与花丛
// 贴地的低多边形草丛 / 小花，让猫有一个可读的地面
function bladeGeo(h, w) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, w * 0.22, h, 0], 3));
  g.computeVertexNormals();
  return g;
}
const GRASS_MATS = [
  new THREE.MeshBasicMaterial({ color: '#5f8f62', side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: '#4a7a55', side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: '#7aa06a', side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: '#cf8f6e', side: THREE.DoubleSide }),   // 小花
  new THREE.MeshBasicMaterial({ color: '#efe0b4', side: THREE.DoubleSide }),
];
const grassGeos = GRASS_MATS.map((_, i) => bladeGeo(0.34 + (i % 3) * 0.12, 0.075 + (i % 2) * 0.025));
function scatterGrass(is, count, seed, rMax) {
  const rand = mulberry(seed);
  const buckets = GRASS_MATS.map(() => []);
  const up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    const th = rand() * Math.PI * 2, d = Math.sqrt(rand()) * rMax;
    const lx = Math.cos(th) * d, lz = Math.sin(th) * d;
    const h = is.h(lx, lz);
    if (h < 4.0 || h > PLATEAU + 3) continue;      // 只在山坡上长草，山顶留空
    const dx = is.h(lx + 2, lz) - is.h(lx - 2, lz);
    const dz = is.h(lx, lz + 2) - is.h(lx, lz - 2);
    const n = new THREE.Vector3(-dx, 4, -dz).normalize();
    const kind = rand() < 0.16 ? (rand() < 0.5 ? 3 : 4) : (rand() < 0.5 ? 0 : rand() < 0.5 ? 1 : 2);
    const m = new THREE.Matrix4().makeBasis(
      up.clone().cross(n).normalize().multiplyScalar(1 + rand() * 1.1),
      n.normalize(),
      new THREE.Vector3().crossVectors(n, up.clone().cross(n).normalize()).normalize());
    const s = 0.65 + rand() * 0.7;
    const t = new THREE.Matrix4().makeTranslation(is.cx + lx, h - 0.2, is.cz + lz);
    t.multiply(m).multiply(new THREE.Matrix4().makeScale(s, s * (0.7 + rand() * 0.8), s));
    buckets[kind].push(grassGeos[kind].clone().applyMatrix4(t));
  }
  buckets.forEach((list, i) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeos(list), GRASS_MATS[i]);
    scene.add(mesh); inkless.push(mesh);
  });
}

// ---------------------------------------------------------------- 构建世界
makeIsland({ cx: 0, cz: 0, R: 120, H: 54, seed: 1, crag: 7, plateau: PLATEAU, rings: 70, segs: 180 });
scatterGrass(islands[0], 4200, 5, 138);         // 主岛草坡与小花
buildVilla();

const west = makeIsland({ cx: -680, cz: -420, R: 75, H: 26, seed: 2, crag: 5, mat: M.rockDk });
makeSpire(-670, -430, 150, 16, 0.4, M.rockDk);
makeSpire(-630, -395, 95, 11, 1.7, M.rock);
makeSpire(-715, -455, 70, 10, 3.1, M.rockDk);

const lightIs = makeIsland({ cx: 340, cz: 380, R: 34, H: 9, seed: 3, crag: 2.5, rings: 28, segs: 80 });
buildLighthouse(lightIs);

{
  const rand = mulberry(42);
  for (let k = 0; k < 9; k++) {
    const a = rand() * Math.PI * 2, d = 170 + rand() * 140;
    makeIsland({ cx: Math.cos(a) * d, cz: Math.sin(a) * d, R: 6 + rand() * 10, H: 3 + rand() * 7, seed: 10 + k, crag: 1.5, cragScale: 0.2, rings: 12, segs: 40 });
  }
}
makeArch(560, -900, 0.6);
makeMesa(1500, -1900, 260, 190, 5);
makeMesa(-1900, -1300, 170, 120, 9);

makeCumulus(-380, 45, -1050, 380, 7, 28, 4);
makeCumulus(950, 40, 650, 260, 11, 22, 3);
makeCumulus(-1700, 40, 950, 360, 23, 24, 3);
makeCumulus(400, 50, -2300, 420, 31, 26, 3);
makeCumulus(2100, 40, -300, 300, 37, 22, 3);
makeHorizonBand(3400, 44, 99);

// ---------------------------------------------------------------- 墨线笔刷（后期基底色）
const inkU = {
  solid: new THREE.Color('#16132b'),
  soft: { value: new THREE.Color('#4d3f77') },
  strength: { value: 1 },
};
const INK = {
  // BackSide 是反壳描边的关键：只画外壳的背面，
  // 物体本身会挡住中间部分，于是只在轮廓处留下一圈黑边。
  // 若用 FrontSide，外壳会整个盖住物体（球和星星之前就是被这样涂黑的）。
  solid: new THREE.MeshBasicMaterial({ color: inkU.solid, side: THREE.BackSide }),
  soft: new THREE.MeshBasicMaterial({ color: inkU.soft.value, vertexColors: true, side: THREE.BackSide }),
};
const inkParts = [];
const _ipTmp = new THREE.Vector3();
const outlinerSoft = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, vertexColors: true });
function addInk(geo, mat, parent = scene, soft = true, w = 0.0045, maxW = 0.4) {
  if (!geo.getAttribute('color')) {
    const n = geo.attributes.position.count, c = new Float32Array(n * 3).fill(1);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  const m = new THREE.Mesh(geo, mat);
  m.scale.setScalar(1);
  m.userData = { soft, w, maxW, base: [] };
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) m.userData.base.push(p.getX(i), p.getY(i), p.getZ(i));
  (parent === scene ? scene : parent).add(m);
  inkParts.push(m);
  return m;
}
function updateInkParts() {
  inkParts.sort((a, b) => b.userData.w - a.userData.w);
  for (const m of inkParts) {
    m.getWorldPosition(_ipTmp);
    const w = Math.min(m.userData.maxW, m.userData.w * _ipTmp.distanceTo(camera.position));
    const p = m.geometry.attributes.position, b = m.userData.base;
    for (let i = 0; i < p.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      const k = 1 + w / l;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    p.needsUpdate = true;
    if (m.geometry.index) m.geometry.index.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- 小球（玩家）
// 漂浮小球：比原来大一圈，悬浮在地面上方，上下轻轻浮动
const PLAYER_R = 0.85;                           // 世界半径（按用户红圈标注缩小）
const HOVER_BASE = 1.8;                          // 贴地面高度 + 悬浮基础偏移
const HOVER_AMP = 0.3;                           // 上下浮动幅度
const HOVER_FREQ = 0.75;                         // 浮动频率（慢一点更飘逸）
const FLOAT_Y = PLAYER_R + HOVER_BASE;           // 滚到海上时的浮起高度
const PLAYER_SPAWN = new THREE.Vector3(0, 0, 62);   // 岛南侧的开阔台地
const PLAYER_MAT = toon({ lit: '#f2e3c4', mid: '#dcc099', shade: '#a8806a', hatch: 0.3, fog: 0, base: -1e9 });
const playerRoot = new THREE.Group();            // 只负责水平位置（不贴地，悬浮）
const ballSpin = new THREE.Group();              // 只负责滚动旋转
playerRoot.add(ballSpin);
scene.add(playerRoot);

const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(PLAYER_R, 28, 20), PLAYER_MAT.color);
ballMesh.userData.pair = PLAYER_MAT;
ballSpin.add(ballMesh);
inked.push(ballMesh);
addInk(new THREE.SphereGeometry(PLAYER_R, 32, 22), INK.solid, ballSpin, 0.003, 0.5);

// 接触阴影：跟随球的水平位置，随悬浮高度变淡变大
const ballShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#2f2e55', transparent: true, opacity: 0.4 }),
);
scene.add(ballShadow);
inkless.push(ballShadow);

playerRoot.position.set(PLAYER_SPAWN.x, groundHeight(PLAYER_SPAWN.x, PLAYER_SPAWN.z) + HOVER_BASE, PLAYER_SPAWN.z);

// ---------------------------------------------------------------- 四角星（收集物）
const starMat = toon({ lit: '#ffe89a', mid: '#f2c14e', shade: '#c1882a', hatch: 0.3, fog: 0, base: -1e9 });
const starMatInk = new THREE.MeshBasicMaterial({ color: inkU.soft.value, vertexColors: true });
const stars = [];
const STAR_HOMES = [];
function starGeo(inner, outer) {
  const g = new THREE.BufferGeometry();
  const pos = [], nor = [];
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, r = i % 2 ? inner : outer;
    pts.push(new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r, 0));
  }
  const apex = new THREE.Vector3(0, 0, inner * 0.7), back = new THREE.Vector3(0, 0, -inner * 0.7);
  for (let i = 0; i < 8; i++) {
    const a = pts[i], b = pts[(i + 1) % 8];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, apex.x, apex.y, apex.z);
    nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    pos.push(b.x, b.y, b.z, a.x, a.y, a.z, back.x, back.y, back.z);
    nor.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2 + 0.6, d = 16 + (i % 3) * 9;
  const home = new THREE.Vector3(PLAYER_SPAWN.x + Math.cos(a) * d, 0, PLAYER_SPAWN.z + Math.sin(a) * d);
  home.y = groundHeight(home.x, home.z) + 1.6;
  const m = new THREE.Group();
  m.position.copy(home);
  const face = new THREE.Mesh(starGeo(0.44, 1.0), starMat.color);
  face.userData.pair = starMat;
  inked.push(face);
  m.add(face);
  scene.add(m);
  addInk(starGeo(0.5, 1.08), starMatInk, m, true, 0.0012, 0.05);   // 细黑边，别盖住金色面
  STAR_HOMES.push(home.clone());
  stars.push({ group: m, face, home: home.clone(), placed: true, phase: i * 1.7, spin: 0.7 + i * 0.06 });
}

// ---------------------------------------------------------------- 猫的动作与拾取
const starState = { count: 0, needed: 5 };
// 只给某一颗星找个新落点（拾一颗换一颗，不影响其它星）
function relocateStar(s, i) {
  const base = playerYaw + (i / stars.length) * Math.PI * 2 + Math.random() * 6.28;
  for (let k = 0; k < 12; k++) {                           // 多试几个方向，保证落在地面上
    const th = base + (Math.random() - 0.5) * 2.2;
    const d = 16 + Math.random() * 20;
    const x = playerRoot.position.x + Math.sin(th) * d, z = playerRoot.position.z + Math.cos(th) * d;
    const h = groundHeight(x, z);
    if (h < 3.0 || h > 44) continue;
    if (Math.hypot(x - playerRoot.position.x, z - playerRoot.position.z) < 7) continue;   // 别落在球脚下
    s.placed = true; s.group.visible = true;
    s.home.set(x, h + 1.3, z);
    s.group.position.copy(s.home);
    return;
  }
  s.placed = false; s.group.visible = false;
}
function placeStars() {
  stars.forEach((s, i) => relocateStar(s, i));
}
let playerYaw = 0, playerSpeed = 0, playerFacing = 0;
let fallPeak = 0, thudCool = 0;
function updatePlayer(dt) {
  const wish = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) wish.z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) wish.z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) wish.x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) wish.x += 1;
  if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const target = wish.lengthSq() > 0 ? (running ? 13 : 5.5) : 0;
  playerSpeed += (target - playerSpeed) * (1 - Math.exp(-dt * 7));
  if (wish.lengthSq() > 0) {
    playerFacing = Math.atan2(-wish.x, -wish.z);
    let d = playerFacing - playerYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    playerYaw += d * (1 - Math.exp(-dt * 9));
  }
  const step = playerSpeed * dt;
  // 水平移动：沿地形滑动，坡度限制
  const tx = playerRoot.position.x - Math.sin(playerYaw) * step;
  const tz = playerRoot.position.z - Math.cos(playerYaw) * step;
  const groundX = groundHeight(tx, tz);
  const groundCur = groundHeight(playerRoot.position.x, playerRoot.position.z);
  const maxClimb = 0.75 * step + 0.03;
  if (groundX > -8 && groundX < groundCur + maxClimb) {
    playerRoot.position.x = tx; playerRoot.position.z = tz;
  } else {
    const sx = playerRoot.position.x - Math.cos(playerYaw) * step;
    const sz = playerRoot.position.z + Math.sin(playerYaw) * step;
    const gs = groundHeight(sx, sz);
    if (gs > -8 && gs < groundCur + maxClimb) { playerRoot.position.x = sx; playerRoot.position.z = sz; }
    else playerSpeed = 0;
  }
  // 悬浮高度：时间驱动的正弦浮动，目标高度在地面以上
  const t = shared.uTime.value;
  const hover = HOVER_BASE + Math.sin(t * HOVER_FREQ * Math.PI * 2) * HOVER_AMP;
  const gNow = groundHeight(playerRoot.position.x, playerRoot.position.z);
  const targetY = Math.max(gNow + hover, FLOAT_Y);
  playerRoot.position.y += (targetY - playerRoot.position.y) * (1 - Math.exp(-dt * 5));
  // 滚动：绕「上 × 前进方向」旋转，角速度 = 位移 / 半径
  if (step > 1e-5) {
    const axis = new THREE.Vector3(-Math.cos(playerYaw), 0, Math.sin(playerYaw));
    ballSpin.rotateOnWorldAxis(axis, step / PLAYER_R * 0.35);  // 减慢一点，配合漂浮感
  }
  // 悬浮时不触发落地音效，但保留滚动声
  Sound.setRoll(playerSpeed, true);

  // 动态阴影：离地越高越淡越大
  const hoverAmt = playerRoot.position.y - gNow;
  const shadowScale = PLAYER_R * (0.9 + hoverAmt * 0.08);
  const shadowOpacity = Math.max(0, 0.35 - hoverAmt * 0.025);
  ballShadow.scale.setScalar(shadowScale);
  ballShadow.material.opacity = shadowOpacity;
  ballShadow.position.set(
    playerRoot.position.x, gNow + 0.07, playerRoot.position.z);

  // 拾取（集满 5 颗后就不再计数）
  if (starState.count < starState.needed) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!s.placed) continue;
      const dx = s.group.position.x - playerRoot.position.x, dz = s.group.position.z - playerRoot.position.z;
      if (dx * dx + dz * dz < 3.2) {
        s.placed = false; s.group.visible = false;
        starState.count = Math.min(starState.needed, starState.count + 1);
        if (starState.count < starState.needed) relocateStar(s, i);   // 拾一颗换一颗
        Sound.pickup();
        updateHud();
      }
    }
  }
}
// 落地瞬间的小小挤压，反馈更清楚
const squashFx = [];
function pulseBall(dur) { squashFx.push({ t: 0, dur }); }
function updateSquash(dt) {
  for (let i = squashFx.length - 1; i >= 0; i--) {
    const q = squashFx[i]; q.t += dt;
    const k = Math.min(1, q.t / q.dur);
    const amt = Math.sin(k * Math.PI) * 0.18;
    ballMesh.scale.set(1 + amt, 1 - amt, 1 + amt);
    if (k >= 1) { ballMesh.scale.setScalar(1); squashFx.splice(i, 1); }
  }
}
function updatePlayerFx(dt) {
  updateSquash(dt);
  const t = shared.uTime.value;
  for (const s of stars) {
    if (!s.placed) continue;
    s.group.position.y = s.home.y + Math.sin(t * 1.6 + s.phase) * 0.28;
    s.group.rotation.y = t * s.spin;
  }
  // 集满后星星换个颜色闪一下
  if (starState.count >= starState.needed) {
    const k = (Math.sin(t * 3) + 1) * 0.5;
    starMat.color.uniforms.uLit.value.setRGB(0.96 + k * 0.04, 0.86, 0.52 + k * 0.2);
  }
}

function updateHud() {
  const el = document.getElementById('star-bar');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < starState.needed; i++) {
    const d = document.createElement('i');
    if (i < starState.count) d.className = 'on';
    el.appendChild(d);
  }
  const num = document.getElementById('star-num');
  if (num) num.textContent = starState.count + '/' + starState.needed;
  if (starState.count >= starState.needed) {
    const msg = document.getElementById('star-msg');
    if (msg) msg.classList.add('shown');
  }
}

// ---------------------------------------------------------------- 后期：墨线描边 + 纸张颗粒
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const rtNormal = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const rtColor = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4 });

const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: {
    tColor: { value: rtColor.texture }, tNormal: { value: rtNormal.texture },
    uRes: { value: size.clone() }, uPx: { value: renderer.getPixelRatio() },
    uTime: shared.uTime, uInk: shared.uInk, uFar: { value: camera.far },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tColor, tNormal; uniform vec2 uRes; uniform float uPx, uTime, uFar; uniform vec3 uInk;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    void S(vec2 uv, out vec3 n, out float z){
      vec4 t = texture2D(tNormal, uv);
      if (t.a <= 0.0) { n = vec3(0.0, 0.0, 1.0); z = uFar; } else { n = t.xyz * 2.0 - 1.0; z = t.a; }
    }
    void main(){
      vec2 px = uPx / uRes;
      vec2 fc = vUv * uRes / uPx;
      vec2 wob = (vec2(vn(fc / 11.0), vn(fc / 11.0 + 31.7)) - 0.5) * 1.1 * px;  // 手绘抖动
      vec2 uv = vUv + wob;
      vec3 nc, nl, nr, nu, nd; float zc, zl, zr, zu, zd;
      S(uv, nc, zc); S(uv - vec2(px.x, 0.), nl, zl); S(uv + vec2(px.x, 0.), nr, zr);
      S(uv + vec2(0., px.y), nu, zu); S(uv - vec2(0., px.y), nd, zd);
      // 深度：1/z 在屏幕空间对平面是仿射的，其拉普拉斯只在轮廓/折痕处非零
      float wc = 1./zc, wl = 1./zl, wr = 1./zr, wu = 1./zu, wd = 1./zd;
      float lap = abs(wl + wr + wu + wd - 4.*wc) / max(max(max(wl, wr), max(wu, wd)), wc);
      float en = max(max(1. - dot(nc, nl), 1. - dot(nc, nr)), max(1. - dot(nc, nu), 1. - dot(nc, nd)));
      en *= mix(1.0, 0.55, smoothstep(250., 2500., zc));
      // 两级阈值：外圈黑线，内芯用物体自身的颜色
      float eOutD = smoothstep(0.055, 0.105, lap);
      float eInD  = smoothstep(0.085, 0.150, lap);
      float eOutN = smoothstep(0.26, 0.42, en);
      float eInN  = smoothstep(0.40, 0.62, en);
      float eOut = max(eOutD, eOutN) * (0.80 + 0.20 * vn(fc / 23.0 + 5.0));  // 线条浓淡起伏
      float eIn  = max(eInD, eInN);

      vec3 col = texture2D(tColor, vUv).rgb;
      vec3 inner = mix(col, uInk, 0.30);                 // 内部描边：物体自身颜色的深色版
      col = mix(col, inner, eIn);
      col = mix(col, uInk, max(eOut - eIn, 0.0));        // 物体轮廓：黑色
      col *= 0.975 + 0.05 * vn(fc / 260.0);              // 纸张斑驳
      col += (hash(floor(fc) + floor(uTime * 12.0)) - 0.5) * 0.07;  // 颗粒
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
const postScene = new THREE.Scene(); postScene.add(post);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function render() {
  for (const m of inked) m.material = m.userData.pair.normal;
  for (const m of inkless) m.visible = false;
  renderer.setRenderTarget(rtNormal);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);

  for (const m of inked) m.material = m.userData.pair.color;
  for (const m of inkless) m.visible = true;
  renderer.setRenderTarget(rtColor);
  renderer.setClearColor(PAL.skyHorizon, 1);
  renderer.clear();
  renderer.render(scene, camera);

  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}

// ---------------------------------------------------------------- 控制（第三人称：拖动环视，滚轮缩放，WASD 控制猫）
let yaw = 0.4, pitch = 0.24;
let camDist = 13, camDistWanted = 13;
let camGoal = new THREE.Vector3();
let camFree = false;   // 调试用：冻结镜头
const focus = new THREE.Vector3();
function resetView() {
  yaw = Math.PI; pitch = 0.2; camDistWanted = 13;
  playerRoot.position.set(PLAYER_SPAWN.x, groundHeight(PLAYER_SPAWN.x, PLAYER_SPAWN.z) + PLAYER_R, PLAYER_SPAWN.z);
  playerYaw = 0; playerSpeed = 0; fallPeak = 0;
  starState.count = 0;
  stars.forEach((s, i) => {
    s.home.copy(STAR_HOMES[i]);
    s.placed = true; s.group.visible = true;
    s.group.position.copy(s.home);
  });
  updateHud();
  const msg = document.getElementById('star-msg');
  if (msg) msg.classList.remove('shown');
}

const keys = new Set();
let tour = false, tourA = 0;
addEventListener('keydown', (e) => {
  if (e.target !== document.body) return;
  keys.add(e.code);
  Sound.start();                                   // 首次按键即启动音频（浏览器要求用户手势）
  if (e.code === 'KeyG') { tour = !tour; tourA = Math.atan2(camera.position.x, camera.position.z); }
  if (e.code === 'KeyR') { tour = false; resetView(); }
  if (e.code === 'KeyH') document.getElementById('hud').classList.toggle('hidden');
  if (e.code === 'KeyM') Sound.toggleMute();       // 静音开关
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', () => Sound.start(), { once: true });

const canvas = renderer.domElement;
let dragging = false, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', (e) => { Sound.start(); dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); tour = false; });
canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture(e.pointerId); canvas.classList.remove('dragging'); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lx) * 0.004; pitch += (e.clientY - ly) * 0.004;
  pitch = Math.max(-0.35, Math.min(1.25, pitch));
  lx = e.clientX; ly = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDistWanted = Math.max(3.5, Math.min(90, camDistWanted * (1 + e.deltaY * 0.0012)));
}, { passive: false });

function updateCamera(dt) {
  if (camFree) return;
  if (tour) {
    tourA += dt * 0.045;
    const r = 270 + Math.sin(tourA * 1.7) * 40;
    return;
  }
  camDist += (camDistWanted - camDist) * (1 - Math.exp(-dt * 6));
  // 跟随点：猫的胸口
  const cx = playerRoot.position.x, cy = playerRoot.position.y + 0.9, cz = playerRoot.position.z;
  focus.set(cx, cy, cz);
  const ch = Math.cos(pitch);
  camGoal.set(
    cx + Math.sin(yaw) * ch * camDist,
    cy + Math.sin(pitch) * camDist + 0.8,
    cz + Math.cos(yaw) * ch * camDist,
  );
  // 不让镜头穿进地形
  const gh = groundHeight(camGoal.x, camGoal.z) + 0.9;
  if (camGoal.y < gh) camGoal.y = gh;
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * 9));
  camera.lookAt(cx, cy, cz);
}

// 地名牌
const LANDMARKS = [
  { name: 'MŒBIUS ISLE · 悬崖别墅', x: 0, z: 0, r: 260 },
  { name: 'NEEDLES · 针岩群岛', x: -680, z: -420, r: 240 },
  { name: 'BEACON · 灯塔小岛', x: 340, z: 380, r: 150 },
  { name: 'STONE ARCH · 海蚀拱门', x: 560, z: -900, r: 220 },
  { name: 'MESA · 赭红台地', x: 1500, z: -1900, r: 520 },
  { name: 'MESA · 西台地', x: -1900, z: -1300, r: 380 },
];
const locEl = document.getElementById('loc');
let locT = 0;
function updateLoc(dt) {
  if ((locT += dt) < 0.4) return; locT = 0;
  let name = 'OPEN SEA · 开阔海面';
  for (const l of LANDMARKS) if (Math.hypot(camera.position.x - l.x, camera.position.z - l.z) < l.r) { name = l.name; break; }
  if (camera.position.y > 600) name = 'ABOVE THE CLOUDS · 云上';
  if (locEl.textContent !== name) locEl.textContent = name;
}

// ---------------------------------------------------------------- 循环
resetView();                        // 先摆好猫与镜头，第一帧就不会从原点飞过来
{
  const cy = playerRoot.position.y + 0.9;
  camera.position.set(playerRoot.position.x, cy + 4, playerRoot.position.z + 13);
  camera.lookAt(playerRoot.position.x, cy, playerRoot.position.z);
}
function onResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(size);
  rtNormal.setSize(size.x, size.y); rtColor.setSize(size.x, size.y);
  post.material.uniforms.uRes.value.copy(size);
  post.material.uniforms.uPx.value = renderer.getPixelRatio();
  shared.uDpr.value = renderer.getPixelRatio();
}
addEventListener('resize', onResize);

const clock = new THREE.Timer();
renderer.setAnimationLoop(() => {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  shared.uTime.value += dt;
  updatePlayer(dt);
  updatePlayerFx(dt);
  updateInkParts();
  if (tour) {
    tourA += dt * 0.045;
    const r = 210 + Math.sin(tourA * 1.7) * 30;
    camera.position.set(Math.sin(tourA) * r, 58 + Math.sin(tourA * 2.3) * 12, Math.cos(tourA) * r);
    camera.lookAt(0, 40, 0);
  } else {
    updateCamera(dt);
  }
  updateLoc(dt);
  sky.position.copy(camera.position);
  updateMeteors(dt);
  sea.position.set(Math.round(camera.position.x / 100) * 100, 0, Math.round(camera.position.z / 100) * 100);
  const t = shared.uTime.value;
  for (const f of foamRings) { const s = 1 + Math.sin(t * 0.6 + f.phase) * 0.012; f.mesh.scale.set(s, 1, s); }
  render();
});

// 调试/截图辅助（不影响正常游玩）
window.__view = (x, y, z, tx, ty, tz) => { camFree = true; tour = false; camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); };
window.__free = (v) => { camFree = v; };
window.__cat = () => ({ pos: playerRoot.position.toArray().map(v => +v.toFixed(2)), stars: starState.count });
window.__meteor = () => { spawnMeteor(); return meteors.length; };
window.__sound = () => ({ ...Sound.state, muted: Sound.muted });
