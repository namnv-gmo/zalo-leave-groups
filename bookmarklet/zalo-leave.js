// Bookmarklet dọn dẹp Zalo khi nghỉ việc: rời / tắt thông báo / lưu trữ hàng loạt nhóm và trò chuyện với đồng nghiệp cũ.
// Chạy trong tab chat.zalo.me đã đăng nhập.
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
  const encrypt = async (obj) => toBase64(await aesEncrypt(secretKey, JSON.stringify(obj)));

  // params: gửi trong body (POST); query: gửi mã hóa trên URL (GET)
  async function call(url, { method = "GET", params, query } = {}) {
    const init = { method, credentials: "include" };
    if (params) init.body = new URLSearchParams({ params: await encrypt(params) });
    const json = await (await fetch(makeURL(url, query ? { params: await encrypt(query) } : {}), init)).json();
    if (json.error_code != 0) throw new Error(`${json.error_message} (mã ${json.error_code})`);
    const decoded = JSON.parse(await aesDecrypt(secretKey, json.data));
    if (decoded.error_code != 0) throw new Error(`${decoded.error_message} (mã ${decoded.error_code})`);
    return typeof decoded.data === "string" && /^[[{]/.test(decoded.data) ? JSON.parse(decoded.data) : decoded.data;
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
    changeGroupOwner: (groupId, newOwnerId) =>
      call(`${services.group[0]}/api/group/change-owner`, { query: { grid: groupId, newAdminId: newOwnerId, imei, language: LANGUAGE } }),
    // Thời điểm tin nhắn mới nhất của nhóm (ms), null nếu không có
    getLastMessageTime: async (groupId) => {
      const data = await call(`${services.group[0]}/api/group/history`, { query: { grid: groupId, count: 1 } });
      const times = (data?.groupMsgs ?? []).map((m) => Number(m.ts ?? m.data?.ts)).filter(Boolean);
      return times.length ? Math.max(...times) : null;
    },
    getProfiles: async (uids) => (await call(`${services.profile[0]}/api/social/group/members`, { query: { friend_pversion_map: uids.map((id) => `${id}_0`) } })).profiles ?? {},
    getAllFriends: () =>
      call(`${services.profile[0]}/api/social/friend/getfriends`, { query: { incInvalid: 1, page: 1, count: 20000, avatar_size: 120, actiontime: 0, imei } }),
    // isGroup: tắt thông báo nhóm hay trò chuyện cá nhân
    mute: (threadId, isGroup) =>
      call(`${services.profile[0]}/api/social/profile/setmute`, {
        method: "POST",
        params: { toid: threadId, duration: -1, action: 1, startTime: Math.floor(Date.now() / 1000), muteType: isGroup ? 2 : 1, imei },
      }),
    archive: (threadId, isGroup) =>
      call(`${services.label[0]}/api/archivedchat/update`, {
        method: "POST",
        params: { actionType: 0, ids: [{ id: threadId, type: isGroup ? 1 : 0 }], imei, version: Date.now() },
      }),
  };
}

// ---------- tiện ích ----------

// getmg-v2 thường trả danh sách thành viên trong memVerList dạng "uid_version"
const memberIds = (g, ownId) =>
  new Set([...(g.memberIds ?? []), ...(g.memVerList ?? []).map((m) => String(m).split("_")[0]), ...(g.currentMems ?? []).map((m) => m.id)].filter((id) => id && id !== ownId));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return "chưa có tin nhắn";
  const days = Math.floor((now - ts) / 86400000);
  if (days < 1) return "hôm nay";
  if (days < 30) return `${days} ngày trước`;
  if (days < 365) return `${Math.floor(days / 30)} tháng trước`;
  return `${Math.floor(days / 365)} năm trước`;
}

// localStorage có thể bị chặn — mọi lỗi đều bỏ qua
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};
const PROGRESS_KEY = "zalo-leave:progress";
const HISTORY_KEY = "zalo-leave:history";
const COLLEAGUES_KEY = "zalo-leave:colleagues";
const MAX_HISTORY = 1000;

