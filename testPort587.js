const nodemailer = require('nodemailer');

async function checkPort587() {
  const transporter = nodemailer.createTransport({
    host: 'mail.gigatechservices.org',
    port: 2525,
    secure: false, // true for 465, false for other ports
    auth: {
      user: 'notifications@gigatechservices.org',
      pass: 'Pu$gm;p)$7O+IzCb'
    }
  });

  try {
    const success = await transporter.verify();
    console.log('Port 2525 successful:', success);
  } catch (err) {
    console.error('Port 2525 failed:', err.message);
  }
}

checkPort587();
