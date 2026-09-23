// Valida el ST_RECEIPT de ST-08.2 con los validadores aceptados de IMP-01
// (read-only) y verifica su linkage con la identidad del WORK-PACKET.
import fs from "node:fs";
import { validateStReceipt, linkStReceiptToPacket } from "../../../../src/contracts/identities.mjs";

const receipt = JSON.parse(fs.readFileSync(new URL("../../../../operations/receipts/IMP-08-ST-2.json", import.meta.url)));

const packet = {
  packetId: "WP-IMP-08-ST-2-v1.1",
  project: "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
  spec: {
    id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md",
    version: "1.1",
    sha256: "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
  },
  parentImp: "IMP-08",
  subtaskId: "ST-08.2",
};

const receiptOutcome = validateStReceipt(receipt);
const linkageOutcome = linkStReceiptToPacket(packet, receipt);

console.log("validateStReceipt.ok =", receiptOutcome.ok);
if (!receiptOutcome.ok) {
  console.log(JSON.stringify(receiptOutcome.errors, null, 2));
}
console.log("linkStReceiptToPacket.ok =", linkageOutcome.ok);
if (!linkageOutcome.ok) {
  console.log(JSON.stringify(linkageOutcome.errors, null, 2));
}

process.exitCode = receiptOutcome.ok && linkageOutcome.ok ? 0 : 1;
