# 記帳本

純前端記帳 App：多幣別（MOP / HKD / CNY）、戶口、信用卡還款、強積金、日息，支援 Firebase 雲端同步與本機訪客模式。

## 功能摘要

- 記帳／分析／資產三頁
- 消費支出 vs 實際支出、結餘 vs 現金流結餘
- 內部轉帳、代墊、存錢、信用卡還款
- Google 登入後各帳戶資料隔離（不把訪客資料寫入帳戶）
- 增量雲端同步（只上傳變更模組）
- 匯出 CSV / JSON 備份、導入預覽、一鍵清空

## 本機開啟

同一目錄需有：

- `index.html`
- `styles.css`
- `app.js`

用瀏覽器開啟 `index.html`，或任意靜態伺服器：

```bash
npx serve .
```

## 部署到 GitHub Pages

1. 建立 GitHub 倉庫，上傳上述檔案（可含本 README）
2. **Settings → Pages → Deploy from branch**，選 `main` / root
3. 在 Firebase Console 將 GitHub Pages 網域加入 **Authorized domains**（Authentication）
4. 確認 RTDB **Rules**（見下方）

### 建議 `.gitignore`

```
.DS_Store
*.log
.env
.env.*
node_modules/
```

`apiKey` 為前端公開設定，真正保護靠 **Security Rules + 登入**，勿把 Firebase **Admin / service account 私鑰** 放進倉庫。

## Firebase 設定

1. 建立專案，啟用 **Authentication → Google**
2. 建立 **Realtime Database**（建議 `asia-southeast1`）
3. 將設定填入 `app.js` 的 `FIREBASE_CONFIG`（或參考 `firebase-config.example.js`）
4. 套用 `database.rules.json`：

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    }
  }
}
```

## 資料隔離

| 狀態 | 本機 | 雲端 |
|------|------|------|
| 未登入 | 訪客 localStorage 鍵 | 不同步 |
| 已登入 | `key__{uid}` 快取 | `users/{uid}/…` |

登入時只載入該 uid 雲端資料，**不會**自動上傳訪客資料。

## 同步策略

- 記帳紀錄雲端使用 `recordMap/{id}、accountMap/{id}、liabilityMap/{id}` **單筆 upsert / remove**（大量變更或匯入才整包覆寫）
- 其他模組（戶口、強積金等）仍以模組級 dirty + `update` 上傳
- Service Worker（`sw.js`）網路優先快取靜態檔，加速重複開啟；Firebase 請求不攔截

## 同步策略（細節）

- 變更標記 dirty 模組：`records` / `accounts` / `liabilities` / `mpfData` / `rates`
- debounce 約 400ms 後以 RTDB `update` 只寫入變更路徑
- 離線時本機照常寫入，連線後自動補同步
- 標題旁顯示：同步中 / 已同步 / 失敗 / 離線

## 操作提示

- 記帳頁右上 **⬇**：匯出、導入、一鍵清空
- 新增紀錄會記住上次戶口與幣別
- 金額輸入後按 Enter 可儲存
- 日息：設定利率的**隔天**起計；可手動改刪利息紀錄

## 授權

私人記帳用途；請自行負責資料與 Firebase 費用。