export function toCSV(rows) {
  const cols = ["Thời gian", "Loại", "Tên", "ID", "Số thành viên", "Trưởng nhóm", "Hành động", "Kết quả"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "\uFEFF" + [cols, ...rows.map((r) => [r.time, r.kind, r.name, r.id, r.members, r.owner, r.action, r.result])].map((r) => r.map(esc).join(",")).join("\r\n");
}

function downloadCSV(rows, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const ACTIONS = {
  leave: { label: "Rời nhóm", groupOnly: true },
  mute: { label: "Tắt thông báo (vẫn ở lại)" },
  archive: { label: "Lưu trữ (ẩn khỏi danh sách chính)" },
  muteArchive: { label: "Tắt thông báo + Lưu trữ" },
};

class SkipError extends Error {}

// ---------- UI ----------

const CSS = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
.panel { background: #fff; width: min(600px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
header { padding: 16px 20px 8px; display: flex; justify-content: space-between; align-items: center; }
h2 { margin: 0; font-size: 18px; }
.x { border: 0; background: none; font-size: 22px; cursor: pointer; color: #666; padding: 0 4px; }
.tabs { display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid #eee; }
.tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 8px 10px; color: #555; }
.tab.on { border-bottom-color: #0068ff; color: #0068ff; font-weight: 600; }
.banner { margin: 10px 20px 0; padding: 10px 12px; border-radius: 8px; background: #fff4e5; color: #6b3d00; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.banner span { flex: 1 1 200px; }
.tools { padding: 10px 20px 8px; display: flex; gap: 8px; flex-wrap: wrap; }
input[type=search] { flex: 1 1 200px; padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px; font: inherit; }
button, select { font: inherit; padding: 7px 12px; border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; color: inherit; }
button.primary { background: #d93025; border-color: #d93025; color: #fff; font-weight: 600; }
button.link { border: 0; background: none; color: #0068ff; padding: 4px 0; }
button:disabled, select:disabled { opacity: .5; cursor: default; }
.list { overflow: auto; flex: 1; border-top: 1px solid #eee; border-bottom: 1px solid #eee; min-height: 120px; }
.item { padding: 2px 0; }
label.row { display: flex; gap: 10px; align-items: center; padding: 6px 20px; cursor: pointer; }
label.row:hover { background: #f7f7f7; }
.meta { color: #777; font-size: 12px; }
.tag { color: #b06000; font-size: 12px; font-weight: 600; margin-left: 6px; }
.shared { color: #0068ff; font-size: 12px; font-weight: 600; margin-left: 6px; }
.activity { color: #6a1b9a; font-size: 12px; margin-left: 6px; }
.slot { padding: 0 20px 6px 46px; }
.slot select { width: 100%; font-size: 13px; padding: 5px 8px; }
.slot .warn { color: #b06000; font-size: 12px; }
.hint { padding: 0 20px 8px; color: #555; font-size: 13px; }
.empty { padding: 24px 20px; color: #555; }
footer { padding: 12px 20px 16px; display: flex; flex-direction: column; gap: 8px; }
.opts { display: flex; gap: 8px 16px; flex-wrap: wrap; align-items: center; color: #444; }
.actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.log { max-height: 160px; overflow: auto; font-size: 12px; line-height: 1.5; background: #f7f7f7; border-radius: 8px; padding: 8px; white-space: pre-wrap; }
.msg { padding: 24px 20px; }
[hidden] { display: none !important; }
`;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children.filter((c) => c != null));
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
  panel.append(h("header", {}, h("h2", { textContent: "Dọn dẹp Zalo công ty cũ" }), close));
  const body = h("div", { className: "msg", textContent: "Đang tải danh sách nhóm..." });
  panel.append(body);
  root.append(h("div", { className: "wrap" }, panel));
  document.body.append(host);

  let running = false;
  let stopRequested = false;
  close.onclick = () => {
    if (running && !confirm("Đang chạy. Dừng lại và đóng?")) return;
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

  // ----- danh sách (dùng chung cho tab Nhóm và tab Đồng nghiệp cũ) -----

  function makeTab(kind) {
    return { kind, items: [], checked: new Set(), list: h("div", { className: "list" }), hint: h("div", { className: "hint", hidden: true }) };
  }
  const tabs = { groups: makeTab("groups"), users: makeTab("users") };
  let current = tabs.groups;

  function addItem(tab, item) {
    item.box = h("input", { type: "checkbox" });
    item.shared = h("span", { className: "shared" });
    item.activity = h("span", { className: "activity" });
    item.slot = h("div", { className: "slot", hidden: true });
    item.box.onchange = () => {
      item.box.checked ? tab.checked.add(item) : tab.checked.delete(item);
      updateOwnerSlot(item);
      refresh();
    };
    item.el = h(
      "div",
      { className: "item" },
      h(
        "label",
        { className: "row" },
        item.box,
        h("div", {}, h("div", { textContent: item.name }), h("span", { className: "meta", textContent: item.meta }), item.tag ? h("span", { className: "tag", textContent: item.tag }) : null, item.shared, item.activity),
      ),
      item.slot,
    );
    item.key = normalize(item.name);
    tab.items.push(item);
    tab.list.append(item.el);
  }

  function setChecked(tab, item, on) {
    item.box.checked = on;
    on ? tab.checked.add(item) : tab.checked.delete(item);
    updateOwnerSlot(item);
  }

  for (const g of groups) {
    const isOwner = g.creatorId === client.uid;
    addItem(tabs.groups, {
      id: g.groupId,
      isGroup: true,
      group: g,
      name: g.name,
      meta: `${g.totalMember} thành viên`,
      tag: isOwner ? "TRƯỞNG NHÓM" : g.adminIds?.includes(client.uid) ? "phó nhóm" : "",
      isOwner,
      members: memberIds(g, client.uid),
    });
  }

  // ----- mục 4: chọn người nhận quyền trưởng nhóm -----

  async function updateOwnerSlot(item) {
    const show = item.isOwner && item.box.checked && actionSel.value === "leave";
    item.slot.hidden = !show;
    if (!show || item.ownerSelect) return;
    const select = h("select", {}, h("option", { value: "", textContent: "Đang tải thành viên..." }));
    item.ownerSelect = select;
    item.slot.append(select);
    select.onchange = refresh;
    try {
      const uids = [...item.members];
      const profiles = {};
      for (let i = 0; i < uids.length; i += 50) Object.assign(profiles, await client.getProfiles(uids.slice(i, i + 50)));
      const admins = new Set(item.group.adminIds ?? []);
      const opts = uids
        .map((id) => ({ id, name: profiles[id]?.displayName || profiles[id]?.zaloName || id, admin: admins.has(id) }))
        .sort((a, b) => b.admin - a.admin || a.name.localeCompare(b.name, "vi"));
      select.replaceChildren(
        h("option", { value: "", textContent: "— Chọn người nhận quyền trưởng nhóm trước khi rời —" }),
        ...opts.map((o) => h("option", { value: o.id, textContent: o.admin ? `${o.name} (phó nhóm)` : o.name })),
      );
      item.ownerNames = Object.fromEntries(opts.map((o) => [o.id, o.name]));
    } catch (err) {
      select.replaceChildren(h("option", { value: "", textContent: "Không tải được thành viên: " + err.message }));
    }
    refresh();
  }

  // ----- thanh công cụ -----

  const search = h("input", { type: "search", placeholder: "Gõ tên để lọc..." });
  const selectShown = h("button", { textContent: "Chọn hết đang hiện" });
  const clearAll = h("button", { textContent: "Bỏ chọn hết" });
  const suggest = h("button", { textContent: "Tìm nhóm có người chung", title: "Xếp các nhóm có nhiều thành viên chung với những nhóm đã tick lên đầu" });
  const activityBtn = h("button", { textContent: "Kiểm tra lâu không hoạt động", title: "Xem tin nhắn cuối của các nhóm đang hiện và xếp nhóm im lâu nhất lên đầu" });
  const visible = (tab) => tab.items.filter((it) => !it.el.hidden);

  function reorder(tab, score) {
    for (const it of [...tab.items].sort((a, b) => score(b) - score(a))) tab.list.append(it.el);
    tab.list.scrollTop = 0;
  }
  function showHint(tab, text) {
    tab.hint.hidden = false;
    tab.hint.textContent = text;
  }

  search.oninput = () => {
    const q = normalize(search.value.trim());
    for (const it of current.items) it.el.hidden = !!q && !it.key.includes(q);
  };
  selectShown.onclick = () => {
    for (const it of visible(current)) setChecked(current, it, true);
    refresh();
  };
  clearAll.onclick = () => {
    for (const it of current.items) setChecked(current, it, false);
    refresh();
  };

  suggest.onclick = () => {
    const tab = tabs.groups;
    const ref = new Set();
    for (const it of tab.checked) it.members.forEach((id) => ref.add(id));
    if (tab.checked.size === 0) return alert("Hãy tick trước 1–2 nhóm chắc chắn là của công ty cũ (ví dụ nhóm toàn công ty), rồi bấm lại nút này.");
    if (ref.size === 0) return alert("Zalo không trả về danh sách thành viên của các nhóm đã chọn, nên không so sánh được.");
    for (const it of tab.items) {
      it.common = it.box.checked ? Infinity : [...it.members].filter((id) => ref.has(id)).length;
      it.shared.textContent = it.box.checked ? "" : it.common ? `· ${it.common} người chung` : "";
    }
    search.value = "";
    search.oninput();
    reorder(tab, (it) => it.common);
    showHint(tab, `So với ${ref.size} người trong ${tab.checked.size} nhóm đã tick. Nhóm càng nhiều người chung càng có khả năng là nhóm công ty — hãy xem và tự tick thêm.`);
  };

  // mục 5: nhóm lâu không hoạt động
  activityBtn.onclick = async () => {
    const tab = tabs.groups;
    const targets = visible(tab);
    activityBtn.disabled = true;
    const now = Date.now();
    for (const [i, it] of targets.entries()) {
      if (stopRequested) return;
      showHint(tab, `Đang kiểm tra tin nhắn cuối... ${i + 1}/${targets.length}`);
      try {
        it.lastTs = await client.getLastMessageTime(it.id);
        it.activity.textContent = `· tin cuối: ${timeAgo(it.lastTs, now)}`;
      } catch {
        it.activity.textContent = "· không xem được";
      }
      await sleep(400);
    }
    // nhóm im lâu nhất lên đầu; nhóm chưa kiểm tra xuống cuối
    reorder(tab, (it) => (it.lastTs === undefined ? -Infinity : now - (it.lastTs ?? 0)));
    showHint(tab, `Đã xếp ${targets.length} nhóm theo thời gian im lặng, nhóm lâu không có tin nhắn nhất ở trên cùng.`);
    activityBtn.disabled = false;
  };

  // ----- mục 6: tab Đồng nghiệp cũ (trò chuyện cá nhân) -----

  let colleaguesFor = null; // các nhóm đã tick lúc tải danh sách đồng nghiệp
  const checkedGroupsKey = () => [...tabs.groups.checked].map((it) => it.id).sort().join(",");
  async function loadColleagues() {
    colleaguesFor = checkedGroupsKey();
    const tab = tabs.users;
    const ref = new Map(); // uid -> số nhóm công ty có người đó
    for (const it of tabs.groups.checked) for (const id of it.members) ref.set(id, (ref.get(id) ?? 0) + 1);
    for (const id of store.get(COLLEAGUES_KEY, [])) if (!ref.has(id)) ref.set(id, 0);
    if (ref.size === 0) {
      tab.list.replaceChildren(h("div", { className: "empty", textContent: "Chưa biết ai là đồng nghiệp cũ. Hãy quay lại tab Nhóm, tick các nhóm của công ty cũ, rồi mở lại tab này." }));
      return;
    }
    tab.list.replaceChildren(h("div", { className: "empty", textContent: "Đang tải danh sách bạn bè..." }));
    try {
      const friends = (await client.getAllFriends()) ?? [];
      tab.items = [];
      tab.checked.clear();
      tab.list.replaceChildren();
      const colleagues = friends.filter((f) => ref.has(f.userId)).sort((a, b) => ref.get(b.userId) - ref.get(a.userId));
      for (const f of colleagues) {
        const n = ref.get(f.userId);
        addItem(tab, { id: f.userId, isGroup: false, name: f.displayName || f.zaloName || f.userId, meta: n ? `có trong ${n} nhóm công ty đã chọn` : "đồng nghiệp từ lần dọn trước" });
      }
      if (!colleagues.length) tab.list.append(h("div", { className: "empty", textContent: "Không có ai trong danh sách bạn bè là thành viên của các nhóm đã chọn." }));
      showHint(tab, `${colleagues.length} người bạn có mặt trong các nhóm công ty đã tick. Chọn những cuộc trò chuyện muốn tắt thông báo hoặc lưu trữ (không xóa tin nhắn, không hủy kết bạn).`);
    } catch (err) {
      tab.list.replaceChildren(h("div", { className: "empty", textContent: "Không tải được danh sách bạn bè: " + err.message }));
    }
  }

  // ----- chân trang: hành động + chạy -----

  const actionSel = h("select");
  const silent = h("input", { type: "checkbox" });
  const silentLabel = h("label", {}, silent, " Rời im lặng");
  const dryRun = h("input", { type: "checkbox" });
  const count = h("span");
  const go = h("button", { className: "primary" });
  const log = h("div", { className: "log", hidden: true });
  const historyBtn = h("button", { className: "link", textContent: "Tải lịch sử đã làm (CSV)" });
  historyBtn.onclick = () => downloadCSV(store.get(HISTORY_KEY, []), "zalo-lich-su-don-dep.csv");

  function fillActions() {
    const prev = actionSel.value;
    actionSel.replaceChildren(
      ...Object.entries(ACTIONS)
        .filter(([, a]) => current.kind === "groups" || !a.groupOnly)
        .map(([key, a]) => h("option", { value: key, textContent: a.label })),
    );
    if ([...actionSel.options].some((o) => o.value === prev)) actionSel.value = prev;
  }
  actionSel.onchange = () => {
    for (const it of tabs.groups.items) updateOwnerSlot(it);
    refresh();
  };

  function refresh() {
    const n = current.checked.size;
    const total = current.items.length;
    count.textContent = `Đã chọn ${n}/${total}`;
    const label = ACTIONS[actionSel.value]?.label.split(" (")[0] ?? "";
    go.textContent = `${dryRun.checked ? "Chạy thử: " : ""}${label} ${n} mục`;
    go.disabled = running || n === 0;
    silentLabel.hidden = actionSel.value !== "leave";
    historyBtn.hidden = store.get(HISTORY_KEY, []).length === 0;
  }
  dryRun.onchange = refresh;

  const write = (line) => { log.hidden = false; log.textContent += line + "\n"; log.scrollTop = log.scrollHeight; };

  async function perform(item, action) {
    if (action === "leave") {
      if (item.isOwner) {
        const newOwner = item.ownerSelect?.value;
        if (!newOwner) throw new SkipError("bạn là trưởng nhóm nhưng chưa chọn người nhận quyền — bỏ qua");
        if (!dryRun.checked) {
          await client.changeGroupOwner(item.id, newOwner);
          await sleep(1500);
        }
        write(`   đã chuyển quyền trưởng nhóm cho ${item.ownerNames?.[newOwner] ?? newOwner}`);
      }
      if (!dryRun.checked) await client.leaveGroup(item.id, silent.checked);
      return;
    }
    if (dryRun.checked) return;
    if (action === "mute" || action === "muteArchive") await client.mute(item.id, item.isGroup);
    if (action === "muteArchive") await sleep(800);
    if (action === "archive" || action === "muteArchive") await client.archive(item.id, item.isGroup);
  }

  // Tên trưởng nhóm để biết cần nhờ ai thêm lại (mục 1)
  async function resolveOwnerNames(targets) {
    const uids = [...new Set(targets.filter((it) => it.isGroup && !it.isOwner && it.group.creatorId).map((it) => it.group.creatorId))];
    const names = {};
    try {
      for (let i = 0; i < uids.length; i += 50) {
        const profiles = await client.getProfiles(uids.slice(i, i + 50));
        for (const [id, p] of Object.entries(profiles)) names[id] = p.displayName || p.zaloName;
      }
    } catch {}
    for (const it of targets) if (it.isGroup) it.ownerName = it.isOwner ? "Bạn" : names[it.group.creatorId] || it.group.creatorId;
  }

  go.onclick = async () => {
    const tab = current;
    const action = actionSel.value;
    const actionLabel = ACTIONS[action].label;
    const targets = tab.items.filter((it) => tab.checked.has(it));
    const shown = targets.slice(0, 40).map((it, i) => `${i + 1}. ${it.name}`).join("\n") + (targets.length > 40 ? `\n... và ${targets.length - 40} mục nữa` : "");
    if (!confirm(`${dryRun.checked ? "[CHẠY THỬ] " : ""}${actionLabel} — ${targets.length} mục:\n\n${shown}`)) return;

    running = true;
    stopRequested = false;
    const controls = [search, selectShown, clearAll, suggest, activityBtn, actionSel, silent, dryRun, ...tabButtons, ...tab.items.flatMap((it) => [it.box, it.ownerSelect].filter(Boolean))];
    for (const el of controls) el.disabled = true;
    refresh();

    await resolveOwnerNames(targets);
    // Ghi nhớ đồng nghiệp cũ cho tab trò chuyện cá nhân ở lần sau, vì sau khi rời nhóm sẽ không còn thấy thành viên
    if (tab.kind === "groups" && action === "leave" && !dryRun.checked) {
      const known = new Set(store.get(COLLEAGUES_KEY, []));
      for (const it of targets) it.members.forEach((id) => known.add(id));
      store.set(COLLEAGUES_KEY, [...known]);
    }

    const pending = new Map(targets.map((it) => [it.id, { id: it.id, name: it.name }]));
    const saveProgress = () => store.set(PROGRESS_KEY, dryRun.checked || pending.size === 0 ? null : { uid: client.uid, tab: tab.kind, action, items: [...pending.values()], savedAt: Date.now() });
    saveProgress();

    const results = [];
    let ok = 0;
    let errors = 0;
    for (const [i, it] of targets.entries()) {
      if (stopRequested) break;
      const prefix = `[${i + 1}/${targets.length}] ${it.name}`;
      let result;
      let tooManyErrors = false;
      try {
        await perform(it, action);
        result = dryRun.checked ? "chạy thử" : "thành công";
        write(`✓ ${prefix}${dryRun.checked ? " (chạy thử)" : ""}`);
        ok++;
        errors = 0;
        pending.delete(it.id);
        if (!dryRun.checked) it.el.style.textDecoration = "line-through";
      } catch (err) {
        result = "lỗi: " + err.message;
        write(`✗ ${prefix}: ${err.message}`);
        tooManyErrors = !(err instanceof SkipError) && ++errors >= MAX_CONSECUTIVE_ERRORS;
      } finally {
        saveProgress();
      }
      results.push({
        time: new Date().toLocaleString("vi-VN"),
        kind: it.isGroup ? "Nhóm" : "Cá nhân",
        name: it.name,
        id: it.id,
        members: it.group?.totalMember ?? "",
        owner: it.ownerName ?? "",
        action: actionLabel + (dryRun.checked ? " (chạy thử)" : ""),
        result,
      });
      if (tooManyErrors) {
        write(`Lỗi ${MAX_CONSECUTIVE_ERRORS} lần liên tiếp, có thể Zalo đang giới hạn. Đã dừng — lần sau mở lại công cụ sẽ có nút làm tiếp.`);
        break;
      }
      if (i < targets.length - 1 && !stopRequested) {
        const delay = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
        write(`   chờ ${(delay / 1000).toFixed(1)} giây...`);
        await sleep(delay);
      }
    }

    if (!dryRun.checked && results.length) store.set(HISTORY_KEY, [...store.get(HISTORY_KEY, []), ...results].slice(-MAX_HISTORY));
    write(`Xong: ${ok}/${targets.length}.${pending.size && !dryRun.checked ? ` Còn ${pending.size} mục chưa xong, lần sau mở lại công cụ để làm tiếp.` : ""}${dryRun.checked ? "" : " Tải lại trang (F5) để cập nhật Zalo."}`);
    if (results.length) {
      downloadCSV(results, `zalo-ket-qua-${new Date().toISOString().slice(0, 10)}.csv`);
      write(`Đã tải về file kết quả (CSV) — mở bằng Excel để xem lại${tab.kind === "groups" ? ", gồm cả tên trưởng nhóm để nhờ thêm lại nếu cần" : ""}.`);
    }
    running = false;
    for (const el of controls) el.disabled = false;
    refresh();
  };

  // ----- mục 2: làm tiếp lần trước -----

  const banner = h("div", { className: "banner", hidden: true });
  const progress = store.get(PROGRESS_KEY, null);
  if (progress?.uid === client.uid && progress.items?.length) {
    const resume = h("button", { textContent: "Chọn lại các mục đó" });
    const dismiss = h("button", { className: "link", textContent: "Bỏ qua" });
    banner.append(h("span", { textContent: `Lần trước còn ${progress.items.length} mục chưa xong (${ACTIONS[progress.action]?.label ?? progress.action}).` }), resume, dismiss);
    banner.hidden = false;
    dismiss.onclick = () => { store.set(PROGRESS_KEY, null); banner.hidden = true; };
    resume.onclick = async () => {
      await switchTab(progress.tab);
      actionSel.value = progress.action;
      const ids = new Set(progress.items.map((x) => x.id));
      for (const it of current.items) setChecked(current, it, ids.has(it.id));
      const missing = progress.items.length - current.checked.size;
      reorder(current, (it) => (ids.has(it.id) ? 1 : 0));
      showHint(current, `Đã chọn lại ${current.checked.size} mục chưa xong.${missing ? ` ${missing} mục không còn trong danh sách (có thể đã xong).` : ""} Kiểm tra lại rồi bấm nút đỏ.`);
      banner.hidden = true;
      actionSel.onchange();
    };
  }

  // ----- tab -----

  const tabButtons = [
    h("button", { className: "tab on", textContent: "Nhóm", onclick: () => switchTab("groups") }),
    h("button", { className: "tab", textContent: "Đồng nghiệp cũ (chat riêng)", onclick: () => switchTab("users") }),
  ];
  const listSlot = h("div", { style: "display:contents" });

  async function switchTab(kind) {
    current = tabs[kind];
    tabButtons[0].classList.toggle("on", kind === "groups");
    tabButtons[1].classList.toggle("on", kind === "users");
    for (const b of [suggest, activityBtn]) b.hidden = kind !== "groups";
    search.value = "";
    listSlot.replaceChildren(current.hint, current.list);
    fillActions();
    refresh();
    if (kind === "users" && colleaguesFor !== checkedGroupsKey()) {
      await loadColleagues();
      refresh();
    }
    search.oninput();
  }

  body.replaceWith(
    h("div", { className: "tabs" }, ...tabButtons),
    banner,
    h("div", { className: "tools" }, search, selectShown, clearAll, suggest, activityBtn),
    listSlot,
    h(
      "footer",
      {},
      h("div", { className: "opts" }, h("label", {}, "Hành động: ", actionSel), silentLabel, h("label", {}, dryRun, " Chạy thử")),
      h("div", { className: "actions" }, count, go),
      log,
      historyBtn,
    ),
  );
  await switchTab("groups");
  search.focus();
}
