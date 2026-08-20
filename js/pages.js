/**
 * pages.js — 記帳 / 分析 / 戶口列表渲染
 */
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
  renderAnalysisMonthSummary();
  renderBudgetPanel();
  renderMonthBars();
  renderCustomCatSum();
}

/** 分析頁月份摘要：日均消費、預算已用／餘下／進度 */
function renderAnalysisMonthSummary() {
  let consumption = 0;
  let budgetUsed = 0;
  const budgetCats = new Set((budget && budget.categories) || []);
  const hasBudgetCats = budgetCats.size > 0;
  getMonthRecords().forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r) || isSavings(r) || isAdjustment(r)) return;
    let amt = 0;
    let cat = r.category || '其他';
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      amt = toMOP(selfAmt, r.currency);
    } else if (r.type === 'expense') {
      amt = toMOP(r.amount, r.currency);
    } else {
      return;
    }
    consumption += amt;
    if (!hasBudgetCats || budgetCats.has(cat)) budgetUsed += amt;
  });
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const dailyAvg = daysInMonth > 0 ? consumption / daysInMonth : 0;
  const budgetAmt = Number(budget && budget.amount) || 0;
  const remaining = budgetAmt - budgetUsed;
  const pct = budgetAmt > 0 ? Math.min(999, (budgetUsed / budgetAmt) * 100) : 0;

  const dailyEl = $('#analysis-daily-avg');
  if (dailyEl) dailyEl.textContent = money('MOP', dailyAvg);
  const usedEl = $('#analysis-budget-used');
  if (usedEl) usedEl.textContent = money('MOP', budgetUsed);
  const remainEl = $('#analysis-budget-remain');
  if (remainEl) {
    remainEl.textContent = money('MOP', remaining);
    remainEl.classList.toggle('negative', remaining < 0);
    remainEl.classList.toggle('positive', remaining >= 0 && budgetAmt > 0);
  }
  const pctEl = $('#analysis-budget-pct');
  if (pctEl) {
    pctEl.textContent = budgetAmt > 0 ? pct.toFixed(0) + '%' : '—';
    pctEl.classList.toggle('over-budget', budgetAmt > 0 && budgetUsed > budgetAmt);
  }
  const barEl = $('#analysis-budget-bar-fill');
  if (barEl) {
    const w = budgetAmt > 0 ? Math.min(100, (budgetUsed / budgetAmt) * 100) : 0;
    barEl.style.width = w + '%';
    barEl.classList.toggle('over', budgetAmt > 0 && budgetUsed > budgetAmt);
  }
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

