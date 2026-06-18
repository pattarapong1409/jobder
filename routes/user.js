// routes/company.js
const express = require('express');
const router = express.Router();
const supabase = require('../db');

// =====================================================
// 🏢 PART 1: JOB & COMPANY
// =====================================================

// ดึงโพสต์งานทั้งหมด (แก้ใหม่)
router.get('/jobposts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('jobpost')
      .select(`
        *,
        company:company_id (
          company_id,
          namecompany,
          company_logo
        ),
        promotion (
          promotion_id,
          promotion_type,
          title,
          description,
          created_at
        )
      `)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const result = (data || []).map(post => {
      const promotions = post.promotion || [];
      const firstPromotion = promotions.length > 0 ? promotions[0] : null;

      return {
        ...post,
        display_name: post.company?.namecompany || 'บริษัท',
        image_url: post.company?.company_logo || '',

        promotions,
        is_promoted: promotions.length > 0,
        promotion_type: firstPromotion?.promotion_type || null,
        promotion_title: firstPromotion?.title || null,
        promotion_description: firstPromotion?.description || null,
      };
    });

    // ให้โพสต์ที่มีโปรโมชั่นขึ้นบนสุด
    result.sort((a, b) => {
      if (a.is_promoted && !b.is_promoted) return -1;
      if (!a.is_promoted && b.is_promoted) return 1;
      return 0;
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูล jobpost'
    });
  }
});

