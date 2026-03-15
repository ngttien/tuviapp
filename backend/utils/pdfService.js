const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

class PDFService {

constructor(){

this.fontRegular = path.join(__dirname,"../assets/fonts/BeVietnamPro-Regular.ttf");
this.fontBold = path.join(__dirname,"../assets/fonts/BeVietnamPro-Bold.ttf");

this.logo = path.join(__dirname,"../assets/images/logo_tps.jpg");
this.bg = path.join(__dirname,"../assets/images/hoa-van-trong-dong-9.png");

this.colors={
navy:"#0a192f",
gold:"#d4af37",
white:"#ffffff",
text:"#e5e7eb"
}

}

async generateUltimateReport(userInfo,allChapters){

return new Promise((resolve,reject)=>{

try{

const doc=new PDFDocument({
size:"A4",
margin:50
})

const reportsDir=path.join(__dirname,"../assets/reports")

if(!fs.existsSync(reportsDir)){
fs.mkdirSync(reportsDir,{recursive:true})
}

const filePath=path.join(reportsDir,`report_${Date.now()}.pdf`)
const stream=fs.createWriteStream(filePath)

doc.pipe(stream)

/* COVER */
this.drawBackground(doc)
this.drawHeader(doc)
this.drawCover(doc,userInfo)

/* CONTENT */
if(allChapters && allChapters.length>0){
this.drawContent(doc,allChapters[0].content)
}

doc.end()

stream.on("finish",()=>{
const buffer=fs.readFileSync(filePath)
resolve(buffer)
})

}catch(err){
reject(err)
}

})

}

/* ================= BACKGROUND ================= */

drawBackground(doc){

doc.save()

doc.rect(0,0,doc.page.width,doc.page.height)
.fillColor(this.colors.navy)
.fill()

if(fs.existsSync(this.bg)){

doc.image(this.bg,0,0,{
width:doc.page.width,
height:doc.page.height
})

doc.rect(0,0,doc.page.width,doc.page.height)
.fillColor(this.colors.navy)
.fillOpacity(.65)
.fill()

}

doc.restore()

}

/* ================= HEADER ================= */

drawHeader(doc){

if(fs.existsSync(this.logo)){
doc.image(this.logo,50,40,{width:70})
}

doc.fillColor(this.colors.white)
.font(this.fontBold)
.fontSize(15)
.text("CÔNG TY CỔ PHẦN TPS THÀNH PHONG",130,45)

doc.font(this.fontRegular)
.fontSize(10)
.fillColor(this.colors.text)
.text("VPGD: 31B Đường số 23, P.Hiệp Bình Chánh, Q.Thủ Đức, TP.HCM",130)
.text("Điện thoại: (08) 3848 7933 – 3848 7553")
.text("www.thanhphong.vn")

}

/* ================= COVER ================= */

drawCover(doc,userInfo){

const name=(userInfo.fullName || userInfo.full_name || "KHÁCH HÀNG VIP").toUpperCase()

const dob = userInfo.dob
? new Date(userInfo.dob).toLocaleDateString("vi-VN")
: "Bảo mật"

const tob = userInfo.tob || "Chưa cung cấp"
const gender = userInfo.gender || "Chưa cung cấp"
const goal = userInfo.goal || "Chưa cung cấp"
const email = userInfo.email || "Không có"
const desc = userInfo.description || "Không có"

doc.moveDown(6)

doc.fillColor(this.colors.gold)
.font(this.fontBold)
.fontSize(22)
.text("THUẬN THỜI HIỂU MỆNH - VẠN SỰ HANH THÔNG",{align:"center"})

doc.moveDown(2)

doc.fillColor(this.colors.white)
.font(this.fontBold)
.fontSize(42)
.text("HỒ SƠ LUẬN GIẢI",{align:"center"})

doc.text("CHIẾN LƯỢC",{align:"center"})

doc.fillColor(this.colors.gold)
.fontSize(24)
.text("21 NGÀY CHUYÊN SÂU",{align:"center"})

doc.moveDown(3)

doc.fillColor(this.colors.white)
.fontSize(30)
.text(name,{align:"center"})

doc.moveDown(2)

doc.font(this.fontRegular)
.fontSize(14)
.fillColor(this.colors.text)

doc.text(`Ngày sinh: ${dob}`,{align:"center"})
doc.text(`Giờ sinh: ${tob}`,{align:"center"})
doc.text(`Giới tính: ${gender}`,{align:"center"})
doc.text(`Mục tiêu: ${goal}`,{align:"center"})
doc.text(`Email: ${email}`,{align:"center"})

doc.moveDown(1)

doc.text(`Mô tả: ${desc}`,{
align:"center",
width:400
})

doc.addPage()

this.drawBackground(doc)
this.drawHeader(doc)

doc.y=150

}

/* ================= CONTENT ================= */

drawContent(doc,text){

if(!text) return

const lines=text.replace(/\n{2,}/g,"\n").split("\n")

for(const rawLine of lines){

const line=rawLine.trim()

if(!line){
doc.moveDown(.5)
continue
}

/* PAGE BREAK */

if(doc.y > doc.page.height - 90){

doc.addPage()

this.drawBackground(doc)
this.drawHeader(doc)

doc.y=150

}

/* TITLE */

if(line.startsWith("#")){

doc.moveDown(1)

doc.fillColor(this.colors.gold)
.font(this.fontBold)
.fontSize(22)
.text(
line.replace(/^#+/,""),
50,
doc.y,
{
width:495,
align:"left"
}
)

doc.moveDown(.8)

}

/* NORMAL TEXT */

else{

doc.fillColor(this.colors.white)
.font(this.fontRegular)
.fontSize(13)
.text(
line.replace(/\*\*/g,""),
50,
doc.y,
{
width:495,
align:"justify",
lineGap:6
}
)

}

}

}

}

module.exports=new PDFService()