/**
 * config.js — 常數與 Firebase 設定
 * 修改分類、預設匯率、Firebase 專案時只動這個檔
 */
const STORAGE_KEY = 'accounting_records_v2';
const RATES_KEY = 'accounting_rates_v2';
const ACCOUNTS_KEY = 'accounting_accounts_v2';
const LIABILITIES_KEY = 'accounting_liabilities_v1';
const MPF_KEY = 'accounting_mpf_v3';
const CUSTOM_CAT_SUM_KEY = 'accounting_custom_cat_sum_v1';
const BUDGET_KEY = 'accounting_budget_v1';
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