// ดึงรายละเอียดงาน
router.get('/job/:id', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);

  try {
    const { data: jobData, error: jobError } = await supabase
      .from('jobpost')
      .select(`
        *,
        company:company_id (
          *,
          users:user_id (
            user_id,
            fullname,
            phone,
            email,
            address,
            profile_image
          )
        )
      `)
      .eq('job_id', jobId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!jobData) return res.status(404).json({ error: 'ไม่พบข้อมูลงาน' });

    const finalData = {
      ...jobData,
      location: jobData.location || jobData.province || 'ไม่ระบุ',
      display_name: jobData.company?.namecompany || 'บริษัท',
      image_url: jobData.company?.company_logo || '',
      company: jobData.company,
      user: jobData.company?.users || null
    };

    res.json({ job: finalData });
  } catch (err) {
    console.error("💥 Server Error:", err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ค้นหางาน
router.get('/searchjobs', async (req, res) => {
  const { location, type, keyword, min_salary } = req.query;

  try {
    let query = supabase
      .from('jobpost')
      .select(`
        job_id,
        title,
        description,
        salary,
        province,
        created_at,
        company:company_id (
          company_id,
          namecompany,
          company_logo,
          users:user_id (
            email,
            phone
          )
        )
      `);

    if (location && location.trim() !== '') {
      query = query.ilike('province', `%${location.trim()}%`);
    }

    if (type && type.trim() !== '') {
      query = query.ilike('title', `%${type.trim()}%`);
    }

    if (keyword && keyword.trim() !== '') {
      const k = keyword.trim();
      query = query.or(`title.ilike.%${k}%,description.ilike.%${k}%`);
    }

    if (min_salary && !isNaN(min_salary)) {
      query = query.gte('salary', parseInt(min_salary));
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(400).json({ error: error.message });
    }

    const results = data.map(job => ({
      ...job,
      display_name: job.company?.namecompany || 'บริษัท',
      image_url: job.company?.company_logo || ''
    }));

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// =====================================================
// 👤 PART 2: USER & MEMBER POSTS (ฉบับแก้ไขบั๊ก Matching)
// =====================================================

function normalizeText(text) {
  return (text || '').toString().trim().toLowerCase();
}

router.post('/memberpost', async (req, res) => {
  const { member_id, title, description, salary, location } = req.body;

  if (!member_id || !title || !description) {
    return res.status(400).json({
      error: 'กรุณากรอกข้อมูลสำคัญให้ครบ (User ID, หัวข้อ, รายละเอียด)'
    });
  }

  try {
    // 1. บันทึกโพสต์หางานของ Member ลงในตาราง memberpost
    const { data: insertedPost, error: insertError } = await supabase
      .from('memberpost')
      .insert([
        {
          member_id: parseInt(member_id, 10),
          title,
          description,
          salary,
          location
        }
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    // 2. ทำการค้นหาตำแหน่งงานจากฝั่งบริษัท (jobpost) ที่ตรงกับคำค้นหา (Keyword)
    const keyword = normalizeText(title);

    if (keyword) {
      const { data: matchedJobs, error: matchError } = await supabase
        .from('jobpost')
        .select('job_id, company_id, title')
        .ilike('title', `%${keyword}%`);

      // 3. ตรวจสอบว่ามีงานของบริษัทไหนบ้างที่ Match ตรงกัน
      if (!matchError && matchedJobs && matchedJobs.length > 0) {
        
        // 🌟 [แก้ไขจุดสำคัญ] ปรับแต่งข้อมูล Object แจ้งเตือนให้เข้าคู่กับระบบกรองหน้าบ้าน
        const notifications = matchedJobs.map(job => ({
          company_id: job.company_id,
          member_id: parseInt(member_id, 10),
          app_id: null,
          job_id: job.job_id,
          post_id: insertedPost.post_id,
          
          // 🛠️ แก้ไขจาก 'member_match' -> เป็น 'job_match' เพื่อให้วิ่งผ่านด่าน Array Filter ของฝั่งผู้ใช้
          noti_type: 'job_match', 
          
          // ข้อความแจ้งเตือนที่ชัดเจนและสื่อสารเข้าใจง่าย
          message: `พบงานที่ตรงกับคุณ! ตำแหน่ง "${job.title}" จากบริษัทชั้นนำ เข้าดูรายละเอียดเลย`,
          
          // ตั้งค่าสถานะการอ่านให้เป็นเท็จทั้งหมด ป้องกันการหลุดสายตาจากระเบียบตรวจนับแจ้งเตือนใหม่
          is_read: false,
          company_is_read: false,
          member_is_read: false
        }));

        // 4. บันทึกชุดข้อมูลแจ้งเตือนลงในตาราง notification พร้อมกันทั้งหมด (Bulk Insert)
        const { error: notiInsertError } = await supabase
          .from('notification')
          .insert(notifications);

        if (notiInsertError) {
          console.error("❌ บันทึกแจ้งเตือน Matching ผิดพลาด:", notiInsertError.message);
        }
      }
    }

    // 5. ส่งผลลัพธ์ตอบกลับไปยังหน้าแอปพลิเคชัน Flutter
    return res.json({
      message: '✅ เพิ่มโพสต์และประมวลผลจับคู่งานสำเร็จ',
      data: insertedPost
    });

  } catch (error) {
    console.error("💥 Error ในขั้นตอน memberpost:", error.message);
    return res.status(400).json({
      error: error.message
    });
  }
});

// ดึงประวัติการโพสต์ของ Member
router.get('/userposts/:id', async (req, res) => {
  const memberId = parseInt(req.params.id, 10);
  if (isNaN(memberId)) return res.status(400).json({ error: 'ID ไม่ถูกต้อง' });

  try {
    const { data, error } = await supabase
      .from('memberpost')
      .select(`
        *,
        member:member_id (
          member_id,
          user_id,
          users:user_id (
            fullname,
            profile_image
          )
        )
      `)
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const posts = data.map(post => ({
      ...post,
      display_name: post.member?.users?.fullname || 'ผู้สมัครงาน',
      image_url: post.member?.users?.profile_image || ''
    }));

    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });


// แก้ไขข้อมูล User Profile
router.put('/user/:id', upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'resumeFile', maxCount: 1 }
]), async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  // 1. รับค่า bio (วุฒิการศึกษา) เพิ่มเติมจาก req.body
  const { fullname, phone, address, skill, bio } = req.body;

  if (isNaN(userId)) {
    return res.status(400).json({ error: 'ID ไม่ถูกต้อง' });
  }

  try {
    let profileImageUrl = null;
    let resumeFileUrl = null;

    if (req.files && req.files['profileImage']) {
      const file = req.files['profileImage'][0];
      const fileExt = file.originalname.split('.').pop();
      const fileName = `profile_${userId}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      profileImageUrl = publicUrlData.publicUrl;
    }

    if (req.files && req.files['resumeFile']) {
      const file = req.files['resumeFile'][0];
      const fileExt = file.originalname.split('.').pop();
      const fileName = `resume_${userId}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('resumes')
        .getPublicUrl(fileName);

      resumeFileUrl = publicUrlData.publicUrl;
    }

    const userUpdateData = {
      fullname,
      phone,
      address,
    };

    if (profileImageUrl) {
      userUpdateData.profile_image = profileImageUrl;
    }

    if (resumeFileUrl) {
      userUpdateData.resume = resumeFileUrl;
      userUpdateData.resume_url = resumeFileUrl;
    }

    const updateUsers = await supabase
      .from('users')
      .update(userUpdateData)
      .eq('user_id', userId);

    if (updateUsers.error) throw updateUsers.error;

    // 2. อัปเดตทั้ง skill และ bio (วุฒิการศึกษา) ลงในตาราง member พร้อมกัน
    const updateMember = await supabase
      .from('member')
      .update({ 
        skill, 
        bio // บันทึกข้อมูลวุฒิการศึกษาลงคอลัมน์ bio
      })
      .eq('user_id', userId);

    if (updateMember.error) throw updateMember.error;

    res.json({
      message: 'อัปเดตข้อมูลสำเร็จทั้ง 2 ตาราง',
      profile_image: profileImageUrl,
      resume: resumeFileUrl,
      resume_url: resumeFileUrl,
    });
  } catch (err) {
    console.error("💥 Server Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ลบโพสต์ Member
router.delete('/post/:id', async (req, res) => {
  const postId = parseInt(req.params.id, 10);

  try {
    const { error } = await supabase
      .from('memberpost')
      .delete()
      .eq('post_id', postId);

    if (error) throw error;
    res.json({ message: 'ลบโพสต์สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// แก้ไขโพสต์ Member
router.put('/post/:id', async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const { title, description, salary, location } = req.body;

  try {
    const { error } = await supabase
      .from('memberpost')
      .update({ title, description, salary, location })
      .eq('post_id', postId);

    if (error) throw error;
    res.json({ message: 'แก้ไขโพสต์สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member สมัครงาน
router.post('/api/apply-job', async (req, res) => {
  try {
    const {
      member_id,
      job_id,
      company_id,
      cover_letter,
      noti_message
    } = req.body;

    if (!member_id || !job_id) {
      return res.status(400).json({
        success: false,
        error: 'ข้อมูลไม่ครบถ้วน (member_id/job_id)'
      });
    }

    // ตรวจสอบว่าสมัครไปแล้วหรือยัง
    const { data: existingApp, error: checkError } = await supabase
      .from('application')
      .select('app_id,status')
      .eq('member_id', member_id)
      .eq('job_id', job_id)
      .maybeSingle();

    if (checkError) {
      throw checkError;
    }

    if (existingApp) {
      return res.status(400).json({
        success: false,
        error: 'คุณสมัครตำแหน่งนี้ไปแล้ว'
      });
    }

    // บันทึกใบสมัคร
    const { data: appData, error: appError } = await supabase
      .from('application')
      .insert([
        {
          member_id,
          job_id,
          status: 'pending',
          cover_letter: cover_letter || ''
        }
      ])
      .select('app_id')
      .single();

    if (appError) {
      throw appError;
    }

    // สร้างแจ้งเตือนบริษัท
    const { error: notiError } = await supabase
      .from('notification')
      .insert([
        {
          company_id,
          member_id,
          app_id: appData.app_id,
          noti_type: 'application',
          message:
            noti_message ||
            'มีผู้สมัครงานใหม่เข้ามา!',
          is_read: false
        }
      ]);

    if (notiError) {
      console.error(
        '❌ Notification Error:',
        notiError
      );
    }

    return res.status(200).json({
      success: true,
      message: 'สมัครงานสำเร็จ'
    });

  } catch (err) {
    console.error(
      '❌ Apply Job Error:',
      err
    );

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ประวัติการสมัครงานของ Member
router.get('/api/my-applications/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;

    const { data, error } = await supabase
      .from('application')
      .select(`
        app_id,
        status,
        created_at,
        jobpost:job_id (
          title,
          company:company_id (
            namecompany,
            company_logo
          )
        )
      `)
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(400).json({ error: error.message });
    }

    const result = data.map(app => ({
      ...app,
      company_name: app.jobpost?.company?.namecompany || 'บริษัท',
      image_url: app.jobpost?.company?.company_logo || ''
    }));

    res.json(result);
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงประวัติการสมัครงาน' });
  }
});

// รายละเอียดใบสมัคร
router.get('/api/application/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('application')
      .select(`
        *,
        jobpost:job_id (
          title,
          company:company_id (
            namecompany,
            companyaddress,
            company_logo
          )
        )
      `)
      .eq('app_id', id)
      .single();

    if (error) {
      console.error("❌ Supabase Error:", error);
      throw error;
    }

    res.status(200).json({
      ...data,
      company_name: data.jobpost?.company?.namecompany || 'บริษัท',
      image_url: data.jobpost?.company?.company_logo || ''
    });
  } catch (err) {
    console.error("❌ API Error:", err.message);
    res.status(500).json({ error: 'ดึงข้อมูลไม่สำเร็จ: ' + err.message });
  }
});

// ดึงข้อมูลโปรไฟล์ Member
router.get('/user/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ error: 'ID ไม่ถูกต้อง' });
  }

  try {
    const { data, error } = await supabase
      .from('member')
      .select(`
        *,
        users:user_id (
          fullname,
          email,
          phone,
          address,
          profile_image
        )
      `) // 💡 ถอด membereducation(*) ออกไปแล้ว เพราะย้ายมาใช้ bio ในตาราง member แทน
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    // 💡 เตรียมชุดข้อมูลวุฒิการศึกษาจำลอง เพื่อส่งกลับไปให้ Flutter ทำงานร่วมกับโค้ดเดิมได้
    // โดยการนำค่าข้อความจากคอลัมน์ data.bio มาครอบให้อยู่ในโครงสร้างแบบที่แอป Flutter แกะข้อมูลรอไว้
    const formattedEducation = data.bio 
      ? [{ degree: data.bio, major: '', university: '' }] 
      : [];

    res.json({
      ...data,
      fullname: data.users?.fullname || '',
      email: data.users?.email || '',
      phone: data.users?.phone || '',
      address: data.users?.address || '',
      profile_image: data.users?.profile_image || '',
      image_url: data.users?.profile_image || '',
      
      // 🎯 ส่งก้อนที่แปลงมาจากข้อความใน bio ไปแทนที่ตารางเดิม เพื่อไม่ให้ฝั่ง Flutter เกิด Error
      education_list: formattedEducation, 
    });
  } catch (err) {
    console.error('Fetch user profile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 🔔 1. เส้นดึงแจ้งเตือนฝั่งพนักงาน (กรองเฉพาะอันที่พนักงานควรเห็น)
// ============================================================================
router.get('/notifications/member/:memberId', async (req, res) => {
  const { memberId } = req.params;
  try {
    const { data, error } = await supabase
      .from('notification')
      .select(`
        *,
        jobpost:job_id (
          job_id,
          title,
          company_id,
          company:company_id (
            company_id,
            namecompany,
            company_logo
          )
        )
      `)
      .eq('member_id', memberId)
      // 🎯 แก้ไข: เพิ่ม 'application_status' เข้าไปในอาเรย์ดักกรอง
      .in('noti_type', ['job_match', 'application', 'interest', 'application_status']) 
      .order('created_at', { ascending: false });

    if (error) throw error;

    const uniqueMap = new Map();

    for (const noti of data || []) {
      const key = `${noti.member_id}_${noti.job_id}_${noti.post_id}_${noti.app_id}_${noti.noti_type}`;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          ...noti,
          member_is_read: noti.member_is_read ?? noti.is_read ?? false,
          company_is_read: noti.company_is_read ?? false,
        });
      }
    }

    res.json(Array.from(uniqueMap.values()));
  } catch (err) {
    console.error('❌ Fetch Member Notifications Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 📊 2. เส้นนับแจ้งเตือนที่ยังไม่ได้อ่าน (แก้ไขให้ครอบคลุมทุกประเภทของ Member)
// ============================================================================
router.get('/api/notifications/member/:memberId/unread-count', async (req, res) => {
  const { memberId } = req.params;

  try {
    // 1. 🟢 ยึดโค้ดเดิมของคุณเป็นหลัก: ดึงข้อมูลแจ้งเตือนทั้งหมดของสมาชิกคนนี้ที่ยังไม่ได้อ่าน
    const { data: rawNotifications, error } = await supabase
      .from('notification')
      .select('noti_id, noti_type, job_id, app_id, post_id, member_is_read, created_at')
      .eq('member_id', memberId)
      .eq('member_is_read', false); // เอาเฉพาะที่ยังไม่ได้อ่านจริง ๆ

    if (error) throw error;

    // 2. 🎯 ส่วนเสริม: ทำการกรองตัดแถวซ้ำออกด้วยตรรกะเดียวกับหน้าจอแอป ก่อนเริ่มนับจำนวน
    const uniqueMap = new Map();

    if (rawNotifications && rawNotifications.length > 0) {
      for (const noti of rawNotifications) {
        const type = noti.noti_type || '';
        const jobId = noti.job_id || '';
        const appId = noti.app_id || '';

        // ถ้าเข้าเงื่อนไขแจ้งเตือนกลุ่มที่มีตัวซ้ำ
        if (type === 'job_match' || type === 'interest' || type === 'application_status') {
          // สร้าง Key สำหรับตรวจสอบตัวซ้ำ
          const key = `${type}_${jobId}_${appId}`;
          
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, noti);
          } else {
            // ถ้าซ้ำ ให้เอาตัวที่เวลาล่าสุดกว่าเก็บไว้
            const currentDateTime = new Date(noti.created_at || 0);
            const existingDateTime = new Date(uniqueMap.get(key).created_at || 0);
            if (currentDateTime > existingDateTime) {
              uniqueMap.set(key, noti);
            }
          }
        } else {
          // สำหรับประเภทอื่น ๆ ที่ไม่เข้าข่ายซ้ำ ให้เก็บไอดีแยกเป็นเอกเทศไว้เลย
          uniqueMap.set(`other_${noti.noti_id}`, noti);
        }
      }
    }

    // 3. คำนวณจำนวนที่เหลือจากการคัดกรองตัวซ้ำแล้ว
    const finalCount = uniqueMap.size;

    // ส่งจำนวนยอดสุทธิกลับไปให้ฝั่งแอป
    res.json({ count: finalCount });

  } catch (err) {
    console.error('❌ Get Unread Count Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ✅ 3. พนักงานกดอ่านแจ้งเตือน (แก้ไขให้อ่านเฉพาะ ID นั้นๆ ไม่เหมารวมประเภท)
// ============================================================================
// ============================================================================
// ✅ พนักงานกดอ่านแจ้งเตือน (ใช้ตรรกะเดิม: เคลียร์ตัวซ้ำที่มี job_id เดียวกันเพื่อให้เลขไอคอนด้านล่างลดลง)
// ============================================================================
router.put('/api/notifications/member/read/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. ค้นหาข้อมูลกลุ่มก้อนของแจ้งเตือนไอดีนี้ก่อน
    const { data: noti, error: findError } = await supabase
      .from('notification')
      .select('member_id, job_id, post_id, noti_type')
      .eq('noti_id', id)
      .single();

    if (findError) throw findError;

    // 2. สั่งอัปเดต member_is_read = true ให้กับแจ้งเตือนประเภทเดียวกันของสมาชิกคนนี้
    let query = supabase
      .from('notification')
      .update({ member_is_read: true })
      .eq('member_id', noti.member_id)
      .eq('noti_type', noti.noti_type);

    // 3. ถ้าผูกกับ job_id หรือ post_id ให้เคลียร์ตัวซ้ำที่ผูกกับ id ชุดนี้ออกให้หมด (ตัวเลขด้านล่างจะได้ลดลงตรงกัน)
    if (noti.job_id) query = query.eq('job_id', noti.job_id);
    if (noti.post_id) query = query.eq('post_id', noti.post_id);

    const { error } = await query;
    if (error) throw error;

    return res.status(200).json({ success: true, message: 'อัปเดตสถานะการอ่านเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('❌ Member Read Notification Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ============================================================================
// ❤️ API สำหรับกด "สนใจงาน" / "ยกเลิกสนใจ" (Toggle Version) - ปรับปรุงข้อความใหม่
// ============================================================================
router.post('/api/jobs/interest', async (req, res) => {
  const { member_id, job_id, company_id, title, member_name } = req.body;

  if (!member_id || !job_id || !company_id) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    // 1. ตรวจสอบดูว่าเคยบันทึกความสนใจของคู่นี้ไว้แล้วหรือไม่
    const { data: existingNotis } = await supabase
      .from('notification')
      .select('noti_id')
      .eq('member_id', member_id)
      .eq('job_id', job_id)
      .eq('company_id', company_id)
      .eq('noti_type', 'interest');

    // 2. 🟥 เคสที่ 1: มีข้อมูลอยู่แล้ว -> ทำการ "ยกเลิกสนใจ" (ลบแจ้งเตือนที่เกี่ยวข้องออกทั้งหมด)
    if (existingNotis && existingNotis.length > 0) {
      // ดึงลิสต์ ID ทั้งหมดที่เจอเพื่อลบออกพร้อมกันทีเดียว (เคลียร์ทั้งแถวฝั่ง User และ Company)
      const notiIdsToDelete = existingNotis.map(n => n.noti_id);

      const { error: deleteError } = await supabase
        .from('notification')
        .delete()
        .in('noti_id', notiIdsToDelete);

      if (deleteError) throw deleteError;

      return res.json({ 
        success: true, 
        isInterested: false, // 👈 ส่งบอก Flutter ว่าเลิกสนใจแล้วนะ
        message: 'ยกเลิกความสนใจและลบการแจ้งเตือนเรียบร้อยแล้ว' 
      });
    }

    // 3. 🟩 เคสที่ 2: ยังไม่มีข้อมูล -> ทำการ "บันทึกความสนใจ" (สร้างข้อมูลใหม่แยก 2 ฝั่ง)
    const nameToShow = member_name || 'มีผู้ใช้งาน';
    const jobTitle = title || 'ประกาศงาน';
    
    // 🎯 ปรับแต่งข้อความใหม่ตามที่คุณต้องการสำหรับฝั่ง User และ Company
    const userMessage = `ยินดีด้วย คุณ ${nameToShow} ได้สนใจงานนี้แล้ว (${jobTitle})`;
    const companyMessage = `${nameToShow} แสดงความสนใจในตำแหน่งงาน "${jobTitle}" ของคุณ`;
    
    const { data, error } = await supabase
      .from('notification')
      .insert([
        {
          // แถวที่ 1: สำหรับส่งให้ฝั่ง User (ผู้สมัครงาน)
          company_id: company_id,
          member_id: member_id,
          job_id: job_id,
          noti_type: 'interest',
          message: userMessage,         // 👈 ใช้ข้อความที่คุณขอมา
          is_read: false,          
          company_is_read: true,        // ฝั่งบริษัทแถวนี้ไม่ต้องตรวจ
          member_is_read: false         // เด้งจุดสีแจ้งเตือนที่ฝั่ง User
        },
        {
          // แถวที่ 2: สำหรับส่งให้ฝั่ง Company (บริษัท)
          company_id: company_id,
          member_id: member_id,
          job_id: job_id,
          noti_type: 'interest',
          message: companyMessage,      // 👈 ใช้ข้อความแบบเดิมที่บริษัทอ่านไม่งง
          is_read: false,          
          company_is_read: false,       // เด้งจุดสีแจ้งเตือนที่ฝั่ง บริษัท
          member_is_read: true          // User แถวนี้อ่านแล้วเพราะเป็นคนกดเอง
        }
      ])
      .select();

    if (error) throw error;

    return res.json({
      success: true,
      isInterested: true, // 👈 ส่งบอก Flutter ว่ากดสนใจสำเร็จแล้วนะ
      message: 'บันทึกความสนใจและส่งแจ้งเตือนเรียบร้อย!',
      data: data[0] // ส่งข้อมูลแถวแรกกลับไปให้แอปใช้
    });

  } catch (err) {
    console.error("❌ Error:", err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการประมวลผลความสนใจ' });
  }
});

module.exports = router;