// routes/auth.js
const express = require('express');
const router = express.Router();
const supabase = require('../db'); // ดึง supabase จากไฟล์ db.js
const bcrypt = require("bcrypt");
const axios = require("axios");

// 🌟 เพิ่มการดึงแพ็กเกจ multer และสร้างตัวแปร upload สำหรับรับรูปภาพ
const multer = require('multer');
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // จำกัดขนาดไฟล์ไว้ที่ 5MB เพื่อความปลอดภัย
});

/**
 * 🔒 ฟังก์ชันตรวจสอบ reCAPTCHA ฝั่ง Server
 */
async function verifyCaptcha(captchaToken) {
  if (!captchaToken) return false;
  try {
    const response = await axios.post(
      "https://www.google.com/recaptcha/api/siteverify",
      null,
      {
        params: {
          secret: process.env.RECAPTCHA_SECRET_KEY,
          response: captchaToken,
        },
      }
    );
    return response.data.success === true;
  } catch (err) {
    console.error("❌ reCAPTCHA verification error:", err.message);
    return false;
  }
}

/////////////////////////////////////////////////////////
// 🔐 Login Route 
////////////////////////////////////////////////////////
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่านให้ครบ' });
  }

  try {
    // 1. ดึง user ด้วย email อย่างเดียวก่อน
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (userError) throw userError;

    if (!user) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    let passwordIsValid = false;

    // 2. ตรวจว่ารหัสใน DB เป็น bcrypt hash หรือยัง
    const dbPassword = user.password || '';

    if (dbPassword.startsWith('$2a$') || dbPassword.startsWith('$2b$')) {
      passwordIsValid = await bcrypt.compare(password, dbPassword);
    } else {
      passwordIsValid = password === dbPassword;

      // ถ้า login ผ่านด้วยรหัสเก่า ให้แปลงเป็น hash อัตโนมัติ
      if (passwordIsValid) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await supabase
          .from('users')
          .update({ password: hashedPassword })
          .eq('user_id', user.user_id);
      }
    }

    if (!passwordIsValid) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    // 🚫 ตรวจสอบบัญชีที่ถูกระงับ
    if (user.is_suspended === true) {
      const now = new Date();
      const suspendUntil = user.suspend_until
        ? new Date(user.suspend_until)
        : null;

      // ถ้ามีวันสิ้นสุด และยังไม่หมดเวลาระงับ
      if (suspendUntil && suspendUntil > now) {
        return res.status(403).json({
          error: 'บัญชีของคุณถูกระงับการใช้งานชั่วคราว',
          reason: user.suspend_reason || 'ละเมิดกฎการใช้งาน',
          suspend_until: user.suspend_until
        });
      }

      // ถ้าไม่มีวันสิ้นสุด = ระงับถาวร
      if (!suspendUntil) {
        return res.status(403).json({
          error: 'บัญชีของคุณถูกระงับการใช้งาน',
          reason: user.suspend_reason || 'ละเมิดกฎการใช้งาน',
          suspend_until: null
        });
      }

      // ถ้าหมดเวลาระงับแล้ว ให้ปลดระงับอัตโนมัติ
      if (suspendUntil <= now) {
        await supabase
          .from('users')
          .update({
            is_suspended: false,
            suspend_until: null,
            suspend_reason: null
          })
          .eq('user_id', user.user_id);

        user.is_suspended = false;
        user.suspend_until = null;
        user.suspend_reason = null;
      }
    }
    
    // 🔍 ด่านตรวจสถานะการสมัครและการปฏิเสธจากผู้ดูแลระบบ
    if (user.memberapproved === false) {
      // 💡 เคสที่ 1: แอดมินกดปฏิเสธ (เซ็ตสถานะเป็นเท็จร่วมด้วย)
      if (user.status === false) {
        return res.status(403).json({
          error: 'ใบสมัครสมาชิกของคุณถูกปฏิเสธโดยผู้ดูแลระบบ เนื่องจากข้อมูลไม่ผ่านเกณฑ์การตรวจสอบ'
        });
      }
      
      // 💡 เคสที่ 2: เพิ่งสมัครเข้ามาและรอแอดมินอนุมัติตามปกติ
      return res.status(403).json({
        error: 'บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ กรุณารอตรวจสอบครับ'
      });
    }

    const userId = user.user_id;
    let role = 'user';
    let roleData = {};

    // 👑 3. เช็คว่าเป็น Superadmin หรือไม่
    const { data: superadmin } = await supabase
      .from('superadmin')
      .select('superadmin_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (superadmin) {
      role = 'superadmin';
      roleData = { superadmin_id: superadmin.superadmin_id };
    } else {
      // 🔧 เช็คว่าเป็น Admin ธรรมดาหรือไม่
      const { data: admin } = await supabase
        .from('admin')
        .select('admin_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (admin) {
        role = 'admin';
        roleData = { admin_id: admin.admin_id };
      } else {
        // 🏢 เช็คว่าเป็น Company หรือไม่
        const { data: company } = await supabase
          .from('company')
          .select('company_id, namecompany, description, position')
          .eq('user_id', userId)
          .maybeSingle();

        if (company) {
          role = 'company';
          roleData = {
            company_id: company.company_id,
            company_name: company.namecompany
          };
        } else {
          // 🧑‍💼 เช็คว่าเป็น Member หรือไม่
          const { data: member } = await supabase
            .from('member')
            .select('member_id, bio, skill')
            .eq('user_id', userId)
            .maybeSingle();

          if (member) {
            role = 'member';
            roleData = { member_id: member.member_id };
          }
        }
      }
    }

    // 4. ส่งข้อมูลกลับไปหา Client
    return res.json({
      role: role,
      user_id: user.user_id,
      email: user.email,
      name: user.fullname,
      phone: user.phone,
      address: user.address,
      status: user.status,
      ...roleData
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
  }
});

