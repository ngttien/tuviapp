const { chromium } = require('playwright');
const path = require('path');
const User = require('../models/userModel');
const pdfService = require('../utils/pdfService');
const { sendResultEmail } = require('../utils/emailService');
const { updateSheetStatus } = require('../utils/googleSheet');
const { getHoroscopeImage } = require('../utils/getHoroscopeImage');
const { getMasterPrompt } = require('../data/systemPrompt');

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