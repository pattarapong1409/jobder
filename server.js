// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// นำเข้า Routes ที่เราแยกไฟล์ไว้
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const companyRoutes = require('./routes/company');
const adminRoutes = require('./routes/admin'); // 👈 1. เพิ่มบรรทัดนี้
const paymentRoutes = require('./routes/payment');
const forgotPasswordRoutes = require('./routes/forgot_password');


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // 🔥 เพิ่มบรรทัดนี้เพื่อรองรับการดึงข้อมูลจาก Multipart

// 🌐 Route ทดสอบ
app.get('/', (req, res) => res.send('✅ Jobder Backend Running...'));

// 🔗 เชื่อมต่อ Routes เข้ากับ App
app.use(authRoutes); // เรียกใช้เส้นทาง Login/Register
app.use(userRoutes); // เรียกใช้เส้นทาง User
app.use(companyRoutes);  // เรียกใช้เส้นทาง Job
app.use(adminRoutes); //เรียกใช้เส้นทาง admin

app.use(paymentRoutes);
app.use(forgotPasswordRoutes);
// 🔥 เริ่มต้นเซิร์ฟเวอร์
app.listen(PORT, () => console.log(`✅ Server ทำงานอยู่ที่พอร์ต ${PORT}`));