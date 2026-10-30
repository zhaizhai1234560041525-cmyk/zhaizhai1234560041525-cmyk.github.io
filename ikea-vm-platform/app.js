// IKEA VM 施工效果图生图平台 - 前端
const STEPS = [
  { id: 'demand', title: '需求输入', desc: '录入点位、主推 SKU、日期' },
  { id: 'analysis', title: '需求分析', desc: '系统分析可建 Brief 状态' },
  { id: 'media', title: '选 media', desc: '选定唯一 media 主类' },
  { id: 'brief', title: 'Brief 生成', desc: '生成并编辑 Brief' },
  { id: 'brief-review', title: 'Brief 审核', desc: 'Manager 双侧审核' },
  { id: 'inventory', title: '库存核对', desc: '销售确认库存与备货' },
  { id: 'visual', title: '效果图生成', desc: '本地合成效果图' },
  { id: 'visual-review', title: '图稿审核', desc: 'Manager 审图' },
  { id: 'package', title: '交接包', desc: '发布执行包' },
  { id: 'site', title: '现场验收', desc: '四项验收与用量确认' },
];

let state = null;
let currentStep = 'demand';
let mediaRules = {};
let productsCache = {};
let platformConfig = { modes: ['local'], apimart: { configured: false } };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || '请求失败');
    throw new Error(data.error);
  }
  return data;
}

function getRole() {
  return $('#role-select').value;
}

function canAccess(stepId, role) {
  const map = {
    'demand': ['designer'],
    'analysis': ['designer'],
    'media': ['designer'],
    'brief': ['designer'],
    'brief-review': ['designManager'],
    'inventory': ['sales', 'salesManager'],
    'visual': ['designer'],
    'visual-review': ['designManager'],
    'package': ['designer'],
    'site': ['coordinator', 'designManager', 'salesManager', 'designer'],
  };
  return (map[stepId] || []).includes(role);
}

function stepIndex(id) {
  return STEPS.findIndex(s => s.id === id);
}

function completedSteps() {
  if (!state) return new Set();
  const s = state;
  const done = new Set(['demand']);
  if (s.analysis) done.add('analysis');
  if (s.mediaId) done.add('media');
  if (s.brief && s.brief.plan && s.brief.plan.length) done.add('brief');
  if (s.approvals && s.approvals.brief === s.version) done.add('brief-review');
  if (s.approvals && s.approvals.inventory === s.version) done.add('inventory');
  if (s.visual && s.visual.status && s.visual.status !== 'idle') done.add('visual');
  if (s.approvals && s.approvals.visual === s.version) done.add('visual-review');
  if (s.package && s.package.status === 'published') done.add('package');
  if (s.actual) done.add('site');
  return done;
}

function renderSteps() {
  const done = completedSteps();
  $('#steps-nav').innerHTML = STEPS.map((step, idx) => {
    const isActive = step.id === currentStep;
    const isDone = done.has(step.id);
    const roleOk = canAccess(step.id, getRole());
    const blocked = !roleOk && !isDone;
    return `
      <div class="step-item ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''} ${blocked ? 'blocked' : ''}"
           data-step="${step.id}" ${blocked ? '' : 'onclick="gotoStep(\'' + step.id + '\')"'}>
        <div class="step-num">${isDone ? '✓' : idx + 1}</div>
        <div>
          <div class="step-title">${step.title}</div>
          <div class="step-desc">${step.desc}</div>
        </div>
      </div>
    `;
  }).join('');
}

function gotoStep(id) {
  currentStep = id;
  renderSteps();
  renderWorkspace();
  renderContext();
}

function statusBadge(text, type) {
  return `<span class="status-badge status-${type}">${text}</span>`;
}

