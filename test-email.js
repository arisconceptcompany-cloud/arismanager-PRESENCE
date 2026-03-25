const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'sarobidyf036@gmail.com',
    pass: 'aslojgloifjruolp'
  }
});

transporter.sendMail({
  from: '"ARIS" <sarobidyf036@gmail.com>',
  to: 'test@example.com',
  subject: 'Test',
  text: 'Test email'
}, (err, info) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log('Sent:', info.messageId);
  }
});
