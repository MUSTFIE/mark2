const STORAGE_KEY = 'accounting_records_v2';
const RATES_KEY = 'accounting_rates_v2';
const ACCOUNTS_KEY = 'accounting_accounts_v2';
const LIABILITIES_KEY = 'accounting_liabilities_v1';
const MPF_KEY = 'accounting_mpf_v3';
const CUSTOM_CAT_SUM_KEY = 'accounting_custom_cat_sum_v1';
const INTEREST_FLOOR = '2026-08-08';

const DEFAULT_RATES = { MOP: 1, HKD: 1.03, CNY: 1.196, HKD_CNY: 0.86 };
const CATEGORIES = [
  { name: '餐飲', icon: '🍔' }, { name: '交通', icon: '🚗' }, { name: '購物', icon: '🛍️' },
  { name: '娛樂', icon: '🎮' }, { name: '居住', icon: '🏠' }, { name: '母嬰', icon: '👶' },
  { name: '保險費', icon: '🛡️' }, { name: '學貸', icon: '🎓' }, { name: '生活費', icon: '💵' },
  { name: '薪資', icon: '💼' }, { name: '電話費', icon: '📞' }, { name: '電費', icon: '⚡' },
  { name: '淘寶', icon: '🛒' }, { name: '上網費', icon: '🌐' }, { name: '醫療', icon: '🏥' },
  { name: '信用卡還款', icon: '💳' }, { name: '戶口調整', icon: '⚖️' }, { name: '其他', icon: '🏷️' },
  { name: '代墊', icon: '🧾' }, { name: '存錢', icon: '🐷' }, { name: '收回應收', icon: '📥' }, { name: '利息收入', icon: '💹' }
];
const CATEGORY_ICONS = Object.fromEntries(CATEGORIES.map(c => [c.name, c.icon]));
const ACCOUNT_TYPE_ICONS = {
  '現金':'💵','銀行':'🏦','信用卡':'💳','電子錢包':'📱','投資':'📈','其他':'🏷️','應收帳款':'🧾'
};
const TYPE_ORDER = ['銀行','信用卡','電子錢包','現金','投資','應收帳款','其他'];
const BAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9'];

// ========== Firebase 設定（請填入你的專案） ==========
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAr_4P8sHYFDH2ZIW-04kvN8baHaePxxQ8',
  authDomain: 'financial-record-e41e9.firebaseapp.com',
  databaseURL: 'https://financial-record-e41e9-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'financial-record-e41e9',
  storageBucket: 'financial-record-e41e9.firebasestorage.app',
  messagingSenderId: '1022975525620',
  appId: '1:1022975525620:web:c918f787d51aae670214a1'
};
let firebaseReady = false;
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
const SYNC_DEBOUNCE_MS = 400;

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
function money(currency, n) {
  return `${currency} ${formatMoney(n)}`;
}
function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
/** 不計入消費支出／收入的特殊紀錄 */
function isNonOperating(r) {
  return isTransfer(r) || isAdvance(r) || isCollectReceivable(r) || isInterest(r);
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
let expandedAccountTypes = null; // null = 全部展開
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
    alert('請先在 app.js 填入 FIREBASE_CONFIG（Firebase 專案設定）');
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

function init() {
  if ($('#date')) $('#date').valueAsDate = new Date();
  initFirebase();
  updateAuthButton();

  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
  $('#btn-add').addEventListener('click', openAddModal);
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#btn-prev-month').addEventListener('click', () => changeMonth(-1));
  $('#btn-next-month').addEventListener('click', () => changeMonth(1));
  $('#record-form').addEventListener('submit', handleRecordSubmit);
  $('#category').addEventListener('change', onCategoryChange);
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
    });
  });
  $('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
  $('#btn-auth').addEventListener('click', handleAuthClick);
  $('#btn-mpf-prev-month').addEventListener('click', () => {
    mpfViewMonth--;
    if (mpfViewMonth < 0) { mpfViewMonth = 11; mpfViewYear--; }
    if (currentPage === 'assets') renderAssets(); else renderMpf();
  });
  $('#btn-mpf-next-month').addEventListener('click', () => {
    mpfViewMonth++;
    if (mpfViewMonth > 11) { mpfViewMonth = 0; mpfViewYear++; }
    if (currentPage === 'assets') renderAssets(); else renderMpf();
  });

  $('#btn-toggle-filter').addEventListener('click', () => $('#filter-panel').classList.toggle('hidden'));
  $('#btn-filter-apply').addEventListener('click', () => {
    filters.type = $('#filter-type').value;
    filters.category = $('#filter-category').value;
    filters.account = $('#filter-account').value;
    filters.currency = $('#filter-currency')?.value || '';
    renderMonthRecords();
  });
  $('#btn-filter-reset').addEventListener('click', () => {
    filters = { type: '', category: '', account: '', currency: '' };
    $('#filter-type').value = '';
    $('#filter-category').value = '';
    $('#filter-account').value = '';
    if ($('#filter-currency')) $('#filter-currency').value = '';
    renderMonthRecords();
  });

  $('#btn-prev-year').addEventListener('click', () => { currentYear--; renderYearly(); });
  $('#btn-next-year').addEventListener('click', () => { currentYear++; renderYearly(); });
  const btnPrevMA = $('#btn-prev-month-analysis');
  const btnNextMA = $('#btn-next-month-analysis');
  if (btnPrevMA) btnPrevMA.addEventListener('click', () => changeMonth(-1));
  if (btnNextMA) btnNextMA.addEventListener('click', () => changeMonth(1));
  $$('.sub-tab').forEach(btn => btn.addEventListener('click', () => switchAnalysisSub(btn.dataset.sub)));

  $('#btn-add-account').addEventListener('click', openAddAccountModal);
  $('#btn-close-account-modal').addEventListener('click', closeAccountModal);
  $('#btn-cancel-account').addEventListener('click', closeAccountModal);
  $('#account-form').addEventListener('submit', handleAccountSubmit);
  $('#account-type').addEventListener('change', onAccountTypeChange);
  $('#account-modal-overlay').addEventListener('click', e => { if (e.target.id === 'account-modal-overlay') closeAccountModal(); });

  $('#btn-repay').addEventListener('click', openRepayModal);
  $('#btn-close-repay').addEventListener('click', closeRepayModal);
  $('#btn-cancel-repay').addEventListener('click', closeRepayModal);
  $('#repay-form').addEventListener('submit', handleRepaySubmit);
  $('#repay-modal-overlay').addEventListener('click', e => { if (e.target.id === 'repay-modal-overlay') closeRepayModal(); });

  $('#btn-transfer').addEventListener('click', openTransferModal);
  $('#btn-close-transfer').addEventListener('click', closeTransferModal);
  $('#btn-cancel-transfer').addEventListener('click', closeTransferModal);
  $('#transfer-form').addEventListener('submit', handleTransferSubmit);
  $('#transfer-modal-overlay').addEventListener('click', e => { if (e.target.id === 'transfer-modal-overlay') closeTransferModal(); });
  ['transfer-from-amount','transfer-from-currency','transfer-to-currency'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', autoFillTransferToAmount);
    if (el) el.addEventListener('change', autoFillTransferToAmount);
  });

  $('#btn-add-liability').addEventListener('click', openAddLiabilityModal);
  $('#btn-close-liability-modal').addEventListener('click', closeLiabilityModal);
  $('#btn-cancel-liability').addEventListener('click', closeLiabilityModal);
  $('#liability-form').addEventListener('submit', handleLiabilitySubmit);
  $('#liability-modal-overlay').addEventListener('click', e => { if (e.target.id === 'liability-modal-overlay') closeLiabilityModal(); });

  $('#btn-add-mpf-account').addEventListener('click', openAddMpfAccountModal);
  $('#btn-close-mpf-account').addEventListener('click', closeMpfAccountModal);
  $('#btn-cancel-mpf-account').addEventListener('click', closeMpfAccountModal);
  $('#mpf-account-form').addEventListener('submit', handleMpfAccountSubmit);
  $('#mpf-account-modal-overlay').addEventListener('click', e => { if (e.target.id === 'mpf-account-modal-overlay') closeMpfAccountModal(); });
  $('#btn-close-mpf-change').addEventListener('click', closeMpfChangeModal);
  $('#btn-cancel-mpf-change').addEventListener('click', closeMpfChangeModal);
  $('#mpf-change-form').addEventListener('submit', handleMpfChangeSubmit);
  $('#mpf-change-modal-overlay').addEventListener('click', e => { if (e.target.id === 'mpf-change-modal-overlay') closeMpfChangeModal(); });

  $('#btn-rates').addEventListener('click', openRatesModal);
  $('#btn-close-rates').addEventListener('click', closeRatesModal);
  $('#btn-reset-rates').addEventListener('click', resetRates);
  $('#rates-form').addEventListener('submit', handleRatesSubmit);
  $('#rates-modal-overlay').addEventListener('click', e => { if (e.target.id === 'rates-modal-overlay') closeRatesModal(); });

  // export
  $('#btn-export').addEventListener('click', () => $('#export-modal-overlay').classList.remove('hidden'));
  $('#btn-close-export').addEventListener('click', () => $('#export-modal-overlay').classList.add('hidden'));
  $('#export-modal-overlay').addEventListener('click', e => { if (e.target.id === 'export-modal-overlay') $('#export-modal-overlay').classList.add('hidden'); });
  $('#btn-csv-records').addEventListener('click', exportRecordsCSV);
  $('#btn-csv-accounts').addEventListener('click', exportAccountsCSV);
  $('#btn-csv-mpf').addEventListener('click', exportMpfCSV);
  $('#btn-backup-export').addEventListener('click', exportBackup);
  $('#btn-backup-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importBackup);
  const btnClearAll = $('#btn-clear-all');
  if (btnClearAll) btnClearAll.addEventListener('click', clearAllData);

  // 存錢
  const btnSav = $('#btn-savings');
  if (btnSav) btnSav.addEventListener('click', openSavingsModal);
  const btnCloseSav = $('#btn-close-savings');
  if (btnCloseSav) btnCloseSav.addEventListener('click', closeSavingsModal);
  const btnCancelSav = $('#btn-cancel-savings');
  if (btnCancelSav) btnCancelSav.addEventListener('click', closeSavingsModal);
  const savForm = $('#savings-form');
  if (savForm) savForm.addEventListener('submit', handleSavingsSubmit);
  const savOverlay = $('#savings-modal-overlay');
  if (savOverlay) savOverlay.addEventListener('click', e => { if (e.target.id === 'savings-modal-overlay') closeSavingsModal(); });

  // 代墊勾選（併入新增紀錄）
  const isAdvCb = $('#is-advance');
  if (isAdvCb) {
    isAdvCb.addEventListener('change', () => {
      const box = $('#advance-fields');
      if (box) box.classList.toggle('hidden', !isAdvCb.checked);
      if (isAdvCb.checked) {
        const amt = Number($('#amount')?.value) || 0;
        const selfEl = $('#advance-self-amt');
        const recvEl = $('#advance-recv-amt');
        if (selfEl && recvEl) {
          const selfV = Number(selfEl.value) || 0;
          recvEl.value = Math.max(0, +(amt - selfV).toFixed(2));
        }
      }
    });
  }
  const selfAmtEl = $('#advance-self-amt');
  if (selfAmtEl) {
    selfAmtEl.addEventListener('input', () => {
      const amt = Number($('#amount')?.value) || 0;
      const selfV = Number(selfAmtEl.value) || 0;
      const recvEl = $('#advance-recv-amt');
      if (recvEl) recvEl.value = Math.max(0, +(amt - selfV).toFixed(2));
    });
  }
  const amtEl = $('#amount');
  if (amtEl) {
    amtEl.addEventListener('input', () => {
      if (!$('#is-advance')?.checked) return;
      const amt = Number(amtEl.value) || 0;
      const selfV = Number($('#advance-self-amt')?.value) || 0;
      const recvEl = $('#advance-recv-amt');
      if (recvEl) recvEl.value = Math.max(0, +(amt - selfV).toFixed(2));
    });
  }

  // 舊代墊 modal（若仍存在）
  const btnCloseAdv = $('#btn-close-advance');
  if (btnCloseAdv) btnCloseAdv.addEventListener('click', closeAdvanceModal);
  const btnCancelAdv = $('#btn-cancel-advance');
  if (btnCancelAdv) btnCancelAdv.addEventListener('click', closeAdvanceModal);
  const advForm = $('#advance-form');
  if (advForm) advForm.addEventListener('submit', handleAdvanceSubmit);
  const advOverlay = $('#advance-modal-overlay');
  if (advOverlay) advOverlay.addEventListener('click', e => { if (e.target.id === 'advance-modal-overlay') closeAdvanceModal(); });
  ['advance-total', 'advance-self'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', () => {
      const total = Number($('#advance-total')?.value) || 0;
      const self = Number($('#advance-self')?.value) || 0;
      if ($('#advance-recv')) $('#advance-recv').value = Math.max(0, Math.round((total - self) * 100) / 100);
    });
  });

  const btnCol = $('#btn-collect');
  if (btnCol) btnCol.addEventListener('click', openCollectModal);
  const btnCloseCol = $('#btn-close-collect');
  if (btnCloseCol) btnCloseCol.addEventListener('click', closeCollectModal);
  const btnCancelCol = $('#btn-cancel-collect');
  if (btnCancelCol) btnCancelCol.addEventListener('click', closeCollectModal);
  const colForm = $('#collect-form');
  if (colForm) colForm.addEventListener('submit', handleCollectSubmit);
  const colOverlay = $('#collect-modal-overlay');
  if (colOverlay) colOverlay.addEventListener('click', e => { if (e.target.id === 'collect-modal-overlay') closeCollectModal(); });

  // 金額欄 Enter → 提交
  const amountInput = $('#amount');
  if (amountInput) {
    amountInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const form = $('#record-form');
        if (form) form.requestSubmit();
      }
    });
  }

  updateOfflineBanner();
  accrueDailyInterest();
  startInterestAutoAccrue();
  switchPage('monthly');
}