// =====================================================
// 🧩 Register Company
// =====================================================
router.post("/register/company", upload.fields([
  { name: 'companyLogo', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, email, password, address, phone, description, captchaToken } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "กรุณากรอกข้อมูลให้ครบ" });
    }

    // 🔒 [เช็คจุดที่ 1] ตรวจสอบห้ามมีเว้นวรรคในรหัสผ่าน
    if (password.includes(" ")) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านต้องไม่มีช่องว่างหรือการเว้นวรรค"
      });
    }

    // 🔒 [เช็คจุดที่ 2] ตรวจสอบความยาวรหัสผ่าน (ต้องไม่น้อยกว่า 8 ตัวอักษร)
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป"
      });
    }

    // 🔒 [เช็คจุดที่ 3] ตรวจสอบห้ามใช้อักขระแปลกปลอม (อนุญาตเฉพาะ A-Z, a-z, 0-9 และ !@#$%^&*()_+-=)
    const safePasswordRegex = /^[a-zA-Z0-9!@#\$%\^&\*\(\)_\+\-=]+$/;
    if (!safePasswordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านมีอักขระที่ไม่ปลอดภัย อนุญาตเฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์พื้นฐาน (!@#$%^&*()_+-=) เท่านั้น"
      });
    }

    // ตรวจสอบความปลอดภัยของรหัสผ่าน (ต้องมีพิมพ์ใหญ่และพิมพ์เล็กอย่างน้อย 1 ตัว)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านไม่ปลอดภัย ต้องประกอบด้วยตัวพิมพ์ใหญ่ (A-Z) และพิมพ์เล็ก (a-z) อย่างน้อยอย่างละ 1 ตัว"
      });
    }

    // ตรวจสอบอีเมลซ้ำ
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ success: false, error: "อีเมลนี้ถูกใช้งานแล้ว" });
    }

    // ระบบตรวจสอบ CAPTCHA
    let captchaOk = false;
    if (captchaToken === "mobile_verified_emoji") {
      captchaOk = true;
    } else {
      captchaOk = await verifyCaptcha(captchaToken);
    }

    if (!captchaOk) {
      return res.status(400).json({ success: false, error: "กรุณายืนยัน CAPTCHA ก่อนสมัครสมาชิก" });
    }

    // อัปโหลดโลโก้บริษัทและจัดการ Error อย่างเป็นระบบ
    let companyLogoUrl = "";
    if (req.files && req.files["companyLogo"]) {
      const file = req.files["companyLogo"][0];
      const fileExt = file.originalname.split(".").pop();
      const fileName = `company_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file.buffer, { contentType: file.mimetype });

      if (uploadError) {
        throw new Error(`ไม่สามารถอัปโหลดรูปโลโก้ได้: ${uploadError.message}`);
      }

      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      companyLogoUrl = publicUrlData.publicUrl;
    }

    // สร้าง User ในตาราง users
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          fullname: name,
          email: email,
          password: hashedPassword,
          address: address,
          phone: phone,
          status: true,
          memberapproved: false
        }
      ])
      .select()
      .single();

    if (userError) throw userError;

    // สร้างข้อมูลบริษัทในตาราง company
    const { data: companyData, error: companyError } = await supabase
      .from("company")
      .insert([
        {
          user_id: newUser.user_id,
          namecompany: name,
          description: description,
          position: "Recruiter",
          companyaddress: address,
          company_logo: companyLogoUrl,
          address: address,
          phone: phone
        }
      ])
      .select()
      .single();

    if (companyError) throw companyError;

    return res.status(201).json({
      success: true,
      message: "สมัครสมาชิกบริษัทสำเร็จ 🎉",
      user_id: newUser.user_id,
      role: "company",
      user: newUser,
      company: companyData,
      company_id: companyData.company_id
    });

  } catch (err) {
    console.error("❌ register company error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// 🧩 Register User
// =====================================================
router.post("/register/user", upload.fields([
  { name: "profileImage", maxCount: 1 },
  { name: "resumeFile", maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, email, password, address, phone, education, skills, resume, captchaToken } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    // 🔒 [เช็คจุดที่ 1] ตรวจสอบห้ามมีเว้นวรรคในรหัสผ่าน
    if (password.includes(" ")) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านต้องไม่มีช่องว่างหรือการเว้นวรรค"
      });
    }

    // 🔒 [เช็คจุดที่ 2] ตรวจสอบความยาวรหัสผ่าน (ต้องไม่น้อยกว่า 8 ตัวอักษร)
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป"
      });
    }

    // 🔒 [เช็คจุดที่ 3] ตรวจสอบห้ามใช้อักขระแปลกปลอม (อนุญาตเฉพาะ A-Z, a-z, 0-9 และ !@#$%^&*()_+-=)
    const safePasswordRegex = /^[a-zA-Z0-9!@#\$%\^&\*\(\)_\+\-=]+$/;
    if (!safePasswordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านมีอักขระที่ไม่ปลอดภัย อนุญาตเฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์พื้นฐาน (!@#$%^&*()_+-=) เท่านั้น"
      });
    }

    // ตรวจสอบความปลอดภัยของรหัสผ่าน (ต้องมีพิมพ์ใหญ่และพิมพ์เล็กอย่างน้อย 1 ตัว)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        error: "รหัสผ่านไม่ปลอดภัย ต้องประกอบด้วยตัวพิมพ์ใหญ่ (A-Z) และพิมพ์เล็ก (a-z) อย่างน้อยอย่างละ 1 ตัว"
      });
    }

    // ตรวจสอบอีเมลซ้ำ
    const { data: existing, error: existingError } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return res.status(400).json({ success: false, error: "อีเมลนี้ถูกใช้งานแล้ว" });
    }

    // ระบบตรวจสอบ CAPTCHA
    let captchaOk = false;
    if (captchaToken === "mobile_verified_emoji") {
      captchaOk = true;
    } else {
      captchaOk = await verifyCaptcha(captchaToken);
    }

    if (!captchaOk) {
      return res.status(400).json({ success: false, error: "กรุณายืนยัน CAPTCHA ก่อนสมัครสมาชิก" });
    }

    // จัดการอัปโหลดไฟล์รูปภาพ และ Resume ของผู้สมัครงานให้ปลอดภัยขึ้น
    let profileImageUrl = "https://via.placeholder.com/150";
    let resumeFileUrl = resume || "";

    if (req.files && req.files["profileImage"]) {
      const file = req.files["profileImage"][0];
      const fileExt = file.originalname.split(".").pop();
      const fileName = `profile_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

      if (uploadError) throw new Error(`ไม่สามารถอัปโหลดรูปโปรไฟล์ได้: ${uploadError.message}`);

      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      profileImageUrl = publicUrlData.publicUrl;
    }

    if (req.files && req.files["resumeFile"]) {
      const file = req.files["resumeFile"][0];
      const fileExt = file.originalname.split(".").pop();
      const fileName = `resume_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

      if (uploadError) throw new Error(`ไม่สามารถอัปโหลดไฟล์ Resume ได้: ${uploadError.message}`);

      const { data: publicUrlData } = supabase.storage
        .from("resumes")
        .getPublicUrl(fileName);

      resumeFileUrl = publicUrlData.publicUrl;
    }

    // บันทึกข้อมูลลงฐานข้อมูล
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          fullname: name,
          email,
          password: hashedPassword,
          address,
          phone,
          profile_image: profileImageUrl,
          resume: resumeFileUrl,
          status: true,
          memberapproved: false,
        }
      ])
      .select("*")
      .single();

    if (userError) throw userError;

    const { data: memberData, error: memberError } = await supabase
      .from("member")
      .insert([
        {
          user_id: newUser.user_id,
          bio: education || "",
          skill: skills || "",
        }
      ])
      .select()
      .single();

    if (memberError) throw memberError;

    return res.status(201).json({
      success: true,
      message: "✅ สมัครสมาชิกผู้ใช้สำเร็จ",
      user_id: newUser.user_id,
      role: "member",
      member_id: memberData.member_id,
      user: newUser,
      member: memberData,
    });
  } catch (err) {
    console.error("❌ register user error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "เกิดข้อผิดพลาดในการสมัครสมาชิกผู้ใช้",
    });
  }
});

module.exports = router;