const { chromium } = require('playwright');
const path = require('path');
const User = require('../models/userModel');
const pdfService = require('../utils/pdfService');
const { sendResultEmail } = require('../utils/emailService');
const { updateSheetStatus } = require('../utils/googleSheet');
const { getHoroscopeImage } = require('../utils/getHoroscopeImage');
const { getMasterPrompt } = require('../data/systemPrompt');

// 🛠️ ĐÃ XÓA: Dòng JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT) của Railway ở đây để chống lỗi sập server.

async function startGeminiWorker() {

    console.log("🚀 KHỞI ĐỘNG BOT TRÌNH DUYỆT");

    const userDataDir = path.join(__dirname, '../gemini-profile-data');

    let context;

    try {

        context = await chromium.launchPersistentContext(userDataDir, {

            headless: false, // Nếu muốn xem bot chạy, bạn đổi thành false nhé

            chromiumSandbox: false,

            ignoreHTTPSErrors: true,

            viewport: { width: 1280, height: 720 },

            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--disable-gpu",
                "--disable-web-security"
            ]

        });

    } catch (err) {

        console.error("❌ Lỗi khởi tạo trình duyệt:", err.message);
        return;

    }

    const pageGemini = await context.newPage();

    console.log("🌐 Đang mở trang Gemini...");

    await pageGemini.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    const isLoginRequired = await pageGemini
        .locator('a[href*="ServiceLogin"], input[type="email"]')
        .isVisible()
        .catch(() => false);

    if (isLoginRequired) {

        console.log("⚠️ Cần đăng nhập Google...");

        await pageGemini.waitForSelector("div[contenteditable='true']", {
            state: "visible",
            timeout: 0
        });

        console.log("✅ Đăng nhập thành công");

        await pageGemini.waitForTimeout(3000);
    }

    while (true) {

        try {

            const request = await User.findPending();

            if (!request) {

                await new Promise((resolve) => setTimeout(resolve, 5000));
                continue;

            }

            const clientName =
                request.full_name || request.fullName || "Khách hàng";

            console.log(`🎬 ĐANG XỬ LÝ ĐƠN: ${clientName}`);

            await User.updateStatus(request.id, "processing");

            await updateSheetStatus(request.email, "PROCESSING");

            console.log("🔮 Lấy ảnh lá số...");

            const imageBuffer = await getHoroscopeImage(request);

            try {

                await pageGemini.goto("https://gemini.google.com/app", {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                });

                const prompt = getMasterPrompt(request);

                const geminiFinalResponse =
                    await askGeminiOneShot(pageGemini, prompt, imageBuffer);

                if (!geminiFinalResponse || geminiFinalResponse.length < 500) {

                    throw new Error("Gemini trả lời thiếu nội dung");

                }

                await User.updateResult(
                    request.id,
                    geminiFinalResponse.substring(0, 1500) + "... (Đã lưu đủ)"
                );

                console.log("📄 Đang tạo PDF...");

                const chapterResults = [
                    {
                        day: 1,
                        title: "Luận Giải Chiến Lược 21 Ngày",
                        content: geminiFinalResponse
                    }
                ];

                const pdfBuffer =
                    await pdfService.generateUltimateReport(
                        request,
                        chapterResults,
                        imageBuffer
                    );

                console.log("📧 Gửi Email...");

                await sendResultEmail(request.email, clientName, pdfBuffer);

                await User.updateStatus(request.id, "completed");

                await updateSheetStatus(request.email, "DONE");

                console.log(`🔥 HOÀN THÀNH ĐƠN ${clientName}`);

            } catch (innerError) {

                console.error("❌ Lỗi xử lý AI/PDF:", innerError.message);

                // 🛠️ SỬA NHẸ: Bọc try-catch để lỡ DB có đứt kết nối (timeout) thì bot không bị văng lỗi sập luôn
                try {
                    await User.updateStatus(request.id, "failed");
                    await updateSheetStatus(request.email, "FAILED");
                } catch (fallbackError) {
                    console.error("⚠️ Không thể cập nhật trạng thái lỗi (DB có thể đã ngắt kết nối):", fallbackError.message);
                }

            }

        } catch (error) {

            console.error("❌ Lỗi vòng lặp:", error.message);

            await new Promise((resolve) => setTimeout(resolve, 5000));

        }

    }
}

