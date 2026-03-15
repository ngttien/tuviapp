# Dùng ảnh chuẩn có Playwright
FROM mcr.microsoft.com/playwright:v1.58.0-jammy

# Tạo thư mục làm việc trên mây
WORKDIR /app

# CHỈNH LẠI ĐÂY: Không cần chữ backend/ nữa
COPY package*.json ./

# Cài đặt thư viện
RUN npm install

# CHỈNH LẠI ĐÂY: Copy mọi thứ ở thư mục hiện tại vào /app
COPY . .

# Mở cổng 5000
EXPOSE 5000

# Lệnh khởi động (Nhớ chạy cả server và worker nha Tiên)
CMD ["sh", "-c", "npm start & npm run worker"]