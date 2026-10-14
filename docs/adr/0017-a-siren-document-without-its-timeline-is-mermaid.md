---
status: accepted
---

# Siren 文件刪掉 timeline 區塊後就是 Mermaid，主題改以 Mermaid 的顏色模型為基礎

自 ADR-0001 起，Siren 只守一個方向的相容條件：Mermaid 畫得出來的文件，Siren 一定要畫得出來。反方向從來沒有承諾，
而 Siren 在這個方向上已經走偏了：它接受只有 `%%` 的一行，Mermaid 卻拒絕；好幾個 `examples/*.srn` 拿這種行當段落分隔，
`mermaid-probe.mjs` 也記錄了這個落差，並教讀者繞過它。與此同時，正在討論的樣式規劃——theme preset、可以調色的 GUI、
產出時就帶好顏色的 skill——都需要一個目前沒有任何承諾的性質：使用者最後拿到的文字，仍然是一份 Mermaid 文件。
最直接的使用情境決定了這件事：刪掉 `timeline:` 區塊，把剩下的貼進 Mermaid 官方的渲染器，得到同一張圖。

所以相容條件改成雙向。**Siren 文件刪掉所有 timeline 區塊後，就是一份 Mermaid 文件。** 其餘規則都由守住這條線推導出來：

- **Siren 自己產出的文字絕對遵守。** examples、skill 的輸出、GUI 寫回文件的任何內容，都用一支放在 `mermaid-probe.mjs`
  旁邊的腳本對真 Mermaid 檢查（不能放在 `src/` 下，依 ADR-0001「`src/` 不得 import `mermaid`」的規定）。
- **沒有用途的寬鬆一律移除。** Siren 接受、Mermaid 拒絕，而且接受它對作者沒有任何作用的寫法，Siren 也改成拒絕（error）。
  在這種地方收緊，不會違反原本的相容條件，因為 Mermaid 本來就畫不出那份文件。刻意保留的寬鬆必須有自己的 ADR 說明理由；
  目前沒有任何一個。單獨 `%%` 的行是第一個被移除的。
- **作者的顏色只用 Mermaid 語法表達。** 整份文件層級的顏色是 Mermaid 本來就會讀的 document config——frontmatter 的
  `config`（`theme`、`themeVariables`）與 `%%{init}%%`；單一元素的顏色是 `style`、`classDef`、apply-directive 與 `linkStyle`。
  Siren 不新增自己的樣式語法，也不新增 Siren 專屬的值寫法：特別是作者永遠不在文件裡寫 `var(--siren-*)`，
  因為 Mermaid 會把它畫成什麼都沒有。
- **design token 改以 Mermaid 的顏色模型為基礎。** 主題仍然是 CSS 自訂屬性（ADR-0004 的機制讓頁面不必重畫就能換色，
  這是 Mermaid 做不到的），但 token 的意義改以 Mermaid 的 `themeVariables` 為鍵，Mermaid 的內建主題以原本的名字成為
  theme preset。Mermaid 語法裡沒有位置的意義——哪些顏色代表警告之類的角色、preset 怎麼接管作者的顏色、深色值——
  只能從 Mermaid 已經允許的地方讀取（`classDef` 的名字；Mermaid 不讀就丟掉的 frontmatter 欄位），絕不新增語法。

讓 Siren 讀得懂 document config 是第一步，因為 Mermaid 文件本來就會帶它，而 Siren 目前直接拒絕 frontmatter，
並把單行的 `%%{init}%%` 當成註解剝掉。之後的步驟——以 `themeVariables` 為鍵的 token、theme preset、apply mode、
role class——各自在實作它們的 board 落地時記錄自己的決策；這份 ADR 只固定它們都必須遵守的不變式。

## 考慮過的選項

- **維持單向條件，把落差寫進文件** —— 否決。這就是現況，也正是 repo 自己的範例不是 Mermaid 的原因。
  每個樣式功能都得自備一個匯出步驟才能回到 Mermaid，而對使用者的承諾（「刪掉 timeline 就能貼」）會以使用者看不見的方式失效。
- **每個寬鬆處都只給 warning、不拒絕** —— 對沒有用途的寬鬆否決。對一個什麼都不做的寫法給 warning，等於長期邀請大家忽略它；
  直接拒絕與 Mermaid 完全一致，對作者也沒有任何損失。
- **讓文件引用 design token（`fill:var(--siren-role-warning)`）** —— 否決。這是讓作者顏色跟著主題走最直接的做法，
  但它破壞不變式：Mermaid 沒有這些屬性，顏色在那裡會消失。同樣的意義改由 `classDef` 的名字承載，
  Mermaid 則用 `classDef` 裡寫的定值畫出來。
- **拿掉 token 主題，直接沿用 Mermaid 的主題機制** —— 否決。Mermaid 要換主題就得重畫；自訂屬性的機制才讓一張已經畫好的圖
  能跟著頁面換色。命名改成 Mermaid 的，機制保留。

## 影響

- ADR-0004、ADR-0008、ADR-0014 在改變它們的 board 落地之前維持原文；三者開頭都已加註指向這裡。
- 昨天還能畫的、含有單獨 `%%` 行的文件，今天會被拒絕。對這類文件這是破壞性變更，CHANGELOG 會寫明，範例也一併修正。
- 之後每一個新增的語法、每一個新發現的寬鬆處，都要對照這份 ADR 檢查：不是 Mermaid 的寫法，要嘛放在 timeline 區塊裡，要嘛不存在。
- timeline 區塊仍然是 Siren 自有語法唯一的家（ADR-0002），而這件事現在從「整齊」變成「承重」。