function renderWorkspace() {
  const panel = $('#step-content');
  const s = state;
  if (!s) {
    panel.innerHTML = `<div class="text-center py-20 text-gray-500">点击右上角「新建项目」开始</div>`;
    return;
  }
  switch (currentStep) {
    case 'demand': renderDemand(panel); break;
    case 'analysis': renderAnalysis(panel); break;
    case 'media': renderMedia(panel); break;
    case 'brief': renderBrief(panel); break;
    case 'brief-review': renderBriefReview(panel); break;
    case 'inventory': renderInventory(panel); break;
    case 'visual': renderVisual(panel); break;
    case 'visual-review': renderVisualReview(panel); break;
    case 'package': renderPackage(panel); break;
    case 'site': renderSite(panel); break;
  }
}

function renderDemand(panel) {
  const d = state.demand || {};
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">01 输入当前设计需求</h2>
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">需求描述</label>
        <textarea id="d-text" rows="3" class="w-full border rounded-lg p-3 text-sm" placeholder="描述本次陈列目标、氛围与卖点">${d.text || ''}</textarea>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">点位 / 区域</label>
          <input id="d-site" type="text" class="w-full border rounded-lg p-2 text-sm" value="${d.site || ''}" placeholder="如：灯具区 03 通道端头">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">目标日期</label>
          <input id="d-deadline" type="date" class="w-full border rounded-lg p-2 text-sm" value="${d.deadline || new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">主推 SKU / 商品名称</label>
        <div class="flex gap-2">
          <input id="d-sku" type="text" class="flex-1 border rounded-lg p-2 text-sm" value="${d.mainSku || ''}" placeholder="如：805.939.60">
          <button onclick="searchMainProduct()" class="btn-secondary">搜索</button>
        </div>
        <div id="search-results" class="mt-2 max-h-40 overflow-y-auto border rounded-lg hidden"></div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">网格参考商品（可选）</label>
        <textarea id="d-products" rows="2" class="w-full border rounded-lg p-3 text-sm" placeholder="SKU/商品名称 | 材质 | 描述，一行一条">${d.productsText || ''}</textarea>
      </div>
      <div class="pt-4 flex gap-3">
        <button onclick="saveDemand()" class="btn-primary">保存需求</button>
        <button onclick="analyzeDemand()" class="btn-secondary">分析当前需求</button>
      </div>
    </div>
  `;
}

async function searchMainProduct() {
  const q = $('#d-sku').value.trim();
  if (!q) return;
  const list = await api(`/api/products?q=${encodeURIComponent(q)}&limit=10`);
  const box = $('#search-results');
  if (!list.length) { box.classList.add('hidden'); return; }
  box.innerHTML = list.map(p => `
    <div class="p-2 hover:bg-gray-50 cursor-pointer border-b last:border-0 flex justify-between"
         onclick="selectMainProduct('${p.sku}', '${p.name.replace(/'/g, "\\'")}')">
      <span class="text-sm">${p.name}</span>
      <span class="text-xs text-gray-500 font-mono">${p.sku}</span>
    </div>
  `).join('');
  box.classList.remove('hidden');
}

function selectMainProduct(sku, name) {
  $('#d-sku').value = sku;
  $('#search-results').classList.add('hidden');
}

async function saveDemand() {
  const demand = {
    text: $('#d-text').value,
    site: $('#d-site').value,
    deadline: $('#d-deadline').value,
    mainSku: $('#d-sku').value,
    productsText: $('#d-products').value,
  };
  state.demand = demand;
  state = await api('/api/projects/' + state.id, { method: 'POST', body: state });
  renderContext();
  console.log('需求已保存');
}

async function analyzeDemand() {
  state = await api('/api/projects/' + state.id + '/analyze', { method: 'POST' });
  gotoStep('analysis');
}

function renderAnalysis(panel) {
  const a = state.analysis;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">02 需求分析结果</h2>
    ${a ? `
      <div class="mb-4">状态：${a.status === 'ready' ? statusBadge('可建 Brief', 'ready') : statusBadge('被阻断', 'blocked')}</div>
      <div class="bg-gray-50 rounded-lg p-4 mb-4">
        <div class="font-medium text-sm mb-2">已识别约束</div>
        <ul class="text-sm space-y-1 list-disc list-inside text-gray-700">
          ${(a.constraints || []).map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
      ${a.missing && a.missing.length ? `
        <div class="bg-yellow-50 rounded-lg p-4 mb-4">
          <div class="font-medium text-sm mb-2">待确认 / 缺失项</div>
          <ul class="text-sm space-y-1 list-disc list-inside text-yellow-800">
            ${a.missing.map(m => `<li>${m}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${a.status === 'ready' ? `
        <button onclick="gotoStep('media')" class="btn-primary">继续选 media</button>
      ` : `
        <button onclick="gotoStep('demand')" class="btn-secondary">返回补充需求</button>
      `}
    ` : `
      <div class="text-gray-500">尚未进行分析，请先保存需求。</div>
      <button onclick="analyzeDemand()" class="btn-primary mt-4">分析当前需求</button>
    `}
  `;
}

async function renderMedia(panel) {
  if (!Object.keys(mediaRules).length) {
    mediaRules = await api('/api/media');
  }
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">03 选择 media 主类</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${Object.entries(mediaRules).map(([id, m]) => `
        <div class="media-card ${state.mediaId === id ? 'selected' : ''}" data-mid="${id}" onclick="selectMedia('${id}')">
          <div class="media-id">${id}</div>
          <div class="font-bold text-sm mt-1">${m.name}</div>
          <div class="text-xs text-gray-500 mt-1">${m.function}</div>
          <div class="text-xs text-gray-400 mt-1">${m.scene}</div>
        </div>
      `).join('')}
    </div>
    <div class="mt-6">
      <button onclick="confirmMedia()" class="btn-primary" ${state.mediaId ? '' : 'disabled'}>确认选择 ${state.mediaId || ''}</button>
    </div>
  `;
}

async function selectMedia(id) {
  state = await api('/api/projects/' + state.id + '/media', { method: 'POST', body: { mediaId: id } });
  renderSteps();
  renderWorkspace();
  renderContext();
}

function confirmMedia() {
  gotoStep('brief');
}

async function renderBrief(panel) {
  const b = state.brief || {};
  const hasBrief = b.plan && b.plan.length;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">04 生成并编辑 Brief</h2>
    ${!hasBrief ? `
      <div class="bg-blue-50 rounded-lg p-6 text-center">
        <p class="text-sm text-gray-700 mb-4">系统将根据主推 SKU 与 media 规则生成 Brief 草稿。</p>
        <button onclick="generateBrief()" class="btn-primary">本地规则生成 Brief</button>
      </div>
    ` : `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">主推 SKU</label>
            <input id="b-sku" type="text" class="w-full border rounded-lg p-2 text-sm bg-gray-50" value="${b.sku || ''}" readonly>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">计划数量</label>
            <input id="b-qty" type="number" class="w-full border rounded-lg p-2 text-sm" value="${b.quantity || ''}">
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">布局说明</label>
          <textarea id="b-layout" rows="3" class="w-full border rounded-lg p-3 text-sm">${b.layout || ''}</textarea>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">参考来源</label>
          <input id="b-ref" type="text" class="w-full border rounded-lg p-2 text-sm" value="${b.reference || ''}">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">商品清单</label>
          <div class="border rounded-lg overflow-hidden">
            <div class="product-row bg-gray-50 font-medium text-xs text-gray-500">
              <div>SKU</div><div>名称</div><div>计划数量</div><div></div>
            </div>
            <div id="brief-plan-rows">
              ${(b.plan || []).map((it, i) => `
                <div class="product-row" data-idx="${i}">
                  <div class="text-xs font-mono">${it.sku}</div>
                  <div class="text-sm">${it.name}</div>
                  <div><input type="number" class="plan-qty w-full border rounded p-1 text-sm" value="${it.quantity || ''}"></div>
                  <div></div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="pt-2 flex gap-3">
          <button onclick="saveBrief()" class="btn-secondary">保存 Brief</button>
          <button onclick="submitBrief()" class="btn-primary">提交 Brief 审核</button>
        </div>
      </div>
    `}
  `;
}

async function generateBrief() {
  state = await api('/api/projects/' + state.id + '/brief', { method: 'POST' });
  renderWorkspace();
  renderContext();
}

async function saveBrief() {
  const plan = (state.brief.plan || []).map((it, i) => {
    const row = $$(`#brief-plan-rows .product-row`)[i];
    return { ...it, quantity: parseInt(row.querySelector('.plan-qty').value) || 1 };
  });
  state.brief = {
    ...state.brief,
    sku: $('#b-sku').value,
    quantity: parseInt($('#b-qty').value) || 1,
    layout: $('#b-layout').value,
    reference: $('#b-ref').value,
    plan,
  };
  state = await api('/api/projects/' + state.id + '/brief/save', { method: 'POST', body: { brief: state.brief } });
  renderContext();
  console.log('Brief 已保存');
}

async function submitBrief() {
  state = await api('/api/projects/' + state.id + '/brief/submit', { method: 'POST' });
  gotoStep('brief-review');
}

function renderBriefReview(panel) {
  const b = state.briefSnapshot || state.brief || {};
  const approved = state.approvals && state.approvals.brief === state.version;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">05 审核当前版 Brief</h2>
    <div class="bg-gray-50 rounded-lg p-4 mb-4 text-sm space-y-2">
      <div><span class="font-medium">主推 SKU：</span>${b.sku}</div>
      <div><span class="font-medium">数量：</span>${b.quantity}</div>
      <div><span class="font-medium">media：</span>${state.mediaId} ${mediaRules[state.mediaId]?.name || ''}</div>
      <div><span class="font-medium">布局：</span>${b.layout}</div>
      <div><span class="font-medium">参考：</span>${b.reference}</div>
    </div>
    ${approved ? statusBadge('Brief 已通过', 'done') : `
      <div class="space-y-3">
        <textarea id="br-note" rows="2" class="w-full border rounded-lg p-3 text-sm" placeholder="审核意见（可选）"></textarea>
        <div class="flex gap-3">
          <button onclick="approveBrief()" class="btn-primary">通过当前 Brief</button>
          <button onclick="rejectBrief()" class="btn-danger">退回设计师</button>
        </div>
      </div>
    `}
  `;
}

async function approveBrief() {
  state = await api('/api/projects/' + state.id + '/brief/approve', { method: 'POST' });
  renderSteps();
  renderWorkspace();
  renderContext();
}

async function rejectBrief() {
  const reason = $('#br-note').value;
  state = await api('/api/projects/' + state.id + '/brief/reject', { method: 'POST', body: { reason } });
  gotoStep('brief');
}

function renderInventory(panel) {
  const inv = state.inventoryRecord || {};
  const plan = (state.brief && state.brief.plan) || [];
  const approved = state.approvals && state.approvals.inventory === state.version;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">06 库存核对与备货</h2>
    ${approved ? statusBadge('库存已通过', 'done') : `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">库存来源</label>
            <input id="inv-source" type="text" class="w-full border rounded-lg p-2 text-sm" value="${inv.source || '门店库存系统导出（演示）'}">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">核对日期</label>
            <input id="inv-at" type="date" class="w-full border rounded-lg p-2 text-sm" value="${inv.at || new Date().toISOString().slice(0,10)}">
          </div>
        </div>
        <div class="border rounded-lg overflow-hidden">
          <div class="product-row bg-gray-50 font-medium text-xs text-gray-500">
            <div>SKU</div><div>名称</div><div>需求数量</div><div>可用数量</div>
          </div>
          ${plan.map((it, i) => `
            <div class="product-row">
              <div class="text-xs font-mono">${it.sku}</div>
              <div class="text-sm">${it.name}</div>
              <div class="text-sm">${it.quantity}</div>
              <div><input type="number" class="inv-avail w-full border rounded p-1 text-sm" data-sku="${it.sku}" value="${(inv.rows && inv.rows[i] && inv.rows[i].available) || ''}"></div>
            </div>
          `).join('')}
        </div>
        <div class="flex gap-3">
          <button onclick="confirmInventory()" class="btn-primary">确认当前版库存</button>
        </div>
      </div>
    `}
  `;
}

async function confirmInventory() {
  const plan = state.brief.plan;
  const rows = plan.map(it => ({
    sku: it.sku,
    available: parseInt($$(`.inv-avail[data-sku="${it.sku}"]`)[0].value) || 0,
  }));
  state = await api('/api/projects/' + state.id + '/inventory', {
    method: 'POST',
    body: { source: $('#inv-source').value, at: $('#inv-at').value, rows },
  });
  renderSteps();
  renderWorkspace();
  renderContext();
}

function renderVisual(panel) {
  const v = state.visual || {};
  const canGen = state.submittedVersion === state.version &&
    state.approvals && state.approvals.brief === state.version &&
    state.approvals && state.approvals.inventory === state.version;
  const aiAvailable = platformConfig.modes.includes('apimart');
  const isPending = v.status === 'pending' && v.version === state.version;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">07 生成效果图</h2>
    ${isPending ? `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-ikea-blue mb-4"></div>
        <p class="text-gray-600 mb-2">AI 正在生成效果图，请稍候…</p>
        <p class="text-xs text-gray-400 font-mono">任务：${v.id}</p>
      </div>
    ` : v.result_url ? `
      <div class="text-center">
        <img src="${v.result_url}?t=${Date.now()}" class="effect-image mx-auto mb-4" alt="效果图">
        <div class="text-sm text-gray-500 mb-4">任务 ID：${v.id} · 模式：${v.mode === 'apimart' ? 'APImart AI' : '本地合成'}</div>
        <button onclick="submitVisual()" class="btn-primary">提交图稿审核</button>
      </div>
    ` : `
      <div class="text-center py-12">
        <p class="text-gray-500 mb-4">${canGen ? 'Brief 与库存双审已通过，可选择生成模式。' : '请先完成 Brief 与库存双审。'}</p>
        ${aiAvailable && canGen ? `
          <div class="mb-4">
            <label class="inline-flex items-center gap-2 mr-4 cursor-pointer">
              <input type="radio" name="visual-mode" value="local" checked class="accent-ikea-blue"> 本地合成（免费）
            </label>
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" name="visual-mode" value="apimart" class="accent-ikea-blue"> APImart AI 生图（付费）
            </label>
          </div>
        ` : ''}
        <button onclick="generateVisual()" class="btn-primary" ${canGen ? '' : 'disabled'}>
          ${aiAvailable && canGen ? '生成效果图' : '生成本地效果图'}
        </button>
      </div>
    `}
  `;
}

let visualPollTimer = null;

async function pollVisualStatus() {
  if (!state || !state.visual || state.visual.status !== 'pending') {
    clearInterval(visualPollTimer);
    visualPollTimer = null;
    return;
  }
  try {
    state = await api('/api/projects/' + state.id + '/visual/status');
    renderSteps();
    renderWorkspace();
    renderContext();
    if (state.visual.status !== 'pending') {
      clearInterval(visualPollTimer);
      visualPollTimer = null;
    }
  } catch (e) {
    console.log('轮询状态失败', e);
  }
}

async function generateVisual() {
  const modeEl = document.querySelector('input[name="visual-mode"]:checked');
  const mode = modeEl ? modeEl.value : 'local';
  state = await api('/api/projects/' + state.id + '/visual', { method: 'POST', body: { mode } });
  renderSteps();
  renderWorkspace();
  renderContext();
  if (state.visual && state.visual.status === 'pending' && !visualPollTimer) {
    visualPollTimer = setInterval(pollVisualStatus, 3000);
  }
}

async function submitVisual() {
  state = await api('/api/projects/' + state.id + '/visual/submit', { method: 'POST' });
  gotoStep('visual-review');
}

function renderVisualReview(panel) {
  const v = state.visual || {};
  const approved = state.approvals && state.approvals.visual === state.version;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">08 审核图稿</h2>
    ${v.result_url ? `
      <img src="${v.result_url}" class="effect-image mb-4" alt="效果图">
    ` : '<div class="text-gray-500">尚未生成效果图</div>'}
    ${approved ? statusBadge('图稿已通过', 'done') : `
      <div class="space-y-3">
        <textarea id="vr-note" rows="2" class="w-full border rounded-lg p-3 text-sm" placeholder="审图意见（可选）"></textarea>
        <div class="flex gap-3">
          <button onclick="approveVisual()" class="btn-primary">通过当前图稿</button>
          <button onclick="rejectVisual()" class="btn-danger">退回设计师</button>
        </div>
      </div>
    `}
  `;
}

async function approveVisual() {
  state = await api('/api/projects/' + state.id + '/visual/approve', { method: 'POST' });
  renderSteps();
  renderWorkspace();
  renderContext();
}

async function rejectVisual() {
  const reason = $('#vr-note').value;
  state = await api('/api/projects/' + state.id + '/visual/reject', { method: 'POST', body: { reason } });
  gotoStep('visual');
}

function renderPackage(panel) {
  const published = state.package && state.package.status === 'published' && state.package.version === state.version;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">09 发布交接包</h2>
    <div class="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
      <div class="font-medium mb-2">交接包内容</div>
      <ul class="list-disc list-inside space-y-1 text-gray-700">
        <li>当前版本 Brief 与图稿</li>
        <li>商品数量清单</li>
        <li>木工 / GC / 电工下单资料（模板）</li>
        <li>库存核对记录</li>
      </ul>
    </div>
    ${published ? statusBadge('执行包已发布', 'done') : `
      <button onclick="publishPackage()" class="btn-primary">发布执行包</button>
    `}
  `;
}

async function publishPackage() {
  state = await api('/api/projects/' + state.id + '/package', { method: 'POST' });
  renderSteps();
  renderWorkspace();
  renderContext();
}

function renderSite(panel) {
  const published = state.package && state.package.status === 'published' && state.package.version === state.version;
  const stockReady = state.stockReady;
  const site = state.site;
  const designDone = state.approvals && state.approvals.designSite === state.version;
  const salesDone = state.approvals && state.approvals.salesSite === state.version;
  const actual = state.actual;
  panel.innerHTML = `
    <h2 class="text-xl font-bold text-ikea-blue mb-4">10 现场执行与验收</h2>
    ${!published ? `<div class="text-gray-500">请先发布交接包。</div>` : `
      <div class="space-y-4">
        ${!stockReady ? `
          <button onclick="stockReady()" class="btn-primary">确认执行前备货完成</button>
        ` : statusBadge('备货完成', 'done')}
        ${stockReady && !site ? `
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">现场记录</label>
            <textarea id="site-note" rows="2" class="w-full border rounded-lg p-3 text-sm" placeholder="现场情况、施工问题"></textarea>
            <button onclick="recordSite()" class="btn-primary mt-2">记录现场</button>
          </div>
        ` : ''}
        ${site ? `
          <div class="bg-gray-50 rounded-lg p-3 text-sm">
            <div class="font-medium">现场记录</div>
            <div class="text-gray-600">${site.note}</div>
          </div>
          <div class="border rounded-lg p-4">
            <div class="font-medium text-sm mb-2">四项共用验收</div>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check-item"> 设计还原</label>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check-item"> 商品数量</label>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check-item"> 价格标签</label>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check-item"> 施工质量</label>
            <div class="flex gap-3 mt-3">
              <button onclick="acceptSite('designManager')" class="btn-secondary">设计管理验收</button>
              <button onclick="acceptSite('salesManager')" class="btn-secondary">销售管理验收</button>
            </div>
          </div>
        ` : ''}
        ${designDone && salesDone ? `
          <div class="border rounded-lg p-4">
            <div class="font-medium text-sm mb-2">实际用量确认</div>
            <div id="actual-rows" class="space-y-2 mb-3">
              ${(state.brief.plan || []).map(it => `
                <div class="flex gap-2 items-center">
                  <span class="text-xs font-mono w-28">${it.sku}</span>
                  <span class="text-sm flex-1">${it.name}</span>
                  <input type="number" class="actual-qty border rounded p-1 text-sm w-24" data-sku="${it.sku}" value="${it.quantity}">
                </div>
              `).join('')}
            </div>
            <button onclick="confirmActual()" class="btn-primary">确认实际清单</button>
          </div>
        ` : ''}
        ${actual ? statusBadge('实际用量已确认', 'done') : ''}
      </div>
    `}
  `;
}

async function stockReady() {
  state = await api('/api/projects/' + state.id + '/stock', { method: 'POST' });
  renderWorkspace();
  renderContext();
}

async function recordSite() {
  const note = $('#site-note').value;
  state = await api('/api/projects/' + state.id + '/site', { method: 'POST', body: { note } });
  renderWorkspace();
  renderContext();
}

async function acceptSite(role) {
  const checks = Array.from($$('.check-item')).map(c => c.checked);
  state = await api('/api/projects/' + state.id + '/site/accept', { method: 'POST', body: { role, checks } });
  renderWorkspace();
  renderContext();
}

async function confirmActual() {
  const rows = (state.brief.plan || []).map(it => ({
    sku: it.sku,
    quantity: parseInt($$(`.actual-qty[data-sku="${it.sku}"]`)[0].value) || 1,
  }));
  state = await api('/api/projects/' + state.id + '/actual', { method: 'POST', body: { rows } });
  renderSteps();
  renderWorkspace();
  renderContext();
}

function renderContext() {
  if (!state) {
    $('#context-panel').innerHTML = '<div class="text-gray-400">暂无项目</div>';
    $('#events-panel').innerHTML = '';
    return;
  }
  $('#project-id').textContent = state.id;
  const a = state.approvals || {};
  $('#context-panel').innerHTML = `
    <div class="flex justify-between"><span>版本</span><span class="font-mono">v${state.version}</span></div>
    <div class="flex justify-between"><span>状态</span><span class="font-medium">${state.status}</span></div>
    <div class="flex justify-between"><span>media</span><span>${state.mediaId || '-'}</span></div>
    <div class="flex justify-between"><span>Brief 审核</span><span>${a.brief === state.version ? '✓' : '—'}</span></div>
    <div class="flex justify-between"><span>库存审核</span><span>${a.inventory === state.version ? '✓' : '—'}</span></div>
    <div class="flex justify-between"><span>图稿审核</span><span>${a.visual === state.version ? '✓' : '—'}</span></div>
    <div class="flex justify-between"><span>现场验收</span><span>${(a.designSite === state.version && a.salesSite === state.version) ? '✓' : '—'}</span></div>
  `;
  $('#events-panel').innerHTML = (state.events || []).slice().reverse().map(e => `
    <div class="border-l-2 border-gray-200 pl-2 py-1">
      <div class="text-gray-800">${e.type} <span class="text-gray-400">· ${e.role}</span></div>
      <div class="text-gray-400">${new Date(e.at).toLocaleString()} · v${e.version}</div>
    </div>
  `).join('');
}

async function newProject() {
  state = await api('/api/projects', { method: 'POST' });
  currentStep = 'demand';
  renderSteps();
  renderWorkspace();
  renderContext();
}

async function init() {
  try {
    platformConfig = await api('/api/config');
    console.log('平台配置', platformConfig);
  } catch (e) {
    console.log('读取配置失败', e);
  }
  $('#btn-new-project').addEventListener('click', newProject);
  $('#role-select').addEventListener('change', () => { renderSteps(); renderWorkspace(); });
  renderSteps();
  renderWorkspace();
  renderContext();
  // 自动创建一个演示项目
  await newProject();
}

init();
