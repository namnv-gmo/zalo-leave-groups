// Bookmarklet: rời nhiều nhóm Zalo cùng lúc, chạy trong tab chat.zalo.me đã đăng nhập.
// Gọi thẳng API của Zalo Web (cùng cách thư viện zca-js làm) bằng phiên đăng nhập sẵn có của trình duyệt.
// Build thành bookmarklet bằng: node build.js

const API_TYPE = 30;
const API_VERSION = 685;
const LANGUAGE = "vi";
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 7000;
const MAX_CONSECUTIVE_ERRORS = 2;

// ---------- crypto helpers ----------

const utf8 = (s) => new TextEncoder().encode(s);
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function md5(str) {
  const msg = utf8(str);
  const len = msg.length;
  const words = new Uint32Array((((len + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= msg[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[words.length - 2] = len * 8;

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < words.length; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + words[off + g]) >>> 0;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((v) => toHex([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24]))
    .join("");
}

// AES-CBC, IV toàn 0, PKCS7 — giống crypto-js trong zca-js
async function aesKey(keyBytes) {
  return crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt", "decrypt"]);
}
const ZERO_IV = new Uint8Array(16);

export async function aesEncrypt(keyBytes, text) {
  const buf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: ZERO_IV }, await aesKey(keyBytes), utf8(text));
  return new Uint8Array(buf);
}

export async function aesDecrypt(keyBytes, base64) {
  const buf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ZERO_IV }, await aesKey(keyBytes), fromBase64(decodeURIComponent(base64)));
  return new TextDecoder().decode(buf);
}

export function signKey(type, params) {
  return md5("zsecure" + type + Object.keys(params).sort().map((k) => params[k]).join(""));
}

const randomHex = () => Math.random().toString(16).substr(2, 6 + Math.floor(Math.random() * 7));

// Tương đương ParamsEncryptor của zca-js
export async function makeParamsEncryptor(imei, zcidExt = randomHex()) {
  const zcid = toHex(await aesEncrypt(utf8("3FC4F0D2AB50057BCE0D90D9187A22B1"), `${API_TYPE},${imei},${Date.now()}`)).toUpperCase();
  const even = (s) => [...s].filter((_, i) => i % 2 === 0);
  const odd = (s) => [...s].filter((_, i) => i % 2 === 1);
  const encryptKey = even(md5(zcidExt).toUpperCase()).slice(0, 8).join("") + even(zcid).slice(0, 12).join("") + odd(zcid).reverse().slice(0, 12).join("");
  return { zcid, zcidExt, encryptKey };
}

// ---------- Zalo API ----------

function makeURL(base, params = {}) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  url.searchParams.set("zpw_ver", API_VERSION);
  url.searchParams.set("zpw_type", API_TYPE);
  return url.toString();
}

function getImei() {
  // cùng thứ tự Zalo Web đọc
  for (const key of ["sh_z_uuid", "z_uuid"]) {
    const v = localStorage.getItem(key);
    if (v) return v.replace(/^"|"$/g, "");
  }
  throw new Error("Không tìm thấy phiên đăng nhập. Hãy mở chat.zalo.me và đăng nhập trước.");
}

async function getLoginInfo(imei) {
  const { zcid, zcidExt, encryptKey } = await makeParamsEncryptor(imei);
  const data = { computer_name: "Web", imei, language: LANGUAGE, ts: Date.now() };
  const params = {
    zcid,
    zcid_ext: zcidExt,
    enc_ver: "v2",
    params: toBase64(await aesEncrypt(utf8(encryptKey), JSON.stringify(data))),
    type: API_TYPE,
    client_version: API_VERSION,
  };
  params.signkey = signKey("getlogininfo", params);

  const res = await fetch(makeURL("https://wpa.chat.zalo.me/api/login/getLoginInfo", { ...params, nretry: 0 }), { credentials: "include" });
  const json = await res.json();
  const decoded = JSON.parse(await aesDecrypt(utf8(encryptKey), json.data));
  if (!decoded?.data?.zpw_enk) throw new Error("Không lấy được thông tin đăng nhập: " + (decoded?.error_message || json.error_message || "không rõ"));
  return decoded.data;
}

export async function createClient() {
  const imei = getImei();
  const info = await getLoginInfo(imei);
  const secretKey = fromBase64(info.zpw_enk);
  const services = info.zpw_service_map_v3;

  async function call(url, { method = "GET", params } = {}) {
    const init = { method, credentials: "include" };
    if (params) init.body = new URLSearchParams({ params: toBase64(await aesEncrypt(secretKey, JSON.stringify(params))) });
    const json = await (await fetch(makeURL(url), init)).json();
    if (json.error_code != 0) throw new Error(`${json.error_message} (mã ${json.error_code})`);
    const decoded = JSON.parse(await aesDecrypt(secretKey, json.data));
    if (decoded.error_code != 0) throw new Error(`${decoded.error_message} (mã ${decoded.error_code})`);
    return decoded.data;
  }

  return {
    uid: info.uid,
    getAllGroupIds: async () => Object.keys((await call(`${services.group_poll[0]}/api/group/getlg/v4`)).gridVerMap),
    getGroupInfo: async (ids) =>
      Object.values(
        (await call(`${services.group[0]}/api/group/getmg-v2`, {
          method: "POST",
          params: { gridVerMap: JSON.stringify(Object.fromEntries(ids.map((id) => [id, 0]))) },
        })).gridInfoMap,
      ),
    leaveGroup: (groupId, silent) =>
      call(`${services.group[0]}/api/group/leave`, {
        method: "POST",
        params: { grids: [groupId], imei, silent: silent ? 1 : 0, language: LANGUAGE },
      }),
  };
}