function switchPage(page) {
  currentPage = page;
  // 舊導航相容
  if (page === 'accounts' || page === 'mpf') page = 'assets';
  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $(`#page-${page}`);
  if (el) el.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page-only').forEach(btn => btn.classList.toggle('hidden', btn.dataset.page !== page));
  if (page === 'monthly') renderMonthly();
  else if (page === 'analysis') renderAnalysis();
  else if (page === 'assets') renderAssets();
}

let analysisSub = 'month';
function switchAnalysisSub(sub) {
  analysisSub = sub;
  $$('.sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  const monthPanel = $('#analysis-month');
  const yearPanel = $('#analysis-year');
  if (monthPanel) monthPanel.classList.toggle('active', sub === 'month');
  if (yearPanel) yearPanel.classList.toggle('active', sub === 'year');
  if (sub === 'month') renderAnalysisMonth();
  else renderYearly();
}

function renderAnalysis() {
  switchAnalysisSub(analysisSub);
}

function renderAnalysisMonth() {
  const label = $('#analysis-month-label');
  if (label) label.textContent = `${currentYear}年${currentMonth + 1}月`;
  renderMonthBars();
  renderCustomCatSum();
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  filters = { type: '', category: '', account: '', currency: '' };
  ['filter-type','filter-category','filter-account','filter-currency'].forEach(id => { const e = $('#'+id); if (e) e.value = ''; });
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'analysis') renderAnalysisMonth();
}

function getMonthRecords() {
  return records.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).sort((a, b) => new Date(b.date) - new Date(a.date) || String(b.id).localeCompare(String(a.id)));
}

function getFilteredMonthRecords() {
  return getMonthRecords().filter(r => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.account && r.accountId !== filters.account && r.displayAccountId !== filters.account) return false;
    if (filters.currency && r.currency !== filters.currency) return false;
    return true;
  });
}

function populateFilterOptions() {
  const monthRecs = getMonthRecords();
  const cats = [...new Set(monthRecs.map(r => r.category).filter(Boolean))];
  const catSel = $('#filter-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">全部</option>';
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = `${CATEGORY_ICONS[c] || ''} ${c}`;
      catSel.appendChild(o);
    });
    catSel.value = filters.category;
  }
  const accSel = $('#filter-account');
  if (accSel) {
    accSel.innerHTML = '<option value="">全部</option>';
    accounts.filter(a => a.type !== '電子錢包').forEach(a => {
      const o = document.createElement('option');
      o.value = a.id; o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
      accSel.appendChild(o);
    });
    accSel.value = filters.account;
  }
}

function renderMonthly() {
  $('#current-month-label').textContent = `${currentYear}年${currentMonth + 1}月`;
  // 消費支出：含刷卡、不含還款／代墊應收／存錢／收回
  // 實際支出：一般支出（非刷卡）+ 還款
  // 結餘：收入 − 消費支出 − 存錢
  let income = 0, consumption = 0, ccPurchase = 0, repayment = 0, savings = 0;
  getMonthRecords().forEach(r => {
    if (isTransfer(r) || isCollectReceivable(r) || isInterest(r)) return;
    if (isSavings(r)) {
      savings += toMOP(r.amount, r.currency);
      return;
    }
    // 代墊：只有「自費」計入消費；應收部分不計
    if (isAdvance(r)) {
      const selfAmt = toMOP(r.selfAmount != null ? r.selfAmount : 0, r.currency);
      if (selfAmt > 0) {
        consumption += selfAmt;
        const payAcc = accounts.find(a => a.id === r.accountId);
        if (payAcc && payAcc.type === '信用卡') ccPurchase += selfAmt;
      }
      return;
    }
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amt;
    else if (isRepayment(r)) repayment += amt;
    else if (r.type === 'expense') {
      consumption += amt;
      if (isCreditCardPurchase(r)) ccPurchase += amt;
    }
  });
  const actual = consumption - ccPurchase + repayment;
  $('#summary-expense').textContent = money('MOP', consumption);
  $('#summary-expense-all').textContent = money('MOP', actual);
  // 結餘：預算觀點（收入 − 消費支出 − 存錢）
  $('#summary-balance').textContent = money('MOP', income - consumption - savings);
  // 現金流結餘：現金觀點（收入 − 實際支出 − 存錢）
  const cashEl = $('#summary-cashflow');
  if (cashEl) cashEl.textContent = money('MOP', income - actual - savings);
  populateFilterOptions();
  renderMonthRecords();
}

function renderMonthBars() {
  const byCat = {};
  getMonthRecords().forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r)) return;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
      return;
    }
    if (r.type !== 'expense') return;
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    $('#categoryBars').innerHTML = '';
    $('#no-chart-data').style.display = 'block';
    return;
  }
  $('#no-chart-data').style.display = 'none';
  renderBarList($('#categoryBars'), sorted.map(([c, v]) => ({ label: `${CATEGORY_ICONS[c] || '🏷️'} ${c}`, value: v })));
}

function buildRecordItemHtml(r) {
  const icon = isTransfer(r) ? '⇄' : (isSavings(r) ? '🐷' : (CATEGORY_ICONS[r.category] || '🏷️'));
  const acc = accounts.find(a => a.id === (r.displayAccountId || r.accountId));
  const toAcc = r.toAccountId ? accounts.find(a => a.id === r.toAccountId) : null;
  const wallet = r.viaWalletId ? accounts.find(a => a.id === r.viaWalletId) : null;
  const sign = isTransfer(r) || isCollectReceivable(r) ? '' : (r.type === 'income' ? '+' : '−');
  let amtText;
  let amtCls = '';
  if (isTransfer(r) || isCollectReceivable(r)) {
    amtText = `${formatMoney(r.amount)}→${formatMoney(r.toAmount ?? r.amount)}`;
    amtCls = '';
  } else if (isAdvance(r)) {
    const parts = [];
    if (r.selfAmount != null && Number(r.selfAmount) > 0) parts.push(`自${formatMoney(r.selfAmount)}`);
    if (r.recvAmount) parts.push(`收${formatMoney(r.recvAmount)}`);
    amtText = `−${formatMoney(r.amount)}` + (parts.length ? `(${parts.join(' ')})` : '');
    amtCls = 'expense';
  } else if (r.type === 'income' || isInterest(r)) {
    amtText = `${sign || '+'}${formatMoney(r.amount)}`;
    amtCls = 'income';
  } else {
    amtText = `${sign}${formatMoney(r.amount)}`;
    amtCls = 'expense';
  }
  const cur = r.currency || 'MOP';
  let metaParts = [];
  if (isTransfer(r) || isCollectReceivable(r)) {
    metaParts.push(`${acc ? escapeHtml(acc.name) : ''}→${toAcc ? escapeHtml(toAcc.name) : ''}`);
  } else {
    if (acc) metaParts.push(escapeHtml(acc.name));
    if (wallet) metaParts.push(escapeHtml(wallet.name));
  }
  if (r.note) {
    const n = String(r.note);
    metaParts.push(escapeHtml(n.length > 16 ? n.slice(0, 16) + '…' : n));
  }
  const meta = metaParts.filter(Boolean).join(' · ');
  return `
    <div class="record-item compact">
      <div class="record-main">
        <span class="record-category">${icon} ${escapeHtml(r.category)}</span>
        ${meta ? `<span class="record-meta">${meta}</span>` : ''}
      </div>
      <div class="record-right">
        <span class="record-amount ${amtCls}">${amtText} <span class="record-currency">${cur}</span></span>
        <span class="record-actions">
          <button type="button" class="edit icon-btn" data-id="${r.id}" title="編輯">✎</button>
          <button type="button" class="delete icon-btn" data-id="${r.id}" title="刪除">✕</button>
        </span>
      </div>
    </div>`;
}

function bindRecordActions(el) {
  el.querySelectorAll('.edit').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const rec = records.find(x => x.id === btn.dataset.id);
    if (rec && isAdvance(rec)) { alert('代墊紀錄請刪除後重新新增'); return; }
    if (rec && isCollectReceivable(rec)) { alert('收回紀錄請刪除後重新新增'); return; }
    if (rec && isTransfer(rec)) openTransferModal(rec.id);
    else openEditModal(btn.dataset.id);
  }));
  el.querySelectorAll('.delete').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); deleteRecord(btn.dataset.id); }));
}

function renderMonthRecords() {
  const list = getFilteredMonthRecords().slice().sort((a, b) => {
    const ta = a.createdAt || a.date || '';
    const tb = b.createdAt || b.date || '';
    return tb.localeCompare(ta) || String(b.id).localeCompare(String(a.id));
  });
  const el = $('#records-list');
  el.innerHTML = '';
  if (!list.length) {
    $('#no-records').style.display = 'block';
    $('#no-records').textContent = getMonthRecords().length ? '沒有符合篩選的紀錄' : '本月尚無紀錄';
    return;
  }
  $('#no-records').style.display = 'none';

  // Group by date (YYYY-MM-DD), keep time order within day
  const byDate = {};
  list.forEach(r => {
    const d = String(r.date || '').slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  dates.forEach((date, idx) => {
    const dayRecs = byDate[date];
    let dayIncome = 0, dayExpense = 0, daySavings = 0;
    dayRecs.forEach(r => {
      if (isTransfer(r) || isCollectReceivable(r) || isInterest(r)) return;
      if (isSavings(r)) { daySavings += toMOP(r.amount, r.currency); return; }
      if (isAdvance(r)) {
        const selfAmt = toMOP(r.selfAmount != null ? r.selfAmount : 0, r.currency);
        if (selfAmt > 0) dayExpense += selfAmt;
        return;
      }
      const amt = toMOP(r.amount, r.currency);
      if (r.type === 'income') dayIncome += amt;
      else if (r.type === 'expense' && !isRepayment(r)) dayExpense += amt;
    });
    const group = document.createElement('div');
    group.className = 'day-group' + (idx < 3 ? ' expanded' : '') + ' day-alt-' + (idx % 2);
    const weekday = ['日','一','二','三','四','五','六'][new Date(date + 'T00:00:00').getDay()];
    group.innerHTML = `
      <button type="button" class="day-group-header">
        <span class="day-group-title">
          <span class="day-chevron">▼</span>
          ${date}（週${weekday}）· ${dayRecs.length} 筆
        </span>
        <span class="day-group-stats">
          ${dayIncome ? `<span class="inc">＋${formatMoney(dayIncome)}</span>` : ''}
          ${dayExpense ? `<span class="exp">−${formatMoney(dayExpense)}</span>` : ''}
          ${daySavings ? `<span class="sav">🐷${formatMoney(daySavings)}</span>` : ''}
        </span>
      </button>
      <div class="day-group-body">
        ${dayRecs.map(buildRecordItemHtml).join('')}
      </div>`;
    el.appendChild(group);
  });

  el.querySelectorAll('.day-group-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.closest('.day-group');
      g.classList.toggle('expanded');
    });
  });
  bindRecordActions(el);
}

function getYearRecords() {
  return records.filter(r => new Date(r.date).getFullYear() === currentYear);
}

