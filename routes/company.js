// routes/company.js
const express = require('express');
const router = express.Router();
const supabase = require('../db');

// 📂 ดึงโพสต์งานของบริษัทตัวเอง
router.get('/selectjobposts', async (req, res) => {
  const { company_id } = req.query;

  if (!company_id) {
    return res.status(400).json({ error: 'Company ID is required' });
  }

  try {
    const { data, error } = await supabase
      .from('jobpost')
      .select(`
        *,
        company:company_id (
          company_id,
          namecompany,
          company_logo
        )
      `)
      .eq('company_id', company_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(400).json({ error: error.message });
    }

    const jobposts = data.map(post => ({
      ...post,
      display_name: post.company?.namecompany || 'บริษัท',
      image_url: post.company?.company_logo || ''
    }));

    res.json({ jobposts });
  } catch (err) {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ดึงข้อมูลบริษัท
router.get('/company/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('company')
      .select(`
        *,
        users:user_id (
          fullname,
          email,
          phone,
          address,
          profile_image
        )
      `)
      .eq('company_id', id)
      .single();

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(400).json({ error: error.message });
    }

    res.json({
      ...data,
      image_url: data.company_logo || '',
      user_profile_image: data.users?.profile_image || ''
    });
  } catch (err) {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/// 📍 ดึงโพสต์ของคนหางานทั้งหมด ให้บริษัทเห็น
router.get('/userposts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('memberpost')
      .select(`
        post_id,
        member_id,
        title,
        description,
        created_at,
        salary,
        location,
        member:member_id (
          member_id,
          user_id,
          users:user_id (
            fullname,
            email,
            phone,
            profile_image,
            resume
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(400).json({ error: error.message });
    }

    const formattedData = data.map(post => ({
      post_id: post.post_id,
      member_id: post.member_id,
      title: post.title,
      description: post.description,
      salary: post.salary,
      location: post.location,
      created_at: post.created_at,
      poster_name: post.member?.users?.fullname || 'ไม่ระบุชื่อ',
      poster_email: post.member?.users?.email || '-',
      poster_phone: post.member?.users?.phone || '-',
      image_url: post.member?.users?.profile_image || '',
      resume: post.member?.users?.resume || '',
      resume_url: post.member?.users?.resume || ''
    }));

    res.json(formattedData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ➕ เพิ่มโพสต์งานใหม่ของบริษัท + แจ้งเตือนพนักงานที่หาโพสต์ตำแหน่งใกล้เคียง
// ➕ เพิ่มโพสต์งานใหม่ของบริษัท + แจ้งเตือนพนักงานที่หาโพสต์ตำแหน่งใกล้เคียง
router.post('/jobpost', async (req, res) => {
  const {
    company_id,
    title,
    description,
    salary,
    province,
    experience,
    age,
    sex
  } = req.body;

  if (!company_id || !title || !salary) {
    return res.status(400).json({
      success: false,
      error: 'กรุณากรอกข้อมูล company_id, title และ salary'
    });
  }

  try {
    const { data, error } = await supabase
      .from('jobpost')
      .insert([
        {
          company_id: parseInt(company_id),
          title,
          description,
          salary,
          province,
          experience,
          age,
          sex
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('❌ Insert Jobpost Error:', error);
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    const insertedJob = data;
    const keyword = (title || '').toString().trim().toLowerCase();

    try {
      if (keyword) {
        const { data: matchedMemberPosts, error: matchError } = await supabase
          .from('memberpost')
          .select('post_id, member_id, title')
          .ilike('title', `%${keyword}%`);

        if (matchError) {
          console.error('❌ Match Memberpost Error:', matchError.message);
        }

        if (!matchError && matchedMemberPosts && matchedMemberPosts.length > 0) {
          for (const post of matchedMemberPosts) {
            const { data: existingNoti, error: checkError } = await supabase
              .from('notification')
              .select('noti_id')
              .eq('company_id', parseInt(company_id))
              .eq('member_id', post.member_id)
              .eq('job_id', insertedJob.job_id)
              .eq('post_id', post.post_id)
              .eq('noti_type', 'job_match')
              .maybeSingle();

            if (checkError) {
              console.error('❌ Check Duplicate Notification Error:', checkError.message);
              continue;
            }

            if (!existingNoti) {
              const { error: notiError } = await supabase
                .from('notification')
                .insert([
                  {
                    company_id: parseInt(company_id),
                    member_id: post.member_id,
                    app_id: null,
                    job_id: insertedJob.job_id,
                    post_id: post.post_id,
                    noti_type: 'job_match',
                    message: `มีงานใหม่ตำแหน่ง "${title}" ที่ตรงกับโพสต์หางานของคุณ`,
                    is_read: false,
                    member_is_read: false,
                    company_is_read: false
                  }
                ]);

              if (notiError) {
                console.error('❌ Insert Notification Error:', notiError.message);
              }
            }
          }
        }
      }
    } catch (notiErr) {
      console.error('❌ Notification Process Error:', notiErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'โพสต์งานเรียบร้อยแล้ว',
      data: insertedJob
    });
  } catch (err) {
    console.error('❌ Jobpost API Error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// 🔍 ค้นหาโพสต์ของคนหางาน
router.get('/searchuserposts', async (req, res) => {
  const { location, education, skills, keyword } = req.query;

  if (
    (!location || location.trim() === '') &&
    (!education || education.trim() === '') &&
    (!skills || skills.trim() === '') &&
    (!keyword || keyword.trim() === '')
  ) {
    return res.json({ results: [] });
  }

  try {
    let query = supabase
      .from('memberpost')
      .select(`
        post_id,
        member_id,
        title,
        description,
        created_at,
        salary,
        location,
        member:member_id!inner (
          member_id,
          skill,
          users:user_id!inner (
            fullname,
            address,
            email,
            phone,
            status,
            profile_image
          ),
          membereducation ( * )
        )
      `)
      .eq('member.users.status', true);

    if (location && location.trim() !== '') {
      query = query.ilike('member.users.address', `%${location.trim()}%`);
    }

    if (skills && skills.trim() !== '') {
      query = query.ilike('member.skill', `%${skills.trim()}%`);
    }

    if (keyword && keyword.trim() !== '') {
      const kw = keyword.trim();
      query = query.or(`title.ilike.%${kw}%,description.ilike.%${kw}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase Search Error:", error.message);
      return res.status(400).json({ error: error.message });
    }

    const results = data.map(post => ({
      post_id: post.post_id,
      member_id: post.member_id,
      title: post.title,
      description: post.description,
      created_at: post.created_at,
      salary: post.salary,
      location: post.location,
      image_url: post.member?.users?.profile_image || '',
      user: {
        name: post.member?.users?.fullname,
        address: post.member?.users?.address,
        email: post.member?.users?.email,
        phone: post.member?.users?.phone,
        skills: post.member?.skill,
        education: post.member?.membereducation,
        image_url: post.member?.users?.profile_image || ''
      }
    }));

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการค้นหาโพสต์ผู้ใช้' });
  }
});

// 🔔 ดึงแจ้งเตือนทั้งหมดของบริษัท
router.get('/api/notifications/company/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    const { data, error } = await supabase
      .from('notification')
      .select(`
        *,
        member:member_id (
          member_id,
          user_id,
          users:user_id (
            fullname,
            email,
            phone,
            profile_image,
            resume
          )
        ),
        application:app_id (
          app_id,
          job_id,
          member_id,
          cover_letter,
          status,
          created_at,
          jobpost:job_id (
            title
          )
        )
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const result = data.map(noti => ({
      ...noti,

      member_name: noti.member?.users?.fullname || 'ผู้สมัครงาน',
      poster_name: noti.member?.users?.fullname || 'ผู้สมัครงาน',

      poster_email: noti.member?.users?.email || '-',
      email: noti.member?.users?.email || '-',

      poster_phone: noti.member?.users?.phone || '-',
      phone: noti.member?.users?.phone || '-',

      image_url: noti.member?.users?.profile_image || '',
      profile_image: noti.member?.users?.profile_image || '',

      resume: noti.member?.users?.resume || '',
      resume_url: noti.member?.users?.resume || '',

      cover_letter:
        noti.application?.cover_letter ||
        noti.message ||

        '',

      job_title:
        noti.application?.jobpost?.title ||
        noti.jobpost?.title ||
        'ตำแหน่งงาน',
    }));

    res.status(200).json(result);
  } catch (err) {
    console.error("❌ Fetch Notification Error:", err);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลแจ้งเตือนได้' });
  }
});

// ✅ พนักงานกดอ่านแจ้งเตือน
router.put('/api/notifications/member/read/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('notification')
      .update({ member_is_read: true })
      .eq('noti_id', id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Member Read Notification Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// อัปเดตสถานะใบสมัคร
router.put('/api/application/status/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const {
      status,
      interview_date,
      interviewDate,
      contact_method,
      contactMethod,
      company_message,
      companyMessage,
      note,
      message
    } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาส่ง status'
      });
    }

    const updateData = {
      status
    };

    if (interview_date || interviewDate) {
      updateData.interview_date = interview_date || interviewDate;
    }

    if (contact_method || contactMethod) {
      updateData.contact_method = contact_method || contactMethod;
    }

    if (company_message || companyMessage || note || message) {
      updateData.company_message =
        company_message || companyMessage || note || message;
    }

    const { data, error } = await supabase
      .from('application')
      .update(updateData)
      .eq('app_id', id)
      .select('*')
      .single();

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: 'อัปเดตสถานะใบสมัครสำเร็จ',
      application: data
    });
  } catch (err) {
    console.error('❌ Update Application Status Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ดึงข้อมูลใบสมัคร
router.get('/api/application/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('application')
      .select(`
        *,
        jobpost:job_id(
          *,
          company:company_id(
            company_id,
            namecompany,
            company_logo,
            companyaddress,
            email,
            phone
          )
        ),
        member:member_id(
          member_id,
          user_id,
          users:user_id(
            fullname,
            email,
            phone,
            profile_image,
            resume
          )
        )
      `)
      .eq('app_id', id)
      .single();

    if (error) throw error;

    res.status(200).json({
      ...data,

      member_name: data.member?.users?.fullname || 'ผู้สมัครงาน',
      member_email: data.member?.users?.email || '-',
      member_phone: data.member?.users?.phone || '-',
      image_url: data.jobpost?.company?.company_logo || '',
      resume: data.member?.users?.resume || '',
      resume_url: data.member?.users?.resume || '',

      company_name: data.jobpost?.company?.namecompany || 'ไม่ระบุบริษัท',
      company_logo: data.jobpost?.company?.company_logo || '',
      company_address: data.jobpost?.company?.companyaddress || '',
      company_email: data.jobpost?.company?.email || '',
      company_phone: data.jobpost?.company?.phone || '',

      interview_date: data.interview_date || '',
      contact_method: data.contact_method || '',
      company_message: data.company_message || '',
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.put('/company/:id', upload.fields([
  { name: 'companyLogo', maxCount: 1 }
]), async (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  const { namecompany, email, phone, companyaddress, description } = req.body;

  if (isNaN(companyId)) {
    return res.status(400).json({ error: 'ID บริษัทไม่ถูกต้อง' });
  }

  try {
    let companyLogoUrl = null;

    if (req.files && req.files['companyLogo']) {
      const file = req.files['companyLogo'][0];
      const fileExt = file.originalname.split('.').pop();
      const fileName = `company_${companyId}_${Date.now()}.${fileExt}`;

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

      companyLogoUrl = publicUrlData.publicUrl;
    }

    const updateData = {
      namecompany,
      phone,
      companyaddress,
      description,
    };

    if (companyLogoUrl) {
      updateData.company_logo = companyLogoUrl;
    }

    const { data, error } = await supabase
      .from('company')
      .update(updateData)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;

    if (email) {
      await supabase
        .from('users')
        .update({ email, phone })
        .eq('user_id', data.user_id);
    }

    res.json({
      message: 'อัปเดตข้อมูลบริษัทสำเร็จ',
      company: data,
      company_logo: companyLogoUrl,
    });
  } catch (err) {
    console.error('Update company error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// นับแจ้งเตือนยังไม่อ่านของบริษัท
router.get('/api/notifications/company/:companyId/unread-count', async (req, res) => {
  const { companyId } = req.params;

  try {
    const { count, error } = await supabase
      .from('notification')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('company_is_read', false);

    if (error) throw error;

    res.json({ count: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/jobpost/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, salary, province, experience, age, sex } = req.body;

    const { data, error } = await supabase
      .from('jobpost')
      .update({ title, description, salary, province, experience, age, sex })
      .eq('job_id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/jobpost/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // ลบแจ้งเตือนที่เกี่ยวกับโพสต์นี้ก่อน
    const { error: notiError } = await supabase
      .from('notification')
      .delete()
      .eq('job_id', id);

    if (notiError) throw notiError;

    // ลบใบสมัครที่เกี่ยวกับโพสต์นี้
    const { error: appError } = await supabase
      .from('application')
      .delete()
      .eq('job_id', id);

    if (appError) throw appError;

    // ลบโพสต์งาน
    const { error: jobError } = await supabase
      .from('jobpost')
      .delete()
      .eq('job_id', id);

    if (jobError) throw jobError;

    return res.status(200).json({
      success: true,
      message: 'ลบโพสต์สำเร็จ'
    });

  } catch (err) {
    console.error('Delete Jobpost Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.put('/api/notifications/company/read/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🔥 COMPANY READ ROUTE HIT:', id);

    const { error } = await supabase
      .from('notification')
      .update({ company_is_read: true })
      .eq('noti_id', id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Company Read Notification Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;