async function askGeminiOneShot(page, prompt, imageBuffer) {

    console.log("⌛ Chờ ô chat...");

    await page.waitForSelector("div[contenteditable='true']", { timeout: 60000 });

    const chatInput = page.locator("div[contenteditable='true']").first();

    await chatInput.click();

    if (imageBuffer) {

        console.log("📷 Upload ảnh lá số...");

        const base64Image = imageBuffer.toString("base64");

        await page.evaluate((base64) => {

            const byteString = atob(base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);

            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            const file = new File([ab], "la_so.png", { type: "image/png" });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            document
                .querySelector("div[contenteditable='true']")
                .dispatchEvent(
                    new ClipboardEvent("paste", {
                        clipboardData: dataTransfer,
                        bubbles: true
                    })
                );

        }, base64Image);

        await page.waitForTimeout(3000);
    }

    console.log("✍️ Gửi prompt...");

    await page.keyboard.insertText(prompt);

    await page.waitForTimeout(1000);

    await page.keyboard.press("Control+Enter");

    let previousLength = 0;

    let stableCount = 0;

    while (true) {

        await page.waitForTimeout(4000);

        // 🛠️ THÊM NHẸ: Cơ chế tự động bấm nút "Continue generating" nếu Gemini viết bài quá dài bị ngắt hơi (Không làm hỏng cấu trúc cũ của bạn)
        const continueBtn = page.locator('button:has-text("Continue generating"), button:has-text("Continue"), button:has-text("Tiếp tục tạo"), button:has-text("Tiếp tục")');
        if (await continueBtn.count() > 0 && await continueBtn.first().isVisible()) {
            console.log("🛟 AI bị ngắt hơi, đang bấm Continue để nối bài...");
            await continueBtn.first().click();
            await page.waitForTimeout(3000);
            continue;
        }

        const currentLength = await page.evaluate(() => {

            const selectors = [
                "message-content",
                ".model-response-text",
                "[data-message-author-role='model']",
                ".markdown-renderer"
            ];

            for (let sel of selectors) {

                const elements = document.querySelectorAll(sel);

                if (elements.length > 0) {
                    return elements[elements.length - 1].innerText.length;
                }
            }

            return 0;

        });

        console.log(`📊 Gemini đã viết ${currentLength} ký tự`);

        if (currentLength > 500 && currentLength === previousLength) {

            stableCount++;

            if (stableCount >= 2) break;

        } else {

            stableCount = 0;
            previousLength = currentLength;

        }
    }

    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => {

        const selectors = [
            "message-content",
            ".model-response-text",
            "[data-message-author-role='model']",
            ".markdown-renderer"
        ];

        for (let sel of selectors) {

            const elements = document.querySelectorAll(sel);

            if (elements.length > 0) {
                return elements[elements.length - 1].innerText;
            }
        }

        return "";
    });

    console.log(`📥 Gemini trả về ${text.length} ký tự`);

    return text;
}

