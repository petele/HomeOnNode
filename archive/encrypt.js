// Nodejs encryption with GCM
// Does not work with nodejs v0.10.31
// Part of https://github.com/chris-rock/node-crypto-examples

var crypto = require('crypto'),
  algorithm = 'aes-256-gcm',
  password = '3zTvzr3p67VC61jmV54rIYu1545x4TlY',
  // do not use a global iv for production,
  // generate a new one for each encryption
  iv = Date.now().toString()

function encrypt(text) {
  var cipher = crypto.createCipheriv(algorithm, password, iv)
  var encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex');
  var tag = cipher.getAuthTag();
  return {
    content: encrypted,
    tag: tag
  };
}

function decrypt(encrypted) {
  var decipher = crypto.createDecipheriv(algorithm, password, iv)
  decipher.setAuthTag(encrypted.tag);
  var dec = decipher.update(encrypted.content, 'hex', 'utf8')
  dec += decipher.final('utf8');
  return dec;
}

var hw = encrypt("aab")
// console.log('hw', hw);

let shw = JSON.stringify(hw);
console.log('shw', shw);
let jshw = JSON.parse(shw, (key, value) => {
  return value && value.type === 'Buffer' ?
    Buffer.from(value.data) : value;
});
// console.log('dshw', jshw);

  // outputs hello world
// console.log('d - hw', decrypt(hw));


console.log('d - shw', decrypt(jshw));
