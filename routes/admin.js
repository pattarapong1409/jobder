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
// 3. API สำหรับปฏิเสธและลบ User ทิ้ง (DELETE)
// ==========================================
router.delete('/admin/users/reject/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'ID ไม่ถูกต้อง' });

  try {
    // สั่งลบข้อมูลออกจากตาราง users
    const { data, error } = await supabase
      .from('users')
      .delete()
      .eq('user_id', userId)
      .select('email'); // ดึงอีเมลกลับมาเช็คว่าลบสำเร็จ

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    res.json({ message: 'ปฏิเสธและลบผู้ใช้งานสำเร็จ', user: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. API ดึงข้อมูลโพสต์ (แยกตาม type: member หรือ company)
router.get('/admin/posts', async (req, res) => {
  const { type } = req.query;

  try {
    if (type === 'company') {
      const { data: posts, error } = await supabase
        .from('jobpost')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const companyIds = posts
        .map(post => post.company_id)
        .filter(id => id !== null && id !== undefined);

      let companies = [];

      if (companyIds.length > 0) {
        const { data: companyData, error: companyError } = await supabase
          .from('company')
          .select('company_id, user_id, namecompany, company_logo')
          .in('company_id', companyIds);

        if (companyError) throw companyError;
        companies = companyData || [];
      }

      const result = posts.map(post => {
        const company = companies.find(c => c.company_id === post.company_id);

        return {
          ...post,
          type: 'company',
          display_name: company?.namecompany || 'บริษัท',
          image_url: company?.company_logo || ''
        };
      });

      return res.json(result);
    } else {
       const { data: posts, error } = await supabase
    .from('memberpost')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const memberIds = posts
    .map(post => post.member_id)
    .filter(id => id !== null && id !== undefined);

  let members = [];

  if (memberIds.length > 0) {
    const { data: memberData, error: memberError } = await supabase
      .from('member')
      .select('member_id, user_id')
      .in('member_id', memberIds);

    if (memberError) throw memberError;
    members = memberData || [];
  }

  const userIds = members
    .map(member => member.user_id)
    .filter(id => id !== null && id !== undefined);

  let users = [];

  if (userIds.length > 0) {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id, fullname, profile_image')
      .in('user_id', userIds);

    if (userError) throw userError;
    users = userData || [];
  }

  const result = posts.map(post => {
    const member = members.find(m => m.member_id === post.member_id);
    const user = users.find(u => u.user_id === member?.user_id);

    return {
      ...post,
      type: 'member',
      display_name: user?.fullname || 'ผู้สมัครงาน',
      image_url: user?.profile_image || ''
    };
  });

  return res.json(result);
    }
  } catch (err) {
    console.error("Fetch Posts Error:", err);
    return res.status(500).json({ error: 'ดึงข้อมูลโพสต์ล้มเหลว' });
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
module.exports = router;