startGeminiWorker();// bản này cũng dùng ngon luôn 
/*const { chromium } = require('playwright');
const path = require('path');
const User = require('../models/userModel');
const pdfService = require('../utils/pdfService');
const { sendResultEmail } = require('../utils/emailService');
const { updateSheetStatus } = require('../utils/googleSheet');
const { getHoroscopeImage } = require('../utils/getHoroscopeImage');
const { getMasterPrompt } = require('../data/systemPrompt');

async function startGeminiWorker() {
    console.log("🚀 [Worker] KHỞI ĐỘNG CHẾ ĐỘ XỬ LÝ TUẦN TỰ (1-BY-1)");

    const userDataDir = path.join(__dirname, '../../gemini-profile-data');
    let context;

    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process" // Giúp tiết kiệm RAM cực tốt
            ]
        });
    } catch (err) {
        console.error("❌ Lỗi trình duyệt:", err.message);
        return;
    }

    const pageGemini = await context.newPage();

    while (true) {
        let request = null;
        try {
            // 1. CHỈ LẤY 1 NGƯỜI DUY NHẤT ĐANG ĐỢI
            request = await User.findPending();

            if (!request) {
                console.log("💤 Không có đơn mới, đang nghỉ ngơi...");
                await new Promise(r => setTimeout(r, 10000)); // Đợi 10s quét lại
                continue;
            }

            const clientName = request.full_name || "Khách hàng";
            console.log(`\n-----------------------------------`);
            console.log(`🎬 ĐANG XỬ LÝ TRỌN GÓI CHO: ${clientName}`);

            // Cập nhật trạng thái ngay để các worker khác (nếu có) không tranh giành
            await User.updateStatus(request.id, "processing");
            await updateSheetStatus(request.email, "PROCESSING");

            // 2. LẤY LÁ SỐ
            console.log("🔮 Bước 1: Chụp ảnh lá số...");
            const imageBuffer = await getHoroscopeImage(request);

            // 3. VÀO GEMINI VÀ LÀM SẠCH LỊCH SỬ (Quan trọng để AI viết dài)
            console.log("🌐 Bước 2: Reset Gemini cho người mới...");
            await pageGemini.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
            
            try {
                // Bấm nút New Chat để AI không nhớ người cũ (tránh lỗi 177 ký tự)
                await pageGemini.click('div[aria-label="Cuộc trò chuyện mới"]', { timeout: 5000 });
                await pageGemini.waitForTimeout(2000);
            } catch (e) {
                console.log(" (Trang mới sạch sẽ, không cần bấm New Chat)");
            }

            // 4. GỬI PROMPT & ĐỢI AI TUÔN SỚ
            const prompt = getMasterPrompt(request);
            const geminiResponse = await askGeminiOneShot(pageGemini, prompt, imageBuffer);

            // Kiểm tra chất lượng AI: Nếu ngắn quá là bị lỗi
            if (!geminiResponse || geminiResponse.length < 1000) {
                throw new Error(`Gemini trả lời quá ngắn (${geminiResponse.length} ký tự).`);
            }

            // 5. TẠO PDF (Dùng nội dung AI vừa viết)
            console.log("📄 Bước 3: Đang vẽ hồ sơ PDF...");
            const chapters = [{ day: 1, title: "Luận Giải Chuyên Sâu", content: geminiResponse }];
            const pdfBuffer = await pdfService.generateUltimateReport(request, chapters, imageBuffer);

            // 6. GỬI MAIL VÀ CẬP NHẬT TRẠNG THÁI CUỐI CÙNG
            console.log("📧 Bước 4: Gửi Email kết quả...");
            await sendResultEmail(request.email, clientName, pdfBuffer);

            await User.updateStatus(request.id, "completed");
            await updateSheetStatus(request.email, "DONE");

            console.log(`✅ THÀNH CÔNG RỰC RỠ: ${clientName}`);
            console.log(`-----------------------------------\n`);

        } catch (error) {
            console.error(`❌ THẤT BẠI cho đơn ${request?.email}:`, error.message);
            if (request) {
                await User.updateStatus(request.id, "failed");
                await updateSheetStatus(request.email, "FAILED");
            }
            // Nghỉ 5 giây trước khi sang người kế tiếp để Railway hồi RAM
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function askGeminiOneShot(page, prompt, imageBuffer) {
    await page.waitForSelector("div[contenteditable='true']");
    const chatInput = page.locator("div[contenteditable='true']").first();
    await chatInput.click();

    if (imageBuffer) {
        console.log("📷 Upload ảnh lá số...");
        const base64 = imageBuffer.toString("base64");
        await page.evaluate((b64) => {
            const byteString = atob(b64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(new File([ab], "la_so.png", { type: "image/png" }));
            document.querySelector("div[contenteditable='true']").dispatchEvent(
                new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true })
            );
        }, base64);
        await page.waitForTimeout(4000);
    }

    console.log("✍️ Gửi lệnh luận giải...");
    await page.keyboard.insertText(prompt);
    await page.keyboard.press("Enter");

    let lastLen = 0;
    let stable = 0;
    console.log("⌛ Đang chờ AI viết (vui lòng không ngắt)...");

    for (let i = 0; i < 40; i++) { // Đợi tối đa ~3 phút cho sớ dài
        await page.waitForTimeout(5000);
        const currentText = await page.evaluate(() => {
            const el = document.querySelector(".model-response-text, [data-message-author-role='model'], .markdown-renderer");
            return el ? el.innerText : "";
        });

        console.log(` 📝 Đã viết: ${currentText.length} ký tự...`);

        // Nếu 15 giây (3 lần quét) mà số ký tự không đổi -> Đã viết xong
        if (currentText.length > 500 && currentText.length === lastLen) {
            stable++;
            if (stable >= 3) break;
        } else {
            stable = 0;
            lastLen = currentText.length;
        }
    }

    const finalText = await page.evaluate(() => {
        const els = document.querySelectorAll(".model-response-text, [data-message-author-role='model'], .markdown-renderer");
        return els.length > 0 ? els[els.length - 1].innerText : "";
    });

    console.log(`📥 Đã thu thập xong ${finalText.length} ký tự.`);
    return finalText;
}

startGeminiWorker();
*/
/*
bản này dùng được 
const { chromium } = require('playwright');
const path = require('path');
const User = require('../models/userModel');
const pdfService = require('../utils/pdfService');
const { sendResultEmail } = require('../utils/emailService');
const { updateSheetStatus } = require('../utils/googleSheet');
const { getHoroscopeImage } = require('../utils/getHoroscopeImage');
const { getMasterPrompt } = require('../data/systemPrompt');
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

async function startGeminiWorker() {

    console.log("🚀 KHỞI ĐỘNG BOT TRÌNH DUYỆT");

    const userDataDir = path.join(__dirname, '../gemini-profile-data');

    let context;

    try {

        context = await chromium.launchPersistentContext(userDataDir, {

            headless: true,

            chromiumSandbox: false,

            ignoreHTTPSErrors: true,

            viewport: { width: 1280, height: 720 },

            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--disable-gpu",
                "--disable-web-security"
            ]

        });

    } catch (err) {

        console.error("❌ Lỗi khởi tạo trình duyệt:", err.message);
        return;

    }

    const pageGemini = await context.newPage();

    console.log("🌐 Đang mở trang Gemini...");

    await pageGemini.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    const isLoginRequired = await pageGemini
        .locator('a[href*="ServiceLogin"], input[type="email"]')
        .isVisible()
        .catch(() => false);

    if (isLoginRequired) {

        console.log("⚠️ Cần đăng nhập Google...");

        await pageGemini.waitForSelector("div[contenteditable='true']", {
            state: "visible",
            timeout: 0
        });

        console.log("✅ Đăng nhập thành công");

        await pageGemini.waitForTimeout(3000);
    }

    while (true) {

        try {

            const request = await User.findPending();

            if (!request) {

                await new Promise((resolve) => setTimeout(resolve, 5000));
                continue;

            }

            const clientName =
                request.full_name || request.fullName || "Khách hàng";

            console.log(`🎬 ĐANG XỬ LÝ ĐƠN: ${clientName}`);

            await User.updateStatus(request.id, "processing");

            await updateSheetStatus(request.email, "PROCESSING");

            console.log("🔮 Lấy ảnh lá số...");

            const imageBuffer = await getHoroscopeImage(request);

            try {

                await pageGemini.goto("https://gemini.google.com/app", {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                });

                const prompt = getMasterPrompt(request);

                const geminiFinalResponse =
                    await askGeminiOneShot(pageGemini, prompt, imageBuffer);

                if (!geminiFinalResponse || geminiFinalResponse.length < 500) {

                    throw new Error("Gemini trả lời thiếu nội dung");

                }

                await User.updateResult(
                    request.id,
                    geminiFinalResponse.substring(0, 1500) + "... (Đã lưu đủ)"
                );

                console.log("📄 Đang tạo PDF...");

                const chapterResults = [
                    {
                        day: 1,
                        title: "Luận Giải Chiến Lược 21 Ngày",
                        content: geminiFinalResponse
                    }
                ];

                const pdfBuffer =
                    await pdfService.generateUltimateReport(
                        request,
                        chapterResults,
                        imageBuffer
                    );

                console.log("📧 Gửi Email...");

                await sendResultEmail(request.email, clientName, pdfBuffer);

                await User.updateStatus(request.id, "completed");

                await updateSheetStatus(request.email, "DONE");

                console.log(`🔥 HOÀN THÀNH ĐƠN ${clientName}`);

            } catch (innerError) {

                console.error("❌ Lỗi xử lý AI/PDF:", innerError.message);

                await User.updateStatus(request.id, "failed");

                await updateSheetStatus(request.email, "FAILED");

            }

        } catch (error) {

            console.error("❌ Lỗi vòng lặp:", error.message);

            await new Promise((resolve) => setTimeout(resolve, 5000));

        }

    }
}

async function askGeminiOneShot(page, prompt, imageBuffer) {

    console.log("⌛ Chờ ô chat...");

    await page.waitForSelector("div[contenteditable='true']", { timeout: 60000 });

    const chatInput = page.locator("div[contenteditable='true']").first();

    await chatInput.click();

    if (imageBuffer) {

        console.log("📷 Upload ảnh lá số...");

        const base64Image = imageBuffer.toString("base64");

        await page.evaluate((base64) => {

            const byteString = atob(base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);

            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            const file = new File([ab], "la_so.png", { type: "image/png" });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            document
                .querySelector("div[contenteditable='true']")
                .dispatchEvent(
                    new ClipboardEvent("paste", {
                        clipboardData: dataTransfer,
                        bubbles: true
                    })
                );

        }, base64Image);

        await page.waitForTimeout(3000);
    }

    console.log("✍️ Gửi prompt...");

    await page.keyboard.insertText(prompt);

    await page.waitForTimeout(1000);

    await page.keyboard.press("Control+Enter");

    let previousLength = 0;

    let stableCount = 0;

    while (true) {

        await page.waitForTimeout(4000);

        const currentLength = await page.evaluate(() => {

            const selectors = [
                "message-content",
                ".model-response-text",
                "[data-message-author-role='model']",
                ".markdown-renderer"
            ];

            for (let sel of selectors) {

                const elements = document.querySelectorAll(sel);

                if (elements.length > 0) {
                    return elements[elements.length - 1].innerText.length;
                }
            }

            return 0;

        });

        console.log(`📊 Gemini đã viết ${currentLength} ký tự`);

        if (currentLength > 500 && currentLength === previousLength) {

            stableCount++;

            if (stableCount >= 2) break;

        } else {

            stableCount = 0;
            previousLength = currentLength;

        }
    }

    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => {

        const selectors = [
            "message-content",
            ".model-response-text",
            "[data-message-author-role='model']",
            ".markdown-renderer"
        ];

        for (let sel of selectors) {

            const elements = document.querySelectorAll(sel);

            if (elements.length > 0) {
                return elements[elements.length - 1].innerText;
            }
        }

        return "";
    });

    console.log(`📥 Gemini trả về ${text.length} ký tự`);

    return text;
}

startGeminiWorker();

*/
/*// backend/workers/geminiWorker.js
const { chromium } = require('playwright');
const path = require('path');
const User = require('../models/userModel');
const pdfService = require('../utils/pdfService');
const { sendResultEmail } = require('../utils/emailService');
const { updateSheetStatus } = require('../utils/googleSheet');
const { getHoroscopeImage } = require('../utils/getHoroscopeImage');

// 👉 Lôi cái Siêu Prompt khổng lồ vào
const { getMasterPrompt } = require('../data/systemPrompt');

async function startGeminiWorker() {
    console.log("🚀 KHỞI ĐỘNG BOT TRÌNH DUYỆT");

    const userDataDir = path.join(__dirname, '../gemini-profile-data');
    let context;

    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: true,
            chromiumSandbox: false,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--disable-gpu"
            ],
            viewport: { width: 1280, height: 720 },
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        });
    } catch (err) {
        console.error("❌ Lỗi khởi tạo trình duyệt:", err.message);
        return;
    }

    const pageGemini = await context.newPage();

    console.log("🌐 Đang mở trang Gemini...");
    await pageGemini.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    const isLoginRequired = await pageGemini
        .locator('a[href*="ServiceLogin"], input[type="email"]')
        .isVisible()
        .catch(() => false);

    if (isLoginRequired) {
        console.log("⚠️ Cần đăng nhập Google...");
        await pageGemini.waitForSelector("div[contenteditable='true']", {
            state: "visible",
            timeout: 0
        });
        console.log("✅ Đăng nhập thành công");
        await pageGemini.waitForTimeout(3000);
    }

    while (true) {
        try {
            const request = await User.findPending();

            if (!request) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                continue;
            }

            const clientName =
                request.full_name || request.fullName || "Khách hàng";

            console.log(`\n🎬 ĐANG XỬ LÝ ĐƠN: ${clientName}`);

            await User.updateStatus(request.id, "processing");
            await updateSheetStatus(request.email, "PROCESSING");

            console.log("🔮 Lấy ảnh lá số...");
            const imageBuffer = await getHoroscopeImage(request);

            try {
                await pageGemini.goto("https://gemini.google.com/app", {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                });

                const prompt = getMasterPrompt(request);

                const geminiFinalResponse =
                    await askGeminiOneShot(pageGemini, prompt, imageBuffer);

                if (!geminiFinalResponse || geminiFinalResponse.length < 500) {
                    throw new Error("Gemini trả lời thiếu nội dung");
                }

                await User.updateResult(
                    request.id,
                    geminiFinalResponse.substring(0, 1500) + "... (Đã lưu đủ)"
                );

                console.log("📄 Đang tạo PDF...");
                const chapterResults = [
                    {
                        day: 1,
                        title: "Luận Giải Chiến Lược 21 Ngày",
                        content: geminiFinalResponse
                    }
                ];

                const pdfBuffer =
                    await pdfService.generateUltimateReport(
                        request,
                        chapterResults,
                        imageBuffer
                    );

                console.log("📧 Gửi Email...");
                await sendResultEmail(request.email, clientName, pdfBuffer);

                await User.updateStatus(request.id, "completed");
                await updateSheetStatus(request.email, "DONE");

                console.log(`🔥 HOÀN THÀNH ĐƠN ${clientName}`);

            } catch (innerError) {

                console.error("❌ Lỗi xử lý AI/PDF:", innerError.message);

                await User.updateStatus(request.id, "failed");
                await updateSheetStatus(request.email, "FAILED");
            }

        } catch (error) {

            console.error("❌ Lỗi vòng lặp:", error.message);

            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}

// =====================================================
// Hàm hỏi Gemini
// =====================================================

async function askGeminiOneShot(page, prompt, imageBuffer) {

    console.log("⌛ Chờ ô chat...");

    await page.waitForSelector("div[contenteditable='true']", { timeout: 60000 });

    const chatInput = page.locator("div[contenteditable='true']").first();

    await chatInput.click();

    if (imageBuffer) {

        console.log("📷 Upload ảnh lá số...");

        const base64Image = imageBuffer.toString("base64");

        await page.evaluate((base64) => {

            const byteString = atob(base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);

            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            const file = new File([ab], "la_so.png", { type: "image/png" });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            document
                .querySelector("div[contenteditable='true']")
                .dispatchEvent(
                    new ClipboardEvent("paste", {
                        clipboardData: dataTransfer,
                        bubbles: true
                    })
                );

        }, base64Image);

        await page.waitForTimeout(3000);
    }

    console.log("✍️ Gửi prompt...");

    await page.keyboard.insertText(prompt);
    await page.waitForTimeout(1000);
    await page.keyboard.press("Control+Enter");

    let previousLength = 0;
    let stableCount = 0;

    while (true) {

        await page.waitForTimeout(4000);

        const currentLength = await page.evaluate(() => {

            const selectors = [
                "message-content",
                ".model-response-text",
                "[data-message-author-role='model']",
                ".markdown-renderer"
            ];

            for (let sel of selectors) {

                const elements = document.querySelectorAll(sel);

                if (elements.length > 0) {
                    return elements[elements.length - 1].innerText.length;
                }
            }

            return 0;

        });

        console.log(`📊 Gemini đã viết ${currentLength} ký tự`);

        if (currentLength > 500 && currentLength === previousLength) {

            stableCount++;

            if (stableCount >= 2) break;

        } else {

            stableCount = 0;
            previousLength = currentLength;

        }
    }

    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => {

        const selectors = [
            "message-content",
            ".model-response-text",
            "[data-message-author-role='model']",
            ".markdown-renderer"
        ];

        for (let sel of selectors) {

            const elements = document.querySelectorAll(sel);

            if (elements.length > 0) {
                return elements[elements.length - 1].innerText;
            }
        }

        return "";
    });

    console.log(`📥 Gemini trả về ${text.length} ký tự`);

    return text;
}

startGeminiWorker();*/