function renderYearly() {
  $('#current-year-label').textContent = `${currentYear}年`;
  const yearRecs = getYearRecords();
  let income = 0, consumption = 0, savings = 0;
  const monthsInc = Array(12).fill(0);
  const monthsExp = Array(12).fill(0);
  const monthsSav = Array(12).fill(0);
  yearRecs.forEach(r => {
    if (isTransfer(r) || isCollectReceivable(r) || isInterest(r)) return;
    const m = new Date(r.date).getMonth();
    if (isSavings(r)) {
      const amt = toMOP(r.amount, r.currency);
      savings += amt; monthsSav[m] += amt;
      return;
    }
    if (isAdvance(r)) {
      const selfAmt = toMOP(r.selfAmount != null ? r.selfAmount : 0, r.currency);
      if (selfAmt > 0) { consumption += selfAmt; monthsExp[m] += selfAmt; }
      return;
    }
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') { income += amt; monthsInc[m] += amt; }
    else if (isRepayment(r)) { /* 還款不計入消費支出 */ }
    else if (r.type === 'expense') { consumption += amt; monthsExp[m] += amt; }
  });
  $('#year-income').textContent = money('MOP', income);
  $('#year-expense').textContent = money('MOP', consumption);
  $('#year-balance').textContent = money('MOP', income - consumption - savings);

  const byCat = {};
  yearRecs.forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r)) return;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
      return;
    }
    if (r.type !== 'expense') return;
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  if (!Object.keys(byCat).length) {
    $('#yearlyCategoryBars').innerHTML = '';
    $('#no-year-cat-data').style.display = 'block';
  } else {
    $('#no-year-cat-data').style.display = 'none';
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    renderBarList($('#yearlyCategoryBars'), sorted.map(([c, v]) => ({ label: `${CATEGORY_ICONS[c] || '🏷️'} ${c}`, value: v })));
  }

  renderYearCustomCatSum(byCat);

  const listEl = $('#yearly-months-list');
  let rows = '';
  let sumInc = 0, sumExp = 0, sumSav = 0;
  for (let m = 0; m < 12; m++) {
    if (!monthsInc[m] && !monthsExp[m] && !monthsSav[m]) continue;
    const bal = monthsInc[m] - monthsExp[m] - monthsSav[m];
    const balCls = bal > 0 ? 'positive' : bal < 0 ? 'negative' : '';
    sumInc += monthsInc[m];
    sumExp += monthsExp[m];
    sumSav += monthsSav[m];
    rows += `<tr>
      <td><span class="month-full">${currentYear}年${m + 1}月</span><span class="month-short">${m + 1}月</span></td>
      <td class="inc">＋${formatMoney(monthsInc[m])}</td>
      <td class="exp">−${formatMoney(monthsExp[m])}</td>
      <td class="sav">${monthsSav[m] ? '🐷' + formatMoney(monthsSav[m]) : '—'}</td>
      <td class="bal ${balCls}">${formatMoney(bal)}</td>
    </tr>`;
  }
  if (!rows) {
    listEl.innerHTML = '<div class="empty-hint">本年尚無紀錄</div>';
  } else {
    const totalBal = sumInc - sumExp - sumSav;
    const totalBalCls = totalBal > 0 ? 'positive' : totalBal < 0 ? 'negative' : '';
    rows += `<tr class="month-table-total">
      <td>總計</td>
      <td class="inc">＋${formatMoney(sumInc)}</td>
      <td class="exp">−${formatMoney(sumExp)}</td>
      <td class="sav">${sumSav ? '🐷' + formatMoney(sumSav) : '—'}</td>
      <td class="bal ${totalBalCls}">${formatMoney(totalBal)}</td>
    </tr>`;
    listEl.innerHTML = `<div class="table-wrap"><table class="month-table">
      <thead><tr><th>月份</th><th>收入</th><th>消費支出</th><th>存錢</th><th>結餘</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }
}

const YEAR_CUSTOM_CAT_SUM_KEY = 'accounting_year_custom_cat_sum_v1';
function loadYearCustomCatSum() {
  return loadJSON(YEAR_CUSTOM_CAT_SUM_KEY, []);
}
function saveYearCustomCatSum(cats) {
  saveJSON(YEAR_CUSTOM_CAT_SUM_KEY, cats);
}
function renderYearCustomCatSum(byCat) {
  const box = $('#year-custom-cat-sum');
  if (!box) return;
  if (!byCat) {
    byCat = {};
    getYearRecords().forEach(r => {
      if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r)) return;
      if (isAdvance(r)) {
        const selfAmt = Number(r.selfAmount) || 0;
        if (selfAmt <= 0) return;
        const c = r.category || '其他';
        byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
        return;
      }
      if (r.type !== 'expense') return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
    });
  }
  const selected = new Set(loadYearCustomCatSum());
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  if (!cats.length) {
    box.innerHTML = '<div class="empty-hint">本年尚無支出可加總</div>';
    return;
  }
  let total = 0;
  const chips = cats.map(c => {
    const on = selected.has(c);
    if (on) total += byCat[c];
    return `<label class="cat-sum-chip${on ? ' active' : ''}">
      <input type="checkbox" data-cat="${escapeHtml(c)}" ${on ? 'checked' : ''}>
      <span>${CATEGORY_ICONS[c] || '🏷️'} ${escapeHtml(c)}</span>
      <span class="cat-sum-amt">${formatMoney(byCat[c])}</span>
    </label>`;
  }).join('');
  box.innerHTML = `
    <div class="cat-sum-chips">${chips}</div>
    <div class="cat-sum-total">已選合計：<strong>MOP ${formatMoney(total)}</strong></div>`;
  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const next = [...box.querySelectorAll('input[type=checkbox]:checked')].map(x => x.dataset.cat);
      saveYearCustomCatSum(next);
      renderYearCustomCatSum();
    });
  });
}

/** 計入淨額的戶口（不含電子錢包、信用卡） */
function netAssetAccounts() {
  return accounts.filter(a => a.type !== '電子錢包' && a.type !== '信用卡' && a.type !== '應收帳款');
}

function getAccountLedger(accountId, monthKey = '') {
  return records
    .filter(r => {
      const hit =
        r.accountId === accountId ||
        r.displayAccountId === accountId ||
        r.repayToId === accountId ||
        r.toAccountId === accountId;
      if (!hit) return false;
      if (monthKey && String(r.date || '').slice(0, 7) !== monthKey) return false;
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function ledgerMonthOptions(accountId, isWallet) {
  const all = isWallet
    ? records.filter(r => r.viaWalletId === accountId)
    : records.filter(r =>
        r.accountId === accountId ||
        r.displayAccountId === accountId ||
        r.repayToId === accountId ||
        r.toAccountId === accountId
      );
  const months = [...new Set(all.map(r => String(r.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  return months;
}

/** 在指定戶口視角下，轉帳／收支的正負與顯示金額 */
function ledgerAmountView(r, accountId) {
  if (isTransfer(r)) {
    if (r.toAccountId === accountId) {
      return { sign: '+', cls: 'income', amount: r.toAmount ?? r.amount, currency: r.toCurrency || r.currency };
    }
    // 轉出
    return { sign: '−', cls: 'expense', amount: r.amount, currency: r.currency };
  }
  if (r.type === 'income') return { sign: '+', cls: 'income', amount: r.amount, currency: r.currency };
  return { sign: '−', cls: 'expense', amount: r.amount, currency: r.currency };
}

function renderAccounts() {
  const nets = { MOP: 0, HKD: 0, CNY: 0 };
  netAssetAccounts().forEach(a => {
    const b = a.balances || {};
    nets.MOP += Number(b.MOP) || 0;
    nets.HKD += Number(b.HKD) || 0;
    nets.CNY += Number(b.CNY) || 0;
  });
  $('#net-mop').textContent = money('MOP', nets.MOP);
  $('#net-hkd').textContent = money('HKD', nets.HKD);
  $('#net-cny').textContent = money('CNY', nets.CNY);
  $('#net-total-mop').textContent = money('MOP', toMOP(nets.MOP, 'MOP') + toMOP(nets.HKD, 'HKD') + toMOP(nets.CNY, 'CNY'));

  const container = $('#accounts-by-type');
  container.innerHTML = '';
  if (!accounts.length) {
    $('#no-accounts').style.display = 'block';
    return;
  }
  $('#no-accounts').style.display = 'none';

  TYPE_ORDER.forEach(type => {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) return;
    const typeOpen = expandedAccountTypes === null || expandedAccountTypes.has(type);
    const section = document.createElement('div');
    section.className = 'type-group' + (typeOpen ? ' expanded' : '');
    const groupTotal = group.reduce((s, a) => s + balancesToMOP(a.balances), 0);
    section.innerHTML = `<button type="button" class="type-group-toggle" data-type="${type}">
      <span>${ACCOUNT_TYPE_ICONS[type] || ''} ${type} <span class="account-meta">（${group.length}）</span></span>
      <span class="type-group-right">${money('MOP', groupTotal)} <span class="sec-chevron">${typeOpen ? '▼' : '▸'}</span></span>
    </button>
    <div class="type-group-body" style="display:${typeOpen ? 'block' : 'none'}"></div>`;
    const body = section.querySelector('.type-group-body');

    group.forEach(a => {
      const b = a.balances || { MOP: 0, HKD: 0, CNY: 0 };
      const isDebt = a.type === '信用卡';
      const isWallet = a.type === '電子錢包';
      const linked = isWallet && a.linkedBankId ? accounts.find(x => x.id === a.linkedBankId) : null;
      const expanded = expandedAccountId === a.id;
      let ledger = [];
      let monthOpts = [];
      if (expanded) {
        monthOpts = ledgerMonthOptions(a.id, isWallet);
        if (isWallet) {
          ledger = records
            .filter(r => {
              if (r.viaWalletId !== a.id) return false;
              if (ledgerFilterMonth && String(r.date || '').slice(0, 7) !== ledgerFilterMonth) return false;
              return true;
            })
            .sort((x, y) => new Date(y.date) - new Date(x.date));
        } else {
          ledger = getAccountLedger(a.id, ledgerFilterMonth);
        }
      }
      let ledgerHtml = '';
      if (expanded) {
        const monthSelect = `<div class="ledger-filter">
          <label>月份</label>
          <select class="ledger-month-select" data-acc="${a.id}">
            <option value="">全部</option>
            ${monthOpts.map(m => `<option value="${m}" ${m === ledgerFilterMonth ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>`;
        if (!ledger.length) {
          ledgerHtml = monthSelect + '<div class="ledger-empty">此條件下尚無流水紀錄</div>';
        } else {
          ledgerHtml = monthSelect + ledger.slice(0, 80).map(r => {
            const view = ledgerAmountView(r, a.id);
            const via = r.viaWalletId ? accounts.find(w => w.id === r.viaWalletId) : null;
            const other = isTransfer(r)
              ? (r.toAccountId === a.id
                  ? accounts.find(x => x.id === r.accountId)
                  : accounts.find(x => x.id === r.toAccountId))
              : null;
            const extra = isTransfer(r) && other
              ? ` · ${r.toAccountId === a.id ? '自' : '至'} ${escapeHtml(other.name)}`
              : (via && !isWallet ? ' · ' + escapeHtml(via.name) : '');
            const canEdit = isInterest(r) || (!isTransfer(r) && !isAdvance(r) && !isCollectReceivable(r));
            const actions = canEdit
              ? `<span class="record-actions" style="display:inline-flex;margin-left:6px">
                  <button type="button" class="edit icon-btn" data-id="${r.id}" title="編輯">✎</button>
                  <button type="button" class="delete icon-btn" data-id="${r.id}" title="刪除">✕</button>
                </span>`
              : (isInterest(r) ? '' : '');
            return `<div class="ledger-item">
              <span>${r.date} · ${escapeHtml(r.category)}${extra}${r.note ? ' · ' + escapeHtml(r.note) : ''}</span>
              <span style="display:flex;align-items:center;gap:4px;flex-shrink:0">
                <span class="record-amount ${view.cls}">${view.sign}${money(view.currency, view.amount)}</span>
                ${actions}
              </span>
            </div>`;
          }).join('');
        }
      }
      const rateInfo = (a.type === '銀行' && a.interestRate > 0)
        ? `<div class="account-meta">年利率 ${a.interestRate}% · ${a.interestPeriod === 'daily' ? '日息' : a.interestPeriod === 'monthly' ? '月息' : '年息'}</div>`
        : '';
      const chips = isWallet
        ? `<div class="account-meta" style="margin-top:8px">扣帳銀行：${linked ? escapeHtml(linked.name) : '未設定'}（不計入淨額）</div>`
        : currencyChipsHtml(b);
      const item = document.createElement('div');
      item.className = 'account-item' + (expanded ? ' expanded' : '');
      item.dataset.id = a.id;
      item.innerHTML = `
        <div class="account-item-header">
          <div>
            <div class="account-name">${escapeHtml(a.name)}</div>
            ${rateInfo}
            ${a.note ? `<div class="account-meta">${escapeHtml(a.note)}</div>` : ''}
          </div>
          <div class="account-actions">
            <button type="button" class="edit" data-id="${a.id}">編輯</button>
            <button type="button" class="delete" data-id="${a.id}">刪除</button>
          </div>
        </div>
        ${chips}
        <div class="account-ledger">
          <div class="ledger-title">流水帳（再點一次收合）</div>
          ${ledgerHtml}
        </div>`;
      body.appendChild(item);
    });
    container.appendChild(section);
  });

  bindRecordActions(container);
  container.querySelectorAll('.type-group-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = btn.dataset.type;
      if (expandedAccountTypes === null) {
        expandedAccountTypes = new Set(TYPE_ORDER);
      }
      if (expandedAccountTypes.has(t)) expandedAccountTypes.delete(t);
      else expandedAccountTypes.add(t);
      renderAccounts();
    });
  });

  container.querySelectorAll('.account-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      const id = item.dataset.id;
      if (expandedAccountId === id) {
        expandedAccountId = null;
        ledgerFilterMonth = '';
      } else {
        expandedAccountId = id;
        ledgerFilterMonth = '';
      }
      renderAccounts();
    });
  });
  container.querySelectorAll('.ledger-month-select').forEach(sel => {
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      ledgerFilterMonth = sel.value;
      expandedAccountId = sel.dataset.acc;
      renderAccounts();
    });
  });
  container.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditAccountModal(btn.dataset.id); });
  });
  container.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('確定刪除此戶口？')) return;
      const delId = btn.dataset.id;
      accounts = accounts.filter(a => a.id !== delId);
      saveAccountsLocal();
      queueAccountRemove(delId);
      if (expandedAccountId === delId) expandedAccountId = null;
      toast('已刪除戶口', 'ok');
      if (currentPage === 'assets') renderAssets(); else renderAccounts();
    });
  });
}

