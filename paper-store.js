"use strict";

// 批次存档：原纸批次与领料单的状态机。数据只存浏览器（localStorage）。
// 纯数据与规则模块，不操作 DOM；换算规则委托 PaperConvert。
window.PaperStore = (() => {
  const STORAGE_KEY = "zfl16-paper-requisitions";

  const STATUS = Object.freeze({
    RESERVED: "reserved", // 已预留，尚未出库
    STARTED: "started", // 已开工出库，批次锁定
    COMPLETED: "completed", // 已完工，边角已回原批次
    CANCELLED: "cancelled" // 已撤单，预留已归还
  });

  const STATUS_LABELS = Object.freeze({
    reserved: "预留中",
    started: "已开工",
    completed: "已完工",
    cancelled: "已撤单"
  });

  const seedBatches = () => [
    {
      id: crypto.randomUUID(),
      name: "净皮四尺·甲批",
      receivedAt: new Date(Date.now() - 86400000 * 12).toISOString(),
      initialStock: 60,
      stock: 60,
      active: true,
      scraps: { postcard: 0, bookmark: 0, square: 0 }
    },
    {
      id: crypto.randomUUID(),
      name: "棉料六尺·乙批",
      receivedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      initialStock: 30,
      stock: 30,
      active: true,
      scraps: { postcard: 0, bookmark: 0, square: 0 }
    },
    {
      id: crypto.randomUUID(),
      name: "旧藏陈纸·丙批",
      receivedAt: new Date(Date.now() - 86400000 * 40).toISOString(),
      initialStock: 12,
      stock: 12,
      active: false,
      scraps: { postcard: 0, bookmark: 0, square: 0 }
    }
  ];

  const emptyScraps = () => ({ postcard: 0, bookmark: 0, square: 0 });

  function defaultData() {
    return { batches: seedBatches(), requisitions: [] };
  }

  function normalize(data) {
    const base = defaultData();
    if (!data || typeof data !== "object") return base;
    const batches = Array.isArray(data.batches)
      ? data.batches.map((batch) => ({
          id: batch.id || crypto.randomUUID(),
          name: String(batch.name ?? "未命名批次"),
          receivedAt: batch.receivedAt || new Date().toISOString(),
          initialStock: Number(batch.initialStock) || 0,
          stock: Number(batch.stock) || 0,
          active: batch.active !== false,
          scraps: { ...emptyScraps(), ...(batch.scraps || {}) }
        }))
      : base.batches;
    const requisitions = Array.isArray(data.requisitions)
      ? data.requisitions.map((r) => ({
          id: r.id || crypto.randomUUID(),
          draftId: String(r.draftId ?? ""),
          draftTitle: String(r.draftTitle ?? ""),
          paperSize: r.paperSize || "postcard",
          pieces: Number(r.pieces) || 0,
          perSheet: Number(r.perSheet) || PaperConvert.yieldFor(r.paperSize),
          sheets: Number(r.sheets) || 0,
          batchId: String(r.batchId ?? ""),
          status: r.status || STATUS.RESERVED,
          offcuts: Number(r.offcuts) || 0,
          createdAt: r.createdAt || new Date().toISOString(),
          cancelledAt: r.cancelledAt || null,
          startedAt: r.startedAt || null,
          completedAt: r.completedAt || null
        }))
      : [];
    return { batches, requisitions };
  }

  let data = load();

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalize(JSON.parse(saved)) : defaultData();
    } catch {
      return defaultData();
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // 供其他标签页同步时重新装载
  function reload() {
    data = load();
  }

  const getBatches = () => data.batches;
  const getRequisitions = () => data.requisitions;
  const getBatch = (batchId) => data.batches.find((batch) => batch.id === batchId) || null;
  const getRequisition = (id) => data.requisitions.find((r) => r.id === id) || null;

  // 草稿的未结领料：预留中或已开工（撤单、完工后即结清）
  function findOpenByDraft(draftId) {
    return (
      data.requisitions.find(
        (r) =>
          r.draftId === draftId &&
          (r.status === STATUS.RESERVED || r.status === STATUS.STARTED)
      ) || null
    );
  }

  function availableStock(batchId) {
    return (getBatch(batchId)?.stock) ?? 0;
  }

  // 新批次登记；库存必须为非负整数
  function addBatch({ name, stock }) {
    const trimmed = String(name ?? "").trim();
    const amount = Number(stock);
    if (!trimmed) return { ok: false, reason: "请填写批次名称。" };
    if (!Number.isInteger(amount) || amount < 0) {
      return { ok: false, reason: "原纸库存需为不小于零的整数。" };
    }
    const batch = {
      id: crypto.randomUUID(),
      name: trimmed,
      receivedAt: new Date().toISOString(),
      initialStock: amount,
      stock: amount,
      active: true,
      scraps: emptyScraps()
    };
    data.batches.unshift(batch);
    persist();
    return { ok: true, batch };
  }

  // 批次存档/启用；停用后不能再向其领料或换入，已预留的单仍可处理
  function setBatchActive(batchId, active) {
    const batch = getBatch(batchId);
    if (!batch) return { ok: false, reason: "批次不存在。" };
    batch.active = Boolean(active);
    persist();
    return { ok: true, batch };
  }

  // 提交领料：先预留库存。库存不足、批次停用或草稿已有未结领料时，库存不动
  function reserve({ draftId, draftTitle, paperSize, pieces, batchId }) {
    if (!draftId) return { ok: false, reason: "请选择要领料的草稿。" };
    if (findOpenByDraft(draftId)) {
      return { ok: false, reason: "该草稿已有未结领料，撤单或完工后才能再领。" };
    }
    const batch = getBatch(batchId);
    if (!batch) return { ok: false, reason: "请选择原纸批次。" };
    if (!batch.active) return { ok: false, reason: "该批次已停用，不能领料。" };
    const count = Number(pieces);
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, reason: "张数需为正整数。" };
    }
    const size = PaperConvert.PAPER_LABELS[paperSize] ? paperSize : "postcard";
    const sheets = PaperConvert.sheetsNeeded(size, count);
    if (batch.stock < sheets) {
      return {
        ok: false,
        reason: `库存不足：需要${sheets}张原纸，批次「${batch.name}」仅剩${batch.stock}张，库存未动。`
      };
    }
    const requisition = {
      id: crypto.randomUUID(),
      draftId,
      draftTitle: String(draftTitle ?? ""),
      paperSize: size,
      pieces: count,
      perSheet: PaperConvert.yieldFor(size),
      sheets,
      batchId,
      status: STATUS.RESERVED,
      offcuts: 0,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      startedAt: null,
      completedAt: null
    };
    batch.stock -= sheets;
    data.requisitions.unshift(requisition);
    persist();
    return { ok: true, requisition };
  }

  // 撤单：归还预留的原纸
  function cancel(requisitionId) {
    const r = getRequisition(requisitionId);
    if (!r) return { ok: false, reason: "领料单不存在。" };
    if (r.status !== STATUS.RESERVED) {
      return { ok: false, reason: "仅预留中的领料可以撤单。" };
    }
    const batch = getBatch(r.batchId);
    if (batch) batch.stock += r.sheets;
    r.status = STATUS.CANCELLED;
    r.cancelledAt = new Date().toISOString();
    persist();
    return { ok: true, requisition: r };
  }

  // 开工出库：预留转出库，批次此后锁定
  function start(requisitionId) {
    const r = getRequisition(requisitionId);
    if (!r) return { ok: false, reason: "领料单不存在。" };
    if (r.status !== STATUS.RESERVED) {
      return { ok: false, reason: "仅预留中的领料可以开工出库。" };
    }
    const batch = getBatch(r.batchId);
    if (!batch || !batch.active) {
      return { ok: false, reason: "批次已停用或不存在，无法开工；可撤单后改选其他批次。" };
    }
    r.status = STATUS.STARTED;
    r.startedAt = new Date().toISOString();
    persist();
    return { ok: true, requisition: r };
  }

  // 完工：边角按成品小张计，回到原批次存档
  function complete(requisitionId) {
    const r = getRequisition(requisitionId);
    if (!r) return { ok: false, reason: "领料单不存在。" };
    if (r.status !== STATUS.STARTED) {
      return { ok: false, reason: "仅已开工的领料可以完工登记。" };
    }
    const batch = getBatch(r.batchId);
    if (!batch) return { ok: false, reason: "原批次已不存在，边角无法回档。" };
    const offcuts = PaperConvert.offcutsFor(r.paperSize, r.sheets, r.pieces);
    r.offcuts = offcuts;
    batch.scraps[r.paperSize] = (batch.scraps[r.paperSize] || 0) + offcuts;
    r.status = STATUS.COMPLETED;
    r.completedAt = new Date().toISOString();
    persist();
    return { ok: true, requisition: r };
  }

  // 换批次：只允许在开工前（预留中）；已开工不能换批次
  function switchBatch(requisitionId, nextBatchId) {
    const r = getRequisition(requisitionId);
    if (!r) return { ok: false, reason: "领料单不存在。" };
    if (r.status === STATUS.STARTED) {
      return { ok: false, reason: "已开工出库，批次锁定，不能再换批次。" };
    }
    if (r.status !== STATUS.RESERVED) {
      return { ok: false, reason: "仅预留中的领料可以换批次。" };
    }
    const target = getBatch(nextBatchId);
    if (!target) return { ok: false, reason: "目标批次不存在。" };
    if (!target.active) return { ok: false, reason: "目标批次已停用，不能换入。" };
    if (target.id === r.batchId) return { ok: true, requisition: r };
    if (target.stock < r.sheets) {
      return {
        ok: false,
        reason: `目标批次库存不足：需要${r.sheets}张，「${target.name}」仅剩${target.stock}张。`
      };
    }
    const current = getBatch(r.batchId);
    if (current) current.stock += r.sheets; // 先归还原批次预留
    target.stock -= r.sheets; // 再从新批次预留
    r.batchId = target.id;
    persist();
    return { ok: true, requisition: r };
  }

  return {
    STORAGE_KEY,
    STATUS,
    STATUS_LABELS,
    reload,
    getBatches,
    getRequisitions,
    getBatch,
    getRequisition,
    findOpenByDraft,
    availableStock,
    addBatch,
    setBatchActive,
    reserve,
    cancel,
    start,
    complete,
    switchBatch
  };
})();
