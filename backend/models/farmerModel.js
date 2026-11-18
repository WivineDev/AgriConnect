const { pool } = require('../config/database');

const profileJoins = `FROM users u
  JOIN farmer_profiles fp ON fp.user_id = u.user_id
  LEFT JOIN villages v ON v.village_id = fp.village_id
  LEFT JOIN cells c ON c.cell_id = v.cell_id
  LEFT JOIN sectors s ON s.sector_id = c.sector_id
  LEFT JOIN districts d ON d.district_id = s.district_id`;

async function getProfile(userId) {
  const [rows] = await pool.execute(
    `SELECT u.user_id AS id, u.full_name AS fullName, u.email, u.phone_number AS phone,
      u.profile_picture_url AS profilePictureUrl, fp.farmer_id AS farmerId,
      fp.farm_description AS farmDescription, d.district_name AS district,
      v.village_name AS generalLocation, fp.village_id AS villageId
     ${profileJoins} WHERE u.user_id = ? LIMIT 1`, [userId]);
  return rows[0] || null;
}

async function updateProfile(userId, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute(
      `SELECT fp.village_id AS villageId FROM farmer_profiles fp
       JOIN users u ON u.user_id = fp.user_id WHERE u.user_id = ? FOR UPDATE`, [userId]);
    if (!existingRows.length) { await connection.rollback(); return null; }
    const profile = existingRows[0];
    const userUpdates = [];
    const userValues = [];
    for (const [key, column] of [['fullName', 'full_name'], ['email', 'email'], ['phone', 'phone_number'], ['profilePictureUrl', 'profile_picture_url']]) {
      if (data[key] !== undefined) { userUpdates.push(`\`${column}\` = ?`); userValues.push(data[key]); }
    }
    if (userUpdates.length) await connection.execute(`UPDATE users SET ${userUpdates.join(', ')} WHERE user_id = ?`, [...userValues, userId]);
    if (data.farmDescription !== undefined) {
      await connection.execute('UPDATE farmer_profiles SET farm_description = ? WHERE user_id = ?', [data.farmDescription || null, userId]);
    }
    if (data.district !== undefined || data.generalLocation !== undefined) {
      const district = data.district;
      const village = data.generalLocation;
      if (!district || !village) throw Object.assign(new Error('Both district and generalLocation are required to change location'), { status: 400 });
      const villageId = await findVillage(connection, district, village);
      if (!villageId) throw Object.assign(new Error('Location must match a configured district and village'), { status: 400 });
      await connection.execute('UPDATE farmer_profiles SET village_id = ? WHERE user_id = ?', [villageId, userId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getProfile(userId);
}

async function getDashboard(userId) {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const [summaryRows] = await pool.execute(
    `SELECT COUNT(*) AS totalProducts,
      COALESCE(SUM(p.availability_status = 'available'), 0) AS availableProducts,
      COALESCE(SUM(p.availability_status = 'unavailable'), 0) AS unavailableProducts,
      (SELECT COUNT(*) FROM inquiries i JOIN products pi ON pi.product_id = i.product_id
        WHERE pi.farmer_id = ? AND i.inquiry_status = 'pending') AS pendingInquiries,
      (SELECT COUNT(*) FROM inquiries i JOIN products pi ON pi.product_id = i.product_id
        WHERE pi.farmer_id = ? AND i.inquiry_status = 'accepted') AS acceptedInquiries,
      (SELECT COUNT(*) FROM inquiries i JOIN products pi ON pi.product_id = i.product_id
        WHERE pi.farmer_id = ? AND i.inquiry_status = 'rejected') AS declinedInquiries
     FROM products p WHERE p.farmer_id = ? AND p.archived_at IS NULL`,
    [profile.farmerId, profile.farmerId, profile.farmerId, profile.farmerId]);
  const [categoryRows] = await pool.execute(
    `SELECT c.category_id AS categoryId, c.category_name AS category,
      COUNT(p.product_id) AS total
     FROM products p JOIN categories c ON c.category_id = p.category_id
     WHERE p.farmer_id = ? AND p.archived_at IS NULL GROUP BY c.category_id, c.category_name
     ORDER BY total DESC`, [profile.farmerId]);
  const [availabilityRows] = await pool.execute(
    `SELECT availability_status AS status, COUNT(*) AS total FROM products
     WHERE farmer_id = ? AND archived_at IS NULL GROUP BY availability_status`, [profile.farmerId]);
  const [monthlyRows] = await pool.execute(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS total
     FROM products WHERE farmer_id = ? AND archived_at IS NULL
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month`, [profile.farmerId]);
  const [inquiryRows] = await pool.execute(
    `SELECT inquiry_status AS status, COUNT(*) AS total FROM inquiries i
     JOIN products p ON p.product_id = i.product_id
     WHERE p.farmer_id = ? GROUP BY inquiry_status`, [profile.farmerId]);
  return {
    farmer: { id: profile.id, fullName: profile.fullName, email: profile.email, profilePictureUrl: profile.profilePictureUrl },
    summary: summaryRows[0],
    charts: {
      productsByCategory: categoryRows,
      productAvailability: availabilityRows,
      monthlyListings: monthlyRows,
      inquiryStatuses: inquiryRows.map((row) => ({ status: row.status === 'rejected' ? 'declined' : row.status, total: row.total })),
    },
  };
}

async function listCategories() {
  const [rows] = await pool.execute('SELECT category_id AS id, category_name AS name FROM categories ORDER BY category_name');
  return rows;
}

async function getFarmerId(userId, connection = pool) {
  const [rows] = await connection.execute('SELECT farmer_id AS id, village_id AS villageId FROM farmer_profiles WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function findVillage(connection, district, village) {
  const [rows] = await connection.execute(
    `SELECT v.village_id AS id FROM villages v
     JOIN cells c ON c.cell_id = v.cell_id JOIN sectors s ON s.sector_id = c.sector_id
     JOIN districts d ON d.district_id = s.district_id
     WHERE LOWER(d.district_name) = LOWER(?) AND LOWER(v.village_name) = LOWER(?) LIMIT 1`, [district, village]);
  return rows[0]?.id || null;
}

async function listProducts(userId, { search, categoryId, availability, limit, offset }) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const where = ['p.farmer_id = ?', 'p.archived_at IS NULL'];
  const values = [farmer.id];
  if (search) { where.push('p.product_name LIKE ?'); values.push(`%${search}%`); }
  if (categoryId) { where.push('p.category_id = ?'); values.push(categoryId); }
  if (availability) { where.push('p.availability_status = ?'); values.push(availability); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM products p WHERE ${clause}`, values);
  const [products] = await pool.execute(
    `SELECT p.product_id AS id, p.product_name AS name, p.description,
      p.category_id AS categoryId, c.category_name AS category,
      p.price, p.unit_of_measurement AS unitOfMeasurement,
      p.available_quantity AS availableQuantity, p.availability_status AS availabilityStatus,
      p.village_id AS villageId, v.village_name AS generalLocation, d.district_name AS district,
      p.created_at AS createdAt, p.updated_at AS updatedAt,
      (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.image_id LIMIT 1) AS imageUrl
     FROM products p JOIN categories c ON c.category_id = p.category_id
     LEFT JOIN villages v ON v.village_id = p.village_id
     LEFT JOIN cells ce ON ce.cell_id = v.cell_id LEFT JOIN sectors s ON s.sector_id = ce.sector_id
     LEFT JOIN districts d ON d.district_id = s.district_id
     WHERE ${clause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
  return { products, total: count.total, limit, offset };
}

async function getProduct(userId, productId) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const [rows] = await pool.execute(
    `SELECT p.product_id AS id, p.product_name AS name, p.description,
      p.category_id AS categoryId, c.category_name AS category, p.price,
      p.unit_of_measurement AS unitOfMeasurement, p.available_quantity AS availableQuantity,
      p.availability_status AS availabilityStatus, p.village_id AS villageId,
      v.village_name AS generalLocation, d.district_name AS district,
      p.created_at AS createdAt, p.updated_at AS updatedAt,
      (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.image_id LIMIT 1) AS imageUrl
     FROM products p JOIN categories c ON c.category_id = p.category_id
     LEFT JOIN villages v ON v.village_id = p.village_id
     LEFT JOIN cells ce ON ce.cell_id = v.cell_id LEFT JOIN sectors s ON s.sector_id = ce.sector_id
     LEFT JOIN districts d ON d.district_id = s.district_id
     WHERE p.product_id = ? AND p.farmer_id = ? AND p.archived_at IS NULL LIMIT 1`, [productId, farmer.id]);
  return rows[0] || null;
}

async function createProduct(userId, data, imageUrl) {
  const connection = await pool.getConnection();
  let id;
  try {
    await connection.beginTransaction();
    const farmer = await getFarmerId(userId, connection);
    if (!farmer) throw Object.assign(new Error('Farmer profile not found'), { status: 404 });
    const [categories] = await connection.execute('SELECT category_id FROM categories WHERE category_id = ? LIMIT 1', [data.categoryId]);
    if (!categories.length) throw Object.assign(new Error('Product category not found'), { status: 400 });
    const villageId = data.generalLocation
      ? await findVillage(connection, data.district || '', data.generalLocation)
      : farmer.villageId;
    if (!villageId) throw Object.assign(new Error('Product location must match a configured district and village'), { status: 400 });
    const status = Number(data.quantity) <= 0 ? 'unavailable' : (data.availabilityStatus || 'available');
    const [result] = await connection.execute(
      `INSERT INTO products (farmer_id, category_id, village_id, product_name, description,
       price, unit_of_measurement, available_quantity, availability_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [farmer.id, data.categoryId, villageId, data.name.trim(), data.description || null,
        data.price, data.unit, data.quantity, status]);
    id = result.insertId;
    if (imageUrl) await connection.execute('INSERT INTO product_images (product_id, image_url) VALUES (?, ?)', [id, imageUrl]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getProduct(userId, id);
}

async function updateProduct(userId, productId, data, imageUrl) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT product_id, available_quantity, availability_status, village_id FROM products WHERE product_id = ? AND farmer_id = ? AND archived_at IS NULL FOR UPDATE',
      [productId, farmer.id]);
    if (!rows.length) { await connection.rollback(); return null; }
    const current = rows[0];
    const updates = [];
    const values = [];
    const fields = { name: 'product_name', description: 'description', price: 'price', unit: 'unit_of_measurement', quantity: 'available_quantity', categoryId: 'category_id' };
    for (const [key, column] of Object.entries(fields)) {
      if (data[key] !== undefined) { updates.push(`\`${column}\` = ?`); values.push(key === 'name' || key === 'unit' ? data[key].trim() : data[key]); }
    }
    if (data.district !== undefined || data.generalLocation !== undefined) {
      if (!data.district || !data.generalLocation) throw Object.assign(new Error('Both district and generalLocation are required to change product location'), { status: 400 });
      const villageId = await findVillage(connection, data.district, data.generalLocation);
      if (!villageId) throw Object.assign(new Error('Product location must match a configured district and village'), { status: 400 });
      updates.push('village_id = ?'); values.push(villageId);
    }
    if (data.categoryId !== undefined) {
      const [categories] = await connection.execute('SELECT category_id FROM categories WHERE category_id = ? LIMIT 1', [data.categoryId]);
      if (!categories.length) throw Object.assign(new Error('Product category not found'), { status: 400 });
    }
    const nextQuantity = data.quantity === undefined ? Number(current.available_quantity) : Number(data.quantity);
    let nextStatus = data.availabilityStatus || current.availability_status;
    if (nextQuantity <= 0) {
      nextStatus = 'unavailable';
    } else if (data.quantity !== undefined && Number(current.available_quantity) <= 0 && data.availabilityStatus === undefined) {
      nextStatus = 'available';
    }
    if (data.quantity !== undefined && nextQuantity <= 0) {
      const index = updates.indexOf('`available_quantity` = ?');
      if (index >= 0) updates.splice(index, 1), values.splice(index, 1);
      updates.push('available_quantity = 0');
    }
    if (data.availabilityStatus !== undefined || data.quantity !== undefined) {
      updates.push('availability_status = ?'); values.push(nextStatus);
    }
    if (updates.length) {
      await connection.execute(`UPDATE products SET ${updates.join(', ')} WHERE product_id = ? AND farmer_id = ?`, [...values, productId, farmer.id]);
    }
    if (imageUrl) {
      const [images] = await connection.execute('SELECT image_id FROM product_images WHERE product_id = ? ORDER BY image_id LIMIT 1', [productId]);
      if (images.length) await connection.execute('UPDATE product_images SET image_url = ? WHERE image_id = ?', [imageUrl, images[0].image_id]);
      else await connection.execute('INSERT INTO product_images (product_id, image_url) VALUES (?, ?)', [productId, imageUrl]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getProduct(userId, productId);
}

async function updateStock(userId, productId, quantity, price) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const [result] = await pool.execute(
    `UPDATE products SET available_quantity = ?,
      availability_status = IF(? <= 0, 'unavailable', 'available'),
      price = COALESCE(?, price)
     WHERE product_id = ? AND farmer_id = ? AND archived_at IS NULL`,
    [quantity, quantity, price ?? null, productId, farmer.id]);
  if (!result.affectedRows) return null;
  return getProduct(userId, productId);
}

async function archiveProduct(userId, productId) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return false;
  const [result] = await pool.execute(
    `UPDATE products SET archived_at = CURRENT_TIMESTAMP, availability_status = 'unavailable'
     WHERE product_id = ? AND farmer_id = ? AND archived_at IS NULL`, [productId, farmer.id]);
  return result.affectedRows > 0;
}

async function listInquiries(userId, { status, limit, offset }) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const where = ['p.farmer_id = ?'];
  const values = [farmer.id];
  if (status) { where.push('i.inquiry_status = ?'); values.push(status); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM inquiries i JOIN products p ON p.product_id = i.product_id WHERE ${clause}`, values);
  const [rows] = await pool.execute(
    `SELECT i.inquiry_id AS id, i.product_id AS productId, p.product_name AS productName,
      i.buyer_id AS buyerId, buyer.full_name AS buyerName, buyer.email AS buyerEmail,
      buyer.phone_number AS buyerPhone, i.requested_quantity AS requestedQuantity,
      i.message, i.inquiry_status AS status, i.created_at AS submittedAt
     FROM inquiries i JOIN products p ON p.product_id = i.product_id
     JOIN users buyer ON buyer.user_id = i.buyer_id
     WHERE ${clause} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
  return { inquiries: rows.map((row) => ({ ...row, status: row.status === 'rejected' ? 'declined' : row.status })), total: count.total, limit, offset };
}

async function getInquiry(userId, inquiryId) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const [rows] = await pool.execute(
    `SELECT i.inquiry_id AS id, i.product_id AS productId, p.product_name AS productName,
      i.buyer_id AS buyerId, buyer.full_name AS buyerName, buyer.email AS buyerEmail,
      buyer.phone_number AS buyerPhone, i.requested_quantity AS requestedQuantity,
      i.message, i.inquiry_status AS status, i.created_at AS submittedAt
     FROM inquiries i JOIN products p ON p.product_id = i.product_id
     JOIN users buyer ON buyer.user_id = i.buyer_id
     WHERE i.inquiry_id = ? AND p.farmer_id = ? LIMIT 1`, [inquiryId, farmer.id]);
  if (!rows.length) return null;
  const [responses] = await pool.execute(
    `SELECT response_id AS id, response_message AS message, response_type AS type, responded_at AS respondedAt
     FROM inquiry_responses WHERE inquiry_id = ? ORDER BY responded_at`, [inquiryId]);
  const inquiry = rows[0];
  inquiry.status = inquiry.status === 'rejected' ? 'declined' : inquiry.status;
  inquiry.responses = responses;
  return inquiry;
}

async function respondToInquiry(userId, inquiryId, action, message) {
  const farmer = await getFarmerId(userId);
  if (!farmer) return null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT i.inquiry_status AS status FROM inquiries i
       JOIN products p ON p.product_id = i.product_id
       WHERE i.inquiry_id = ? AND p.farmer_id = ? FOR UPDATE`,
      [inquiryId, farmer.id]);
    if (!rows.length) { await connection.rollback(); return null; }
    const previousStatus = rows[0].status;
    if (['accepted', 'rejected', 'closed'].includes(previousStatus) && action !== 'message') {
      throw Object.assign(new Error('This inquiry has already been resolved'), { status: 409 });
    }
    const responseType = action === 'declined' ? 'rejected' : action;
    const responseMessage = message?.trim() || (action === 'accepted' ? 'Inquiry accepted.' : action === 'declined' ? 'Inquiry declined.' : '');
    if (!responseMessage) throw Object.assign(new Error('A response message is required'), { status: 400 });
    await connection.execute(
      'INSERT INTO inquiry_responses (inquiry_id, farmer_id, response_message, response_type) VALUES (?, ?, ?, ?)',
      [inquiryId, farmer.id, responseMessage, responseType]);
    if (action === 'accepted' || action === 'declined') {
      await connection.execute('UPDATE inquiries SET inquiry_status = ? WHERE inquiry_id = ?', [responseType, inquiryId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getInquiry(userId, inquiryId);
}

module.exports = {
  getProfile, updateProfile, getDashboard, listCategories, getFarmerId, findVillage,
  listProducts, getProduct, createProduct, updateProduct, updateStock, archiveProduct,
  listInquiries, getInquiry, respondToInquiry,
};
