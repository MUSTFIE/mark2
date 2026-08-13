/**
 * core.js — 狀態、本機儲存、分路徑同步、領域邏輯
 */
let auth = null;
let db = null;
let currentUser = null;
let syncing = false;
let cloudConnected = true;

// 增量同步：只上傳變更過的模組
const DIRTY = { records: false, accounts: false, liabilities: false, mpfData: false, rates: false };
const KEY_TO_MODULE = {
  [STORAGE_KEY]: 'records',
  [ACCOUNTS_KEY]: 'accounts',
  [LIABILITIES_KEY]: 'liabilities',
  [MPF_KEY]: 'mpfData',
  [RATES_KEY]: 'rates'
};
/** 單筆雲端操作佇列 id -> { type:'upsert'|'remove', data? } */
const pendingRecordOps = new Map();
const pendingAccountOps = new Map();
const pendingLiabilityOps = new Map();
const pendingMpfOps = new Map();

function listToMap(list) {
  const map = {};
  (list || []).forEach(item => {
    if (item && item.id != null) map[String(item.id)] = item;
  });
  return map;
}
function mapToList(mapOrArr) {
  if (!mapOrArr) return [];
  if (Array.isArray(mapOrArr)) return mapOrArr.filter(Boolean);
  return Object.keys(mapOrArr).map(k => mapOrArr[k]).filter(Boolean);
}
const recordsToMap = listToMap;
const mapToRecords = mapToList;

function queueOp(map, id, type, data) {
  if (id == null) return;
  map.set(String(id), type === 'remove' ? { type: 'remove' } : { type: 'upsert', data: stripUndefined(data) });
  if (currentUser) scheduleCloudSync(false);
}
function queueRecordUpsert(rec) { queueOp(pendingRecordOps, rec && rec.id, 'upsert', rec); }
function queueRecordRemove(id) { queueOp(pendingRecordOps, id, 'remove'); }
function queueAccountUpsert(acc) { queueOp(pendingAccountOps, acc && acc.id, 'upsert', acc); }
function queueAccountRemove(id) { queueOp(pendingAccountOps, id, 'remove'); }
function queueLiabilityUpsert(l) { queueOp(pendingLiabilityOps, l && l.id, 'upsert', l); }
function queueLiabilityRemove(id) { queueOp(pendingLiabilityOps, id, 'remove'); }

function queueRecordsFullSync() {
  DIRTY.records = true;
  pendingRecordOps.clear();
  if (currentUser) scheduleCloudSync(false);
}
function queueAccountsFullSync() {
  DIRTY.accounts = true;
  pendingAccountOps.clear();
  if (currentUser) scheduleCloudSync(false);
}
function queueLiabilitiesFullSync() {
  DIRTY.liabilities = true;
  pendingLiabilityOps.clear();
  if (currentUser) scheduleCloudSync(false);
}
function queueMpfFullSync() {
  DIRTY.mpfData = true;
  pendingMpfOps.clear();
  if (currentUser) scheduleCloudSync(false);
}
function queueMpfUpsert(acc) { queueOp(pendingMpfOps, acc && acc.id, 'upsert', acc); }
function queueMpfRemove(id) { queueOp(pendingMpfOps, id, 'remove'); }
function saveRecordsLocal() { writeLocalOnly(STORAGE_KEY, records); }
function saveAccountsLocal() { writeLocalOnly(ACCOUNTS_KEY, accounts); }
function saveLiabilitiesLocal() { writeLocalOnly(LIABILITIES_KEY, liabilities); }
function saveMpfLocal() { writeLocalOnly(MPF_KEY, mpfData); }

/** 只同步指定 id 的戶口（轉帳／還款等多戶口變動時用） */
function queueAccountsUpsertByIds(ids) {
  const set = new Set((ids || []).filter(Boolean).map(String));
  set.forEach(id => {
    const acc = accounts.find(a => String(a.id) === id);
    if (acc) queueAccountUpsert(acc);
  });
}

/** 依紀錄推斷需同步的戶口 id */
function accountIdsTouchedByRecord(rec) {
  if (!rec) return [];
  const ids = [rec.accountId, rec.toAccountId, rec.repayToId, rec.recvAccountId, rec.displayAccountId, rec.viaWalletId];
  return [...new Set(ids.filter(Boolean).map(String))];
}


/**
 * 分路徑寫：組出相對於 users/{uid} 的 update payload
 * 單筆：recordMap/{id}、accountMap/{id}…
 * 整包：recordMap = {…} 並清掉舊陣列欄位 records
 */
