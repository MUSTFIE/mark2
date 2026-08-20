/**
 * actions.js — 新增/編輯紀錄、戶口、轉帳、日息、資產、強積金
 */
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
  if (old && isAdjustment(old)) {
    record.isAdjustment = true;
    record.category = '戶口調整';
  }
  if (category === '戶口調整') record.isAdjustment = true;

  if (old) reverseRecordEffect(old);
  applyRecordEffect(record);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record; else records.push(record);
  // 清理本機既有紀錄中的 undefined 欄位
  records = stripUndefined(records);
  if (typeof invalidateMonthRecCache === 'function') invalidateMonthRecCache();
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
  if (typeof invalidateMonthRecCache === 'function') invalidateMonthRecCache();

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
  if (typeof invalidateMonthRecCache === 'function') invalidateMonthRecCache();
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
      acc.lastInterestDate = todayLocalStr();
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
      date: todayLocalStr(),
      category: '戶口調整',
      isAdjustment: true,
      accountId: id,
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
  if (typeof invalidateMonthRecCache === 'function') invalidateMonthRecCache();
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
  if (typeof invalidateMonthRecCache === 'function') invalidateMonthRecCache();
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
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r) || isAdjustment(r)) return;
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
    const recBox = $('#custom-cat-records');
    if (recBox) recBox.innerHTML = '';
    return;
  }
  let total = 0;
  const chips = cats.map(c => {
    const on = selected.has(c);
    if (on) total += byCat[c];
    return `<label class="cat-sum-chip${on ? ' active' : ''}">
      <input type="checkbox" data-cat="${escapeHtml(c)}" ${on ? 'checked' : ''}>
      <span class="cat-sum-label">${CATEGORY_ICONS[c] || '🏷️'} ${escapeHtml(c)}</span>
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
  renderCustomCatRecords(selected);
}

/** 在自訂加總下方列出所有已勾選分類的本月流水 */
function renderCustomCatRecords(selectedSet) {
  const recBox = $('#custom-cat-records');
  if (!recBox) return;
  const selected = selectedSet || new Set(loadCustomCatSum());
  if (!selected.size) {
    recBox.innerHTML = '';
    return;
  }
  const list = getMonthRecords().filter(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r) || isAdjustment(r)) return false;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      return selfAmt > 0 && selected.has(r.category || '其他');
    }
    return r.type === 'expense' && selected.has(r.category || '其他');
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));

  if (!list.length) {
    recBox.innerHTML = '<div class="empty-hint">已選分類本月尚無紀錄</div>';
    return;
  }
  // 依日期分組，與記帳頁類似
  const byDate = {};
  list.forEach(r => {
    const d = String(r.date || '').slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  let html = '<div class="custom-cat-records-title">已選分類流水</div>';
  dates.forEach(date => {
    html += `<div class="day-group expanded">
      <div class="day-header"><span class="day-date">${date}</span></div>
      <div class="day-records">${byDate[date].map(r => buildRecordItemHtml(r)).join('')}</div>
    </div>`;
  });
  recBox.innerHTML = html;
  bindRecordActions(recBox);
}

/** 預算設定面板（分析頁月份上方） */
let budgetCatsExpanded = false;
function renderBudgetPanel() {
  const panel = $('#budget-panel');
  if (!panel) return;
  const amountEl = $('#budget-amount-input');
  const catsBox = $('#budget-cats');
  const wrap = $('#budget-cats-wrap');
  const toggle = $('#btn-toggle-budget-cats');
  const summaryEl = $('#budget-cats-summary');
  if (amountEl && document.activeElement !== amountEl) {
    amountEl.value = budget.amount > 0 ? budget.amount : '';
  }
  const exclude = new Set(['信用卡還款', '收回應收', '代墊', '利息收入', '存錢', '戶口調整', '內部轉帳']);
  const allCats = [...new Set([
    ...CATEGORIES.map(c => c.name).filter(n => !exclude.has(n)),
    ...(budget.categories || [])
  ])];
  getMonthRecords().forEach(r => {
    if (r.type !== 'expense' && !isAdvance(r)) return;
    if (isRepayment(r) || isSavings(r) || isAdjustment(r)) return;
    const c = r.category || '其他';
    if (!exclude.has(c) && !allCats.includes(c)) allCats.push(c);
  });
  const selected = new Set(budget.categories || []);
  if (summaryEl) {
    if (!selected.size) summaryEl.textContent = '全部消費';
    else summaryEl.textContent = `已選 ${selected.size} 項`;
  }
  if (wrap) {
    wrap.classList.toggle('collapsed', !budgetCatsExpanded);
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', budgetCatsExpanded ? 'true' : 'false');
    const chev = toggle.querySelector('.sec-chevron');
    if (chev) chev.textContent = budgetCatsExpanded ? '▼' : '▸';
  }
  if (catsBox) {
    catsBox.innerHTML = allCats.map(c => {
      const on = selected.has(c);
      return `<label class="budget-cat-chip${on ? ' active' : ''}">
        <input type="checkbox" data-cat="${escapeHtml(c)}" ${on ? 'checked' : ''}>
        <span>${CATEGORY_ICONS[c] || '🏷️'} ${escapeHtml(c)}</span>
      </label>`;
    }).join('');
    catsBox.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const next = [...catsBox.querySelectorAll('input[type=checkbox]:checked')].map(x => x.dataset.cat);
        budget = normalizeBudget({ amount: budget.amount, categories: next });
        saveBudgetObj(budget);
        renderAnalysisMonthSummary();
        renderBudgetPanel();
      });
    });
  }
}

function saveBudgetFromUI() {
  const amountEl = $('#budget-amount-input');
  const amount = amountEl ? Math.max(0, Number(amountEl.value) || 0) : (budget.amount || 0);
  const catsBox = $('#budget-cats');
  const categories = catsBox
    ? [...catsBox.querySelectorAll('input[type=checkbox]:checked')].map(x => x.dataset.cat)
    : (budget.categories || []);
  budget = normalizeBudget({ amount, categories });
  saveBudgetObj(budget);
  renderAnalysisMonthSummary();
  toast('預算已儲存', 'ok');
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

/**
 * 日息計入規則（重整版）
 * ------------------------------------------------------------
 * 適用：type=銀行、interestPeriod=daily、interestRate>0
 *
 * lastInterestDate =「已處理完畢的最後一天」（當日已計過或已確認無息）
 * 計息從 lastInterestDate 的「隔天」開始，到「今天」為止（含今天）
 * 首次啟用時 lastInterestDate 設為今天 → 從明天才開始有利息
 *
 * 每日每幣別：
 *   利息 = round(當前餘額 × 年利率/100/365, 2)
 *   餘額 > 0 且利息 ≥ 0.01 才入帳
 *   入帳後餘額 += 利息（日複利）
 *   寫入 isInterest 流水（不計入月結餘收入）
 *
 * 日期一律用本地曆（formatDateLocal），禁止 toISOString 截日期
 * 已刪除的利息 id 在 skippedInterestIds，不再自動補回
 * ------------------------------------------------------------
 */
function accrueDailyInterest() {
  const todayStr = todayLocalStr();
  let changed = false;
  // 全表 id 索引一次建立
  const idSet = new Set(records.map(r => r.id));

  accounts.forEach(acc => {
    if (acc.type !== '銀行') return;
    if (acc.interestPeriod !== 'daily') return;
    const ratePct = Number(acc.interestRate) || 0;
    if (!(ratePct > 0)) return;

    const dailyRate = ratePct / 100 / 365;
    if (!(dailyRate > 0)) return;

    // 尚無基準日：設為今天，今天不計息
    let last = acc.lastInterestDate || '';
    if (!last || !parseDateLocal(last)) {
      acc.lastInterestDate = todayStr;
      changed = true;
      return;
    }

    // 不可早於系統底線（若有）
    if (typeof INTEREST_FLOOR === 'string' && INTEREST_FLOOR && last < INTEREST_FLOOR) {
      last = INTEREST_FLOOR;
    }

    const lastDt = parseDateLocal(last);
    const todayDt = parseDateLocal(todayStr);
    if (!lastDt || !todayDt) return;

    // 從隔天開始
    const cursor = new Date(lastDt.getTime());
    cursor.setDate(cursor.getDate() + 1);

    if (cursor.getTime() > todayDt.getTime()) {
      // 已計到今天或未來，無需再跑
      return;
    }

    if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
    const skipped = new Set(acc.skippedInterestIds || []);
    // 一次建立 id 索引，避免每日每幣別都掃全 records
    while (cursor.getTime() <= todayDt.getTime()) {
      const dateStr = formatDateLocal(cursor);

      // 若設了底線，底線當天之前不計
      if (typeof INTEREST_FLOOR === 'string' && INTEREST_FLOOR && dateStr < INTEREST_FLOOR) {
        acc.lastInterestDate = dateStr;
        changed = true;
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      ['MOP', 'HKD', 'CNY'].forEach(cur => {
        const recId = `${acc.id}_${dateStr}_${cur}`;
        if (skipped.has(recId)) return;
        // 已有該日該幣流水 → 不再重複加餘額
        if (idSet.has(recId)) return;

        const bal = Number(acc.balances[cur]) || 0;
        if (bal <= 0) return;

        const interest = Math.round(bal * dailyRate * 100) / 100;
        if (interest < 0.01) return;

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
          note: `日息 ${ratePct}%（計息餘額 ${formatMoney(bal)}）`,
          createdAt: new Date().toISOString()
        });
        idSet.add(recId);
        changed = true;
      });

      // 無論當日是否實際產生利息，都標記已處理
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
    if (typeof invalidateMonthRecCache === 'function') invalidateMonthRecCache();
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

  // 備用：每天檢查一次（主觸發仍為每日 00:01 與開啟／回到 App）
  clearInterval(startInterestAutoAccrue._timer);
  startInterestAutoAccrue._timer = setInterval(() => {
    if (accrueDailyInterest()) {
      if (currentPage === 'monthly' || currentPage === 'assets') switchPage(currentPage);
    }
  }, 24 * 60 * 60 * 1000);

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
    const cur = mpfCurrency(acc);
    const item = document.createElement('div');
    item.className = 'account-item account-row mpf-row';
    item.dataset.id = acc.id;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="account-row-main">
        <div class="account-name">${escapeHtml(acc.name)}</div>
      </div>
      <div class="account-row-right">
        <div class="account-row-amount">${money('MOP', mpfToMOP(acc))}</div>
        <span class="account-row-chevron">›</span>
      </div>`;
    el.appendChild(item);
  });

  el.querySelectorAll('.mpf-row').forEach(item => {
    const open = () => openMpfDetailModal(item.dataset.id);
    item.addEventListener('click', open);
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

function openMpfDetailModal(accountId) {
  const acc = mpfData.accounts.find(x => x.id === accountId);
  if (!acc) return;
  expandedMpfId = accountId;
  const overlay = $('#mpf-detail-modal-overlay');
  if (!overlay) return;
  const cur = mpfCurrency(acc);
  $('#mpf-detail-title').textContent = acc.name;
  $('#mpf-detail-summary').innerHTML = `
    <div class="account-detail-total">${money('MOP', mpfToMOP(acc))}</div>
    <div class="account-meta">原幣結餘：${money(cur, acc.balance)}</div>
    ${acc.note ? `<div class="account-meta">${escapeHtml(acc.note)}</div>` : ''}`;

  $('#btn-mpf-detail-snap').onclick = () => {
    closeMpfDetailModal();
    openAddMpfSnapModal(acc.id);
  };
  $('#btn-mpf-detail-edit').onclick = () => {
    closeMpfDetailModal();
    openEditMpfAccountModal(acc.id);
  };
  $('#btn-mpf-detail-delete').onclick = () => {
    if (!confirm('確定刪除此強積金戶口？')) return;
    mpfData.accounts = mpfData.accounts.filter(a => a.id !== acc.id);
    saveMpfLocal();
    queueMpfFullSync();
    expandedMpfId = null;
    closeMpfDetailModal();
    toast('已刪除強積金戶口', 'ok');
    if (currentPage === 'assets') renderAssets(); else renderMpf();
  };

  renderMpfDetailSnaps(acc.id);
  overlay.classList.remove('hidden');
}

function closeMpfDetailModal() {
  $('#mpf-detail-modal-overlay')?.classList.add('hidden');
}

function renderMpfDetailSnaps(accountId) {
  const acc = mpfData.accounts.find(x => x.id === accountId);
  const box = $('#mpf-detail-snaps');
  if (!acc || !box) return;
  const cur = mpfCurrency(acc);
  const snaps = [...(acc.snapshots || [])].sort((a, b) => b.month.localeCompare(a.month));
  if (!snaps.length) {
    box.innerHTML = '<div class="ledger-empty">尚無結餘紀錄</div>';
    return;
  }
  box.innerHTML = snaps.map((s, i) => {
    const prev = snaps[i + 1];
    let changeHtml = prev
      ? (() => {
          const diff = Number(s.balance) - Number(prev.balance);
          const up = diff >= 0;
          return `<span class="${up ? 'mpf-change-up' : 'mpf-change-down'}">${up ? '+' : ''}${money(cur, diff)}</span>`;
        })()
      : '<span class="account-meta">—</span>';
    return `<div class="ledger-item">
      <span class="ledger-item-left">${s.month}<br><span class="account-meta">${money(cur, s.balance)}${s.note ? ' · ' + escapeHtml(s.note) : ''}</span></span>
      <span class="ledger-item-right">
        ${changeHtml}
        <span class="record-actions">
          <button type="button" class="edit-snap icon-btn" data-acc="${acc.id}" data-id="${s.id}" title="編輯">✎</button>
          <button type="button" class="del-snap icon-btn" data-acc="${acc.id}" data-id="${s.id}" title="刪除">✕</button>
        </span>
      </span>
    </div>`;
  }).join('');

  box.querySelectorAll('.edit-snap').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeMpfDetailModal();
      openEditMpfSnapModal(btn.dataset.acc, btn.dataset.id);
    });
  });
  box.querySelectorAll('.del-snap').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('確定刪除此結餘紀錄？')) return;
      const a = mpfData.accounts.find(x => x.id === btn.dataset.acc);
      if (!a) return;
      a.snapshots = (a.snapshots || []).filter(s => s.id !== btn.dataset.id);
      const sorted2 = [...(a.snapshots || [])].sort((x, y) => y.month.localeCompare(x.month));
      if (sorted2.length) a.balance = Number(sorted2[0].balance);
      saveMpfLocal();
      queueMpfFullSync();
      toast('已刪除結餘紀錄', 'ok');
      renderMpfDetailSnaps(a.id);
      if (currentPage === 'assets') renderAssets(); else renderMpf();
    });
  });
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