function populateAccountSelect(selectedId = '') {
  const sel = $('#record-account');
  sel.innerHTML = '<option value="">請選擇戶口</option>';
  // 排序：電子支付 → 信用卡 → 銀行 → 現金（不顯示投資／其他）
  let firstWalletId = '';
  ['電子錢包', '信用卡', '銀行', '現金'].forEach(type => {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) return;
    if (type === '電子錢包' && !firstWalletId) firstWalletId = group[0].id;
    const og = document.createElement('optgroup');
    const labelMap = { '電子錢包': '電子支付', '信用卡': '信用卡', '銀行': '銀行戶口', '現金': '現金' };
    og.label = `${ACCOUNT_TYPE_ICONS[type] || ''} ${labelMap[type] || type}`;
    group.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      if (a.id === selectedId) opt.selected = true;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
  // 新增時未指定：預設第一個電子支付
  if (!selectedId && firstWalletId) sel.value = firstWalletId;
}

function populateRepayToSelect(selectedId = '') {
  const sel = $('#repay-to-account');
  sel.innerHTML = '<option value="">請選擇信用卡</option>';
  accounts.filter(a => a.type === '信用卡').forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = a.name;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateLinkedBankSelect(selectedId = '') {
  const sel = $('#linked-bank');
  sel.innerHTML = '<option value="">請選擇銀行戶口</option>';
  accounts.filter(a => a.type === '銀行').forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = a.name;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onAccountTypeChange() {
  const type = $('#account-type').value;
  const isWallet = type === '電子錢包';
  const isBank = type === '銀行';
  $('#linked-bank-row').classList.toggle('hidden', !isWallet);
  $('#balances-row').classList.toggle('hidden', isWallet);
  $('#interest-row').classList.toggle('hidden', !isBank);
  if (isWallet) populateLinkedBankSelect();
}

function onCategoryChange() {
  const cat = $('#category').value;
  const isRepay = cat === '信用卡還款';
  $('#repay-to-row').classList.toggle('hidden', !isRepay);
  $('#repay-to-account').required = isRepay;
  if (isRepay) populateRepayToSelect();
  if (cat === '其他') {
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').required = true;
  } else {
    $('#custom-category-row').classList.add('hidden');
    $('#custom-category').required = false;
    $('#custom-category').value = '';
  }
}

function applyBalanceDelta(accountId, currency, delta) {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc || acc.type === '電子錢包') return;
  if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
  acc.balances[currency] = Number(acc.balances[currency] || 0) + delta;
  saveJSON(ACCOUNTS_KEY, accounts);
}

function resolveEffectAccount(rec) {
  const acc = accounts.find(a => a.id === rec.accountId);
  if (acc && acc.type === '電子錢包' && acc.linkedBankId) {
    return { effectId: acc.linkedBankId, viaWalletId: acc.id };
  }
  return { effectId: rec.accountId, viaWalletId: null };
}

function reverseRecordEffect(rec) {
  if (!rec) return;
  if (isSavings(rec)) return; // 存錢不影響戶口餘額
  if (isInterest(rec)) {
    // 日息：扣回已加的利息
    applyBalanceDelta(rec.accountId, rec.currency, -(Number(rec.amount) || 0));
    return;
  }
  if (isAdvance(rec)) {
    const total = Number(rec.amount) || 0;
    const recvAmt = Number(rec.recvAmount) || 0;
    const payAcc = accounts.find(a => a.id === rec.accountId);
    // 還原支付戶口：信用卡減少欠款；銀行／現金加回餘額
    if (payAcc && payAcc.type === '信用卡') {
      applyBalanceDelta(rec.accountId, rec.currency, -total);
    } else {
      applyBalanceDelta(rec.accountId, rec.currency, total);
    }
    if (rec.recvAccountId && recvAmt) applyBalanceDelta(rec.recvAccountId, rec.currency, -recvAmt);
    return;
  }
  if (isTransfer(rec) || isCollectReceivable(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, Number(rec.amount));
    applyBalanceDelta(rec.toAccountId, rec.toCurrency || rec.currency, -(Number(rec.toAmount ?? rec.amount)));
    return;
  }
  const amt = Number(rec.amount);
  if (isRepayment(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, amt);
    if (rec.repayToId) applyBalanceDelta(rec.repayToId, rec.currency, amt);
    return;
  }
  const { effectId } = resolveEffectAccount(rec);
  const acc = accounts.find(a => a.id === effectId);
  if (!acc) return;
  if (acc.type === '信用卡') applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? -amt : amt);
  else applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? amt : -amt);
}

function applyRecordEffect(rec) {
  if (!rec) return;
  if (isSavings(rec)) return; // 存錢不影響戶口餘額
  if (isInterest(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, Number(rec.amount) || 0);
    return;
  }
  if (isTransfer(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, -Number(rec.amount));
    applyBalanceDelta(rec.toAccountId, rec.toCurrency || rec.currency, Number(rec.toAmount ?? rec.amount));
    return;
  }
  const amt = Number(rec.amount);
  if (isRepayment(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, -amt);
    if (rec.repayToId) applyBalanceDelta(rec.repayToId, rec.currency, -amt);
    return;
  }
  const { effectId } = resolveEffectAccount(rec);
  const acc = accounts.find(a => a.id === effectId);
  if (!acc) return;
  if (acc.type === '信用卡') applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? amt : -amt);
  else applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? -amt : amt);
}

function openAddModal() {
  if (!accounts.length) {
    toast('請先到資產頁新增戶口', 'err');
    switchPage('assets');
    return;
  }
  $('#modal-title').textContent = '新增紀錄';
  $('#record-form').reset();
  $('#edit-id').value = '';
  $('#date').valueAsDate = new Date();
  currentType = 'expense';
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $('.type-btn[data-type="expense"]').classList.add('active');
  $('#category').value = '餐飲';
  $('#custom-category-row').classList.add('hidden');
  $('#repay-to-row').classList.add('hidden');
  if ($('#is-advance')) $('#is-advance').checked = false;
  if ($('#advance-fields')) $('#advance-fields').classList.add('hidden');
  if ($('#advance-self-amt')) $('#advance-self-amt').value = 0;
  if ($('#advance-recv-amt')) $('#advance-recv-amt').value = 0;
  if ($('#advance-toggle-row')) $('#advance-toggle-row').classList.remove('hidden');
  populateAccountSelect(getPref('lastAccountId', ''));
  const lastCur = getPref('lastCurrency', 'MOP');
  if ($('#currency')) $('#currency').value = lastCur;
  $('#modal-overlay').classList.remove('hidden');
  setTimeout(() => { const a = $('#amount'); if (a) a.focus(); }, 100);
}

function openEditModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  $('#modal-title').textContent = '編輯紀錄';
  $('#edit-id').value = r.id;
  $('#amount').value = r.amount;
  $('#currency').value = r.currency;
  $('#date').value = r.date;
  $('#note').value = r.note || '';
  currentType = r.type;
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  const tb = $(`.type-btn[data-type="${r.type}"]`);
  if (tb) tb.classList.add('active');

  const preset = CATEGORIES.map(c => c.name);
  if (preset.includes(r.category)) {
    $('#category').value = r.category;
    $('#custom-category-row').classList.add('hidden');
  } else {
    $('#category').value = '其他';
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').value = r.category;
  }
  onCategoryChange();
  populateAccountSelect(r.viaWalletId || r.accountId || '');
  if (isRepayment(r) && r.repayToId) populateRepayToSelect(r.repayToId);
  if ($('#is-advance')) $('#is-advance').checked = !!isAdvance(r);
  if ($('#advance-fields')) $('#advance-fields').classList.toggle('hidden', !isAdvance(r));
  if (isAdvance(r)) {
    if ($('#advance-self-amt')) $('#advance-self-amt').value = r.selfAmount != null ? r.selfAmount : 0;
    if ($('#advance-recv-amt')) $('#advance-recv-amt').value = r.recvAmount != null ? r.recvAmount : 0;
  }
  if ($('#advance-toggle-row')) $('#advance-toggle-row').classList.add('hidden'); // 編輯不改代墊結構
  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() { $('#modal-overlay').classList.add('hidden'); }

function handleRecordSubmit(e) {
  e.preventDefault();
  const selectedId = $('#record-account').value;
  if (!selectedId) { alert('請選擇戶口'); return; }

  // 代墊模式（僅新增）
  const asAdvance = !!( $('#is-advance')?.checked && !$('#edit-id').value );
  if (asAdvance) {
    const currency = $('#currency').value;
    const total = Number($('#amount').value) || 0;
    const selfAmt = Number($('#advance-self-amt')?.value) || 0;
    const recvAmt = Number($('#advance-recv-amt')?.value) || 0;
    if (total <= 0) { alert('請輸入總金額'); return; }
    if (Math.abs(selfAmt + recvAmt - total) > 0.02) { alert('自費 + 應收 應等於總金額'); return; }
    let recv = getReceivableAccount();
    if (!recv) {
      recv = {
        id: 'recv_' + genId(), name: '應收帳款', type: '應收帳款',
        balances: { MOP: 0, HKD: 0, CNY: 0 }, note: '',
        linkedBankId: '', interestRate: 0, interestPeriod: 'yearly', lastInterestDate: ''
      };
      accounts.push(recv);
      saveJSON(ACCOUNTS_KEY, accounts);
    }
    let category = $('#category').value;
    if (category === '其他') {
      category = $('#custom-category').value.trim() || '其他';
    }
    const date = $('#date').value;
    const note = ($('#note').value || '').trim();
    const payAcc = accounts.find(a => a.id === selectedId);
    const effectId = (payAcc && payAcc.type === '電子錢包' && payAcc.linkedBankId) ? payAcc.linkedBankId : selectedId;
    const effectAcc = accounts.find(a => a.id === effectId);
    if (effectAcc && effectAcc.type === '信用卡') applyBalanceDelta(effectId, currency, total);
    else applyBalanceDelta(effectId, currency, -total);
    if (recvAmt > 0) applyBalanceDelta(recv.id, currency, recvAmt);
    const rec = {
      id: genId(),
      type: 'expense',
      amount: total,
      selfAmount: selfAmt,
      recvAmount: recvAmt,
      currency, date,
      category: selfAmt > 0 ? category : '代墊',
      accountId: effectId,
      recvAccountId: recv.id,
      isAdvance: true,
      note: note || (recvAmt > 0 ? `代墊 ${money(currency, recvAmt)}` : '代墊'),
      createdAt: new Date().toISOString()
    };
    if (payAcc && payAcc.type === '電子錢包') {
      rec.viaWalletId = payAcc.id;
      rec.displayAccountId = effectId;
    }
    records.push(rec);
    saveRecordsLocal();
    queueRecordUpsert(rec);
    saveAccountsLocal();
    queueAccountsUpsertByIds(accountIdsTouchedByRecord(rec));
    setPref('lastAccountId', selectedId);
    setPref('lastCurrency', currency);
    closeModal();
    toast('已新增代墊', 'ok');
    switchPage(currentPage);
    return;
  }

  let category = $('#category').value;
  if (category === '其他') {
    category = $('#custom-category').value.trim();
    if (!category) { alert('請輸入自訂分類'); return; }
  }
  let repayToId = '';
  if (category === '信用卡還款') {
    repayToId = $('#repay-to-account').value;
    if (!repayToId) { alert('請選擇信用卡'); return; }
  }

  const selected = accounts.find(a => a.id === selectedId);
  let accountId = selectedId;
  let viaWalletId, displayAccountId;
  if (selected && selected.type === '電子錢包') {
    if (!selected.linkedBankId) { alert('此電子錢包未綁定銀行'); return; }
    viaWalletId = selected.id;
    accountId = selected.linkedBankId;
    displayAccountId = selected.linkedBankId;
  }

  const old = records.find(r => r.id === $('#edit-id').value);
  const record = {
    id: $('#edit-id').value || genId(),
    type: currentType,
    amount: Number($('#amount').value),
    currency: $('#currency').value,
    date: $('#date').value,
    category,
    accountId,
    note: $('#note').value.trim(),
    createdAt: old?.createdAt || new Date().toISOString()
  };
  // 僅在有值時寫入，避免 Firebase 拒絕 undefined
  if (displayAccountId) record.displayAccountId = displayAccountId;
  if (viaWalletId) record.viaWalletId = viaWalletId;
  if (repayToId) record.repayToId = repayToId;
  if (old && isSavings(old)) {
    record.isSavings = true;
    record.category = '存錢';
  }
  if (category === '存錢') record.isSavings = true;
  if (old && isInterest(old)) {
    record.isInterest = true;
    record.category = '利息收入';
  }
  if (category === '利息收入') record.isInterest = true;

  if (old) reverseRecordEffect(old);
  applyRecordEffect(record);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record; else records.push(record);
  // 清理本機既有紀錄中的 undefined 欄位
  records = stripUndefined(records);
  saveRecordsLocal();
  queueRecordUpsert(record);
  saveAccountsLocal();
  queueAccountsUpsertByIds(accountIdsTouchedByRecord(record).concat(old ? accountIdsTouchedByRecord(old) : []));
  if (record.accountId) setPref('lastAccountId', record.viaWalletId || record.displayAccountId || record.accountId);
  if (record.currency) setPref('lastCurrency', record.currency);
  closeModal();
  toast(old ? '已更新紀錄' : '已新增紀錄', 'ok');
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'analysis') renderAnalysis();
  else if (currentPage === 'assets') renderAssets();
}

