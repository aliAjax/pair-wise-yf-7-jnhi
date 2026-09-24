"use strict";

// 页面接入：把纸张领用渲染到现有页面下方，绑定交互。
// 只依赖 PaperConvert（换算）与 PaperStore（批次存档），不改动排版主程序。
(() => {
  const WORKSHOP_KEY = "zfl16-movable-type-workshop";
  const { STATUS, STATUS_LABELS } = window.PaperStore;

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function readDrafts() {
    try {
      const saved = JSON.parse(localStorage.getItem(WORKSHOP_KEY));
      return Array.isArray(saved?.drafts) ? saved.drafts : [];
    } catch {
      return [];
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  }

  const messageTypes = {
    success: "成功",
    error: "无法提交",
    hint: "说明"
  };

  let messageTimer = null;

  function showMessage(kind, text) {
    const box = $("#paperMessage");
    box.className = `paper-message ${kind}`;
    box.innerHTML = `<strong>${messageTypes[kind] || "说明"}：</strong>${escapeHtml(text)}`;
    clearTimeout(messageTimer);
    if (kind === "success") {
      messageTimer = setTimeout(() => {
        box.className = "paper-message";
        box.textContent = "";
      }, 4000);
    }
  }

  function clearMessage() {
    const box = $("#paperMessage");
    box.className = "paper-message";
    box.textContent = "";
  }

  function renderDraftSelect() {
    const select = $("#paperDraft");
    const previous = select.value;
    const drafts = readDrafts();
    select.innerHTML =
      `<option value="">请选择已保存草稿</option>` +
      drafts
        .map(
          (draft) =>
            `<option value="${escapeHtml(draft.id)}">${escapeHtml(draft.title)} · ${escapeHtml(
              PaperConvert.label(draft.settings?.paperSize)
            )}</option>`
        )
        .join("");
    select.value = drafts.some((draft) => draft.id === previous) ? previous : "";
  }

  function renderBatchSelect() {
    const select = $("#paperBatch");
    const previous = select.value;
    const batches = [...PaperStore.getBatches()].sort(
      (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "zh-CN")
    );
    select.innerHTML = batches
      .map(
        (batch) =>
          `<option value="${escapeHtml(batch.id)}"${batch.active ? "" : " disabled"}>${escapeHtml(
            batch.name
          )}（余${batch.stock}张${batch.active ? "" : " · 已停用"}）</option>`
      )
      .join("");
    const stillValid = batches.some((batch) => batch.id === previous && batch.active);
    select.value = stillValid
      ? previous
      : batches.find((batch) => batch.active)?.id || "";
  }

  function renderHint() {
    const hint = $("#paperHint");
    const draft = readDrafts().find((item) => item.id === $("#paperDraft").value);
    const batchId = $("#paperBatch").value;
    const batch = batchId ? PaperStore.getBatch(batchId) : null;
    const pieces = Number($("#paperPieces").value);

    const problems = [];
    if (!draft) problems.push("请先在右侧「草稿与核对」中保存草稿，再选择领料。");
    if (draft && PaperStore.findOpenByDraft(draft.id)) {
      problems.push("该草稿已有未结领料，需先撤单或完工。");
    }
    if (batch && !batch.active) problems.push("该批次已停用，不能领料。");

    let calc = "";
    if (draft && Number.isInteger(pieces) && pieces > 0) {
      const size = draft.settings?.paperSize || "postcard";
      const perSheet = PaperConvert.yieldFor(size);
      const sheets = PaperConvert.sheetsNeeded(size, pieces);
      const remain = batch ? Math.max(0, batch.stock - sheets) : 0;
      calc = `${escapeHtml(PaperConvert.label(size))}每张原纸出${perSheet}张成品，${pieces}张需原纸 <strong>${sheets}张</strong>（向上取整）。`;
      if (batch) {
        calc += `提交后批次余${remain}张。`;
        if (batch.stock < sheets) {
          problems.push(`库存不足：需${sheets}张，该批次仅剩${batch.stock}张。`);
        }
      }
    } else {
      calc = "明信片每张原纸出2张、书签4张、方形小笺3张，张数按向上取整换算。";
    }

    hint.className = problems.length ? "paper-calc warn" : "paper-calc";
    hint.innerHTML =
      calc +
      (problems.length
        ? problems.map((text) => `<span class="paper-calc-line">${text}</span>`).join("")
        : "");
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  function timeline(r) {
    const points = [
      [`提交预留 ${formatTime(r.createdAt)}`, true],
      [`撤单归还 ${formatTime(r.cancelledAt)}`, r.status === STATUS.CANCELLED],
      [`开工出库 ${formatTime(r.startedAt)}`, Boolean(r.startedAt)],
      [`完工回角 ${formatTime(r.completedAt)}`, Boolean(r.completedAt)]
    ];
    return `<ul class="paper-timeline">${points
      .filter(([, show]) => show)
      .map(([text]) => `<li>${escapeHtml(text)}</li>`)
      .join("")}</ul>`;
  }

  function renderRequisitionCard(r) {
    const batch = PaperStore.getBatch(r.batchId);
    const batchText = batch ? `${batch.name}（余${batch.stock}张）` : "批次已不存在";
    const locked = r.status === STATUS.STARTED;
    const switchRow =
      r.status === STATUS.RESERVED
        ? `<label class="paper-switch-row">换批次
            <select data-switch-batch="${escapeHtml(r.id)}">
              ${PaperStore.getBatches()
                .map(
                  (b) =>
                    `<option value="${escapeHtml(b.id)}"${
                      b.id === r.batchId ? " selected" : ""
                    }${b.active || b.id === r.batchId ? "" : " disabled"}>${escapeHtml(
                      b.name
                    )}${b.active ? "" : "（已停用）"}</option>`
                )
                .join("")}
            </select>
            <span>开工前可换；已开工不能换</span>
          </label>`
        : locked
          ? `<p class="paper-locknote">已开工出库，批次锁定：${escapeHtml(batchText)}</p>`
          : `<p class="paper-locknote">原批次：${escapeHtml(batchText)}</p>`;

    let actions = "";
    if (r.status === STATUS.RESERVED) {
      actions = `
        <button type="button" data-act="start" data-id="${escapeHtml(r.id)}">开工出库</button>
        <button type="button" data-act="cancel" data-id="${escapeHtml(r.id)}">撤单归还</button>`;
    } else if (r.status === STATUS.STARTED) {
      actions = `<button type="button" data-act="complete" data-id="${escapeHtml(r.id)}">完工登记·边角回批次</button>`;
    }

    const scrapLine =
      r.status === STATUS.COMPLETED
        ? `<p class="paper-scrap">边角回原批次：${r.offcuts}小张${escapeHtml(
            PaperConvert.label(r.paperSize)
          )}（回${escapeHtml(batchText)}）</p>`
        : "";

    return `
      <article class="paper-card status-${escapeHtml(r.status)}">
        <div class="paper-card-head">
          <strong>${escapeHtml(r.draftTitle || "未命名草稿")}</strong>
          <span class="paper-chip ${escapeHtml(r.status)}">${statusLabel(r.status)}</span>
        </div>
        <p class="paper-meta">
          ${escapeHtml(PaperConvert.label(r.paperSize))}成品${r.pieces}张 ·
          每原纸出${r.perSheet}张 · 领原纸${r.sheets}张
        </p>
        ${switchRow}
        ${scrapLine}
        ${actions ? `<div class="paper-card-actions">${actions}</div>` : ""}
        ${timeline(r)}
      </article>`;
  }

  function renderRequisitions() {
    const list = $("#requisitionList");
    const items = PaperStore.getRequisitions();
    $("#requisitionCount").textContent = `${items.length}条领料`;
    list.innerHTML =
      items.map(renderRequisitionCard).join("") ||
      `<p class="empty">还没有领料记录。选草稿和批次后提交即预留库存。</p>`;
  }

  function renderBatches() {
    const list = $("#batchList");
    list.innerHTML = PaperStore.getBatches()
      .map((batch) => {
        const scraps = PaperConvert.PAPER_ORDER.filter(
          (size) => (batch.scraps[size] || 0) > 0
        )
          .map((size) => `${batch.scraps[size]}小张${PaperConvert.label(size)}`)
          .join("、");
        return `
          <article class="paper-batch ${batch.active ? "" : "archived"}">
            <div class="paper-card-head">
              <strong>${escapeHtml(batch.name)}</strong>
              <span class="paper-chip ${batch.active ? "reserved" : "cancelled"}">${
                batch.active ? "启用中" : "已停用存档"
              }</span>
            </div>
            <p class="paper-meta">原纸库存 <strong>${batch.stock}</strong>/${batch.initialStock}张 · 登记于${formatTime(
              batch.receivedAt
            )}</p>
            <p class="paper-scrap">边角回档：${escapeHtml(scraps || "暂无")}</p>
            <div class="paper-card-actions">
              <button type="button" data-toggle-batch="${escapeHtml(batch.id)}" data-active="${
                batch.active ? "0" : "1"
              }">${batch.active ? "停用存档" : "重新启用"}</button>
            </div>
          </article>`;
      })
      .join("");
  }

  function renderAll() {
    renderDraftSelect();
    renderBatchSelect();
    renderHint();
    renderRequisitions();
    renderBatches();
  }

  // 在现有草稿卡片上加“未结领料”标记（不改动主程序，监听其列表重绘）
  function markDrafts() {
    $("#draftList")
      .querySelectorAll(".draft-item")
      .forEach((card) => {
        const button = card.querySelector("[data-load-draft]");
        const open = button ? PaperStore.findOpenByDraft(button.dataset.loadDraft) : null;
        const tag = card.querySelector(".paper-open-tag");
        const text =
          open?.status === STATUS.RESERVED
            ? "领料预留中"
            : open?.status === STATUS.STARTED
              ? "领料已开工"
              : "";
        // 幂等：标记内容一致时不动 DOM，避免 MutationObserver 自激
        if (tag && tag.textContent === text) return;
        tag?.remove();
        if (open) {
          const next = document.createElement("span");
          next.className = `paper-open-tag status-${open.status}`;
          next.textContent = text;
          card.appendChild(next);
        }
      });
  }

  function resultText(act, r) {
    const batch = PaperStore.getBatch(r.batchId);
    const batchName = batch ? `「${batch.name}」` : "";
    if (act === "reserve")
      return `已预留${r.sheets}张原纸（批次${batchName}），开工前可撤单或换批次。`;
    if (act === "cancel") return `已撤单，${r.sheets}张原纸已归还批次${batchName}。`;
    if (act === "start") return `已开工出库${r.sheets}张，批次锁定，不能再换。`;
    if (act === "complete")
      return `已完工，边角${r.offcuts}小张回原批次${batchName}。`;
    return "操作完成。";
  }

  function bindEvents() {
    $("#paperDraft").addEventListener("change", () => {
      clearMessage();
      renderHint();
    });
    $("#paperBatch").addEventListener("change", () => {
      clearMessage();
      renderHint();
    });
    $("#paperPieces").addEventListener("input", () => {
      clearMessage();
      renderHint();
    });

    $("#requisitionForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const draft = readDrafts().find((item) => item.id === $("#paperDraft").value);
      const result = PaperStore.reserve({
        draftId: $("#paperDraft").value,
        draftTitle: draft?.title || "已删除草稿",
        paperSize: draft?.settings?.paperSize || "postcard",
        pieces: Number($("#paperPieces").value),
        batchId: $("#paperBatch").value
      });
      if (result.ok) {
        showMessage("success", resultText("reserve", result.requisition));
        $("#paperPieces").value = 10;
        renderAll();
      } else {
        showMessage("error", result.reason);
      }
    });

    $("#requisitionList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-act]");
      if (!button) return;
      const { act, id } = button.dataset;
      const handlers = {
        cancel: PaperStore.cancel,
        start: PaperStore.start,
        complete: PaperStore.complete
      };
      const result = handlers[act]?.call(PaperStore, id);
      if (result?.ok) {
        showMessage("success", resultText(act, result.requisition));
        renderAll();
      } else {
        showMessage("error", result?.reason || "操作失败。");
      }
    });

    $("#requisitionList").addEventListener("change", (event) => {
      const select = event.target.closest("[data-switch-batch]");
      if (!select) return;
      const result = PaperStore.switchBatch(select.dataset.switchBatch, select.value);
      if (result.ok) {
        showMessage("success", resultText("switch", result.requisition) || "批次已更换。");
        renderAll();
      } else {
        showMessage("error", result.reason);
        renderRequisitions(); // 还原被拦截的下拉选择
      }
    });

    $("#batchForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const result = PaperStore.addBatch({
        name: $("#batchName").value,
        stock: Number($("#batchStock").value)
      });
      if (result.ok) {
        showMessage("success", `批次「${result.batch.name}」已登记入库。`);
        event.target.reset();
        $("#batchStock").value = 20;
        renderAll();
      } else {
        showMessage("error", result.reason);
      }
    });

    $("#batchList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-toggle-batch]");
      if (!button) return;
      const active = button.dataset.active === "1";
      const result = PaperStore.setBatchActive(button.dataset.toggleBatch, active);
      if (result.ok) {
        showMessage(
          "success",
          active ? `批次「${result.batch.name}」已重新启用。` : `批次「${result.batch.name}」已停用存档。`
        );
        renderAll();
      } else {
        showMessage("error", result.reason);
      }
    });

    // 草稿列表被主程序重绘后补标记；主表单的草稿下拉在重绘后一并刷新
    new MutationObserver(() => {
      markDrafts();
      const select = $("#paperDraft");
      const drafts = readDrafts();
      if (!select.value || !drafts.some((draft) => draft.id === select.value)) {
        renderDraftSelect();
        renderHint();
      }
    }).observe($("#draftList"), { childList: true });

    // 其他标签页改动 localStorage 后同步
    window.addEventListener("storage", (event) => {
      if (event.key === PaperStore.STORAGE_KEY) {
        PaperStore.reload();
        renderAll();
      } else if (event.key === WORKSHOP_KEY) {
        renderDraftSelect();
        renderHint();
        markDrafts();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#paperPieces").value = 10;
    bindEvents();
    renderAll();
    markDrafts();
  });
})();
