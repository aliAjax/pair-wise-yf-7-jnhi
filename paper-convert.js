"use strict";

// 纸张换算：成品张数与原纸张数之间的换算，独立于批次存档和页面接入维护。
window.PaperConvert = (() => {
  // 每张原纸可出的成品张数：明信片二、书签四、方形小笺三
  const YIELD_PER_SHEET = Object.freeze({
    postcard: 2,
    bookmark: 4,
    square: 3
  });

  const PAPER_LABELS = Object.freeze({
    postcard: "明信片",
    bookmark: "书签",
    square: "方形小笺"
  });

  const PAPER_ORDER = Object.freeze(["postcard", "bookmark", "square"]);

  function yieldFor(paperSize) {
    return YIELD_PER_SHEET[paperSize] ?? YIELD_PER_SHEET.postcard;
  }

  function label(paperSize) {
    return PAPER_LABELS[paperSize] ?? String(paperSize ?? "");
  }

  // 成品张数换算原纸张数，除不尽时向上取整
  function sheetsNeeded(paperSize, pieces) {
    return Math.ceil(pieces / yieldFor(paperSize));
  }

  // 出纸后回原批次的边角（按成品小张计）：领出的整纸能切出的成品数减去实际成品数
  function offcutsFor(paperSize, sheets, pieces) {
    return Math.max(0, sheets * yieldFor(paperSize) - pieces);
  }

  return {
    YIELD_PER_SHEET,
    PAPER_LABELS,
    PAPER_ORDER,
    yieldFor,
    label,
    sheetsNeeded,
    offcutsFor
  };
})();
