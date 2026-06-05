// routes/auth.js
const express = require('express');
const router = express.Router();
const supabase = require('../db'); // ดึง supabase จากไฟล์ db.js

/////////////////////////////////////////////////////////
// 🔐 Login ทำให้ user ที่จะเข้าต้อง approved ก่อนเเล้ว
////////////////////////////////////////////////////////
const bcrypt = require("bcrypt");
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: 'กรอกอีเมลและรหัสผ่านให้ครบ'
    });
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
      return res.status(401).json({
        error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    let passwordIsValid = false;

    // 2. ตรวจว่ารหัสใน DB เป็น bcrypt hash หรือยัง
    const dbPassword = user.password || '';

    if (dbPassword.startsWith('$2a$') || dbPassword.startsWith('$2b$')) {
      // รหัสใหม่แบบ hash
      passwordIsValid = await bcrypt.compare(password, dbPassword);
    } else {
      // รหัสเก่าแบบ plain text
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
      return res.status(401).json({
        error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    if (user.memberapproved === false) {
      return res.status(403).json({
        error: 'บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ กรุณารอตรวจสอบครับ'
      });
    }

    const userId = user.user_id;
    let role = 'user';
    let roleData = {};

    const { data: admin } = await supabase
      .from('admin')
      .select('admin_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (admin) {
      role = 'admin';
      roleData = {
        admin_id: admin.admin_id
      };
    } else {
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
        const { data: member } = await supabase
          .from('member')
          .select('member_id, bio, skill')
          .eq('user_id', userId)
          .maybeSingle();

        if (member) {
          role = 'member';
          roleData = {
            member_id: member.member_id
          };
        }
      }
    }

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
    return res.status(500).json({
      error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์'
    });
  }
});



const axios = require("axios");

async function verifyCaptcha(captchaToken) {
  if (!captchaToken) return false;

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
}

// =====================================================
// 🧩 Register Company
// =====================================================
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() })


router.post("/register/company", upload.fields([
  { name: 'companyLogo', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, email, password, address, phone, description, captchaToken } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "กรุณากรอกข้อมูลให้ครบ"
      });
    }

    // ==========================
    // ตรวจสอบอีเมลซ้ำจาก users
    // ==========================
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "อีเมลนี้ถูกใช้งานแล้ว"
      });
    }

    // ==========================
    // อัปโหลดโลโก้บริษัท
    // ==========================
    let companyLogoUrl = "";

    if (req.files && req.files["companyLogo"]) {
      const file = req.files["companyLogo"][0];

      const fileExt = file.originalname.split(".").pop();
      const fileName = `company_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (uploadError) {
        console.error("Company logo upload error:", uploadError.message);
      } else {
        const { data: publicUrlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(fileName);

        companyLogoUrl = publicUrlData.publicUrl;
      }
    }

    // ── 🌟 แก้ไข: เพิ่มระบบตรวจสอบ CAPTCHA สำหรับโมบายล์และเว็บ ──────────────────
    
    let captchaOk = false;
    
    // ถ้าส่งค่ามาจากแอปพลิเคชัน Flutter ด้วย Token พิเศษ ให้ผ่านได้เลย
    if (captchaToken === "mobile_verified_emoji") {
      captchaOk = true;
    } else {
      // ถ้ามาจากเว็บเวอร์ชันเดิม ให้เรียกใช้ฟังก์ชันตรวจสอบ reCAPTCHA ของ Google ปกติ
      captchaOk = await verifyCaptcha(captchaToken);
    }

    if (!captchaOk) {
      return res.status(400).json({
        success: false,
        error: "กรุณายืนยัน CAPTCHA ก่อนสมัครสมาชิก"
      });
    }

    // ────────────────────────────────────────────────────────────────────────

    // ==========================
    // สร้าง User ก่อน
    // ==========================
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

    // ==========================
    // สร้าง Company
    // ==========================
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
      user: newUser,
      user_id: newUser.user_id,
      role: "company",
      company: companyData,
      company_id: companyData.company_id
    });

  } catch (err) {
    console.error("❌ register company error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =====================================================
// 🧩 Register User
// =====================================================



// 🔗 สมัครสมาชิกผู้ใช้ + แนบรูปโปรไฟล์ + แนบเรซูเม่
router.post("/register/user", upload.fields([
  { name: "profileImage", maxCount: 1 },
  { name: "resumeFile", maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, email, password, address, phone, education, skills, resume, captchaToken } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "กรุณากรอก name, email และ password ให้ครบ",
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return res.status(400).json({
        success: false,
        error: "อีเมลนี้ถูกใช้งานแล้ว",
      });
    }

    let profileImageUrl = "https://via.placeholder.com/150";
    let resumeFileUrl = resume || "";

    if (req.files && req.files["profileImage"]) {
      const file = req.files["profileImage"][0];
      const fileExt = file.originalname.split(".").pop();
      const fileName = `profile_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) throw uploadError;

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
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("resumes")
        .getPublicUrl(fileName);

      resumeFileUrl = publicUrlData.publicUrl;
    }

    // ── 🌟 ส่วนที่แก้ไขดักจับ CAPTCHA เก่า-ใหม่ ──────────────────────────────────
    
    let captchaOk = false;
    
    // ถ้าส่งมาจากแอป Flutter (มีค่า token ตรงกัน) ให้ข้ามไปเลย
    if (captchaToken === "mobile_verified_emoji") {
      captchaOk = true;
    } else {
      // ถ้าส่งมาจากเว็บหรือที่อื่น ให้ใช้ฟังก์ชัน verifyCaptcha ตรวจสอบแบบเดิม
      captchaOk = await verifyCaptcha(captchaToken);
    }

    if (!captchaOk) {
      return res.status(400).json({
        success: false,
        error: "กรุณายืนยัน CAPTCHA ก่อนสมัครสมาชิก"
      });
    }

    // ────────────────────────────────────────────────────────────────────────

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
        },
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
        },
      ])
      .select()
      .single();

    if (memberError) throw memberError;

    res.status(201).json({
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
    res.status(500).json({
      success: false,
      error: err.message || "เกิดข้อผิดพลาดในการสมัครสมาชิกผู้ใช้",
    });
  }
});

module.exports = router;