function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec) {
    reverseRecordEffect(rec);
    if (isInterest(rec)) {
      const acc = accounts.find(a => a.id === rec.accountId);
      if (acc) {
        if (!acc.skippedInterestIds) acc.skippedInterestIds = [];
        if (!acc.skippedInterestIds.includes(rec.id)) acc.skippedInterestIds.push(rec.id);
      }
    }
  }
  records = records.filter(r => r.id !== id);
  saveRecordsLocal();
  queueRecordRemove(id);
  saveAccountsLocal();
  queueAccountsUpsertByIds(accountIdsTouchedByRecord(rec));
  toast('已刪除紀錄', 'ok');
  switchPage(currentPage);
}

function openAddAccountModal() {
  $('#account-modal-title').textContent = '新增戶口';
  $('#account-form').reset();
  $('#account-edit-id').value = '';
  $('#acc-bal-mop').value = 0; $('#acc-bal-hkd').value = 0; $('#acc-bal-cny').value = 0;
  $('#acc-interest-rate').value = 0;
  $('#acc-interest-period').value = 'daily';
  $('#linked-bank-row').classList.add('hidden');
  $('#interest-row').classList.add('hidden');
  $('#balances-row').classList.remove('hidden');
  $('#adjust-row').classList.add('hidden');
  $('#account-modal-overlay').classList.remove('hidden');
}

function openEditAccountModal(id) {
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  $('#account-modal-title').textContent = '編輯戶口';
  $('#account-edit-id').value = a.id;
  $('#account-name').value = a.name;
  $('#account-type').value = a.type;
  $('#acc-bal-mop').value = a.balances?.MOP || 0;
  $('#acc-bal-hkd').value = a.balances?.HKD || 0;
  $('#acc-bal-cny').value = a.balances?.CNY || 0;
  $('#acc-interest-rate').value = a.interestRate || 0;
  $('#acc-interest-period').value = a.interestPeriod || 'yearly';
  $('#account-note').value = a.note || '';
  onAccountTypeChange();
  if (a.type === '電子錢包') populateLinkedBankSelect(a.linkedBankId || '');
  $('#adjust-row').classList.remove('hidden');
  $('#adjust-action').value = '';
  $('#adjust-amount').value = '';
  $('#adjust-note').value = '';
  $('#account-modal-overlay').classList.remove('hidden');
}

function closeAccountModal() { $('#account-modal-overlay').classList.add('hidden'); }

function handleAccountSubmit(e) {
  e.preventDefault();
  const type = $('#account-type').value;
  const id = $('#account-edit-id').value || genId();
  const existing = accounts.find(a => a.id === id);
  const acc = {
    id, name: $('#account-name').value.trim(), type,
    balances: type === '電子錢包' ? { MOP: 0, HKD: 0, CNY: 0 } : {
      MOP: Number($('#acc-bal-mop').value) || 0,
      HKD: Number($('#acc-bal-hkd').value) || 0,
      CNY: Number($('#acc-bal-cny').value) || 0
    },
    linkedBankId: type === '電子錢包' ? ($('#linked-bank').value || '') : '',
    interestRate: type === '銀行' ? (Number($('#acc-interest-rate').value) || 0) : 0,
    interestPeriod: type === '銀行' ? ($('#acc-interest-period').value || 'yearly') : 'yearly',
    lastInterestDate: existing?.lastInterestDate || '',
    note: $('#account-note').value.trim()
  };
  // 日息：由設定的「第二天」開始計息；首次啟用時 lastInterestDate = 今天（明日才入帳）
  if (type === '銀行' && acc.interestPeriod === 'daily' && Number(acc.interestRate) > 0) {
    const wasDaily = existing && existing.interestPeriod === 'daily' && Number(existing.interestRate) > 0;
    if (!wasDaily || !acc.lastInterestDate) {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      acc.lastInterestDate = t.toISOString().slice(0, 10);
    }
  }
  if (type === '電子錢包' && !acc.linkedBankId) { alert('請選擇扣帳銀行戶口'); return; }
  if (type === '應收帳款') {
    const other = accounts.find(a => a.type === '應收帳款' && a.id !== id);
    if (other) { alert('只能有一個應收帳款總戶口'); return; }
  }

  const adjAction = $('#adjust-action').value;
  const adjAmt = Number($('#adjust-amount').value) || 0;
  const adjCur = $('#adjust-currency').value;
  const adjNote = $('#adjust-note').value.trim();
  if (existing && adjAction && adjAmt > 0 && type !== '電子錢包') {
    const delta = adjAction === 'increase' ? adjAmt : -adjAmt;
    acc.balances[adjCur] = Number(acc.balances[adjCur] || 0) + delta;
    records.push({
      id: genId(),
      type: adjAction === 'increase' ? 'income' : 'expense',
      amount: adjAmt, currency: adjCur,
      date: new Date().toISOString().slice(0, 10),
      category: '戶口調整', accountId: id,
      note: adjNote || (adjAction === 'increase' ? '增加餘額' : '減少餘額'),
      createdAt: new Date().toISOString()
    });
  }

  // 若有調整流水，單筆同步紀錄
  if (existing && adjAction && adjAmt > 0 && type !== '電子錢包') {
    const adjRec = records[records.length - 1];
    if (adjRec && adjRec.category === '戶口調整') {
      saveRecordsLocal();
      queueRecordUpsert(adjRec);
    }
  }
  if (existing && existing.skippedInterestIds) acc.skippedInterestIds = existing.skippedInterestIds;
  const idx = accounts.findIndex(a => a.id === id);
  if (idx >= 0) accounts[idx] = acc; else accounts.push(acc);
  saveAccountsLocal();
  queueAccountUpsert(acc);
  closeAccountModal();
  toast(existing ? '已更新戶口' : '已新增戶口', 'ok');
  if (currentPage === 'assets') renderAssets(); else renderAccounts();
}

function openRepayModal() {
  const sources = accounts.filter(a => a.type !== '信用卡' && a.type !== '電子錢包');
  const cards = accounts.filter(a => a.type === '信用卡');
  if (!sources.length || !cards.length) { alert('需要一般戶口與信用卡'); return; }
  const fromSel = $('#repay-from'); const toSel = $('#repay-to');
  fromSel.innerHTML = ''; toSel.innerHTML = '';
  sources.forEach(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = `${ACCOUNT_TYPE_ICONS[a.type]||''} ${a.name}`; fromSel.appendChild(o); });
  cards.forEach(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = a.name; toSel.appendChild(o); });
  $('#repay-date').valueAsDate = new Date();
  $('#repay-amount').value = ''; $('#repay-note').value = '';
  $('#repay-modal-overlay').classList.remove('hidden');
}
function closeRepayModal() { $('#repay-modal-overlay').classList.add('hidden'); }
function handleRepaySubmit(e) {
  e.preventDefault();
  const record = {
    id: genId(), type: 'expense',
    amount: Number($('#repay-amount').value), currency: $('#repay-currency').value,
    date: $('#repay-date').value, category: '信用卡還款',
    accountId: $('#repay-from').value, repayToId: $('#repay-to').value,
    note: $('#repay-note').value.trim() || '信用卡還款',
    createdAt: new Date().toISOString()
  };
  applyRecordEffect(record);
  records.push(record);
  saveRecordsLocal();
  queueRecordUpsert(record);
  saveAccountsLocal();
  queueAccountsUpsertByIds(accountIdsTouchedByRecord(record));
  closeRepayModal();
  toast('已完成還款', 'ok');
  if (currentPage === 'assets') renderAssets(); else renderAccounts();
}

function nonCcAccounts() {
  return accounts.filter(a => a.type !== '信用卡' && a.type !== '電子錢包');
}
function autoFillTransferToAmount() {
  const fromAmt = Number($('#transfer-from-amount').value);
  if (!fromAmt) return;
  const fromCur = $('#transfer-from-currency').value;
  const toCur = $('#transfer-to-currency').value;
  const converted = convertAmount(fromAmt, fromCur, toCur);
  $('#transfer-to-amount').value = Math.round(converted * 100) / 100;
}
function openTransferModal(editId = '') {
  const list = nonCcAccounts();
  if (list.length < 2) { alert('至少需要兩個非信用卡／非電子錢包戶口才能轉帳'); return; }
  const fromSel = $('#transfer-from');
  const toSel = $('#transfer-to');
  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  list.forEach(a => {
    const o1 = document.createElement('option');
    o1.value = a.id; o1.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    fromSel.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = a.id; o2.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    toSel.appendChild(o2);
  });
  const existing = editId ? records.find(r => r.id === editId) : null;
  $('#transfer-edit-id').value = existing ? existing.id : '';
  $('#transfer-modal-title').textContent = existing ? '編輯轉帳' : '內部轉帳';
  if (existing) {
    fromSel.value = existing.accountId;
    toSel.value = existing.toAccountId;
    $('#transfer-from-currency').value = existing.currency || 'MOP';
    $('#transfer-from-amount').value = existing.amount;
    $('#transfer-to-currency').value = existing.toCurrency || existing.currency || 'MOP';
    $('#transfer-to-amount').value = existing.toAmount ?? existing.amount;
    $('#transfer-date').value = existing.date;
    $('#transfer-note').value = existing.note || '';
  } else {
    if (list.length > 1) toSel.selectedIndex = 1;
    $('#transfer-from-amount').value = '';
    $('#transfer-to-amount').value = '';
    $('#transfer-note').value = '';
    $('#transfer-date').valueAsDate = new Date();
  }
  $('#transfer-modal-overlay').classList.remove('hidden');
}
function closeTransferModal() { $('#transfer-modal-overlay').classList.add('hidden'); }
function handleTransferSubmit(e) {
  e.preventDefault();
  const fromId = $('#transfer-from').value;
  const toId = $('#transfer-to').value;
  if (fromId === toId) { alert('轉出與轉入戶口不能相同'); return; }
  const editId = $('#transfer-edit-id').value;
  const old = editId ? records.find(r => r.id === editId) : null;
  const record = {
    id: editId || genId(),
    type: 'transfer',
    category: '內部轉帳',
    amount: Number($('#transfer-from-amount').value),
    currency: $('#transfer-from-currency').value,
    toAmount: Number($('#transfer-to-amount').value),
    toCurrency: $('#transfer-to-currency').value,
    accountId: fromId,
    toAccountId: toId,
    date: $('#transfer-date').value,
    note: $('#transfer-note').value.trim(),
    createdAt: old?.createdAt || new Date().toISOString()
  };
  if (old) reverseRecordEffect(old);
  applyRecordEffect(record);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record; else records.push(record);
  saveRecordsLocal();
  queueRecordUpsert(record);
  saveAccountsLocal();
  queueAccountsUpsertByIds(accountIdsTouchedByRecord(record).concat(old ? accountIdsTouchedByRecord(old) : []));
  closeTransferModal();
  toast(old ? '已更新轉帳' : '已完成轉帳', 'ok');
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'assets') renderAssets();
  else renderAccounts();
}

/** 日息：開啟 App 時補入自 lastInterestDate 起的利息 */

