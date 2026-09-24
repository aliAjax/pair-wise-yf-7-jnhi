// 页面接入：把纸张领用接进排版工坊页面。
// 换算见 paper-conversion.js，批次存档见 paper-store.js，草稿由 app.js 通过 window.WorkshopApp 提供。
(function () {
  const C = window.PaperConversion;
  const store = window.PaperStore;

  const els = {
    summary: document.querySelector("#paperSummary"),
    form: document.querySelector("#requisitionForm"),
    draft: document.querySelector("#reqDraft"),
    batch: document.querySelector("#reqBatch"),
    pieces: document.querySelector("#reqPieces"),
    preview: document.querySelector("#reqPreview"),
    message: document.querySelector("#reqMessage"),
    batchForm: document.querySelector("#batchForm"),
    batchName: document.querySelector("#batchName"),
    batchSheets: document.querySelector("#batchSheets"),
    batchList: document.querySelector("#batchList"),
    requisitionList: document.querySelector("#requisitionList")
  };

  const STATUS_LABELS = {
    reserved: ["预留中", "status-reserved"],
    issued: ["已开工", "status-issued"],
    cancelled: ["已撤单", "status-cancelled"]
  };

  function getDrafts() {
    return window.WorkshopApp ? window.WorkshopApp.getDrafts() : [];
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showMessage(text, isError) {
    els.message.textContent = text;
    els.message.className = `paper-message ${isError ? "error" : "ok"}`;
  }

  function handle(result, successText) {
    showMessage(result.ok ? successText : result.reason, !result.ok);
    render();
  }

  function batchOptionLabel(batch) {
    const suffix = batch.status === "active" ? "" : "（已停用）";
    return `${batch.name}${suffix} · 余${C.formatUnits(batch.stockUnits)}`;
  }

  function renderSummary() {
    const batches = store.listBatches();
    const open = store.listRequisitions().filter((item) => item.status === "reserved").length;
    const available = batches
      .filter((item) => item.status === "active")
      .reduce((sum, item) => sum + item.stockUnits, 0);
    els.summary.textContent = `${batches.length}个批次 · 可用${C.formatUnits(available)} · ${open}单预留中`;
  }

  function renderDraftOptions() {
    const drafts = getDrafts();
    const current = els.draft.value;
    if (!drafts.length) {
      els.draft.innerHTML = `<option value="">暂无已保存草稿</option>`;
      return;
    }
    els.draft.innerHTML = drafts
      .map(
        (draft) =>
          `<option value="${draft.id}">${escapeHtml(draft.title)}（${C.SIZE_LABELS[draft.paperSize] || draft.paperSize}）</option>`
      )
      .join("");
    if (drafts.some((draft) => draft.id === current)) els.draft.value = current;
  }

  function renderBatchOptions() {
    const batches = store.listBatches();
    const current = els.batch.value;
    if (!batches.length) {
      els.batch.innerHTML = `<option value="">暂无批次，请先入库</option>`;
      return;
    }
    els.batch.innerHTML = batches
      .map((batch) => `<option value="${batch.id}">${escapeHtml(batchOptionLabel(batch))}</option>`)
      .join("");
    if (batches.some((batch) => batch.id === current)) els.batch.value = current;
  }

  function renderPreview() {
    const drafts = getDrafts();
    const draft = drafts.find((item) => item.id === els.draft.value);
    const pieces = Number(els.pieces.value);
    if (!draft) {
      els.preview.textContent = drafts.length ? "" : "请先在上方保存草稿，再来领纸。";
      return;
    }
    if (!Number.isInteger(pieces) || pieces <= 0) {
      els.preview.textContent = "请填写成品张数。";
      return;
    }
    const sheets = C.piecesToSheets(pieces, draft.paperSize);
    let text = `${C.describeYield(draft.paperSize)}，${pieces}张需原纸${sheets}张（向上取整）`;
    const batch = store.listBatches().find((item) => item.id === els.batch.value);
    if (batch) {
      text +=
        batch.stockUnits >= C.sheetsToUnits(sheets)
          ? `；批次余${C.formatUnits(batch.stockUnits)}，够用`
          : `；批次余${C.formatUnits(batch.stockUnits)}，不足`;
    }
    els.preview.textContent = text;
  }

  function renderBatches() {
    const batches = store.listBatches();
    els.batchList.innerHTML =
      batches
        .map((batch) => {
          const disabled = batch.status !== "active";
          const reserved = store.reservedUnitsForBatch(batch.id);
          return `
            <article class="batch-item ${disabled ? "disabled" : ""}">
              <header>
                <strong>${escapeHtml(batch.name)}</strong>
                <span class="status-badge ${disabled ? "status-disabled" : "status-active"}">${disabled ? "已停用" : "在用"}</span>
              </header>
              <span class="meta-line">可用 ${C.formatUnits(batch.stockUnits)} · 预留中 ${C.formatUnits(reserved)} · 入库 ${batch.initialSheets}张</span>
              <div class="req-actions">
                <button type="button" data-toggle-batch="${batch.id}">${disabled ? "启用批次" : "停用批次"}</button>
              </div>
            </article>
          `;
        })
        .join("") || `<p class="empty">还没有原纸批次。</p>`;
  }

  function renderRequisitions() {
    const requisitions = store.listRequisitions();
    const batches = store.listBatches();
    els.requisitionList.innerHTML =
      requisitions
        .map((item) => {
          const [statusText, statusClass] = STATUS_LABELS[item.status];
          const sizeLabel = C.SIZE_LABELS[item.paperSize] || item.paperSize;
          let body = "";
          if (item.status === "reserved") {
            const options = batches
              .filter((batch) => batch.id !== item.batchId)
              .map(
                (batch) =>
                  `<option value="${batch.id}">${escapeHtml(batch.name)}${batch.status === "active" ? "" : "（已停用）"}</option>`
              )
              .join("");
            body = `
              <div class="req-actions">
                <button type="button" data-issue="${item.id}">开工出库</button>
                <button type="button" data-cancel="${item.id}">撤单归还</button>
              </div>
              <div class="req-actions">
                <select data-change-select="${item.id}" ${options ? "" : "disabled"}>
                  ${options || `<option value="">无其他批次</option>`}
                </select>
                <button type="button" data-change="${item.id}" ${options ? "" : "disabled"}>换批次</button>
              </div>
            `;
          } else if (item.status === "issued") {
            body = `<span class="meta-line">已开工出库${
              item.offcutUnits > 0 ? `，边角${C.formatUnits(item.offcutUnits)}已回批次` : "，无边角"
            }；不能再换批次。</span>`;
          } else {
            body = `<span class="meta-line">已撤单，原纸已归还批次。</span>`;
          }
          return `
            <article class="req-item">
              <header>
                <strong>${escapeHtml(item.draftTitle)}</strong>
                <span class="status-badge ${statusClass}">${statusText}</span>
              </header>
              <span class="meta-line">${sizeLabel} ${item.pieces}张 → 原纸 ${item.sheets}张 · 批次：${escapeHtml(item.batchName)}</span>
              <span class="meta-line">${new Date(item.createdAt).toLocaleString("zh-CN")}</span>
              ${body}
            </article>
          `;
        })
        .join("") || `<p class="empty">还没有领料记录。</p>`;
  }

  function render() {
    renderSummary();
    renderDraftOptions();
    renderBatchOptions();
    renderPreview();
    renderBatches();
    renderRequisitions();
  }

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = getDrafts().find((item) => item.id === els.draft.value);
    if (!draft) {
      showMessage("请选择草稿", true);
      return;
    }
    const result = store.reserve({
      draftId: draft.id,
      draftTitle: draft.title,
      paperSize: draft.paperSize,
      pieces: Number(els.pieces.value),
      batchId: els.batch.value
    });
    handle(result, result.ok ? `已预留原纸 ${result.requisition.sheets} 张（${draft.title}）` : "");
  });

  els.batchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = store.addBatch(els.batchName.value, Number(els.batchSheets.value));
    handle(result, result.ok ? `批次「${result.batch.name}」已入库 ${result.batch.initialSheets} 张` : "");
    if (result.ok) els.batchForm.reset();
  });

  els.batchList.addEventListener("click", (event) => {
    const toggleButton = event.target.closest("[data-toggle-batch]");
    if (!toggleButton) return;
    const result = store.toggleBatch(toggleButton.dataset.toggleBatch);
    handle(result, result.ok ? `批次「${result.batch.name}」已${result.batch.status === "active" ? "启用" : "停用"}` : "");
  });

  els.requisitionList.addEventListener("click", (event) => {
    const issueButton = event.target.closest("[data-issue]");
    const cancelButton = event.target.closest("[data-cancel]");
    const changeButton = event.target.closest("[data-change]");
    if (issueButton) {
      const result = store.issue(issueButton.dataset.issue);
      handle(
        result,
        result.ok
          ? result.requisition.offcutUnits > 0
            ? `已开工出库，边角${C.formatUnits(result.requisition.offcutUnits)}已回批次`
            : "已开工出库，无边角"
          : ""
      );
      return;
    }
    if (cancelButton) {
      const result = store.cancel(cancelButton.dataset.cancel);
      handle(result, result.ok ? `已撤单，${result.requisition.sheets} 张原纸已归还批次` : "");
      return;
    }
    if (changeButton) {
      const select = els.requisitionList.querySelector(`[data-change-select="${changeButton.dataset.change}"]`);
      const result = store.changeBatch(changeButton.dataset.change, select ? select.value : "");
      handle(result, result.ok ? `已换至批次「${result.requisition.batchName}」` : "");
    }
  });

  els.draft.addEventListener("change", renderPreview);
  els.batch.addEventListener("change", renderPreview);
  els.pieces.addEventListener("input", renderPreview);

  // 主应用保存/删除草稿后同步下拉
  document.addEventListener("workshop:change", render);

  render();
})();
