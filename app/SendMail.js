'use strict';

const nodemailer = require('nodemailer');

function _send(user, pass, msg) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.pobox.com',
    port: 465,
    secure: true,
    auth: {
      user: user,
      pass: pass,
    },
  });

  return transporter.sendMail(msg);
}

exports.send = _send;

/*
  const creds = await fs.readJson('.email-auth.json');
  const msg = {
    from: '"Fred Foo 👻" <pete.lepage@pobox.com>', // sender address
    to: 'petele+btg-deploy@gmail.com', // list of receivers
    subject: 'Hello ✔', // Subject line
    text: _output, // plain text body
  };
  return sendMail.send(creds.user, creds.pass, msg);
*/
