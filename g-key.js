const crypto = require('crypto');

let message = JSON.stringify({ 'text': 123 });
RSA(message);

async function RSA(message) {
  const keyPairA = await generateKeyPair();
  console.log('公鑰A：',　keyPairA.publicKey);
  console.log('私鑰A：',　keyPairA.privateKey);
  const keyPairB = await generateKeyPair();
  console.log('公鑰B：',　keyPairB.publicKey);
  console.log('私鑰B：',　keyPairB.privateKey);
  // B -> A
  const encryptData = encrypt(message, keyPairA.publicKey);
  console.log('加密結果：', encryptData.toString('base64'));
  let signData = sign(encryptData, keyPairB.privateKey);
  console.log('簽章結果：', signData.toString('base64'));
  try {
    const authSignData = authSign(signData, keyPairB.publicKey);
    console.log('簽章驗證：', authSignData.toString('base64'));
    let decryptedData = decrypt(authSignData, keyPairA.privateKey);
    console.log('解密結果：', JSON.parse(decryptedData.toString()));
  } catch (error) {
    console.log('解密失敗', error);
  }
};

// 加密方法
function encrypt(data, key) {
    const setting = { key };
  return crypto.publicEncrypt(setting, Buffer.from(data));
}

// 解密方法
function decrypt(encrypted, key) {
    const setting = { key };
    return crypto.privateDecrypt(setting, encrypted);
  }

// 簽章
function sign(data, key) {
    const setting = { key, padding: crypto.constants.RSA_NO_PADDING };
    return crypto.privateEncrypt(setting, Buffer.from(data));
}

// 驗證簽章
function authSign(signed, key) {
    const setting = { key, padding: crypto.constants.RSA_NO_PADDING };
    return crypto.publicDecrypt(setting, signed);
}

// 建立 KeyPair, 並單獨針對私鑰再進行一次加密
function generateKeyPair() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    }, (err, publicKey, privateKey) => {
      const keyPair = {publicKey, privateKey}
      err !== null ? reject(err) : resolve(keyPair);
    });
  });
}