/* 权限模型
 *
 * ── 三级角色 ─────────────────────────────────────────────────────
 *   student 学生：只能读写自己的学习数据
 *   teacher 教师：对**自己名下的学生**有完全管理权限
 *   admin   管理员：系统级，可以管教师，也能管所有学生
 *
 * ── 「完全管理权限」到底覆盖什么 ─────────────────────────────────
 * 教师对自己名下的学生可以：
 *   建号 / 改资料 / 改学号 / 重置密码 / 强制下线 / 停用 / 启用 / 删除
 *   查看全部学情（作答明细、SQL 运行记录、错题、复习进度、打卡）
 *   布置作业 / 批改 / 写评语
 * 教师**不能**：
 *   管理别的教师的学生（越权）
 *   把自己提为管理员（提权）
 *   管理任何 role='teacher' 或 'admin' 的账号
 *   看到学生的密码哈希（连脱敏形式都不给）
 *
 * ── 「自己名下」怎么判定 ─────────────────────────────────────────
 *   scope(user) = 该教师创建的账号（users.created_by = teacher.id）
 *              ∪ 该教师名下班级的全部成员（class_members）
 * 两条都要，因为存在两个真实的过渡态：
 *   · 教师批量建号后还没分班 → 只有 created_by 能认领
 *   · 学生凭邀请码自己入班 → 只有 class_members 能认领
 * 少任何一条，都会出现「学生明明在我的班上，我却管不了他」。
 *
 * ── 为什么用 403 而不是 404 ─────────────────────────────────────
 * 越权访问一个不存在的 id 和一个存在但无权访问的 id，如果都返回 404，
 * 攻击者无法区分；但如果「存在的返回 403、不存在的返回 404」，
 * 403 就成了一个**存在性探测器** —— 可以拿它枚举全校学号。
 * 所以本模块统一：**无权 = 403，不存在 = 404，两者不共用分支**。
 * 换句话说，先查存在性（404），再查权限（403），顺序固定。
 */
import { db } from '../db/index.js';

export const ROLES = ['student', 'teacher', 'admin'];
export const STATUSES = ['active', 'disabled'];

export const isAdmin = (u) => u?.role === 'admin';
export const isTeacher = (u) => u?.role === 'teacher';
export const isStudent = (u) => u?.role === 'student';
/** 教学人员 = 教师或管理员。用于「能看班级/作业」这类两类都该有的能力。 */
export const isStaff = (u) => isAdmin(u) || isTeacher(u);

/** 某教师名下学生的 id 集合。管理员传 null 表示「全部」。 */
export function scopeStudentIds(actor) {
  if (isAdmin(actor)) return null; // null = 不限

  const rows = db.prepare(`
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN class_members cm ON cm.user_id = u.id
    LEFT JOIN classes c ON c.id = cm.class_id AND c.teacher_id = ?
    WHERE u.role = 'student'
      AND (u.created_by = ? OR c.id IS NOT NULL)
  `).all(actor.id, actor.id);

  return rows.map((r) => r.id);
}

/** 判断 actor 能否管理 target 这个账号。返回 null 表示可以，否则返回拒绝原因。 */
export function canManage(actor, target) {
  if (!actor || !target) return '账号不存在';

  /* 管理员：能管所有人，但**不能管自己**。
   * 「不能管自己」不是洁癖，是因为下面那些操作（停用/降级/删除）
   * 作用在自己身上会把系统搞成「没有管理员」，或者把人自己锁在门外。 */
  if (isAdmin(actor)) {
    if (target.id === actor.id) return '不能对自己执行这个操作';
    return null;
  }

  if (isTeacher(actor)) {
    // 教师只能管学生，管不了同行和管理员
    if (target.role !== 'student') return '教师只能管理学生账号';
    const ids = scopeStudentIds(actor);
    if (!ids.includes(target.id)) return '这个学生不在你的班级里';
    return null;
  }

  return '没有权限';
}

/** 这个账号能否被删除。删号是不可逆的，所以单独一道护栏。 */
export function canDelete(actor, target) {
  const base = canManage(actor, target);
  if (base) return base;

  // 不能删掉系统里最后一个管理员
  if (target.role === 'admin') {
    const n = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'active'").get().n;
    if (n <= 1) return '这是最后一个管理员，不能删除';
  }
  return null;
}

/** 这个账号能否被停用。 */
export function canDisable(actor, target) {
  const base = canManage(actor, target);
  if (base) return base;
  if (target.role === 'admin') {
    const n = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'active'").get().n;
    if (n <= 1) return '这是最后一个管理员，不能停用';
  }
  return null;
}

/** 角色白名单：谁能把别人设成什么角色。 */
export function canAssignRole(actor, role) {
  if (!ROLES.includes(role)) return '角色不合法';
  if (isAdmin(actor)) return null;
  if (isTeacher(actor)) {
    // 教师不能造教师、更不能造管理员 —— 否则一个教师账号就能自我复制权限
    if (role !== 'student') return '教师只能创建学生账号';
    return null;
  }
  return '没有权限';
}

/** 该账号能否被 actor 看到学情（比 canManage 宽：同班同学也能看排行榜，但看不到明细）。 */
export function canViewDetail(actor, target) {
  if (actor.id === target.id) return null;
  return canManage(actor, target);
}

/* ---------- 隐私边界 ----------
 * 即便有完全管理权限，也有一条线不越：**别人的密钥不是系统资产**。
 * 这个函数集中处理「用户对象脱敏」，所有对外返回 user 的接口都走它，
 * 免得哪一处漏了把 password_hash 带出去。
 */
export function shapeUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    role: r.role || 'student',
    status: r.status || 'active',
    note: r.note || '',
    realName: r.real_name || '',
    studentNo: r.student_no || '',
    avatarHue: r.avatar_hue ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastLoginAt: r.last_login_at,
  };
}
