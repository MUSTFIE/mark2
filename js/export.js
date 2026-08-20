/**
 * export.js — 匯出 / 匯入 / 清空 / 匯率設定
 */
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
  budget = { amount: 0, categories: [] };
  filters = { type: '', category: '', account: '', currency: '' };
  expandedAccountId = null;
  expandedAccountTypes = new Set();
  expandedMpfId = null;
  expandedAssetGroup = null;
  sectionCollapseState = { dist: false, accounts: false, mpf: false, liabilities: false, otherAccounts: false };

  try {
    localStorage.removeItem(scopedKey(STORAGE_KEY));
    localStorage.removeItem(scopedKey(ACCOUNTS_KEY));
    localStorage.removeItem(scopedKey(LIABILITIES_KEY));
    localStorage.removeItem(scopedKey(MPF_KEY));
    localStorage.removeItem(scopedKey(RATES_KEY));
    localStorage.removeItem(scopedKey(BUDGET_KEY));
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
        budget: { amount: 0, categories: [] },
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
    records, accounts, liabilities, mpfData, rates, budget
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
      budget = normalizeBudget(data.budget || { amount: 0, categories: [] });
      saveJSON(STORAGE_KEY, records);
      saveJSON(ACCOUNTS_KEY, accounts);
      saveJSON(LIABILITIES_KEY, liabilities);
      saveJSON(MPF_KEY, mpfData);
      saveRatesObj(rates);
      saveBudgetObj(budget);
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

