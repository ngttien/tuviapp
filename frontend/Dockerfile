# Sử dụng môi trường Node.js nhẹ (alpine)
FROM node:22-alpine

# Tạo thư mục làm việc bên trong container
WORKDIR /app

# Copy 2 file package.json và package-lock.json vào trước
COPY package*.json ./

# Cài đặt các thư viện cho frontend
RUN npm install

# Copy toàn bộ mã nguồn frontend vào container
COPY . .

# Mở cổng 5173 (Cổng mặc định của Vite)
EXPOSE 5173

# Lệnh khởi chạy giao diện web bằng Vite (bắt buộc có --host trên Docker)
CMD ["npm", "run", "dev", "--", "--host"]