// ========== 自訂分類加總 ==========
function loadCustomCatSum() {
  return loadJSON(CUSTOM_CAT_SUM_KEY, []);
}
function saveCustomCatSum(cats) {
  saveJSON(CUSTOM_CAT_SUM_KEY, cats);
}
function renderCustomCatSum() {
  const box = $('#custom-cat-sum');
  if (!box) return;
  const byCat = {};
  getMonthRecords().forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r)) return;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
      return;
    }
    if (r.type !== 'expense') return;
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  const selected = new Set(loadCustomCatSum());
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  if (!cats.length) {
    box.innerHTML = '<div class="empty-hint">本月尚無支出可加總</div>';
    return;
  }
  let total = 0;
  const chips = cats.map(c => {
    const on = selected.has(c);
    if (on) total += byCat[c];
    return `<label class="cat-sum-chip${on ? ' active' : ''}">
      <input type="checkbox" data-cat="${escapeHtml(c)}" ${on ? 'checked' : ''}>
      <span>${CATEGORY_ICONS[c] || '🏷️'} ${escapeHtml(c)}</span>
      <span class="cat-sum-amt">${formatMoney(byCat[c])}</span>
    </label>`;
  }).join('');
  box.innerHTML = `
    <div class="cat-sum-chips">${chips}</div>
    <div class="cat-sum-total">已選合計：<strong>MOP ${formatMoney(total)}</strong></div>`;
  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const next = [...box.querySelectorAll('input[type=checkbox]:checked')].map(x => x.dataset.cat);
      saveCustomCatSum(next);
      renderCustomCatSum();
    });
  });
}


// ========== 存錢 ==========
function openSavingsModal() {
  if (!accounts.length) { alert('請先新增戶口'); return; }
  const form = $('#savings-form');
  if (form) form.reset();
  const dateEl = $('#savings-date');
  if (dateEl) dateEl.valueAsDate = new Date();
  const sel = $('#savings-account');
  if (sel) {
    sel.innerHTML = '';
    accounts.filter(a => a.type !== '應收帳款' && a.type !== '電子錢包').forEach(a => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
      sel.appendChild(o);
    });
  }
  $('#savings-modal-overlay')?.classList.remove('hidden');
}
function closeSavingsModal() { $('#savings-modal-overlay')?.classList.add('hidden'); }
function handleSavingsSubmit(e) {
  e.preventDefault();
  const accountId = $('#savings-account').value;
  const currency = $('#savings-currency').value;
  const amount = Number($('#savings-amount').value) || 0;
  if (amount <= 0) { alert('請輸入金額'); return; }
  const date = $('#savings-date').value;
  const note = ($('#savings-note').value || '').trim();
  // 存錢：只記帳、不扣戶口餘額；不計消費支出，但減少結餘
  const rec = {
    id: genId(),
    type: 'expense',
    amount,
    currency,
    date,
    category: '存錢',
    accountId,
    isSavings: true,
    note: note || '存錢',
    createdAt: new Date().toISOString()
  };
  records.push(rec);
  saveRecordsLocal();
  queueRecordUpsert(rec);
  closeSavingsModal();
  toast('已記錄存錢', 'ok');
  switchPage(currentPage);
}

// ========== 代墊 ==========
function openAdvanceModal() {
  if (!accounts.length) { alert('請先新增戶口'); return; }
  let recv = getReceivableAccount();
  if (!recv) {
    // 自動建立唯一應收帳款戶口
    recv = {
      id: 'recv_' + genId(),
      name: '應收帳款',
      type: '應收帳款',
      balances: { MOP: 0, HKD: 0, CNY: 0 },
      note: '',
      linkedBankId: '', interestRate: 0, interestPeriod: 'yearly', lastInterestDate: ''
    };
    accounts.push(recv);
    saveJSON(ACCOUNTS_KEY, accounts);
  }
  $('#advance-form').reset();
  $('#advance-date').valueAsDate = new Date();
  $('#advance-self').value = 0;
  $('#advance-recv').value = 0;
  const paySel = $('#advance-pay-account');
  paySel.innerHTML = '';
  accounts.filter(a => a.type !== '應收帳款').forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    paySel.appendChild(o);
  });
  const catSel = $('#advance-category');
  if (catSel) {
    catSel.innerHTML = CATEGORIES.filter(c => !['信用卡還款','收回應收','代墊','利息收入'].includes(c.name))
      .map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
  }
  $('#advance-modal-overlay').classList.remove('hidden');
}
function closeAdvanceModal() { $('#advance-modal-overlay')?.classList.add('hidden'); }
function handleAdvanceSubmit(e) {
  e.preventDefault();
  const payId = $('#advance-pay-account').value;
  const currency = $('#advance-currency').value;
  const total = Number($('#advance-total').value) || 0;
  const selfAmt = Number($('#advance-self').value) || 0;
  const recvAmt = Number($('#advance-recv').value) || 0;
  if (total <= 0) { alert('請輸入總金額'); return; }
  if (Math.abs(selfAmt + recvAmt - total) > 0.02) { alert('自費 + 應收 應等於總金額'); return; }
  if (recvAmt < 0 || selfAmt < 0) { alert('金額不可為負'); return; }
  const recv = getReceivableAccount();
  if (!recv) { alert('找不到應收帳款戶口'); return; }
  const date = $('#advance-date').value;
  const note = ($('#advance-note').value || '').trim();
  const category = $('#advance-category')?.value || '其他';
  const idBase = genId();

  // 1) 支付戶口：銀行／現金扣款；信用卡增加欠款
  const payAcc = accounts.find(a => a.id === payId);
  if (payAcc && payAcc.type === '信用卡') {
    applyBalanceDelta(payId, currency, total);   // 欠款＋
  } else {
    applyBalanceDelta(payId, currency, -total);  // 餘額−
  }
  // 2) 應收加應收金額
  if (recvAmt > 0) applyBalanceDelta(recv.id, currency, recvAmt);

  // 紀錄：一筆代墊主紀錄（方便列表顯示）
  const rec = {
    id: idBase,
    type: 'expense',
    amount: total,
    selfAmount: selfAmt,
    recvAmount: recvAmt,
    currency,
    date,
    category: selfAmt > 0 ? category : '代墊',
    accountId: payId,
    recvAccountId: recv.id,
    isAdvance: true,
    note: note || (recvAmt > 0 ? `代墊 ${money(currency, recvAmt)}` : '代墊'),
    createdAt: new Date().toISOString()
  };
  records.push(rec);
  saveJSON(STORAGE_KEY, records);
  saveJSON(ACCOUNTS_KEY, accounts);
  closeAdvanceModal();
  switchPage(currentPage);
}

// ========== 收回應收 ==========
function openCollectModal() {
  const recv = getReceivableAccount();
  if (!recv) { alert('尚無應收帳款戶口，請先記一筆代墊'); return; }
  $('#collect-form').reset();
  $('#collect-date').valueAsDate = new Date();
  const toSel = $('#collect-to-account');
  toSel.innerHTML = '';
  accounts.filter(a => a.type !== '應收帳款' && a.type !== '信用卡' && a.type !== '電子錢包').forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    toSel.appendChild(o);
  });
  if (!toSel.options.length) { alert('需要銀行或現金戶口作為收回目標'); return; }
  $('#collect-modal-overlay').classList.remove('hidden');
}
function closeCollectModal() { $('#collect-modal-overlay')?.classList.add('hidden'); }
function handleCollectSubmit(e) {
  e.preventDefault();
  const recv = getReceivableAccount();
  if (!recv) return;
  const toId = $('#collect-to-account').value;
  const currency = $('#collect-currency').value;
  const amount = Number($('#collect-amount').value) || 0;
  if (amount <= 0) { alert('請輸入金額'); return; }
  const date = $('#collect-date').value;
  const note = ($('#collect-note').value || '').trim();

  // 應收減少、目標戶口增加（不計收入）
  applyBalanceDelta(recv.id, currency, -amount);
  applyBalanceDelta(toId, currency, amount);

  const rec = {
    id: genId(),
    type: 'transfer',
    amount,
    currency,
    toAmount: amount,
    toCurrency: currency,
    date,
    category: '收回應收',
    accountId: recv.id,
    toAccountId: toId,
    isCollectReceivable: true,
    note: note || '收回應收',
    createdAt: new Date().toISOString()
  };
  records.push(rec);
  saveRecordsLocal();
  queueRecordUpsert(rec);
  saveAccountsLocal();
  queueAccountsUpsertByIds(accountIdsTouchedByRecord(rec));
  closeCollectModal();
  toast('已收回應收', 'ok');
  switchPage(currentPage);
}

function accrueDailyInterest() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  let changed = false;

  accounts.forEach(acc => {
    if (acc.type !== '銀行' || !(Number(acc.interestRate) > 0) || acc.interestPeriod !== 'daily') return;

    // lastInterestDate = 已計至哪一天；從隔天起算。無則設為今天（明天才開始入帳）
    let last = acc.lastInterestDate || '';
    if (!last) {
      last = todayStr;
      acc.lastInterestDate = last;
      changed = true;
    }

    const cursor = new Date(last + 'T00:00:00');
    cursor.setDate(cursor.getDate() + 1); // 從「隔天」開始

    const dailyRate = (Number(acc.interestRate) / 100) / 365;
    if (!(dailyRate > 0)) {
      acc.lastInterestDate = todayStr;
      changed = true;
      return;
    }

    const skipped = new Set(acc.skippedInterestIds || []);

    while (cursor.getTime() <= today.getTime()) {
      const dateStr = cursor.toISOString().slice(0, 10);

      // 以「計息當日開始前的餘額」計息，再把利息加回（日複利）
      ['MOP', 'HKD', 'CNY'].forEach(cur => {
        const recId = `${acc.id}_${dateStr}_${cur}`;
        if (skipped.has(recId)) return; // 使用者已刪除，不再自動補回
        const exists = records.some(r => r.id === recId);
        if (exists) return;

        const bal = Number(acc.balances?.[cur]) || 0;
        if (bal <= 0) return;
        const interest = Math.round(bal * dailyRate * 100) / 100;
        if (interest < 0.01) return;

        if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
        acc.balances[cur] = Math.round((bal + interest) * 100) / 100;

        records.push({
          id: recId,
          type: 'income',
          isInterest: true,
          amount: interest,
          currency: cur,
          date: dateStr,
          category: '利息收入',
          accountId: acc.id,
          note: `日息 ${acc.interestRate}%（餘額 ${formatMoney(bal)}）`,
          createdAt: new Date().toISOString()
        });
        changed = true;
      });

      acc.lastInterestDate = dateStr;
      changed = true;
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  if (changed) {
    const seen = new Set();
    records = records.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    saveRecordsLocal();
    queueRecordsFullSync();
    saveAccountsLocal();
    queueAccountsFullSync();
  }
  return changed;
}

function startInterestAutoAccrue() {
  if (startInterestAutoAccrue._started) return;
  startInterestAutoAccrue._started = true;

  function msUntilNext0001() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(0, 1, 0, 0); // 今天 00:01
    if (now >= next) next.setDate(next.getDate() + 1); // 已過則明天 00:01
    return next.getTime() - now.getTime();
  }

  function scheduleMidnight() {
    const wait = msUntilNext0001();
    clearTimeout(startInterestAutoAccrue._midnightTimer);
    startInterestAutoAccrue._midnightTimer = setTimeout(() => {
      if (accrueDailyInterest()) {
        if (currentPage === 'monthly' || currentPage === 'assets') switchPage(currentPage);
      }
      scheduleMidnight(); // 排下一次
    }, wait);
  }

  scheduleMidnight();

  // 備用：每 30 分鐘檢查（避免定時器被瀏覽器節流漏掉）
  clearInterval(startInterestAutoAccrue._timer);
  startInterestAutoAccrue._timer = setInterval(() => {
    if (accrueDailyInterest()) {
      if (currentPage === 'monthly' || currentPage === 'assets') switchPage(currentPage);
    }
  }, 30 * 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (accrueDailyInterest()) {
        if (currentPage === 'monthly' || currentPage === 'assets') switchPage(currentPage);
      }
      scheduleMidnight(); // 重新對齊 00:01
    }
  });
}


function openAddLiabilityModal() {
  $('#liability-modal-title').textContent = '新增扣減項';
  $('#liability-form').reset();
  $('#liability-edit-id').value = '';
  $('#liab-bal-mop').value = 0; $('#liab-bal-hkd').value = 0; $('#liab-bal-cny').value = 0;
  $('#liability-modal-overlay').classList.remove('hidden');
}
function openEditLiabilityModal(id) {
  const l = liabilities.find(x => x.id === id);
  if (!l) return;
  $('#liability-modal-title').textContent = '編輯扣減項';
  $('#liability-edit-id').value = l.id;
  $('#liability-name').value = l.name;
  $('#liab-bal-mop').value = l.balances?.MOP || 0;
  $('#liab-bal-hkd').value = l.balances?.HKD || 0;
  $('#liab-bal-cny').value = l.balances?.CNY || 0;
  $('#liability-note').value = l.note || '';
  $('#liability-modal-overlay').classList.remove('hidden');
}
function closeLiabilityModal() { $('#liability-modal-overlay').classList.add('hidden'); }
function handleLiabilitySubmit(e) {
  e.preventDefault();
  const l = {
    id: $('#liability-edit-id').value || genId(),
    name: $('#liability-name').value.trim(),
    balances: {
      MOP: Number($('#liab-bal-mop').value) || 0,
      HKD: Number($('#liab-bal-hkd').value) || 0,
      CNY: Number($('#liab-bal-cny').value) || 0
    },
    note: $('#liability-note').value.trim()
  };
  const isEdit = liabilities.some(x => x.id === l.id);
  const idx = liabilities.findIndex(x => x.id === l.id);
  if (idx >= 0) liabilities[idx] = l; else liabilities.push(l);
  saveLiabilitiesLocal();
  queueLiabilityUpsert(l);
  closeLiabilityModal();
  toast(isEdit ? '已更新扣減項' : '已新增扣減項', 'ok');
  renderAssets();
}

