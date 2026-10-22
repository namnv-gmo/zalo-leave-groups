// Rời nhiều nhóm Zalo cùng lúc — chọn nhóm bằng checkbox, có delay ngẫu nhiên để tránh bị chặn.
//
// Cách chạy:
//   node leave-groups.js                 # liệt kê tất cả nhóm, tự tick chọn
//   node leave-groups.js "ABC Corp"      # tick sẵn các nhóm có tên chứa "ABC Corp"
//   node leave-groups.js --dry-run       # chạy thử, không rời nhóm nào
//   node leave-groups.js --silent        # rời im lặng (không hiện thông báo "đã rời nhóm")

import fs from "node:fs";
import { Zalo } from "zca-js";
import { checkbox, input } from "@inquirer/prompts";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SILENT = args.includes("--silent");
const keyword = args.find((a) => !a.startsWith("--"))?.toLowerCase();

const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 7000;
const MAX_CONSECUTIVE_ERRORS = 2;
const QR_PATH = "./qr.png";
const LOG_PATH = "./leave-log.txt";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () => MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
const log = (line) => {
  console.log(line);
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
};

// Bỏ dấu tiếng Việt để lọc theo từ khóa dễ hơn ("cong ty" khớp "Công Ty")
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

async function login() {
  console.log(`Đang tạo mã QR... Mở file ${QR_PATH} và quét bằng app Zalo trên điện thoại.`);
  const zalo = new Zalo({ selfListen: false, logging: false });
  const api = await zalo.loginQR({ qrPath: QR_PATH });
  fs.rmSync(QR_PATH, { force: true });
  console.log("Đăng nhập thành công.\n");
  return api;
}

async function fetchGroups(api) {
  const { gridVerMap } = await api.getAllGroups();
  const ids = Object.keys(gridVerMap);
  console.log(`Tìm thấy ${ids.length} nhóm, đang lấy tên nhóm...`);

  const groups = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { gridInfoMap } = await api.getGroupInfo(ids.slice(i, i + 50));
    groups.push(...Object.values(gridInfoMap));
    await sleep(1000);
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

async function main() {
  const api = await login();
  const ownId = api.getOwnId();
  const groups = await fetchGroups(api);

  const selected = await checkbox({
    message: "Chọn các nhóm muốn RỜI (Space: tick/bỏ tick, A: chọn tất cả, Enter: xác nhận)",
    pageSize: 20,
    loop: false,
    choices: groups.map((g) => {
      const isOwner = g.creatorId === ownId;
      const isAdmin = g.adminIds?.includes(ownId);
      const tag = isOwner ? " [TRƯỞNG NHÓM]" : isAdmin ? " [phó nhóm]" : "";
      return {
        name: `${g.name} (${g.totalMember} tv)${tag}`,
        value: g,
        checked: keyword ? normalize(g.name).includes(normalize(keyword)) : false,
      };
    }),
  });

  if (selected.length === 0) {
    console.log("Không chọn nhóm nào. Thoát.");
    process.exit(0);
  }

  console.log("\nSẽ rời các nhóm sau:");
  selected.forEach((g, i) => console.log(`  ${i + 1}. ${g.name}`));
  const owners = selected.filter((g) => g.creatorId === ownId);
  if (owners.length) {
    console.log(`\n⚠ Bạn là trưởng nhóm của ${owners.length} nhóm — Zalo có thể yêu cầu chuyển quyền trưởng nhóm trước khi rời; các nhóm đó có thể báo lỗi.`);
  }

  const confirm = await input({ message: `\nGõ chính xác số ${selected.length} để xác nhận rời${DRY_RUN ? " (CHẠY THỬ)" : ""}:` });
  if (confirm.trim() !== String(selected.length)) {
    console.log("Không khớp — đã hủy, không rời nhóm nào.");
    process.exit(0);
  }

  let ok = 0;
  let consecutiveErrors = 0;
  for (const [i, g] of selected.entries()) {
    const prefix = `[${i + 1}/${selected.length}] ${g.name}`;
    try {
      if (!DRY_RUN) await api.leaveGroup(g.groupId, SILENT);
      log(`${prefix}: ${DRY_RUN ? "(chạy thử) bỏ qua" : "đã rời"}`);
      ok++;
      consecutiveErrors = 0;
    } catch (err) {
      log(`${prefix}: LỖI — ${err?.message ?? err}`);
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log(`Lỗi ${MAX_CONSECUTIVE_ERRORS} lần liên tiếp — có thể đang bị giới hạn. Dừng lại, hãy thử lại sau vài giờ.`);
        break;
      }
    }
    if (i < selected.length - 1) {
      const delay = randomDelay();
      console.log(`   chờ ${(delay / 1000).toFixed(1)}s...`);
      await sleep(delay);
    }
  }

  log(`Xong: ${ok}/${selected.length} nhóm. Chi tiết trong ${LOG_PATH}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi:", err?.message ?? err);
  process.exit(1);
});
