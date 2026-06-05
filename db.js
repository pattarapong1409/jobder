// db.js config suprabase
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://xajhzmwiinuhsssjgcoo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhamh6bXdpaW51aHNzc2pnY29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAyNjQwNjQsImV4cCI6MjA3NTg0MDA2NH0.NtnEXlMWJrtk5b-0hBxLzKG1_AHZMYyLrTN7nF59lKg'
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase; // ส่งออกไปให้ไฟล์อื่นใช้