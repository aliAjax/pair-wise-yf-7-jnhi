// 批次存档：原纸批次与领料单的存取和状态流转，数据只存浏览器（localStorage）。
// 换算规则见 paper-conversion.js，页面接线见 paper-ui.js。
(function () {
  const storageKey = "zfl16-paper-room";
  const C = window.PaperConversion;

  const starterBatches = [
    { name: "红星宣纸 · 甲刀", sheets: 20, status: "active" },
    { name: "澄心堂纸 · 乙刀", sheets: 9, status: "active" },
    { name: "旧存毛边纸", sheets: 6, status: "disabled" }
  ];

  function makeBatch(name, sheets, status = "active") {
    return {
      id: crypto.randomUUID(),
      name,
      initialSheets: sheets,
      stockUnits: C.sheetsToUnits(sheets),
      status,
      createdAt: new Date().toISOString()
    };
  }

  const defaultState = {
    batches: starterBatches.map((item) => makeBatch(item.name, item.sheets, item.status)),
    requisitions: []
  };

  let state = load();

  function load() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return structuredClone(defaultState);
    try {
      const parsed = JSON.parse(saved);
      return { ...structuredClone(defaultState), ...parsed };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function ok(extra = {}) {
    return { ok: true, ...extra };
  }

  function fail(reason) {
    return { ok: false, reason };
  }

  function getBatch(batchId) {
    return state.batches.find((item) => item.id === batchId) || null;
  }

  function getRequisition(id) {
    return state.requisitions.find((item) => item.id === id) || null;
  }

  function hasOpenRequisition(draftId) {
    return state.requisitions.some((item) => item.draftId === draftId && item.status === "reserved");
  }

  function listBatches() {
    return structuredClone(state.batches);
  }

  function listRequisitions() {
    return structuredClone(state.requisitions);
  }

  // 某批次当前被预留占用的原纸（单位）
  function reservedUnitsForBatch(batchId) {
    return state.requisitions
      .filter((item) => item.batchId === batchId && item.status === "reserved")
      .reduce((sum, item) => sum + C.sheetsToUnits(item.sheets), 0);
  }

  function addBatch(name, sheets) {
    const trimmed = String(name).trim();
    const count = Number(sheets);
    if (!trimmed) return fail("请填写批次名称");
    if (!Number.isInteger(count) || count <= 0) return fail("入库张数需为大于0的整数");
    const batch = makeBatch(trimmed, count);
    state.batches.unshift(batch);
    save();
    return ok({ batch: structuredClone(batch) });
  }

  function toggleBatch(batchId) {
    const batch = getBatch(batchId);
    if (!batch) return fail("批次不存在");
    batch.status = batch.status === "active" ? "disabled" : "active";
    save();
    return ok({ batch: structuredClone(batch) });
  }

  // 提交领料：先校验，通过后预留库存；任何失败都不动库存
  function reserve({ draftId, draftTitle, paperSize, pieces, batchId }) {
    const count = Number(pieces);
    if (!draftId) return fail("请选择草稿");
    if (!Number.isInteger(count) || count <= 0) return fail("张数需为大于0的整数");
    if (!C.isKnownSize(paperSize)) return fail("草稿纸型未知，无法换算");
    if (hasOpenRequisition(draftId)) return fail(`「${draftTitle}」已有未结领料，请先撤单或开工`);
    const batch = getBatch(batchId);
    if (!batch) return fail("请选择原纸批次");
    if (batch.status !== "active") return fail(`批次「${batch.name}」已停用，不能领料`);
    const sheets = C.piecesToSheets(count, paperSize);
    const needUnits = C.sheetsToUnits(sheets);
    if (batch.stockUnits < needUnits) {
      return fail(`库存不足：需${C.formatUnits(needUnits)}，批次余${C.formatUnits(batch.stockUnits)}`);
    }
    batch.stockUnits -= needUnits;
    const requisition = {
      id: crypto.randomUUID(),
      draftId,
      draftTitle,
      paperSize,
      pieces: count,
      sheets,
      batchId,
      batchName: batch.name,
      status: "reserved",
      offcutUnits: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.requisitions.unshift(requisition);
    save();
    return ok({ requisition: structuredClone(requisition) });
  }

  // 撤单：预留的原纸归还批次
  function cancel(id) {
    const requisition = getRequisition(id);
    if (!requisition) return fail("领料单不存在");
    if (requisition.status !== "reserved") return fail("仅预留中的领料单可撤单");
    const batch = getBatch(requisition.batchId);
    if (batch) batch.stockUnits += C.sheetsToUnits(requisition.sheets);
    requisition.status = "cancelled";
    requisition.updatedAt = new Date().toISOString();
    save();
    return ok({ requisition: structuredClone(requisition) });
  }

  // 开工出库：裁剩的边角回原批次
  function issue(id) {
    const requisition = getRequisition(id);
    if (!requisition) return fail("领料单不存在");
    if (requisition.status !== "reserved") return fail("仅预留中的领料单可开工");
    const offcut = C.offcutUnits(requisition.pieces, requisition.paperSize);
    const batch = getBatch(requisition.batchId);
    if (batch) batch.stockUnits += offcut;
    requisition.status = "issued";
    requisition.offcutUnits = offcut;
    requisition.updatedAt = new Date().toISOString();
    save();
    return ok({ requisition: structuredClone(requisition) });
  }

  // 换批次：仅预留中可换；已开工的领料不能换批次
  function changeBatch(id, batchId) {
    const requisition = getRequisition(id);
    if (!requisition) return fail("领料单不存在");
    if (requisition.status === "issued") return fail("已开工的领料不能换批次");
    if (requisition.status !== "reserved") return fail("仅预留中的领料单可换批次");
    const next = getBatch(batchId);
    if (!next) return fail("请选择原纸批次");
    if (next.id === requisition.batchId) return fail("已是该批次");
    if (next.status !== "active") return fail(`批次「${next.name}」已停用，不能换入`);
    const needUnits = C.sheetsToUnits(requisition.sheets);
    if (next.stockUnits < needUnits) {
      return fail(`库存不足：需${C.formatUnits(needUnits)}，批次余${C.formatUnits(next.stockUnits)}`);
    }
    const prev = getBatch(requisition.batchId);
    if (prev) prev.stockUnits += needUnits;
    next.stockUnits -= needUnits;
    requisition.batchId = next.id;
    requisition.batchName = next.name;
    requisition.updatedAt = new Date().toISOString();
    save();
    return ok({ requisition: structuredClone(requisition) });
  }

  window.PaperStore = {
    listBatches,
    listRequisitions,
    reservedUnitsForBatch,
    addBatch,
    toggleBatch,
    reserve,
    cancel,
    issue,
    changeBatch
  };
})();
