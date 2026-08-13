/**
 * app.js — 啟動與事件綁定（最後載入）
 */
function init() {
  // iOS 加至主畫面：補上 standalone class（部分版本不支援 display-mode 媒體查詢）
  try {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
    if (standalone) document.body.classList.add('is-standalone');
  } catch (_) {}

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
  const btnCloseAccDetail = $('#btn-close-account-detail');
  const btnCloseMpfDetail = $('#btn-close-mpf-detail');
  if (btnCloseMpfDetail) btnCloseMpfDetail.addEventListener('click', closeMpfDetailModal);
  const mpfDetailOverlay = $('#mpf-detail-modal-overlay');
  if (mpfDetailOverlay) mpfDetailOverlay.addEventListener('click', e => { if (e.target.id === 'mpf-detail-modal-overlay') closeMpfDetailModal(); });

  if (btnCloseAccDetail) btnCloseAccDetail.addEventListener('click', closeAccountDetailModal);
  const accDetailOverlay = $('#account-detail-modal-overlay');
  if (accDetailOverlay) accDetailOverlay.addEventListener('click', e => { if (e.target.id === 'account-detail-modal-overlay') closeAccountDetailModal(); });

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

  // 預算
  const btnSaveBudget = $('#btn-save-budget');
  if (btnSaveBudget) btnSaveBudget.addEventListener('click', saveBudgetFromUI);
  const budgetAmountInput = $('#budget-amount-input');
  if (budgetAmountInput) {
    budgetAmountInput.addEventListener('change', saveBudgetFromUI);
    budgetAmountInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveBudgetFromUI(); }
    });
  }
  const btnToggleBudgetCats = $('#btn-toggle-budget-cats');
  if (btnToggleBudgetCats) {
    btnToggleBudgetCats.addEventListener('click', () => {
      budgetCatsExpanded = !budgetCatsExpanded;
      renderBudgetPanel();
    });
  }

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


init();
