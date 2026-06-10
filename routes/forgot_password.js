const express = require("express");
const router = express.Router();
const supabase = require("../db");
const bcrypt = require('bcrypt'); 

// ==========================================
// 1. ฟังก์ชันส่ง OTP (ส่งหาอีเมลไหนก็ได้ผ่าน Brevo API)
// ==========================================
router.post("/forgot-password/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "กรุณากรอกอีเมล" });
    }

    // เช็กว่ามีอีเมลนี้ในระบบไหม
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("user_id,email")
      .eq("email", email)
      .maybeSingle();

    if (userError) throw userError;

    if (!user) {
      return res.status(404).json({ error: "ไม่พบอีเมลนี้ในระบบ" });
    }

    // สุ่ม OTP 6 หลัก
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // อัปเดต OTP เก่าให้หมดอายุ
    await supabase
      .from("password_reset")
      .update({ is_used: true })
      .eq("email", email);

    const expiresMs = Date.now() + 5 * 60 * 1000;

    // บันทึก OTP ใหม่ลง Database
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

    // 🚨 แก้ไขจุดนี้: เปลี่ยนจาก jsonEncode เป็น JSON.stringify ของ Node.js แท้ ๆ เพื่อให้ Brevo อ่าน API Key เจอ
    const responseBrevo = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": process.env.BREVO_API_KEY, 
        "content-type": "application/json"
      },
      body: JSON.stringify({
        "sender": { "name": "Jobder", "email": "ptrp14097@gmail.com" }, 
        "to": [{ "email": email }], 
        "subject": "OTP รีเซ็ตรหัสผ่าน Jobder",
        "htmlContent": `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #333;">รหัส OTP ของคุณ</h2>
            <p style="font-size: 16px; color: #666;">กรุณานำรหัส OTP ด้านล่างนี้ไปกรอกในแอปพลิเคชันเพื่อรีเซ็ตรหัสผ่านครับ</p>
            <div style="background-color: #fff0f0; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <h1 style="color: #ff5252; letter-spacing: 6px; font-size: 36px; margin: 0;">${otp}</h1>
            </div>
            <p style="font-size: 13px; color: #999;">* รหัส OTP นี้มีอายุการใช้งาน 5 นาที</p>
            <p style="font-size: 13px; color: #999;">หากคุณไม่ได้ขอบริการนี้ กรุณาปล่อยผ่านอีเมลฉบับนี้ไปได้เลยครับ</p>
          </div>
        `
      })
    });

    const resData = await responseBrevo.json();

    // ดัก Error เผื่อฝั่ง Brevo แจ้งเตือนอะไรกลับมา
    if (!responseBrevo.ok) {
      throw new Error(resData.message || "Brevo API ส่งเมลไม่สำเร็จ");
    }

    console.log("Email sent successfully via Brevo Web API!");

    // ส่งคำตอบกลับไปบอก Flutter ให้เปลี่ยนหน้า
    res.json({
      success: true,
      message: "ส่ง OTP ไปที่อีเมลแล้ว",
    });

  } catch (err) {
    console.error("Send OTP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. ฟังก์ชันตรวจ OTP
// ==========================================
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

// ==========================================
// 3. ฟังก์ชันเปลี่ยนรหัสผ่านใหม่
// ==========================================
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

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { error: updateError } = await supabase
      .from("users")
      .update({ password: hashedPassword })
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