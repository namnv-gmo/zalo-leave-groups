// Đóng gói zalo-leave.js thành bookmarklet và tạo trang cài đặt cai-dat.html
import fs from "node:fs";
import { buildSync } from "esbuild";

const { outputFiles } = buildSync({
  stdin: { contents: 'import { run } from "./zalo-leave.js"; run();', resolveDir: import.meta.dirname },
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  charset: "utf8",
  write: false,
});
const href = "javascript:" + encodeURIComponent(outputFiles[0].text.trim());
fs.writeFileSync(new URL("bookmarklet.txt", import.meta.url), href);

const template = fs
  .readFileSync(new URL("cai-dat.template.html", import.meta.url), "utf8")
  // nhúng ảnh vào HTML để chỉ cần gửi đúng một file
  .replace(/src="(images\/[^"]+\.png)"/g, (_, file) => `src="data:image/png;base64,${fs.readFileSync(new URL(file, import.meta.url)).toString("base64")}"`);
const page = template.replaceAll("__BOOKMARKLET__", href.replace(/&/g, "&amp;").replace(/"/g, "&quot;"));
fs.writeFileSync(new URL("cai-dat.html", import.meta.url), page);
// bản cho GitHub Pages
fs.mkdirSync(new URL("../docs/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../docs/index.html", import.meta.url), page);
console.log(`bookmarklet: ${href.length} ký tự`);
