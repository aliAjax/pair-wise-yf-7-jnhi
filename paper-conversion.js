// 纸张换算：成品张数与原纸张数之间的换算规则，独立维护。
// 内部以 1/12 张原纸为最小单位（2、3、4 的最小公倍数），避免分数误差。
(function () {
  const UNITS_PER_SHEET = 12;

  // 每张原纸可裁出的成品张数
  const YIELD_PER_SHEET = {
    postcard: 2, // 明信片
    bookmark: 4, // 书签
    square: 3 // 方形小笺
  };

  const SIZE_LABELS = {
    postcard: "明信片",
    bookmark: "书签",
    square: "方形小笺"
  };

  function isKnownSize(size) {
    return Object.prototype.hasOwnProperty.call(YIELD_PER_SHEET, size);
  }

  function assertSize(size) {
    if (!isKnownSize(size)) throw new Error(`未知纸型：${size}`);
  }

  // 每张成品折合多少单位原纸
  function unitsPerPiece(size) {
    assertSize(size);
    return UNITS_PER_SHEET / YIELD_PER_SHEET[size];
  }

  // 成品张数 → 需预留的原纸整张学数（换算后向上取整）
  function piecesToSheets(pieces, size) {
    assertSize(size);
    return Math.ceil(pieces / YIELD_PER_SHEET[size]);
  }

  function sheetsToUnits(sheets) {
    return sheets * UNITS_PER_SHEET;
  }

  // 开工出库后应回原批次的边角（单位）：预留整数张减去实际消耗
  function offcutUnits(pieces, size) {
    return sheetsToUnits(piecesToSheets(pieces, size)) - pieces * unitsPerPiece(size);
  }

  const FRACTION_GLYPHS = { 2: "⅙", 3: "¼", 4: "⅓", 6: "½", 8: "⅔", 9: "¾", 10: "⅚" };

  // 单位 → “8张” / “8½张” / “⅔张”
  function formatUnits(units) {
    const whole = Math.floor(units / UNITS_PER_SHEET);
    const rem = units % UNITS_PER_SHEET;
    if (rem === 0) return `${whole}张`;
    const fraction = FRACTION_GLYPHS[rem] || `${rem}⁄12`;
    return whole > 0 ? `${whole}${fraction}张` : `${fraction}张`;
  }

  function describeYield(size) {
    assertSize(size);
    return `每张原纸出${YIELD_PER_SHEET[size]}张${SIZE_LABELS[size]}`;
  }

  window.PaperConversion = {
    UNITS_PER_SHEET,
    YIELD_PER_SHEET,
    SIZE_LABELS,
    isKnownSize,
    unitsPerPiece,
    piecesToSheets,
    sheetsToUnits,
    offcutUnits,
    formatUnits,
    describeYield
  };
})();
