const { pool } = require('../config/database');

const publicSelect = `u.user_id AS id, u.full_name AS fullName, u.email,
  u.phone_number AS phone, UPPER(r.role_name) AS role,
  UPPER(u.account_status) AS status, u.token_version AS tokenVersion,
  u.must_change_password AS mustChangePassword,
  d.district_name AS district, v.village_name AS generalLocation`;
const publicFrom = `FROM users u
  JOIN roles r ON r.role_id = u.role_id
  LEFT JOIN farmer_profiles fp ON fp.user_id = u.user_id
  LEFT JOIN villages v ON v.village_id = fp.village_id
  LEFT JOIN cells c ON c.cell_id = v.cell_id
  LEFT JOIN sectors s ON s.sector_id = c.sector_id
  LEFT JOIN districts d ON d.district_id = s.district_id`;

async function findByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT u.user_id AS id, u.full_name AS fullName, u.email,
      u.phone_number AS phone, u.password_hash AS passwordHash,
      UPPER(r.role_name) AS role, UPPER(u.account_status) AS status,
      u.token_version AS tokenVersion, u.must_change_password AS mustChangePassword
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE LOWER(u.email) = ? LIMIT 1`, [email]);
  return rows[0] || null;
}

async function findPublicById(id) {
  const [rows] = await pool.execute(`SELECT ${publicSelect} ${publicFrom} WHERE u.user_id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findByIdWithPassword(id) {
  const [rows] = await pool.execute(
    'SELECT user_id AS id, email, password_hash AS passwordHash FROM users WHERE user_id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function create({ fullName, email, phone, passwordHash, role, district, generalLocation, mustChangePassword = true }) {
  const connection = await pool.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    const [roleRows] = await connection.execute(
      'SELECT role_id FROM roles WHERE UPPER(role_name) = ? LIMIT 1', [role]);
    if (!roleRows.length) throw Object.assign(new Error(`Role ${role} is not configured`), { status: 500 });

    let villageId = null;
    if (role === 'FARMER') {
      const [villages] = await connection.execute(
        `SELECT v.village_id AS villageId
         FROM villages v
         JOIN cells c ON c.cell_id = v.cell_id
         JOIN sectors s ON s.sector_id = c.sector_id
         JOIN districts d ON d.district_id = s.district_id
         WHERE LOWER(d.district_name) = LOWER(?) AND LOWER(v.village_name) = LOWER(?)
         LIMIT 1`, [district, generalLocation]);
      if (!villages.length) {
        throw Object.assign(new Error('The supplied district and location must match a configured village'), { status: 400 });
      }
      villageId = villages[0].villageId;
    }

    const [insert] = await connection.execute(
      `INSERT INTO users (role_id, full_name, email, phone_number, password_hash, account_status, must_change_password)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [roleRows[0].role_id, fullName, email, phone, passwordHash, mustChangePassword ? 1 : 0]);
    userId = insert.insertId;

    if (role === 'FARMER') {
      await connection.execute('INSERT INTO farmer_profiles (user_id, village_id) VALUES (?, ?)', [userId, villageId]);
    } else if (role === 'BUYER') {
      await connection.execute('INSERT INTO buyer_profiles (user_id, telephone_number) VALUES (?, ?)', [userId, phone]);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return findPublicById(userId);
}

async function changePassword(id, passwordHash) {
  await pool.execute(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0 WHERE user_id = ?',
    [passwordHash, id]);
}

module.exports = { findByEmail, findPublicById, findByIdWithPassword, create, changePassword };
