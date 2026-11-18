const { pool } = require('../config/database');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const selectUserColumns = `u.user_id AS id, u.full_name AS fullName, u.email,
  u.phone_number AS phone, UPPER(r.role_name) AS role,
  UPPER(u.account_status) AS status, u.created_at AS createdAt,
  d.district_name AS district, v.village_name AS generalLocation`;
const userJoins = `FROM users u
  JOIN roles r ON r.role_id = u.role_id
  LEFT JOIN farmer_profiles fp ON fp.user_id = u.user_id
  LEFT JOIN villages v ON v.village_id = fp.village_id
  LEFT JOIN cells c ON c.cell_id = v.cell_id
  LEFT JOIN sectors s ON s.sector_id = c.sector_id
  LEFT JOIN districts d ON d.district_id = s.district_id`;

const listUsers = asyncHandler(async (req, res) => {
  const where = [];
  const values = [];
  const status = req.query.status?.toLowerCase();
  const role = req.query.role?.toUpperCase();
  if (status && !['active', 'suspended', 'inactive'].includes(status)) {
    return res.status(400).json({ success: false, message: 'status must be active, suspended, or inactive' });
  }
  if (role && !['FARMER', 'BUYER', 'ADMIN'].includes(role)) {
    return res.status(400).json({ success: false, message: 'role must be FARMER, BUYER, or ADMIN' });
  }
  if (status) { where.push('LOWER(u.account_status) = ?'); values.push(status); }
  if (role) { where.push('UPPER(r.role_name) = ?'); values.push(role); }
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [users] = await pool.execute(
    `SELECT ${selectUserColumns} ${userJoins} ${clause}
     ORDER BY u.user_id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
  return res.json({ success: true, data: { users, pagination: { limit, offset } } });
});

const updateStatus = asyncHandler(async (req, res) => {
  const userId = parseUserId(req.params.userId);
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status.toLowerCase() : '';
  if (!userId) return res.status(400).json({ success: false, message: 'A valid user ID is required' });
  if (!['active', 'suspended', 'inactive'].includes(nextStatus)) {
    return res.status(400).json({ success: false, message: 'status must be active, suspended, or inactive' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT u.user_id AS id, UPPER(r.role_name) AS role, LOWER(u.account_status) AS status
       FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? FOR UPDATE`, [userId]);
    const target = rows[0];
    if (!target) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    if (String(req.user.id) === String(userId) && nextStatus !== 'active') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'You cannot deactivate your own admin account' });
    }
    if (target.role === 'ADMIN' && target.status === 'active' && nextStatus !== 'active') {
      const [activeAdmins] = await connection.execute(
        `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
         WHERE UPPER(r.role_name) = 'ADMIN' AND LOWER(u.account_status) = 'active' FOR UPDATE`);
      if (activeAdmins.length <= 1) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'The last active administrator cannot be deactivated' });
      }
    }
    if (target.status === nextStatus) {
      await connection.commit();
      return res.json({ success: true, message: 'Account already has that status', data: { userId, status: nextStatus.toUpperCase() } });
    }

    await connection.execute(
      'UPDATE users SET account_status = ?, token_version = token_version + 1 WHERE user_id = ?', [nextStatus, userId]);
    const actionType = nextStatus === 'active'
      ? (target.status === 'inactive' ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_ACTIVATED')
      : (nextStatus === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_DEACTIVATED');
    await connection.execute(
      'INSERT INTO moderation_actions (admin_id, user_id, action_type, reason) VALUES (?, ?, ?, ?)',
      [req.user.id, userId, actionType, (typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : null)]);
    await connection.commit();
    return res.json({ success: true, message: 'Account status updated', data: { userId, status: nextStatus.toUpperCase() } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

const deleteUser = asyncHandler(async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) return res.status(400).json({ success: false, message: 'A valid user ID is required' });
  if (String(req.user.id) === String(userId)) {
    return res.status(409).json({ success: false, message: 'You cannot delete your own admin account' });
  }
  if (typeof req.body?.confirmEmail !== 'string' || !req.body.confirmEmail.trim()) {
    return res.status(400).json({ success: false, message: 'confirmEmail is required to permanently delete an account' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT u.user_id AS id, u.email, UPPER(r.role_name) AS role, LOWER(u.account_status) AS status
       FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? FOR UPDATE`, [userId]);
    const target = rows[0];
    if (!target) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    if (target.email.toLowerCase() !== req.body.confirmEmail.trim().toLowerCase()) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'confirmEmail does not match the account email' });
    }
    if (target.role === 'ADMIN' && target.status === 'active') {
      const [activeAdmins] = await connection.execute(
        `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
         WHERE UPPER(r.role_name) = 'ADMIN' AND LOWER(u.account_status) = 'active' FOR UPDATE`);
      if (activeAdmins.length <= 1) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'The last active administrator cannot be deleted' });
      }
    }

    const [dependencies] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM farmer_profiles fp JOIN products p ON p.farmer_id = fp.farmer_id WHERE fp.user_id = ?) AS products,
        (SELECT COUNT(*) FROM buyer_profiles bp JOIN inquiries i ON i.buyer_id = bp.buyer_id WHERE bp.user_id = ?) AS inquiries,
        (SELECT COUNT(*) FROM farmer_profiles fp JOIN inquiry_responses ir ON ir.farmer_id = fp.farmer_id WHERE fp.user_id = ?) AS responses,
        (SELECT COUNT(*) FROM listing_reports WHERE reporter_id = ?) AS reports,
        (SELECT COUNT(*) FROM moderation_actions WHERE admin_id = ? OR user_id = ?) AS auditRecords`,
      [userId, userId, userId, userId, userId, userId]);
    if (Object.values(dependencies[0]).some((count) => Number(count) > 0)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'Account has linked marketplace or audit records. Deactivate it instead to preserve history.',
      });
    }

    await connection.execute('DELETE FROM users WHERE user_id = ?', [userId]);
    await connection.commit();
    return res.json({ success: true, message: 'Account permanently deleted', data: { userId } });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ success: false, message: 'Account has linked records. Deactivate it instead to preserve history.' });
    }
    throw error;
  } finally {
    connection.release();
  }
});

module.exports = { listUsers, updateStatus, deleteUser };
