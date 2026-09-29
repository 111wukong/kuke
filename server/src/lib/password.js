/* 口令哈希与输入校验
 *
 * scrypt 而非 bcrypt：Node 内置，不引原生编译依赖。
 * 参数 N=16384 / r=8 / p=1 —— OWASP 对交互式登录的推荐下限。
 * 每用户独立 16 字节盐，比对走 timingSafeEqual。
 *
 * ★ 为什么比对必须用 timingSafeEqual 而不是 ===：
 *   字符串 === 会在第一个不同的字节处提前返回，比较耗时因此泄漏
 *   「前几个字节猜对了」。虽然要利用它需要海量请求，但成本只有一行代码，
 *   没有理由不做。
 */
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (err, derived) => {
      if (err) return reject(err);
      resolve({ hash: derived.toString('hex'), salt: salt.toString('hex') });
    });
  });
}

export function verifyPassword(password, hashHex, saltHex) {
  return new Promise((resolve) => {
    let salt;
    let expected;
    try {
      salt = Buffer.from(saltHex, 'hex');
      expected = Buffer.from(hashHex, 'hex');
    } catch {
      return resolve(false);
    }
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (err, derived) => {
      if (err) return resolve(false);
      // 长度不等时 timingSafeEqual 会直接抛，所以先比长度
      if (derived.length !== expected.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derived, expected));
    });
  });
}

/* ---------- 输入校验 ----------
 * 返回 null 表示通过，返回字符串表示错误文案。
 * 这个「返回错误文案而不是布尔」的约定让调用方可以直接
 * `const err = checkEmail(x); if (err) return reply.code(400).send({ error: err })`，
 * 不用再维护一张错误码到中文的映射表。
 */

export function checkEmail(email) {
  if (!email) return '邮箱不能为空';
  if (email.length > 120) return '邮箱太长了';
  // 刻意不用复杂正则。RFC 5322 的完整正则没人能维护，
  // 而真正的验证是「能不能收到信」——这里只挡明显不是邮箱的输入。
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '邮箱格式不正确';
  return null;
}

export function checkUsername(name) {
  if (!name) return '昵称不能为空';
  if (name.length < 2) return '昵称至少 2 个字';
  if (name.length > 24) return '昵称最多 24 个字';
  return null;
}

export function checkPasswordStrength(pw) {
  if (!pw) return '密码不能为空';
  if (pw.length < 8) return '密码至少 8 位';
  if (pw.length > 200) return '密码太长了';
  /* 复杂度要求只留「不能全是同一类字符」。
   * 强制大小写+数字+符号的老规矩已经被 NIST SP 800-63B 明确反对 ——
   * 它把人逼向 Password1! 这种可预测的形态，实际熵还不如一个长的纯小写口令。 */
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length;
  if (kinds < 2) return '密码需要包含字母、数字或符号中的至少两类';
  return null;
}

/** 生成一个易读但足够随机的初始密码（给教师批量建号用）。 */
export function generatePassword(len = 12) {
  // 去掉了 0/O/1/l/I 这类容易抄错的字符 —— 这个口令要靠口头或纸条传递
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