function flushPendingOpsToUpdates(updates, opsMap, cloudPath, fullDirty, fullList) {
  if (fullDirty) {
    updates[cloudPath] = stripUndefined(listToMap(fullList));
    const legacy = ({ recordMap: 'records', accountMap: 'accounts', liabilityMap: 'liabilities' })[cloudPath];
    if (legacy) updates[legacy] = null;
    opsMap.clear();
    return;
  }
  opsMap.forEach((op, id) => {
    const p = cloudPath + '/' + id;
    if (op.type === 'remove') updates[p] = null;
    else updates[p] = op.data;
  });
}
const PREFS_KEY = 'accounting_prefs_v1';
const SYNC_DEBOUNCE_MS = 600;

function genId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function loadPrefs() {
  try {
    const d = localStorage.getItem(PREFS_KEY);
    return d ? JSON.parse(d) : {};
  } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (_) {}
}
function getPref(k, fallback) {
  const p = loadPrefs();
  return p[k] != null ? p[k] : fallback;
}
function setPref(k, v) {
  const p = loadPrefs();
  p[k] = v;
  savePrefs(p);
}

/** 輕量提示（取代部分 alert） */
function toast(msg, type = 'info') {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'app-toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.remove('show'); }, 2600);
}

function setSyncStatus(state, detail = '') {
  // state: idle | syncing | ok | err | offline
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    idle: { t: '', cls: '' },
    syncing: { t: '同步中…', cls: 'syncing' },
    ok: { t: '已同步', cls: 'ok' },
    err: { t: detail || '同步失敗', cls: 'err' },
    offline: { t: '離線', cls: 'offline' }
  };
  const m = map[state] || map.idle;
  el.textContent = m.t;
  el.className = 'sync-status ' + m.cls;
  el.title = detail || m.t;
}

function updateOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const offline = !navigator.onLine || (firebaseReady && currentUser && !cloudConnected);
  banner.classList.toggle('hidden', !offline);
  if (offline) setSyncStatus('offline');
}

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function formatMoney(n) {
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** 本地曆日期 YYYY-MM-DD（避免 toISOString 時區偏移） */
function formatDateLocal(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** 解析 YYYY-MM-DD 為本地 00:00 */
function parseDateLocal(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
/** 今天本地日期字串 */
function todayLocalStr() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return formatDateLocal(t);
}

function money(currency, n) {
  return `${currency} ${formatMoney(n)}`;
}
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function scopedKey(key) {
  // 已登入：本機快取依 uid 分開；未登入：使用訪客鍵
  return (currentUser && currentUser.uid) ? `${key}__${currentUser.uid}` : key;
}
function loadJSON(key, fallback) {
  try {
    const d = localStorage.getItem(scopedKey(key));
    return d ? JSON.parse(d) : fallback;
  } catch { return fallback; }
}
function loadJSONRaw(key, fallback) {
  // 強制讀取未加 uid 的訪客鍵
  try {
    const d = localStorage.getItem(key);
    return d ? JSON.parse(d) : fallback;
  } catch { return fallback; }
}
function writeLocalOnly(key, val) {
  localStorage.setItem(scopedKey(key), JSON.stringify(val));
}
function saveJSON(key, val) {
  localStorage.setItem(scopedKey(key), JSON.stringify(val));
  // 只有已登入才同步到該帳戶雲端；訪客資料絕不寫入任何帳戶
  if (currentUser) {
    const mod = KEY_TO_MODULE[key];
    if (mod) markDirty(mod);
    else scheduleCloudSync(true);
  }
}
function saveJSONRaw(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}
function markDirty(mod) {
  if (!DIRTY.hasOwnProperty(mod)) return;
  DIRTY[mod] = true;
  scheduleCloudSync(false);
}
function markAllDirty() {
  Object.keys(DIRTY).forEach(k => { DIRTY[k] = true; });
}

function loadRates() {
  const p = loadJSON(RATES_KEY, null);
  return p ? { ...DEFAULT_RATES, ...p, MOP: 1 } : { ...DEFAULT_RATES };
}
function saveRatesObj(r) {
  saveJSON(RATES_KEY, { HKD: r.HKD, CNY: r.CNY, HKD_CNY: r.HKD_CNY });
}
let rates = loadRates();

function toMOP(amount, currency) {
  if (currency === 'HKD') return (Number(amount) || 0) * rates.HKD;
  if (currency === 'CNY') return (Number(amount) || 0) * rates.CNY;
  return Number(amount) || 0;
}
function balancesToMOP(b) {
  if (!b) return 0;
  return toMOP(b.MOP || 0, 'MOP') + toMOP(b.HKD || 0, 'HKD') + toMOP(b.CNY || 0, 'CNY');
}
/** 以 id 找戶口（線性；資料量小足夠） */
function findAccountById(id) {
  if (id == null || id === '') return null;
  return accounts.find(a => a.id === id) || null;
}
function isRepayment(r) {
  return r.category === '信用卡還款' || !!r.repayToId;
}
function isTransfer(r) {
  return r && (r.type === 'transfer' || r.category === '內部轉帳');
}
/** 信用卡消費（非還款）：記在信用卡戶口的支出 */
function isCreditCardPurchase(r) {
  if (!r || r.type !== 'expense' || isRepayment(r) || isTransfer(r)) return false;
  if (isAdvance(r) || isCollectReceivable(r)) return false;
  const acc = accounts.find(a => a.id === r.accountId);
  return !!(acc && acc.type === '信用卡');
}
/** 代墊紀錄（含自費與應收拆分） */
function isAdvance(r) {
  return !!(r && (r.isAdvance || r.category === '代墊'));
}
/** 存錢：不計消費支出，但扣結餘與戶口 */
function isSavings(r) {
  return !!(r && (r.isSavings || r.category === '存錢'));
}
/** 收回應收 */
function isCollectReceivable(r) {
  return !!(r && (r.isCollectReceivable || r.category === '收回應收'));
}
/** 日息／利息：只進戶口流水，不計入收入 */
function isInterest(r) {
  return !!(r && (r.isInterest || r.category === '利息收入'));
}
/** 戶口餘額調整：只影響戶口，不計入收入／支出 */
function isAdjustment(r) {
  return !!(r && (r.isAdjustment || r.category === '戶口調整'));
}
/** 不計入消費支出／收入的特殊紀錄 */
function isNonOperating(r) {
  return isTransfer(r) || isAdvance(r) || isCollectReceivable(r) || isInterest(r) || isAdjustment(r);
}
function getReceivableAccount() {
  return accounts.find(a => a.type === '應收帳款') || null;
}
/** 各幣互轉（經 MOP） */
function convertAmount(amount, fromCur, toCur) {
  const mop = toMOP(amount, fromCur);
  if (toCur === 'MOP') return mop;
  if (toCur === 'HKD') return rates.HKD ? mop / rates.HKD : mop;
  if (toCur === 'CNY') return rates.CNY ? mop / rates.CNY : mop;
  return mop;
}
function currencyChipsHtml(balances) {
  const b = balances || {};
  const parts = [];
  ['MOP', 'HKD', 'CNY'].forEach(c => {
    const v = Number(b[c]) || 0;
    if (v === 0) return;
    parts.push(`<div class="currency-chip"><span class="cc-code">${c}</span><span class="cc-val">${formatMoney(v)}</span></div>`);
  });
  if (!parts.length) {
    parts.push(`<div class="currency-chip"><span class="cc-code">—</span><span class="cc-val">0</span></div>`);
  }
  return `<div class="currency-chips">${parts.join('')}</div>`;
}

let records = loadJSON(STORAGE_KEY, []);
// 去掉舊資料中的 undefined（JSON 再 parse 會自動去掉）
try { records = JSON.parse(JSON.stringify(records)); } catch (_) {}
let accounts = loadJSON(ACCOUNTS_KEY, []);
accounts = accounts.map(a => {
  if (a.balances) {
    return {
      ...a,
      linkedBankId: a.linkedBankId || '',
      interestRate: a.interestRate || 0,
      interestPeriod: a.interestPeriod || 'yearly',
      lastInterestDate: a.lastInterestDate || ''
    };
  }
  const bal = { MOP: 0, HKD: 0, CNY: 0 };
  if (a.currency && a.balance != null) bal[a.currency] = Number(a.balance);
  return {
    id: a.id, name: a.name, type: a.type, balances: bal, note: a.note || '',
    linkedBankId: '', interestRate: 0, interestPeriod: 'yearly', lastInterestDate: ''
  };
});
saveJSON(ACCOUNTS_KEY, accounts);
let liabilities = loadJSON(LIABILITIES_KEY, []);
let mpfData = loadJSON(MPF_KEY, { accounts: [] });
if (!mpfData.accounts) mpfData = { accounts: [] };

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentType = 'expense';
let currentPage = 'monthly';
let filters = { type: '', category: '', account: '', currency: '' };
let expandedAccountId = null;
let expandedAccountTypes = new Set(); // 空 = 各類型預設收合
let sectionCollapseState = { dist: false, accounts: false, mpf: false, liabilities: false };
let ledgerFilterMonth = ''; // '' = 全部, 'YYYY-MM'
let expandedMpfId = null;
let expandedAssetGroup = null; // e.g. '銀行'
let mpfViewYear = new Date().getFullYear();
let mpfViewMonth = new Date().getMonth(); // 0-11

function renderBarList(container, items) {
  container.innerHTML = '';
  if (!items.length) return;
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  const sum = items.reduce((s, i) => s + Math.abs(i.value), 0) || 1;
  items.forEach((item, idx) => {
    const pct = (Math.abs(item.value) / max) * 100;
    const share = ((Math.abs(item.value) / sum) * 100).toFixed(1);
    const color = item.color || BAR_COLORS[idx % BAR_COLORS.length];
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-row-top">
        <span class="bar-label">${item.label}</span>
        <span class="bar-val">MOP ${formatMoney(item.value)}（${share}%）</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
    container.appendChild(row);
  });
}

function initFirebase() {
  if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.databaseURL) {
    console.info('Firebase 未設定，使用本機模式');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
    firebaseReady = true;
    // 連線狀態
    db.ref('.info/connected').on('value', snap => {
      cloudConnected = !!snap.val();
      updateOfflineBanner();
      if (cloudConnected && currentUser && Object.values(DIRTY).some(Boolean)) {
        scheduleCloudSync(false);
      }
    });
    window.addEventListener('online', updateOfflineBanner);
    window.addEventListener('offline', updateOfflineBanner);
    auth.onAuthStateChanged(async user => {
      const prev = currentUser;
      currentUser = user;
      updateAuthButton();
      if (user) {
        await onUserSignedIn(user);
      } else if (prev) {
        loadGuestDataIntoMemory();
        setSyncStatus('idle');
        switchPage(currentPage);
      }
    });
  } catch (err) {
    console.error('Firebase 初始化失敗', err);
    firebaseReady = false;
  }
}

function updateAuthButton() {
  const btn = $('#btn-auth');
  if (!btn) return;
  if (!firebaseReady) {
    btn.title = '未設定 Firebase';
    btn.textContent = '👤';
    btn.classList.remove('logged-in');
    return;
  }
  if (currentUser) {
    btn.title = currentUser.email || '已登入';
    btn.textContent = '☁️';
    btn.classList.add('logged-in');
  } else {
    btn.title = 'Google 登入';
    btn.textContent = '👤';
    btn.classList.remove('logged-in');
  }
}

function applyDataPayload(data) {
  if (data.recordMap && typeof data.recordMap === 'object' && !Array.isArray(data.recordMap)) {
    records = mapToList(data.recordMap);
  } else if (Array.isArray(data.records)) {
    records = data.records;
  } else if (data.records && typeof data.records === 'object') {
    records = mapToList(data.records);
  } else {
    records = [];
  }
  if (data.accountMap && typeof data.accountMap === 'object' && !Array.isArray(data.accountMap)) {
    accounts = mapToList(data.accountMap);
  } else if (Array.isArray(data.accounts)) {
    accounts = data.accounts;
  } else if (data.accounts && typeof data.accounts === 'object') {
    accounts = mapToList(data.accounts);
  } else {
    accounts = [];
  }
  if (data.liabilityMap && typeof data.liabilityMap === 'object' && !Array.isArray(data.liabilityMap)) {
    liabilities = mapToList(data.liabilityMap);
  } else if (Array.isArray(data.liabilities)) {
    liabilities = data.liabilities;
  } else if (data.liabilities && typeof data.liabilities === 'object') {
    liabilities = mapToList(data.liabilities);
  } else {
    liabilities = [];
  }
  if (data.mpfMap && typeof data.mpfMap === 'object' && !Array.isArray(data.mpfMap)) {
    mpfData = { accounts: mapToList(data.mpfMap) };
  } else if (data.mpfData && Array.isArray(data.mpfData.accounts)) {
    mpfData = data.mpfData;
  } else {
    mpfData = { accounts: [] };
  }
  rates = data.rates
    ? { ...DEFAULT_RATES, ...data.rates, MOP: 1 }
    : { ...DEFAULT_RATES };
}

function loadGuestDataIntoMemory() {
  // 讀取訪客鍵（不加 uid）
  records = loadJSONRaw(STORAGE_KEY, []);
  try { records = JSON.parse(JSON.stringify(records)); } catch (_) {}
  accounts = loadJSONRaw(ACCOUNTS_KEY, []);
  accounts = (accounts || []).map(a => {
    if (a.balances) {
      return {
        ...a,
        linkedBankId: a.linkedBankId || '',
        interestRate: a.interestRate || 0,
        interestPeriod: a.interestPeriod || 'yearly',
        lastInterestDate: a.lastInterestDate || ''
      };
    }
    const bal = { MOP: 0, HKD: 0, CNY: 0 };
    if (a.currency && a.balance != null) bal[a.currency] = Number(a.balance);
    return {
      id: a.id, name: a.name, type: a.type, balances: bal, note: a.note || '',
      linkedBankId: '', interestRate: 0, interestPeriod: 'yearly', lastInterestDate: ''
    };
  });
  liabilities = loadJSONRaw(LIABILITIES_KEY, []);
  mpfData = loadJSONRaw(MPF_KEY, { accounts: [] });
  if (!mpfData || !mpfData.accounts) mpfData = { accounts: [] };
  const p = loadJSONRaw(RATES_KEY, null);
  rates = p ? { ...DEFAULT_RATES, ...p, MOP: 1 } : { ...DEFAULT_RATES };
}

function persistLocal(sync = true) {
  // sync=false：只寫本機快取（登入載入雲端後用，避免整包回寫）
  if (sync) {
    saveJSON(STORAGE_KEY, records);
    saveJSON(ACCOUNTS_KEY, accounts);
    saveJSON(LIABILITIES_KEY, liabilities);
    saveJSON(MPF_KEY, mpfData);
    saveRatesObj(rates);
  } else {
    writeLocalOnly(STORAGE_KEY, records);
    writeLocalOnly(ACCOUNTS_KEY, accounts);
    writeLocalOnly(LIABILITIES_KEY, liabilities);
    writeLocalOnly(MPF_KEY, mpfData);
    writeLocalOnly(RATES_KEY, { HKD: rates.HKD, CNY: rates.CNY, HKD_CNY: rates.HKD_CNY });
  }
}

function persistGuestSnapshotFromMemory() {
  // 登入前把目前記憶體（訪客）寫回訪客鍵，避免被帳戶資料覆蓋
  saveJSONRaw(STORAGE_KEY, records);
  saveJSONRaw(ACCOUNTS_KEY, accounts);
  saveJSONRaw(LIABILITIES_KEY, liabilities);
  saveJSONRaw(MPF_KEY, mpfData);
  saveJSONRaw(RATES_KEY, { HKD: rates.HKD, CNY: rates.CNY, HKD_CNY: rates.HKD_CNY });
}

async function onUserSignedIn(user) {
  // 先保存訪客資料到訪客鍵，稍後登出可還原；絕不把訪客資料自動寫入此帳戶
  if (!onUserSignedIn._guestSaved) {
    persistGuestSnapshotFromMemory();
    onUserSignedIn._guestSaved = true;
  }

  let cloud = null;
  try {
    const snap = await db.ref('users/' + user.uid).once('value');
    cloud = snap.val();
  } catch (err) {
    console.error(err);
    toast('讀取雲端資料失敗：' + (err.message || err), 'err');
  }

  if (cloud && (cloud.records || cloud.recordMap || cloud.accounts || cloud.accountMap || cloud.mpfData || cloud.mpfMap || cloud.liabilities || cloud.liabilityMap)) {
    // 僅載入此帳戶雲端資料
    applyDataPayload(cloud);
  } else {
    // 此帳戶尚無資料 → 使用空白資料，不合併訪客本機資料
    applyDataPayload({
      records: [],
      accounts: [],
      liabilities: [],
      mpfData: { accounts: [] },
      rates: { ...DEFAULT_RATES }
    });
  }

  // 寫入此 uid 的本機快取（不觸發整包上傳）
  persistLocal(false);
  toast('已載入帳戶資料', 'ok');
  setSyncStatus('ok');
  switchPage(currentPage);
}

/** Firebase RTDB 不接受 undefined，用 JSON 去掉後再寫入 */
function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function pushAllToCloud(forceAll = false) {
  if (!firebaseReady || !currentUser || !db) return;
  if (forceAll) {
    markAllDirty();
    pendingRecordOps.clear();
    pendingAccountOps.clear();
    pendingLiabilityOps.clear();
    pendingMpfOps.clear();
  }
  const mods = Object.keys(DIRTY).filter(k => DIRTY[k]);
  const hasOps = pendingRecordOps.size + pendingAccountOps.size + pendingLiabilityOps.size + pendingMpfOps.size;
  if (!mods.length && !hasOps) return;

  // 快照佇列，送出期間仍可繼續累積新操作
  const snapRec = new Map(pendingRecordOps);
  const snapAcc = new Map(pendingAccountOps);
  const snapLiab = new Map(pendingLiabilityOps);
  const snapMpf = new Map(pendingMpfOps);
  if (!DIRTY.records) pendingRecordOps.clear();
  if (!DIRTY.accounts) pendingAccountOps.clear();
  if (!DIRTY.liabilities) pendingLiabilityOps.clear();
  if (!DIRTY.mpfData) pendingMpfOps.clear();

  syncing = true;
  setSyncStatus('syncing');
  try {
    // 分路徑 update：相對於 users/{uid}
    // 例：{ 'recordMap/abc': {...}, 'accountMap/xyz': {...}, updatedAt: n }
    const updates = { updatedAt: Date.now() };
    flushPendingOpsToUpdates(updates, snapRec, 'recordMap', DIRTY.records, records);
    flushPendingOpsToUpdates(updates, snapAcc, 'accountMap', DIRTY.accounts, accounts);
    flushPendingOpsToUpdates(updates, snapLiab, 'liabilityMap', DIRTY.liabilities, liabilities);
    if (DIRTY.mpfData) {
      updates.mpfMap = stripUndefined(listToMap(mpfData.accounts || []));
      updates.mpfData = null; // 清舊結構
      snapMpf.clear();
    } else if (snapMpf.size) {
      snapMpf.forEach((op, id) => {
        const p = 'mpfMap/' + id;
        if (op.type === 'remove') updates[p] = null;
        else updates[p] = op.data;
      });
    }
    if (DIRTY.rates) {
      updates['rates/HKD'] = rates.HKD;
      updates['rates/CNY'] = rates.CNY;
      updates['rates/HKD_CNY'] = rates.HKD_CNY;
    }
    await db.ref('users/' + currentUser.uid).update(stripUndefined(updates));
    mods.forEach(k => { DIRTY[k] = false; });
    setSyncStatus('ok');
  } catch (err) {
    console.error(err);
    const requeue = (snap, live, fullKey) => {
      if (DIRTY[fullKey]) return;
      snap.forEach((op, id) => { if (!live.has(id)) live.set(id, op); });
    };
    requeue(snapRec, pendingRecordOps, 'records');
    requeue(snapAcc, pendingAccountOps, 'accounts');
    requeue(snapLiab, pendingLiabilityOps, 'liabilities');
    requeue(snapMpf, pendingMpfOps, 'mpfData');
    setSyncStatus('err', err.message || String(err));
    toast('同步失敗：' + (err.message || err), 'err');
  }
  syncing = false;
  if (Object.values(DIRTY).some(Boolean) || pendingRecordOps.size || pendingAccountOps.size || pendingLiabilityOps.size || pendingMpfOps.size) {
    scheduleCloudSync(false);
  }
}

function scheduleCloudSync(forceAll = false) {
  if (!firebaseReady || !currentUser) return;
  if (forceAll) markAllDirty();
  clearTimeout(scheduleCloudSync._t);
  scheduleCloudSync._t = setTimeout(() => pushAllToCloud(false), SYNC_DEBOUNCE_MS);
}

async function handleAuthClick() {
  if (!firebaseReady) {
    alert('請先在 js/config.js 填入 FIREBASE_CONFIG（Firebase 專案設定）');
    return;
  }
  if (currentUser) {
    if (confirm('確定要登出？')) {
      // 登出前先把目前帳戶資料推上雲端
      try { await pushAllToCloud(true); } catch (_) {}
      onUserSignedIn._guestSaved = false;
      await auth.signOut();
    }
  } else {
    // 登入前先把訪客資料存好
    persistGuestSnapshotFromMemory();
    onUserSignedIn._guestSaved = true;
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      toast('登入失敗：' + err.message, 'err');
    }
  }
}
