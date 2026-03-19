const express = require("express");
const dotenv = require("dotenv");
// 1. Nạp biến môi trường NGAY LẬP TỨC
dotenv.config(); 

const cors = require("cors");
const cookieParser = require("cookie-parser");

// 2. Gọi DB sau khi đã nạp biến môi trường
const db = require("./config/db");

// Import Routes tổng
const routes = require("./routes/index.route");

const app = express();
const port = process.env.PORT || 5000;

// --- 1. MIDDLEWARE (Bộ lọc bảo vệ & Xử lý dữ liệu) ---
app.use(
  cors({
    origin: true, 
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTE KIỂM TRA (Health Check) ---
app.get("/", (req, res) => {
  res.send("🚀 Server 'Thuận Thời Hiểu Mệnh' đang chạy cực mượt!");
});

// --- 2. ROUTES (Định tuyến API) ---
app.use("/api", routes);

// --- 3. KHỞI ĐỘNG SERVER ---
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ [SERVER] Đang lắng nghe tại cổng ${port}`);
});