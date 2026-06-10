const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const supabase = require("../db");
const bcrypt = require('bcrypt'); // 🌟 เพิ่มบรรทัดนี้เข้าไปด้านบนสุดของไฟล์

//  แก้ไขใหม่เป็นแบบนี้ครับ (เพิ่มการระบุ IPv4 และตั้งค่าหมดเวลา)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // เปลี่ยนจาก service เป็นระบุ host โดยตรง
  port: 465,             // พอร์ตสำหรับส่งเมลแบบปลอดภัย
  secure: true,          // ใช้ SSL
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  // 💡 ทริคสำคัญ: บังคับให้ระบบมองหาที่อยู่แบบ IPv4 ก่อน และถ้าส่งไม่ผ่านใน 10 วิให้ตัดสายทันที แอปจะได้ไม่หมุนค้าง
  connectionTimeout: 10000, 
  greetingTimeout: 10000,
  dnsTimeout: 10000,
});

// ส่ง OTP
router.post("/forgot-password/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "กรุณากรอกอีเมล" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("user_id,email")
      .eq("email", email)
      .maybeSingle();

    if (userError) throw userError;

    if (!user) {
      return res.status(404).json({ error: "ไม่พบอีเมลนี้ในระบบ" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await supabase
      .from("password_reset")
      .update({ is_used: true })
      .eq("email", email);

    const expiresMs = Date.now() + 5 * 60 * 1000;

const { error: insertError } = await supabase
  .from("password_reset")
  .insert([
    {
      email,
      otp_code: otp,
      expires_at: new Date(expiresMs).toISOString(),
      expires_ms: expiresMs,
      is_used: false,
    },
  ]);

    if (insertError) throw insertError;

    const info = await transporter.sendMail({
      from: `"Jobder" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "OTP รีเซ็ตรหัสผ่าน Jobder",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>รหัส OTP ของคุณ</h2>
          <h1 style="color: #ff5252; letter-spacing: 4px;">${otp}</h1>
          <p>OTP นี้มีอายุ 5 นาที</p>
          <p>หากคุณไม่ได้ขอรีเซ็ตรหัสผ่าน กรุณาไม่ต้องสนใจอีเมลนี้</p>
        </div>
      `,
    });

    console.log("Gmail sent:", info.messageId);

    res.json({
      success: true,
      message: "ส่ง OTP ไปที่อีเมลแล้ว",
    });
  } catch (err) {
    console.error("Send OTP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ตรวจ OTP
// ตรวจ OTP
router.post("/forgot-password/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "กรุณากรอกอีเมลและ OTP" });
    }

    const { data, error } = await supabase
      .from("password_reset")
      .select("*")
      .eq("email", email)
      .eq("otp_code", otp)
      .eq("is_used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(400).json({ error: "OTP ไม่ถูกต้อง" });
    }

    const nowMs = Date.now();
const expiresMs = Number(data.expires_ms);

console.log("NOW MS:", nowMs);
console.log("EXPIRES MS:", expiresMs);

if (expiresMs < nowMs) {
  return res.status(400).json({ error: "OTP หมดอายุแล้ว" });
}

    res.json({
      success: true,
      message: "OTP ถูกต้อง",
    });
  } catch (err) {
    console.error("Verify OTP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// เปลี่ยนรหัสผ่าน
router.post("/forgot-password/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
    }

    const { data, error } = await supabase
      .from("password_reset")
      .select("*")
      .eq("email", email)
      .eq("otp_code", otp)
      .eq("is_used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(400).json({ error: "OTP ไม่ถูกต้อง" });
    }

    const nowMs = Date.now();
const expiresMs = Number(data.expires_ms);

console.log("RESET NOW MS:", nowMs);
console.log("RESET EXPIRES MS:", expiresMs);

if (expiresMs < nowMs) {
  return res.status(400).json({ error: "OTP หมดอายุแล้ว" });
}

    const hashedPassword = await bcrypt.hash(
  newPassword,
  10
);

const { error: updateError } = await supabase
  .from("users")
  .update({
    password: hashedPassword
  })
  .eq("email", email);

    if (updateError) throw updateError;

    await supabase
      .from("password_reset")
      .update({ is_used: true })
      .eq("reset_id", data.reset_id);

    res.json({
      success: true,
      message: "เปลี่ยนรหัสผ่านสำเร็จ",
    });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;