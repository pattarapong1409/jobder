const express = require('express');
const router = express.Router();
const multer = require('multer');
const supabase = require('../db');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/payment/upload', upload.single('slip'), async (req, res) => {
  try {
    const { user_id, role, amount } = req.body;

    if (!user_id || !role) {
      return res.status(400).json({ error: 'ข้อมูล user_id หรือ role ไม่ครบ' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'กรุณาอัปโหลดสลิป' });
    }

    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `slip_${user_id}_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('payments')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from('payments')
      .getPublicUrl(fileName);

    const slipUrl = publicUrlData.publicUrl;

    const { data, error } = await supabase
      .from('payment')
      .insert([
        {
          user_id: parseInt(user_id),
          role,
          slip_url: slipUrl,
          amount: amount || 50,
          status: 'pending',
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'ส่งสลิปสำเร็จ รอแอดมินตรวจสอบ',
      payment: data,
    });
  } catch (err) {
    console.error('Payment upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;