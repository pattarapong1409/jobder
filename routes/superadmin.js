// routes/company.js (หรือชื่อไฟล์ที่คุณตั้งไว้)
const express = require('express');
const router = express.Router();
const supabase = require('../db'); // ดึง supabase จากไฟล์ db.js


// 🗑️ [หลังจากแก้ DB เป็น CASCADE แล้ว] โค้ดจะสั้นลงและทำงานได้ปลอดภัย 100%
router.delete('/superadmin/users/delete/:id', async (req, res) => {
  const cleanIdStr = req.params.id.replace(/[^0-9]/g, ''); 
  const userId = parseInt(cleanIdStr, 10);

  try {
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสผู้ใช้งาน (user_id) ให้ถูกต้อง' });
    }

    console.log(`ℹ️ Superadmin กำลังสั่งลบผู้ใช้ ID: ${userId} (ระบบฐานข้อมูลทำการ Cascade อัตโนมัติ)`);

    // สั่งลบที่ตารางหลัก 'users' เพียงที่เดียว 
    // ตัว Supabase จะตามลบข้อมูลใน payment, member, company, jobpost, application ให้เองทั้งหมดครับ
    const { data, error } = await supabase
      .from('users')
      .delete()
      .eq('user_id', userId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายชื่อผู้ใช้งานนี้ในระบบ หรืออาจถูกลบไปแล้ว' });
    }

    return res.json({ 
      success: true, 
      message: `ลบบัญชีผู้ใช้งานรหัส #${userId} และประวัติข้อมูลที่เชื่อมโยงทั้งหมดออกเรียบร้อยแล้ว`
    });

  } catch (err) {
    console.error("❌ Error permanently deleting user:", err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ในการลบผู้ใช้' });
  }
});


// ============================================================================
// 👥 [ตรวจสอบแล้วถูกต้อง] API ดึงรายชื่อผู้ใช้ทั้งหมดแยกตามประเภท สำหรับ Superadmin
// Path: GET /superadmin/users/all?type=member
// ============================================================================
router.get('/superadmin/users/all', async (req, res) => {
  const { type } = req.query; // รับค่า 'admin', 'company', หรือ 'member' จากหน้าบ้าน

  try {
    if (!type) {
      return res.status(400).json({ error: 'กรุณาระบุประเภทผู้ใช้งาน (type)' });
    }

    let query = supabase.from('users').select('*');

    // กรองข้อมูลตามประเภทผู้ใช้ โดยการนำ id ไปหาในตารางย่อย
    if (type === 'admin') {
      const { data: admins } = await supabase.from('admin').select('user_id');
      const adminIds = (admins || []).map(a => a.user_id);
      query = query.in('user_id', adminIds);
    } else if (type === 'company') {
      const { data: companies } = await supabase.from('company').select('user_id');
      const companyIds = (companies || []).map(c => c.user_id);
      query = query.in('user_id', companyIds);
    } else if (type === 'member') {
      const { data: members } = await supabase.from('member').select('user_id');
      const memberIds = (members || []).map(m => m.user_id);
      query = query.in('user_id', memberIds);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    return res.json(users || []);
  } catch (err) {
    console.error("❌ Error fetching all users:", err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้' });
  }
});

module.exports = router;