const { chromium } = require('playwright');

/**
 * Hàm lấy ảnh lá số (Bản tối ưu RAM - Fix lỗi lồng lệnh)
 */
async function getHoroscopeImage(userData) {
    // --- 1. CHUẨN HÓA DỮ LIỆU (Giữ nguyên của Tiên) ---
    const fullName = userData.full_name || userData.fullName || userData['Họ tên'] || '';
    const dob = userData.dob || userData['Ngày sinh'] || ''; 
    const tob = userData.tob || userData['Giờ sinh'] || '00:00';
    
    let genderInput = userData.gender || userData['Giới tính'] || 'male';
    if (typeof genderInput === 'string') genderInput = genderInput.toLowerCase();
    const isMale = (genderInput === 'male' || genderInput === 'nam' || genderInput === '1');

    console.log(`📸 [Playwright] Đang xử lý: Tên="${fullName}" | Ngày="${dob}" | Giờ="${tob}" | Nam?=${isMale}`);

    if (!fullName) {
        throw new Error("Dữ liệu đầu vào thiếu Tên (full_name/fullName)!");
    }

    // KHAI BÁO BIẾN Ở ĐÂY ĐỂ ĐÓNG ĐƯỢC Ở CẢ THÀNH CÔNG LẪN THẤT BẠI
    let browser;

    try {
        // --- 2. KHỞI ĐỘNG TRÌNH DUYỆT (Cấu hình "ép mỡ" chuẩn của Tiên) ---
        browser = await chromium.launch({ 
            headless: true, 
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--disable-set-privileged-capabilities'
    ]
        });
        
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 }
        });
        const page = await context.newPage();

        console.log("... Đang truy cập tuvi.vn");
        await page.goto('https://tuvi.vn/lap-la-so-tu-vi', { 
            waitUntil: 'networkidle', 
            timeout: 90000 
        });

        // --- 3. ĐIỀN FORM (Giữ nguyên cấu trúc của Tiên) ---
        console.log("... Đang đợi ô nhập tên hiện ra");
        await page.waitForSelector('input[name="name"]', { state: 'visible', timeout: 30000 });
        await page.locator('input[name="name"]').fill(fullName); 

        const dateObj = new Date(dob);
        if (isNaN(dateObj.getTime())) {
             throw new Error(`Định dạng ngày sinh không hợp lệ: ${dob}`);
        }

        const day = dateObj.getDate().toString();
        const month = (dateObj.getMonth() + 1).toString();
        const year = dateObj.getFullYear().toString();

        await page.selectOption('select[name="dayOfDOB"]', day);
        await page.selectOption('select[name="monthOfDOB"]', month);
        await page.locator('input[name="yearOfDOB"]').fill(year);

        await page.click('#lichDuongRes');

        const [hour, minute] = tob.split(':');
        await page.selectOption('select[name="hourOfDOB"]', parseInt(hour).toString());
        
        try {
            await page.selectOption('select[name="minOfDOB"]', parseInt(minute).toString());
        } catch (e) {
            await page.selectOption('select[name="minOfDOB"]', "0");
        }

        if (isMale) {
            await page.click('#male2Res');
        } else {
            await page.click('#female2Res');
        }

        // --- 4. SUBMIT & CHỤP ẢNH ---
        console.log("... Bấm nút lấy lá số");
        await page.click('button[type="submit"]');

        console.log(" Đang đợi lá số hiện ra...");
        await page.waitForTimeout(5000); 

        const imageBuffer = await page.screenshot({ fullPage: true });
        console.log("✅ Chụp thành công!");

        return imageBuffer; 

    } catch (error) {
        console.error("❌ Lỗi Robot chụp ảnh:", error.message);
        throw error; // Ném lỗi ra ngoài để hệ thống biết mà xử lý
    } finally {
        // QUAN TRỌNG NHẤT: Luôn luôn đóng trình duyệt để cứu RAM cho Railway
        if (browser) {
            await browser.close();
            console.log("🧹 Đã đóng trình duyệt, giải phóng bộ nhớ.");
        }
    }
}

module.exports = { getHoroscopeImage };