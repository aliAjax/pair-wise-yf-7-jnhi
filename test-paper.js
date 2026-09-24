const fs = require("fs");
const path = require("path");

// 浏览器环境垫片
const storeData = {};
global.localStorage = {
  getItem: (k) => (k in storeData ? storeData[k] : null),
  setItem: (k, v) => {
    storeData[k] = String(v);
  }
};
global.window = global;

eval(fs.readFileSync(path.join(__dirname, "paper-conversion.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "paper-store.js"), "utf8"));

const C = window.PaperConversion;
const S = window.PaperStore;

let failures = 0;
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures += 1;
    console.error(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ---- 换算 ----
check("明信片5张→3张原纸", C.piecesToSheets(5, "postcard"), 3);
check("书签5张→2张原纸", C.piecesToSheets(5, "bookmark"), 2);
check("方形4张→2张原纸", C.piecesToSheets(4, "square"), 2);
check("方形6张→2张原纸", C.piecesToSheets(6, "square"), 2);
check("明信片5张边角=½张", C.formatUnits(C.offcutUnits(5, "postcard")), "½张");
check("书签5张边角=¾张", C.formatUnits(C.offcutUnits(5, "bookmark")), "¾张");
check("方形4张边角=⅔张", C.formatUnits(C.offcutUnits(4, "square")), "⅔张");
check("方形6张无边角", C.offcutUnits(6, "square"), 0);
check("102单位=8½张", C.formatUnits(102), "8½张");
check("24单位=2张", C.formatUnits(24), "2张");

// ---- 批次与领料 ----
const batches = S.listBatches();
check("初始3个批次", batches.length, 3);
const active = batches.filter((b) => b.status === "active");
const disabled = batches.find((b) => b.status === "disabled");
check("甲刀20张", C.formatUnits(active[0].stockUnits), "20张");

const draftA = { draftId: "d1", draftTitle: "晚风小笺", paperSize: "postcard" };
const draftB = { draftId: "d2", draftTitle: "山茶书签", paperSize: "bookmark" };

// 正常预留：12张明信片 → 6张原纸
let r = S.reserve({ ...draftA, pieces: 12, batchId: active[0].id });
check("预留成功", r.ok, true);
check("预留6张", r.requisition.sheets, 6);
check("甲刀余14张", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "14张");

// 草稿重复领料 → 拒绝且库存不动
r = S.reserve({ ...draftA, pieces: 4, batchId: active[0].id });
check("重复领料被拒", r.ok, false);
console.log("     原因:", r.reason);
check("库存不动", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "14张");

// 批次停用 → 拒绝且库存不动
r = S.reserve({ ...draftB, pieces: 4, batchId: disabled.id });
check("停用批次被拒", r.ok, false);
console.log("     原因:", r.reason);
check("停用批次库存不动", C.formatUnits(S.listBatches().find((b) => b.id === disabled.id).stockUnits), "6张");

// 库存不足 → 拒绝且库存不动（乙刀9张，书签39张→10张原纸）
r = S.reserve({ ...draftB, pieces: 39, batchId: active[1].id });
check("库存不足被拒", r.ok, false);
console.log("     原因:", r.reason);
check("乙刀余9张不动", C.formatUnits(S.listBatches().find((b) => b.id === active[1].id).stockUnits), "9张");

// 换批次：甲刀 → 乙刀（6张原纸）
const req1 = S.listRequisitions()[0];
r = S.changeBatch(req1.id, active[1].id);
check("换批次成功", r.ok, true);
check("甲刀回到20张", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "20张");
check("乙刀余3张", C.formatUnits(S.listBatches().find((b) => b.id === active[1].id).stockUnits), "3张");

// 换到停用批次 → 拒绝
r = S.changeBatch(req1.id, disabled.id);
check("换入停用批次被拒", r.ok, false);
console.log("     原因:", r.reason);

// 开工出库：12张明信片=6张原纸，无边角
r = S.issue(req1.id);
check("开工成功", r.ok, true);
check("无边角", r.requisition.offcutUnits, 0);
check("乙刀仍3张", C.formatUnits(S.listBatches().find((b) => b.id === active[1].id).stockUnits), "3张");

// 已开工不能换批次
r = S.changeBatch(req1.id, active[0].id);
check("已开工换批次被拒", r.ok, false);
check("原因提示已开工", r.reason, "已开工的领料不能换批次");

// 已开工不能撤单
r = S.cancel(req1.id);
check("已开工撤单被拒", r.ok, false);

// 开工后草稿可再次领料：5张书签→2张原纸，边角¾张
r = S.reserve({ ...draftB, pieces: 5, batchId: active[0].id });
check("二次领料成功", r.ok, true);
const req2 = S.listRequisitions()[0];
check("书签5张→2张", req2.sheets, 2);
check("甲刀余18张", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "18张");
r = S.issue(req2.id);
check("二次开工成功", r.ok, true);
check("边角¾张", C.formatUnits(r.requisition.offcutUnits), "¾张");
check("边角回批次=18¾张", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "18¾张");

// 撤单归还：再预留4张明信片（2张原纸）后撤单
r = S.reserve({ ...draftA, pieces: 4, batchId: active[0].id });
check("三次领料成功", r.ok, true);
const req3 = S.listRequisitions()[0];
check("甲刀余16¾张", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "16¾张");
r = S.cancel(req3.id);
check("撤单成功", r.ok, true);
check("归还后18¾张", C.formatUnits(S.listBatches().find((b) => b.id === active[0].id).stockUnits), "18¾张");

// 入库与停用切换
r = S.addBatch("红星宣纸 · 丙刀", 10);
check("入库成功", r.ok, true);
r = S.toggleBatch(r.batch.id);
check("停用成功", r.ok && r.batch.status === "disabled", true);
r = S.addBatch("  ", 5);
check("空名入库被拒", r.ok, false);
r = S.addBatch("零刀", 0);
check("0张入库被拒", r.ok, false);

// 持久化：数据已写入 localStorage
check("已写入localStorage", typeof storeData["zfl16-paper-room"], "string");
check("持久化含3条领料", JSON.parse(storeData["zfl16-paper-room"]).requisitions.length, 3);

console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
process.exit(failures ? 1 : 0);
