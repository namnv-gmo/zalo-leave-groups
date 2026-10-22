# Rời nhóm Zalo hàng loạt

Công cụ rời nhiều nhóm Zalo cùng lúc, có checkbox để tự chọn nhóm và chờ 3–7 giây giữa mỗi lần rời để tránh bị Zalo chặn.

**Trang hướng dẫn cài đặt (cho người dùng):** https://namnv-gmo.github.io/zalo-leave-groups/

## Hai cách dùng

### 1. Bookmarklet (khuyên dùng — không cần cài gì)

Mở trang hướng dẫn ở trên, kéo nút “Rời nhóm Zalo” lên thanh dấu trang, đăng nhập [chat.zalo.me](https://chat.zalo.me) rồi bấm dấu trang.

- Lọc nhóm theo tên (không cần gõ dấu).
- **Tìm nhóm có người chung**: tick 1–2 nhóm chắc chắn của công ty cũ, công cụ xếp các nhóm có nhiều đồng nghiệp cũ lên đầu — dùng khi nhóm không đặt theo tên công ty.
- Chế độ chạy thử, rời im lặng, tự dừng khi lỗi 2 lần liên tiếp.

Mã nguồn: [`bookmarklet/zalo-leave.js`](bookmarklet/zalo-leave.js). Bookmarklet dùng phiên đăng nhập sẵn có của trình duyệt và chỉ gửi yêu cầu tới máy chủ Zalo.

### 2. Script Node.js (đăng nhập bằng QR)

```bash
npm install
node leave-groups.js --dry-run "ten cong ty"   # chạy thử
node leave-groups.js "ten cong ty"             # tick sẵn nhóm có tên chứa từ khóa
node leave-groups.js --silent                  # rời im lặng
```

## Phát triển

```bash
npm install
npm run build   # tạo bookmarklet/bookmarklet.txt, bookmarklet/cai-dat.html và docs/index.html (GitHub Pages)
```

Trang hướng dẫn được sinh từ `bookmarklet/cai-dat.template.html`; ảnh trong `bookmarklet/images/` được nhúng thẳng vào HTML.

## Lưu ý

- Dùng API không chính thức của Zalo Web (cùng cách thư viện [zca-js](https://github.com/RFS-ADRENO/zca-js)). Zalo có thể thay đổi bất cứ lúc nào.
- Rời nhóm là không tự vào lại được — luôn chạy thử trước.
- Nếu là trưởng nhóm, Zalo có thể yêu cầu chuyển quyền trước khi rời.