// ---------- UI ----------

// getmg-v2 thường trả danh sách thành viên trong memVerList dạng "uid_version"
const memberIds = (g, ownId) =>
  new Set([...(g.memberIds ?? []), ...(g.memVerList ?? []).map((m) => String(m).split("_")[0]), ...(g.currentMems ?? []).map((m) => m.id)].filter((id) => id && id !== ownId));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

const CSS = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
.panel { background: #fff; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
header { padding: 16px 20px 8px; display: flex; justify-content: space-between; align-items: center; }
h2 { margin: 0; font-size: 18px; }
.x { border: 0; background: none; font-size: 22px; cursor: pointer; color: #666; }
.tools { padding: 0 20px 8px; display: flex; gap: 8px; flex-wrap: wrap; }
input[type=search] { flex: 1 1 200px; padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px; font: inherit; }
button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; }
button.primary { background: #d93025; border-color: #d93025; color: #fff; font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
.list { overflow: auto; flex: 1; border-top: 1px solid #eee; border-bottom: 1px solid #eee; min-height: 120px; }
label.row { display: flex; gap: 10px; align-items: center; padding: 8px 20px; cursor: pointer; }
label.row:hover { background: #f7f7f7; }
.meta { color: #777; font-size: 12px; }
.tag { color: #b06000; font-size: 12px; font-weight: 600; }
.shared { color: #0068ff; font-size: 12px; font-weight: 600; margin-left: 6px; }
.hint { padding: 0 20px 8px; color: #555; font-size: 13px; display: none; }
footer { padding: 12px 20px 16px; display: flex; flex-direction: column; gap: 8px; }
.opts { display: flex; gap: 16px; flex-wrap: wrap; color: #444; }
.actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.log { max-height: 160px; overflow: auto; font-size: 12px; line-height: 1.5; background: #f7f7f7; border-radius: 8px; padding: 8px; white-space: pre-wrap; display: none; }
.msg { padding: 24px 20px; }
`;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

export async function run() {
  if (!location.hostname.endsWith("chat.zalo.me")) {
    alert("Hãy mở https://chat.zalo.me, đăng nhập, rồi bấm lại bookmark này.");
    return;
  }
  document.getElementById("zalo-leave-root")?.remove();
  const host = h("div", { id: "zalo-leave-root" });
  const root = host.attachShadow({ mode: "open" });
  root.append(h("style", { textContent: CSS }));
  const panel = h("div", { className: "panel" });
  const close = h("button", { className: "x", textContent: "×", title: "Đóng" });
  panel.append(h("header", {}, h("h2", { textContent: "Rời nhóm Zalo hàng loạt" }), close));
  const body = h("div", { className: "msg", textContent: "Đang tải danh sách nhóm..." });
  panel.append(body);
  root.append(h("div", { className: "wrap" }, panel));
  document.body.append(host);

  let running = false;
  let stopRequested = false;
  close.onclick = () => {
    if (running && !confirm("Đang rời nhóm. Dừng lại và đóng?")) return;
    stopRequested = true;
    host.remove();
  };

  let client, groups;
  try {
    client = await createClient();
    const ids = await client.getAllGroupIds();
    groups = [];
    for (let i = 0; i < ids.length; i += 50) {
      body.textContent = `Đang tải danh sách nhóm... (${Math.min(i + 50, ids.length)}/${ids.length})`;
      groups.push(...(await client.getGroupInfo(ids.slice(i, i + 50))));
      await sleep(800);
    }
    groups.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  } catch (err) {
    body.textContent = "Lỗi: " + err.message;
    return;
  }

  const checked = new Set();
  const search = h("input", { type: "search", placeholder: "Gõ tên nhóm để lọc..." });
  const selectShown = h("button", { textContent: "Chọn hết đang hiện" });
  const clearAll = h("button", { textContent: "Bỏ chọn hết" });
  const suggest = h("button", { textContent: "Tìm nhóm có người chung", title: "Xếp các nhóm có nhiều thành viên chung với những nhóm đã tick lên đầu" });
  const hint = h("div", { className: "hint" });
  const list = h("div", { className: "list" });
  const silent = h("input", { type: "checkbox" });
  const dryRun = h("input", { type: "checkbox" });
  const count = h("span");
  const go = h("button", { className: "primary" });
  const log = h("div", { className: "log" });

  const rows = groups.map((g) => {
    const box = h("input", { type: "checkbox" });
    box.onchange = () => { box.checked ? checked.add(g) : checked.delete(g); refresh(); };
    const isOwner = g.creatorId === client.uid;
    const isAdmin = g.adminIds?.includes(client.uid);
    const shared = h("span", { className: "shared" });
    const row = h(
      "label",
      { className: "row" },
      box,
      h("div", {}, h("div", { textContent: g.name }), h("span", { className: "meta", textContent: `${g.totalMember} thành viên ` }), h("span", { className: "tag", textContent: isOwner ? "TRƯỞNG NHÓM" : isAdmin ? "phó nhóm" : "" }), shared),
    );
    list.append(row);
    return { g, row, box, shared, key: normalize(g.name), members: memberIds(g, client.uid) };
  });

  function refresh() {
    count.textContent = `Đã chọn ${checked.size}/${groups.length} nhóm`;
    go.textContent = dryRun.checked ? `Chạy thử ${checked.size} nhóm` : `Rời ${checked.size} nhóm`;
    go.disabled = running || checked.size === 0;
  }
  search.oninput = () => {
    const q = normalize(search.value.trim());
    for (const r of rows) r.row.style.display = !q || r.key.includes(q) ? "" : "none";
  };
  selectShown.onclick = () => {
    for (const r of rows) if (r.row.style.display !== "none") { r.box.checked = true; checked.add(r.g); }
    refresh();
  };
  clearAll.onclick = () => {
    for (const r of rows) r.box.checked = false;
    checked.clear();
    refresh();
  };
  dryRun.onchange = refresh;

  // Nhóm không đặt theo tên công ty: dựa vào số đồng nghiệp cũ có mặt trong nhóm
  suggest.onclick = () => {
    const ref = new Set();
    for (const r of rows) if (r.box.checked) r.members.forEach((id) => ref.add(id));
    if (checked.size === 0) return alert("Hãy tick trước 1–2 nhóm chắc chắn là của công ty cũ (ví dụ nhóm toàn công ty), rồi bấm lại nút này.");
    if (ref.size === 0) return alert("Zalo không trả về danh sách thành viên của các nhóm đã chọn, nên không so sánh được.");
    for (const r of rows) {
      r.common = r.box.checked ? Infinity : [...r.members].filter((id) => ref.has(id)).length;
      r.shared.textContent = r.box.checked ? "" : r.common ? `· ${r.common} người chung` : "";
    }
    search.value = "";
    search.oninput();
    for (const r of [...rows].sort((a, b) => b.common - a.common)) list.append(r.row);
    list.scrollTop = 0;
    hint.style.display = "block";
    hint.textContent = `So với ${ref.size} người trong ${checked.size} nhóm đã tick. Nhóm càng nhiều người chung càng có khả năng là nhóm công ty — hãy xem và tự tick thêm.`;
  };

  const write = (line) => { log.style.display = "block"; log.textContent += line + "\n"; log.scrollTop = log.scrollHeight; };

  go.onclick = async () => {
    const targets = rows.filter((r) => checked.has(r.g)).map((r) => r.g);
    const names = targets.map((g, i) => `${i + 1}. ${g.name}`).join("\n");
    if (!confirm(`${dryRun.checked ? "[CHẠY THỬ] " : ""}Rời ${targets.length} nhóm sau?\n\n${names}`)) return;

    running = true;
    stopRequested = false;
    for (const el of [search, selectShown, clearAll, suggest, silent, dryRun, ...rows.map((r) => r.box)]) el.disabled = true;
    refresh();

    let ok = 0;
    let errors = 0;
    for (const [i, g] of targets.entries()) {
      if (stopRequested) break;
      const prefix = `[${i + 1}/${targets.length}] ${g.name}`;
      try {
        if (!dryRun.checked) await client.leaveGroup(g.groupId, silent.checked);
        write(`✓ ${prefix}${dryRun.checked ? " (chạy thử)" : ""}`);
        ok++;
        errors = 0;
        const r = rows.find((r) => r.g === g);
        if (!dryRun.checked) r.row.style.textDecoration = "line-through";
      } catch (err) {
        write(`✗ ${prefix}: ${err.message}`);
        if (++errors >= MAX_CONSECUTIVE_ERRORS) {
          write(`Lỗi ${MAX_CONSECUTIVE_ERRORS} lần liên tiếp, có thể Zalo đang giới hạn. Đã dừng, hãy thử lại sau vài giờ.`);
          break;
        }
      }
      if (i < targets.length - 1) {
        const delay = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
        write(`   chờ ${(delay / 1000).toFixed(1)} giây...`);
        await sleep(delay);
      }
    }
    write(`Xong: ${ok}/${targets.length} nhóm.${dryRun.checked ? "" : " Tải lại trang (F5) để cập nhật danh sách."}`);
    running = false;
    go.disabled = true;
  };

  body.replaceWith(
    h("div", { className: "tools" }, search, selectShown, clearAll, suggest),
    hint,
    list,
    h(
      "footer",
      {},
      h("div", { className: "opts" }, h("label", {}, silent, " Rời im lặng (không báo cho nhóm)"), h("label", {}, dryRun, " Chạy thử (không rời thật)")),
      h("div", { className: "actions" }, count, go),
      log,
    ),
  );
  refresh();
  search.focus();
}