let _monthRecCache = { key: '', list: null };
function invalidateMonthRecCache() { _monthRecCache = { key: '', list: null }; }
function getMonthRecords() {
  const key = currentYear + '-' + currentMonth + '-' + records.length + '-' + (records[records.length - 1]?.id || '');
  if (_monthRecCache.key === key && _monthRecCache.list) return _monthRecCache.list;
  const list = records.filter(r => {
    const d = String(r.date || '');
    if (d.length >= 7) {
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7)) - 1;
      if (!Number.isNaN(y) && !Number.isNaN(m)) return y === currentYear && m === currentMonth;
    }
    const dt = new Date(r.date);
    return dt.getFullYear() === currentYear && dt.getMonth() === currentMonth;
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
  _monthRecCache = { key, list };
  return list;
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
    if (isTransfer(r) || isCollectReceivable(r) || isInterest(r) || isAdjustment(r)) return;
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
      if (isTransfer(r) || isCollectReceivable(r) || isInterest(r) || isAdjustment(r)) return;
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
    if (isTransfer(r) || isCollectReceivable(r) || isInterest(r) || isAdjustment(r)) return;
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
  // 信用卡流水：還款減少欠款 → 顯示為 +
  if (isRepayment(r) && r.repayToId === accountId) {
    return { sign: '+', cls: 'income', amount: r.amount, currency: r.currency };
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
  const netMopEl = $('#net-mop');
  const netHkdEl = $('#net-hkd');
  const netCnyEl = $('#net-cny');
  const netTotalEl = $('#net-total-mop');
  if (netMopEl) netMopEl.textContent = money('MOP', nets.MOP);
  if (netHkdEl) netHkdEl.textContent = money('HKD', nets.HKD);
  if (netCnyEl) netCnyEl.textContent = money('CNY', nets.CNY);
  if (netTotalEl) netTotalEl.textContent = money('MOP', toMOP(nets.MOP, 'MOP') + toMOP(nets.HKD, 'HKD') + toMOP(nets.CNY, 'CNY'));

  // 主戶口：排除電子錢包、現金、應收帳款；扁平列表（無類型分組）
  const MAIN_EXCLUDE = new Set(['電子錢包', '現金', '應收帳款']);
  const typeRank = (t) => {
    const i = TYPE_ORDER.indexOf(t);
    return i >= 0 ? i : 999;
  };
  const mainAccounts = accounts
    .filter(a => !MAIN_EXCLUDE.has(a.type))
    .slice()
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || String(a.name).localeCompare(String(b.name), 'zh'));
  const container = $('#accounts-by-type');
  if (container) {
    container.innerHTML = '';
    container.classList.add('accounts-flat');
    if (!mainAccounts.length) {
      const noAcc = $('#no-accounts');
      if (noAcc) noAcc.style.display = 'block';
    } else {
      const noAcc = $('#no-accounts');
      if (noAcc) noAcc.style.display = 'none';
      mainAccounts.forEach(a => {
        const b = a.balances || { MOP: 0, HKD: 0, CNY: 0 };
        const totalMop = balancesToMOP(b);
        const item = document.createElement('div');
        item.className = 'account-item account-row';
        item.dataset.id = a.id;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        const typeIcon = ACCOUNT_TYPE_ICONS[a.type] || '';
        item.innerHTML = `
          <div class="account-row-main">
            <div class="account-name">${escapeHtml(a.name)}</div>
            <div class="account-type-tag">${typeIcon} ${escapeHtml(a.type || '')}</div>
          </div>
          <div class="account-row-right">
            <div class="account-row-amount">${money('MOP', totalMop)}</div>
            <span class="account-row-chevron">›</span>
          </div>`;
        container.appendChild(item);
      });
      container.querySelectorAll('.account-row').forEach(item => {
        const open = () => openAccountDetailModal(item.dataset.id);
        item.addEventListener('click', open);
        item.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    }
  }

  // 其他：電子錢包、現金、應收帳款（扣減項下方）
  const OTHER_TYPES = ['電子錢包', '現金', '應收帳款'];
  const otherAccounts = [];
  OTHER_TYPES.forEach(type => {
    accounts.filter(a => a.type === type).forEach(a => otherAccounts.push(a));
  });
  // 若有未在 OTHER_TYPES 的，不處理；按 TYPE_ORDER 順序已涵蓋
  const otherEl = $('#accounts-other-list');
  const noOther = $('#no-other-accounts');
  if (otherEl) {
    otherEl.innerHTML = '';
    if (!otherAccounts.length) {
      if (noOther) noOther.style.display = 'block';
    } else {
      if (noOther) noOther.style.display = 'none';
      otherAccounts.forEach(a => {
        const b = a.balances || { MOP: 0, HKD: 0, CNY: 0 };
        const isWallet = a.type === '電子錢包';
        const totalMop = balancesToMOP(b);
        const item = document.createElement('div');
        item.className = 'account-item account-row';
        item.dataset.id = a.id;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        const typeIcon = ACCOUNT_TYPE_ICONS[a.type] || '';
        item.innerHTML = `
          <div class="account-row-main">
            <div class="account-name">${escapeHtml(a.name)}</div>
            <div class="account-type-tag">${typeIcon} ${escapeHtml(a.type || '')}</div>
          </div>
          <div class="account-row-right">
            <div class="account-row-amount">${isWallet ? '—' : money('MOP', totalMop)}</div>
            <span class="account-row-chevron">›</span>
          </div>`;
        otherEl.appendChild(item);
      });
      otherEl.querySelectorAll('.account-row').forEach(item => {
        const open = () => openAccountDetailModal(item.dataset.id);
        item.addEventListener('click', open);
        item.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    }
  }
}

function openAccountDetailModal(accountId) {
  const a = accounts.find(x => x.id === accountId);
  if (!a) return;
  expandedAccountId = accountId;
  const overlay = $('#account-detail-modal-overlay');
  if (!overlay) return;
  $('#account-detail-title').textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
  const b = a.balances || {};
  const isWallet = a.type === '電子錢包';
  const linked = isWallet && a.linkedBankId ? accounts.find(x => x.id === a.linkedBankId) : null;
  let summary = '';
  if (isWallet) {
    summary = `<div class="account-meta">電子錢包不計入淨額</div>
      <div class="account-meta">扣帳銀行：${linked ? escapeHtml(linked.name) : '未設定'}</div>`;
  } else {
    summary = `<div class="account-detail-total">${money('MOP', balancesToMOP(b))}</div>
      ${currencyChipsHtml(b)}`;
    if (a.type === '銀行' && a.interestRate > 0) {
      summary += `<div class="account-meta" style="margin-top:8px">年利率 ${a.interestRate}% · ${a.interestPeriod === 'daily' ? '日息' : a.interestPeriod === 'monthly' ? '月息' : '年息'}</div>`;
    }
    if (a.note) summary += `<div class="account-meta">${escapeHtml(a.note)}</div>`;
  }
  $('#account-detail-summary').innerHTML = summary;

  const monthSel = $('#account-detail-month');
  const months = ledgerMonthOptions(a.id, isWallet);
  const curMonth = ledgerFilterMonth || '';
  monthSel.innerHTML = `<option value="">全部</option>` + months.map(m =>
    `<option value="${m}" ${m === curMonth ? 'selected' : ''}>${m}</option>`).join('');

  const editBtn = $('#btn-account-detail-edit');
  const delBtn = $('#btn-account-detail-delete');
  editBtn.onclick = () => {
    closeAccountDetailModal();
    openEditAccountModal(a.id);
  };
  delBtn.onclick = () => {
    if (!confirm('確定刪除此戶口？')) return;
    accounts = accounts.filter(x => x.id !== a.id);
    saveAccountsLocal();
    queueAccountRemove(a.id);
    expandedAccountId = null;
    closeAccountDetailModal();
    toast('已刪除戶口', 'ok');
    if (currentPage === 'assets') renderAssets(); else renderAccounts();
  };

  monthSel.onchange = () => {
    ledgerFilterMonth = monthSel.value;
    renderAccountDetailLedger(a.id);
  };

  renderAccountDetailLedger(a.id);
  overlay.classList.remove('hidden');
}

function closeAccountDetailModal() {
  $('#account-detail-modal-overlay')?.classList.add('hidden');
}

function renderAccountDetailLedger(accountId) {
  const a = accounts.find(x => x.id === accountId);
  const box = $('#account-detail-ledger');
  if (!a || !box) return;
  const isWallet = a.type === '電子錢包';
  let ledger;
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
  if (!ledger.length) {
    box.innerHTML = '<div class="ledger-empty">此條件下尚無流水紀錄</div>';
    return;
  }
  box.innerHTML = ledger.slice(0, 100).map(r => {
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
      ? `<span class="record-actions">
          <button type="button" class="edit icon-btn" data-id="${r.id}" title="編輯">✎</button>
          <button type="button" class="delete icon-btn" data-id="${r.id}" title="刪除">✕</button>
        </span>`
      : '';
    return `<div class="ledger-item">
      <span class="ledger-item-left">${r.date}<br><span class="account-meta">${escapeHtml(r.category)}${extra}${r.note ? ' · ' + escapeHtml(r.note) : ''}</span></span>
      <span class="ledger-item-right">
        <span class="record-amount ${view.cls}">${view.sign}${money(view.currency, view.amount)}</span>
        ${actions}
      </span>
    </div>`;
  }).join('');
  bindRecordActions(box);
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
  // 只改記憶體；呼叫端負責 saveAccountsLocal / 同步（避免連續寫 localStorage）
  const acc = accounts.find(a => a.id === accountId);
  if (!acc || acc.type === '電子錢包') return;
  if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
  acc.balances[currency] = Number(acc.balances[currency] || 0) + delta;
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