function mpfCurrency(a) {
  return a?.currency === 'MOP' ? 'MOP' : 'HKD';
}
function mpfToMOP(a) {
  return toMOP(Number(a.balance) || 0, mpfCurrency(a));
}

function renderAssets() {
  let bankMop = 0, otherMop = 0;
  accounts.forEach(a => {
    if (a.type === '電子錢包' || a.type === '信用卡' || a.type === '應收帳款') return; // 信用卡／應收不計入資產頁
    const mop = balancesToMOP(a.balances);
    if (a.type === '銀行') bankMop += mop;
    else otherMop += mop; // 現金、投資、其他
  });
  let mpfTotal = 0;
  (mpfData.accounts || []).forEach(a => { mpfTotal += mpfToMOP(a); });
  const gross = bankMop + otherMop + mpfTotal;
  // 扣減合計：僅手動扣減項，不含信用卡
  let otherLiab = 0;
  liabilities.forEach(l => { otherLiab += balancesToMOP(l.balances); });
  const totalLiab = otherLiab;
  // 總存款 = 總資產 − 扣減 − 強積金
  const deposit = gross - totalLiab - mpfTotal;

  $('#assets-gross').textContent = money('MOP', gross);
  $('#assets-liability').textContent = money('MOP', totalLiab);
  if ($('#assets-deposit')) $('#assets-deposit').textContent = money('MOP', deposit);
  $('#assets-net').textContent = money('MOP', gross - totalLiab);
  if ($('#liab-section-total')) $('#liab-section-total').textContent = money('MOP', totalLiab);
  if ($('#liab-summary-total')) $('#liab-summary-total').textContent = money('MOP', totalLiab);

  // 分布：強積金 / 銀行 / 其他（不含信用卡）
  const chartItems = [
    { label: '🏛️ 強積金', value: mpfTotal },
    { label: '🏦 銀行戶口', value: bankMop },
    { label: '💼 其他資產', value: otherMop }
  ].filter(i => i.value > 0);

  if (!chartItems.length) {
    $('#no-assets-data').style.display = 'block';
    $('#assetsAccountBars').innerHTML = '';
    $('#assetsCurrencyBars').innerHTML = '';
  } else {
    $('#no-assets-data').style.display = 'none';
    renderBarList($('#assetsAccountBars'), chartItems);
    const byCur = { MOP: 0, HKD: 0, CNY: 0 };
    accounts.forEach(a => {
      if (a.type === '電子錢包' || a.type === '信用卡' || a.type === '應收帳款') return;
      byCur.MOP += Number(a.balances?.MOP || 0);
      byCur.HKD += toMOP(a.balances?.HKD || 0, 'HKD');
      byCur.CNY += toMOP(a.balances?.CNY || 0, 'CNY');
    });
    byCur.HKD += mpfTotal;
    renderBarList($('#assetsCurrencyBars'),
      Object.entries(byCur).filter(([, v]) => v > 0).map(([c, v]) => ({ label: c, value: v }))
    );
  }

  const detailEl = $('#assets-detail-list');
  if (detailEl) {
  detailEl.innerHTML = '';
  // 依分類列出；點類型才展開戶口（排除信用卡、電子錢包）
  const detailGroups = [
    { key: '銀行', title: '🏦 銀行', list: accounts.filter(a => a.type === '銀行') },
    { key: '現金', title: '💵 現金', list: accounts.filter(a => a.type === '現金') },
    { key: '投資', title: '📈 投資', list: accounts.filter(a => a.type === '投資') },
    { key: '其他', title: '🏷️ 其他', list: accounts.filter(a => a.type === '其他') },
    {
      key: '強積金',
      title: '🏛️ 強積金',
      list: (mpfData.accounts || []).map(m => {
        const cur = mpfCurrency(m);
        const bal = Number(m.balance) || 0;
        return {
          id: m.id, name: m.name, type: '強積金',
          balances: { MOP: cur === 'MOP' ? bal : 0, HKD: cur === 'HKD' ? bal : 0, CNY: 0 },
          isMpf: true
        };
      })
    }
  ];
  let anyGroup = false;
  detailGroups.forEach(g => {
    if (!g.list.length) return;
    anyGroup = true;
    const groupTotal = g.list.reduce((s, a) => s + balancesToMOP(a.balances), 0);
    const open = expandedAssetGroup === g.key;
    const wrap = document.createElement('div');
    wrap.className = 'asset-group' + (open ? ' open' : '');
    wrap.innerHTML = `
      <div class="asset-group-header" data-key="${g.key}">
        <span class="asset-group-title">${g.title} <span class="account-meta">（${g.list.length}）</span></span>
        <span class="asset-group-total">${money('MOP', groupTotal)} ${open ? '▾' : '▸'}</span>
      </div>
      <div class="asset-group-body" style="display:${open ? 'block' : 'none'}"></div>`;
    const body = wrap.querySelector('.asset-group-body');
    if (open) {
      g.list.forEach(a => {
        const mop = balancesToMOP(a.balances);
        const item = document.createElement('div');
        item.className = 'account-item';
        item.style.cursor = 'default';
        item.innerHTML = `<div class="account-item-header">
          <div class="account-name">${escapeHtml(a.name)}</div>
          <div style="text-align:right;font-weight:700;color:var(--primary)">${money('MOP', mop)}</div>
        </div>
        ${currencyChipsHtml(a.balances)}`;
        body.appendChild(item);
      });
    }
    detailEl.appendChild(wrap);
  });
  if (!anyGroup) {
    detailEl.innerHTML = '<div class="empty-hint">尚無資產戶口</div>';
  } else {
    detailEl.querySelectorAll('.asset-group-header').forEach(h => {
      h.addEventListener('click', () => {
        const key = h.dataset.key;
        expandedAssetGroup = expandedAssetGroup === key ? null : key;
        renderAssets();
      });
    });
  }
  } // end if detailEl

  const liabEl = $('#liabilities-list');
  liabEl.innerHTML = '';
  // 扣減項僅手動項目，不含信用卡
  if (!liabilities.length) {
    $('#no-liabilities').style.display = 'block';
  } else {
    $('#no-liabilities').style.display = 'none';
    liabilities.forEach(l => {
      const b = l.balances || {};
      const item = document.createElement('div');
      item.className = 'account-item'; item.style.cursor = 'default';
      item.innerHTML = `<div class="account-item-header">
        <div class="account-name">${escapeHtml(l.name)}</div>
        <div class="account-actions">
          <button type="button" class="edit" data-id="${l.id}">編輯</button>
          <button type="button" class="delete" data-id="${l.id}">刪除</button>
        </div></div>
        ${currencyChipsHtml(b)}
        <div class="account-meta" style="margin-top:6px">折合 ${money('MOP', balancesToMOP(b))}</div>`;
      liabEl.appendChild(item);
    });
    liabEl.querySelectorAll('.edit').forEach(btn => btn.addEventListener('click', () => openEditLiabilityModal(btn.dataset.id)));
    liabEl.querySelectorAll('.delete').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm('確定刪除此扣減項？')) return;
      const delId = btn.dataset.id;
      liabilities = liabilities.filter(l => l.id !== delId);
      saveLiabilitiesLocal();
      queueLiabilityRemove(delId);
      toast('已刪除扣減項', 'ok');
      renderAssets();
    }));
  }

  // 合併：戶口列表 + 強積金
  renderAccounts();
  renderMpf();
  bindSectionCollapse();
}

function bindSectionCollapse() {
  $$('.section-collapse-header').forEach(hdr => {
    if (hdr.dataset.bound) return;
    hdr.dataset.bound = '1';
    hdr.addEventListener('click', e => {
      if (e.target.closest('.mpf-month-nav-inline') || e.target.closest('button')) return;
      const key = hdr.dataset.section;
      const sec = hdr.closest('.collapsible-section');
      if (!sec || !key) return;
      sectionCollapseState[key] = !sectionCollapseState[key];
      sec.classList.toggle('expanded', !!sectionCollapseState[key]);
    });
  });
  // sync state to DOM
  Object.keys(sectionCollapseState).forEach(key => {
    const sec = $(`#section-${key}`);
    if (sec) sec.classList.toggle('expanded', !!sectionCollapseState[key]);
  });
}


function mpfMonthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** 計算指定月份相對上一筆 snapshot 的漲跌合計 */
function calcMpfMonthChange(year, month) {
  const key = mpfMonthKey(year, month);
  let totalDiff = 0;
  (mpfData.accounts || []).forEach(acc => {
    const snaps = [...(acc.snapshots || [])].sort((a, b) => a.month.localeCompare(b.month));
    const idx = snaps.findIndex(s => s.month === key);
    if (idx < 0) return;
    const cur = Number(snaps[idx].balance);
    if (idx === 0) totalDiff += 0; // 無上月可比
    else totalDiff += cur - Number(snaps[idx - 1].balance);
  });
  return totalDiff;
}

function renderMpf() {
  let totalMop = 0;
  (mpfData.accounts || []).forEach(a => { totalMop += mpfToMOP(a); });
  $('#mpf-total').textContent = money('MOP', totalMop);

  // 當月漲跌折合 MOP
  const key = mpfMonthKey(mpfViewYear, mpfViewMonth);
  let changeMop = 0;
  (mpfData.accounts || []).forEach(acc => {
    const cur = mpfCurrency(acc);
    const snaps = [...(acc.snapshots || [])].sort((a, b) => a.month.localeCompare(b.month));
    const idx = snaps.findIndex(s => s.month === key);
    if (idx < 0) return;
    if (idx === 0) return;
    const diff = Number(snaps[idx].balance) - Number(snaps[idx - 1].balance);
    changeMop += toMOP(diff, cur);
  });
  $('#mpf-change-month-label').textContent = `${mpfViewYear}/${mpfViewMonth + 1} 漲跌`;
  const changeEl = $('#mpf-month-change');
  changeEl.textContent = (changeMop >= 0 ? '+' : '') + money('MOP', changeMop);
  changeEl.style.color = changeMop > 0 ? 'var(--income)' : changeMop < 0 ? 'var(--expense)' : '';

  const el = $('#mpf-accounts-list');
  el.innerHTML = '';
  if (!mpfData.accounts?.length) {
    $('#no-mpf-accounts').style.display = 'block';
    return;
  }
  $('#no-mpf-accounts').style.display = 'none';

  mpfData.accounts.forEach(acc => {
    const card = document.createElement('div');
    const expanded = expandedMpfId === acc.id;
    const cur = mpfCurrency(acc);
    card.className = 'mpf-card' + (expanded ? ' expanded' : '');
    card.dataset.id = acc.id;
    const snaps = [...(acc.snapshots || [])].sort((a, b) => b.month.localeCompare(a.month));
    let listHtml = '';
    if (expanded) {
      if (!snaps.length) listHtml = '<div class="ledger-empty">尚無結餘紀錄</div>';
      else {
        listHtml = snaps.map((s, i) => {
          const prev = snaps[i + 1];
          let changeHtml = prev
            ? (() => {
                const diff = Number(s.balance) - Number(prev.balance);
                const up = diff >= 0;
                return `<span class="${up ? 'mpf-change-up' : 'mpf-change-down'}">${up ? '+' : ''}${money(cur, diff)}</span>`;
              })()
            : '<span class="account-meta">—</span>';
          return `<div class="mpf-change-item">
            <span>${s.month} · ${money(cur, s.balance)}${s.note ? ' · ' + escapeHtml(s.note) : ''}</span>
            <span>${changeHtml}
              <button type="button" class="edit-snap" data-acc="${acc.id}" data-id="${s.id}" style="margin-left:6px;font-size:0.7rem;padding:2px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;cursor:pointer">編輯</button>
              <button type="button" class="del-snap" data-acc="${acc.id}" data-id="${s.id}" style="font-size:0.7rem;padding:2px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;cursor:pointer;color:#dc2626">刪</button>
            </span></div>`;
        }).join('');
      }
    }
    card.innerHTML = `
      <div class="mpf-card-header mpf-card-toggle">
        <div>
          <div class="mpf-card-name">${escapeHtml(acc.name)} <span class="account-meta">${cur} ${expanded ? '▾' : '▸'}</span></div>
          ${acc.note ? `<div class="account-meta">${escapeHtml(acc.note)}</div>` : ''}
        </div>
        <div class="mpf-card-balance">${money(cur, acc.balance)}</div>
      </div>
      <div class="account-actions" style="margin-bottom:8px">
        <button type="button" class="add-snap" data-id="${acc.id}">＋ 紀錄結餘</button>
        <button type="button" class="edit-acc" data-id="${acc.id}">編輯</button>
        <button type="button" class="delete del-acc" data-id="${acc.id}">刪除</button>
      </div>
      ${expanded ? `<div class="mpf-changes">
        <div class="mpf-changes-title">每月結餘（自動計算漲跌）</div>
        ${listHtml}
      </div>` : ''}`;
    el.appendChild(card);
  });

  el.querySelectorAll('.mpf-card-toggle').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const card = hdr.closest('.mpf-card');
      const id = card?.dataset.id;
      expandedMpfId = expandedMpfId === id ? null : id;
      renderMpf();
    });
  });
  el.querySelectorAll('.add-snap').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openAddMpfSnapModal(btn.dataset.id); }));
  el.querySelectorAll('.edit-acc').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openEditMpfAccountModal(btn.dataset.id); }));
  el.querySelectorAll('.del-acc').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    mpfData.accounts = mpfData.accounts.filter(a => a.id !== btn.dataset.id);
    saveMpfLocal(); queueMpfFullSync(); if (currentPage === 'assets') renderAssets(); else renderMpf();
  }));
  el.querySelectorAll('.edit-snap').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openEditMpfSnapModal(btn.dataset.acc, btn.dataset.id); }));
  el.querySelectorAll('.del-snap').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const acc = mpfData.accounts.find(a => a.id === btn.dataset.acc);
    if (!acc) return;
    acc.snapshots = (acc.snapshots || []).filter(s => s.id !== btn.dataset.id);
    const sorted = [...(acc.snapshots || [])].sort((a, b) => b.month.localeCompare(a.month));
    if (sorted.length) acc.balance = Number(sorted[0].balance);
    saveMpfLocal(); queueMpfFullSync(); if (currentPage === 'assets') renderAssets(); else renderMpf();
  }));
}

