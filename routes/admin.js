// routes/company.js (หรือชื่อไฟล์ที่คุณตั้งไว้)
const express = require('express');
const router = express.Router();
const supabase = require('../db'); // ดึง supabase จากไฟล์ db.js

// //select ข้อมูล userที่ไม่ approved
// GET /admin/users/pending
router.get('/admin/users/pending', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('user_id, fullname, email, phone, age, status, memberapproved, last_active, profile_image')
      .eq('memberapproved', false)
      .order('user_id', { ascending: false });

    if (error) throw error;

    const userIds = users.map(u => u.user_id);

    const { data: companies, error: companyError } = await supabase
      .from('company')
      .select('user_id, company_logo')
      .in('user_id', userIds);

    if (companyError) throw companyError;

    const result = users.map(user => {
      const company = companies.find(c => c.user_id === user.user_id);

      return {
        ...user,
        company_logo: company?.company_logo || null
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//แก้ไขสิทธิ์
// PATCH /admin/users/approve/:id
router.patch('/admin/users/approve/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'ID ไม่ถูกต้อง' });

  try {
    // อัปเดต memberapproved ให้เป็น true
    // (ถ้าต้องเปลี่ยน status เป็น true ด้วย ก็ใส่เพิ่มใน object เดียวกันได้เลย)
    const { data, error } = await supabase
      .from('users')
      .update({ 
        memberapproved: true,
        status: true // ถ้า status หมายถึงการเปิดใช้งานบัญชี ก็อัปเดตพร้อมกันได้เลย
      })
      .eq('user_id', userId)
      .select('user_id, email, memberapproved'); // return ข้อมูลกลับไปยืนยันนิดหน่อย

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    res.json({ message: 'อนุมัติผู้ใช้งานสำเร็จ', user: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. API สำหรับปฏิเสธผู้ใช้งาน (เปลี่ยนจากลบเป็นการบันทึกสถานะปฏิเสธ)
// ==========================================
router.put('/admin/users/reject/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'ID ไม่ถูกต้อง' });

  try {
    // 📝 เปลี่ยนจาก .delete() เป็น .update()
    // ตั้งค่า memberapproved = false และ status = false เพื่อระบุว่าถูกปฏิเสธ/ระงับการใช้งาน
    const { data, error } = await supabase
      .from('users')
      .update({ 
        memberapproved: false, 
        status: false // เราใช้ status: false ร่วมกับ memberapproved: false เป็นสัญลักษณ์ว่า "ถูกปฏิเสธ"
      })
      .eq('user_id', userId)
      .select('email, fullname');

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    res.json({ message: 'ปฏิเสธคำขอและระงับสิทธิ์ผู้ใช้งานนี้เรียบร้อยแล้ว', user: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. API ดึงข้อมูลโพสต์ (แยกตาม type: member หรือ company)
// 1. API ดึงข้อมูลโพสต์ทั้งหมด แยกตาม type: member หรือ company
// GET /admin/posts?type=company
// GET /admin/posts?type=member
router.get('/admin/posts', async (req, res) => {
  const { type } = req.query;

  try {
    if (!type || !['company', 'member'].includes(type)) {
      return res.status(400).json({
        error: 'กรุณาระบุ type เป็น company หรือ member'
      });
    }

    // ============================
    // โพสต์งานของบริษัท
    // ============================
    if (type === 'company') {
      const { data: posts, error } = await supabase
        .from('jobpost')
        .select(`
          *,
          company:company_id (
            company_id,
            user_id,
            namecompany,
            company_logo
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const result = (posts || []).map((post) => {
        return {
          ...post,
          type: 'company',
          display_name: post.company?.namecompany || 'บริษัท',
          image_url: post.company?.company_logo || '',
          sort_date: post.created_at || null,
        };
      });

      return res.json(result);
    }

    // ============================
    // โพสต์ของคนหางาน
    // ============================
    if (type === 'member') {
      const { data: posts, error } = await supabase
        .from('memberpost')
        .select(`
          *,
          member:member_id (
            member_id,
            user_id,
            users:user_id (
              user_id,
              fullname,
              profile_image
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const result = (posts || []).map((post) => {
        return {
          ...post,
          type: 'member',
          display_name: post.member?.users?.fullname || 'ผู้สมัครงาน',
          image_url: post.member?.users?.profile_image || '',
          sort_date: post.created_at || null,
        };
      });

      return res.json(result);
    }
  } catch (err) {
    console.error("❌ Fetch Posts Error:", err);

    return res.status(500).json({
      error: 'ดึงข้อมูลโพสต์ล้มเหลว',
      detail: err.message
    });
  }
});

// 2. API ลบโพสต์
router.delete('/admin/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { type } = req.query;

  try {
    if (type === 'company') {
      const { error } = await supabase
        .from('jobpost')
        .delete()
        .eq('job_id', id);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('memberpost')
        .delete()
        .eq('post_id', id);

      if (error) throw error;
    }

    return res.json({ message: 'ลบโพสต์สำเร็จ' });
  } catch (err) {
    console.error("Delete Post Error:", err);
    return res.status(500).json({ error: 'ลบโพสต์ล้มเหลว' });
  }
});

router.get('/admin/payment/user/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data, error } = await supabase
      .from('payment')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});
router.put('/admin/payment/:paymentId/approve', async (req, res) => {
  const { paymentId } = req.params;
  const { user_id } = req.body;

  try {
    await supabase
      .from('payment')
      .update({
        status: 'approved',
        approved_at: new Date()
      })
      .eq('payment_id', paymentId);

    await supabase
      .from('users')
      .update({ memberapproved: true })
      .eq('user_id', user_id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================================
// Dashboard Statistics
// GET /admin/dashboard
// ==========================================
router.get('/admin/dashboard', async (req, res) => {
  try {
    const [
      usersResult,
      companyResult,
      jobsResult,
      memberPostResult,
      applicationResult,
      pendingResult,
      paymentResult,
      notificationResult
    ] = await Promise.all([
      supabase
        .from('users')
        .select('user_id', { count: 'exact', head: true }),

      supabase
        .from('company')
        .select('company_id', { count: 'exact', head: true }),

      supabase
        .from('jobpost')
        .select('job_id', { count: 'exact', head: true }),

      supabase
        .from('memberpost')
        .select('post_id', { count: 'exact', head: true }),

      supabase
        .from('application')
        .select('app_id', { count: 'exact', head: true }),

      supabase
        .from('users')
        .select('user_id', { count: 'exact', head: true })
        .eq('memberapproved', false),

      supabase
        .from('payment')
        .select('payment_id, amount, status'),

      supabase
        .from('notification')
        .select('noti_id', { count: 'exact', head: true })
    ]);

    if (usersResult.error) throw usersResult.error;
    if (companyResult.error) throw companyResult.error;
    if (jobsResult.error) throw jobsResult.error;
    if (memberPostResult.error) throw memberPostResult.error;
    if (applicationResult.error) throw applicationResult.error;
    if (pendingResult.error) throw pendingResult.error;
    if (paymentResult.error) throw paymentResult.error;
    if (notificationResult.error) throw notificationResult.error;

    const payments = paymentResult.data || [];

    const totalRevenue = payments
      .filter((p) => p.status === 'approved')
      .reduce((sum, p) => {
        return sum + Number(p.amount || 0);
      }, 0);

    res.json({
      success: true,

      total_users: usersResult.count || 0,
      total_companies: companyResult.count || 0,
      total_jobs: jobsResult.count || 0,
      total_member_posts: memberPostResult.count || 0,
      total_applications: applicationResult.count || 0,

      pending_users: pendingResult.count || 0,
      total_notifications: notificationResult.count || 0,

      total_revenue: totalRevenue,
    });

  } catch (err) {
    console.error('Dashboard Error:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ระงับผู้ใช้
// PATCH /admin/users/suspend/:userId
// ================================
router.patch('/admin/users/suspend/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days, reason } = req.body;

    const suspendUntil = new Date();
    suspendUntil.setDate(
      suspendUntil.getDate() + (parseInt(days) || 7)
    );

    const { data, error } = await supabase
      .from('users')
      .update({
        is_suspended: true,
        suspend_until: suspendUntil.toISOString(),
        suspend_reason: reason || 'ละเมิดกฎการใช้งาน'
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    console.log(
      `🚫 Suspend User ${userId} until ${suspendUntil}`
    );

    res.json({
      success: true,
      message: 'ระงับบัญชีสำเร็จ',
      user: data
    });

  } catch (err) {
    console.error('❌ Suspend Error:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ปลดระงับผู้ใช้
// PATCH /admin/users/unsuspend/:userId
// ================================
router.patch('/admin/users/unsuspend/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('users')
      .update({
        is_suspended: false,
        suspend_until: null,
        suspend_reason: null
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Unsuspend User ${userId}`);

    res.json({
      success: true,
      message: 'ปลดระงับสำเร็จ',
      user: data
    });

  } catch (err) {
    console.error('❌ Unsuspend Error:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ผู้ใช้ทั้งหมด
// GET /admin/users/all
// ================================
// ================================
// ผู้ใช้ทั้งหมด (ยกเว้น Superadmin id: 35)
// GET /admin/users/all
// ================================
router.get('/admin/users/all', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('users')
      .select(`
        user_id,
        fullname,
        email,
        phone,
        profile_image,
        is_suspended,
        suspend_until,
        suspend_reason
      `)
      .neq('user_id', 35) // 🚨 เพิ่มบรรทัดนี้: กรองไม่ให้ดึง user_id ที่เท่ากับ 35 ออกมา
      .order('user_id', { ascending: false });

    if (error) throw error;

    res.json(data);

  } catch (err) {
    console.error('❌ Get Users Error:', err);

    res.status(500).json({
      error: err.message
    });
  }
});


module.exports = router;