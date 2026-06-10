const express = require("express");
const router = express.Router();
const supabase = require("../db");
const bcrypt = require('bcrypt'); 

// 🚨 1. เปลี่ยนมาเรียกใช้ Resend แทน Nodemailer ตัวเดิม
const { Resend } = require('resend');
// ระบบจะดึงคีย์ RESEND_API_KEY ที่เราตั้งไว้บน Render มาใช้เองอัตโนมัติ
const resend = new Resend(process.env.RESEND_API_KEY); 

// ฟังก์ชันส่ง OTP (แก้ไขเฉพาะท่อนส่งอีเมล)
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

    // 🚨 2. ท่อนส่งอีเมลเปลี่ยนมาใช้คำสั่งนี้แทน พอร์ตไม่โดนบล็อกแน่นอน 100%
    const { data, error: sendError } = await resend.emails.send({
      // ช่วงทดสอบระบบฟรี ต้องใช้เมลดิสนี้เท่านั้น: onboarding@resend.dev
      from: 'Jobder <onboarding@resend.dev>', 
      to: email, // อีเมลปลายทางของผู้ใช้ (เช่น ptrp14097@gmail.com)
      subject: 'OTP รีเซ็ตรหัสผ่าน Jobder',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #333;">รหัส OTP ของคุณ</h2>
          <p style="font-size: 16px; color: #666;">กรุณานำรหัส OTP ด้านล่างนี้ไปกรอกในแอปพลิเคชันเพื่อรีเซ็ตรหัสผ่านครับ</p>
          <div style="background-color: #fff0f0; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="color: #ff5252; letter-spacing: 6px; font-size: 36px; margin: 0;">${otp}</h1>
          </div>
          <p style="font-size: 13px; color: #999;">* รหัส OTP นี้มีอายุการใช้งาน 5 นาที</p>
          <p style="font-size: 13px; color: #999;">หากคุณไม่ได้ขอบริการนี้ กรุณาปล่อยผ่านอีเมลฉบับนี้ไปได้เลยครับ</p>
        </div>
      `,
    });

    if (sendError) throw sendError;

    console.log("Email sent via Resend Web API ID:", data.id);

    // ส่งคำตอบกลับไปบอก Flutter ว่าสำเร็จแล้วจ้า!
    res.json({
      success: true,
      message: "ส่ง OTP ไปที่อีเมลแล้ว",
    });

  } catch (err) {
    console.error("Send OTP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ... ส่วนตรวจ OTP และเปลี่ยนรหัสผ่านด้านล่าง ให้คงโค้ดเดิมของคุณไว้ได้เลยครับ ไม่ต้องแก้ตาม ...
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