function openAddMpfAccountModal() {
  $('#mpf-account-modal-title').textContent = '新增強積金戶口';
  $('#mpf-account-form').reset();
  $('#mpf-account-edit-id').value = '';
  $('#mpf-account-balance').value = 0;
  if ($('#mpf-account-currency')) $('#mpf-account-currency').value = 'HKD';
  $('#mpf-account-modal-overlay').classList.remove('hidden');
}
function openEditMpfAccountModal(id) {
  const a = mpfData.accounts.find(x => x.id === id);
  if (!a) return;
  $('#mpf-account-modal-title').textContent = '編輯強積金戶口';
  $('#mpf-account-edit-id').value = a.id;
  $('#mpf-account-name').value = a.name;
  $('#mpf-account-balance').value = a.balance;
  if ($('#mpf-account-currency')) $('#mpf-account-currency').value = mpfCurrency(a);
  $('#mpf-account-note').value = a.note || '';
  $('#mpf-account-modal-overlay').classList.remove('hidden');
}
function closeMpfAccountModal() { $('#mpf-account-modal-overlay').classList.add('hidden'); }
function handleMpfAccountSubmit(e) {
  e.preventDefault();
  const id = $('#mpf-account-edit-id').value || genId();
  const existing = mpfData.accounts.find(a => a.id === id);
  const acc = {
    id, name: $('#mpf-account-name').value.trim(),
    currency: ($('#mpf-account-currency')?.value === 'MOP') ? 'MOP' : 'HKD',
    balance: Number($('#mpf-account-balance').value) || 0,
    note: $('#mpf-account-note').value.trim(),
    snapshots: existing?.snapshots || []
  };
  const idx = mpfData.accounts.findIndex(a => a.id === id);
  if (idx >= 0) mpfData.accounts[idx] = acc; else mpfData.accounts.push(acc);
  saveMpfLocal();
  queueMpfUpsert(acc);
  closeMpfAccountModal();
  toast('已儲存強積金戶口', 'ok');
  if (currentPage === 'assets') renderAssets(); else renderMpf();
}

function openAddMpfSnapModal(accountId) {
  $('#mpf-change-modal-title').textContent = '紀錄結餘';
  $('#mpf-change-form').reset();
  $('#mpf-change-edit-id').value = '';
  $('#mpf-change-account-id').value = accountId;
  const now = new Date();
  $('#mpf-change-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const acc = mpfData.accounts.find(a => a.id === accountId);
  if (acc) $('#mpf-change-amount').value = acc.balance;
  $('#mpf-change-modal-overlay').classList.remove('hidden');
}
function openEditMpfSnapModal(accountId, snapId) {
  const acc = mpfData.accounts.find(a => a.id === accountId);
  const s = acc?.snapshots?.find(x => x.id === snapId);
  if (!s) return;
  $('#mpf-change-modal-title').textContent = '編輯結餘';
  $('#mpf-change-edit-id').value = s.id;
  $('#mpf-change-account-id').value = accountId;
  $('#mpf-change-month').value = s.month;
  $('#mpf-change-amount').value = s.balance;
  $('#mpf-change-note').value = s.note || '';
  $('#mpf-change-modal-overlay').classList.remove('hidden');
}
function closeMpfChangeModal() { $('#mpf-change-modal-overlay').classList.add('hidden'); }
function handleMpfChangeSubmit(e) {
  e.preventDefault();
  const accountId = $('#mpf-change-account-id').value;
  const acc = mpfData.accounts.find(a => a.id === accountId);
  if (!acc) return;
  if (!acc.snapshots) acc.snapshots = [];
  const editId = $('#mpf-change-edit-id').value;
  const month = $('#mpf-change-month').value;
  const balance = Number($('#mpf-change-amount').value);
  const note = $('#mpf-change-note').value.trim();
  if (editId) {
    const s = acc.snapshots.find(x => x.id === editId);
    if (s) { s.month = month; s.balance = balance; s.note = note; }
  } else {
    const existing = acc.snapshots.find(x => x.month === month);
    if (existing) { existing.balance = balance; existing.note = note; }
    else acc.snapshots.push({ id: genId(), month, balance, note });
  }
  const sorted = [...acc.snapshots].sort((a, b) => b.month.localeCompare(a.month));
  if (sorted.length) acc.balance = Number(sorted[0].balance);
  saveMpfLocal();
  queueMpfUpsert(acc);
  closeMpfChangeModal();
  toast('已儲存結餘', 'ok');
  if (currentPage === 'assets') renderAssets(); else renderMpf();
}

// ========== Export / Import ==========
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportRecordsCSV() {
  const headers = ['日期','類型','分類','金額','貨幣','戶口','備註'];
  const rows = records.map(r => {
    const acc = accounts.find(a => a.id === (r.displayAccountId || r.accountId));
    return [r.date, r.type === 'income' ? '收入' : '支出', r.category, r.amount, r.currency, acc?.name || '', r.note || ''];
  });
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  downloadFile(`記帳紀錄_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  $('#export-modal-overlay').classList.add('hidden');
}

function exportAccountsCSV() {
  const headers = ['名稱','類型','MOP','HKD','CNY','備註'];
  const rows = accounts.filter(a => a.type !== '電子錢包').map(a => [
    a.name, a.type, a.balances?.MOP || 0, a.balances?.HKD || 0, a.balances?.CNY || 0, a.note || ''
  ]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  downloadFile(`戶口_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  $('#export-modal-overlay').classList.add('hidden');
}

function exportMpfCSV() {
  const headers = ['戶口','目前結餘(HKD)','月份','該月結餘(HKD)','備註'];
  const rows = [];
  (mpfData.accounts || []).forEach(acc => {
    const snaps = acc.snapshots || [];
    if (!snaps.length) {
      rows.push([acc.name, acc.balance, '', '', acc.note || '']);
    } else {
      snaps.forEach(s => rows.push([acc.name, acc.balance, s.month, s.balance, s.note || '']));
    }
  });
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  downloadFile(`強積金_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  $('#export-modal-overlay').classList.add('hidden');
}

async function clearAllData() {
  const ok1 = confirm('確定要清空所有資料？\n\n包含：記帳紀錄、戶口、強積金、扣減項、匯率設定。\n此操作無法復原，建議先導出備份。');
  if (!ok1) return;
  const ok2 = confirm('再次確認：真的要永久刪除全部資料嗎？');
  if (!ok2) return;

  records = [];
  accounts = [];
  liabilities = [];
  mpfData = { accounts: [] };
  rates = { ...DEFAULT_RATES };
  filters = { type: '', category: '', account: '', currency: '' };
  expandedAccountId = null;
  expandedAccountTypes = null;
  expandedMpfId = null;
  expandedAssetGroup = null;
  sectionCollapseState = { dist: false, accounts: false, mpf: false, liabilities: false };

  try {
    localStorage.removeItem(scopedKey(STORAGE_KEY));
    localStorage.removeItem(scopedKey(ACCOUNTS_KEY));
    localStorage.removeItem(scopedKey(LIABILITIES_KEY));
    localStorage.removeItem(scopedKey(MPF_KEY));
    localStorage.removeItem(scopedKey(RATES_KEY));
    localStorage.removeItem(scopedKey(CUSTOM_CAT_SUM_KEY));
    localStorage.removeItem(scopedKey(YEAR_CUSTOM_CAT_SUM_KEY));
  } catch (_) {}

  // 雲端同步清空（若已登入）
  if (firebaseReady && currentUser && db) {
    try {
      await db.ref('users/' + currentUser.uid).set({
        records: null,
        accounts: null,
        liabilities: null,
        mpfData: null,
        recordMap: {},
        accountMap: {},
        liabilityMap: {},
        mpfMap: {},
        rates: { HKD: rates.HKD, CNY: rates.CNY, HKD_CNY: rates.HKD_CNY },
        updatedAt: Date.now()
      });
      pendingRecordOps.clear();
      pendingAccountOps.clear();
      pendingLiabilityOps.clear();
      pendingMpfOps.clear();
      Object.keys(DIRTY).forEach(k => { DIRTY[k] = false; });
    } catch (err) {
      console.error(err);
      alert('本機已清空，但雲端同步失敗：' + (err.message || err));
    }
  }

  $('#export-modal-overlay').classList.add('hidden');
  toast('已清空所有資料', 'ok');
  switchPage(currentPage);
}

function exportBackup() {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    records, accounts, liabilities, mpfData, rates
  };
  downloadFile(`記帳備份_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  $('#export-modal-overlay').classList.add('hidden');
}

function importBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.records && !data.accounts) throw new Error('格式不正確');
      const nRec = (data.records || []).length;
      const nAcc = (data.accounts || []).length;
      const nLiab = (data.liabilities || []).length;
      const nMpf = (data.mpfData && data.mpfData.accounts) ? data.mpfData.accounts.length : 0;
      const summary = `即將覆蓋目前資料：\n\n紀錄 ${nRec} 筆\n戶口 ${nAcc} 個\n扣減 ${nLiab} 項\n強積金 ${nMpf} 個\n\n建議先導出備份。確定導入？`;
      if (!confirm(summary)) { e.target.value = ''; return; }
      records = data.records || [];
      accounts = data.accounts || [];
      liabilities = data.liabilities || [];
      mpfData = data.mpfData || { accounts: [] };
      rates = data.rates ? { ...DEFAULT_RATES, ...data.rates, MOP: 1 } : rates;
      saveJSON(STORAGE_KEY, records);
      saveJSON(ACCOUNTS_KEY, accounts);
      saveJSON(LIABILITIES_KEY, liabilities);
      saveJSON(MPF_KEY, mpfData);
      saveRatesObj(rates);
      toast('備份已導入', 'ok');
      $('#export-modal-overlay').classList.add('hidden');
      switchPage(currentPage);
    } catch (err) {
      toast('導入失敗：' + (err.message || '檔案無效'), 'err');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function openRatesModal() {
  $('#rate-hkd').value = rates.HKD;
  $('#rate-cny').value = rates.CNY;
  $('#rate-hkd-cny').value = rates.HKD_CNY;
  $('#rates-modal-overlay').classList.remove('hidden');
}
function closeRatesModal() { $('#rates-modal-overlay').classList.add('hidden'); }
function handleRatesSubmit(e) {
  e.preventDefault();
  const hkd = Number($('#rate-hkd').value);
  const cny = Number($('#rate-cny').value);
  const hkdCny = Number($('#rate-hkd-cny').value);
  if (hkd <= 0 || cny <= 0 || hkdCny <= 0) { alert('匯率必須大於 0'); return; }
  rates = { MOP: 1, HKD: hkd, CNY: cny, HKD_CNY: hkdCny };
  saveRatesObj(rates);
  closeRatesModal();
  switchPage(currentPage);
}
function resetRates() {
  rates = { ...DEFAULT_RATES };
  saveRatesObj(rates);
  $('#rate-hkd').value = rates.HKD;
  $('#rate-cny').value = rates.CNY;
  $('#rate-hkd-cny').value = rates.HKD_CNY;
}

init();
