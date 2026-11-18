const { pool } = require('../config/database');

const productSelect = `SELECT p.product_id AS id, p.product_name AS name, p.description,
  p.category_id AS categoryId, c.category_name AS category, p.price,
  p.unit_of_measurement AS unitOfMeasurement, p.available_quantity AS availableQuantity,
  p.availability_status AS availabilityStatus, p.created_at AS createdAt,
  v.village_name AS generalLocation, d.district_name AS district,
  f.user_id AS farmerUserId, f.full_name AS farmerName, f.email AS farmerEmail,
  f.phone_number AS farmerPhone,
  (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.image_id LIMIT 1) AS imageUrl
  FROM products p JOIN categories c ON c.category_id = p.category_id
  JOIN farmer_profiles fp ON fp.farmer_id = p.farmer_id
  JOIN users f ON f.user_id = fp.user_id
  LEFT JOIN villages v ON v.village_id = p.village_id
  LEFT JOIN cells ce ON ce.cell_id = v.cell_id
  LEFT JOIN sectors s ON s.sector_id = ce.sector_id
  LEFT JOIN districts d ON d.district_id = s.district_id`;

async function listProducts({ search, categoryId, district, limit, offset }) {
  const where = ["p.archived_at IS NULL", "p.availability_status = 'available'", 'p.available_quantity > 0',
    "EXISTS (SELECT 1 FROM farmer_profiles ownerProfile JOIN users owner ON owner.user_id = ownerProfile.user_id WHERE ownerProfile.farmer_id = p.farmer_id AND LOWER(owner.account_status) = 'active')"];
  const values = [];
  if (search) { where.push('p.product_name LIKE ?'); values.push(`%${search}%`); }
  if (categoryId) { where.push('p.category_id = ?'); values.push(categoryId); }
  if (district) { where.push('LOWER(d.district_name) = LOWER(?)'); values.push(district); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM products p LEFT JOIN villages v ON v.village_id = p.village_id
     LEFT JOIN cells ce ON ce.cell_id = v.cell_id LEFT JOIN sectors s ON s.sector_id = ce.sector_id
     LEFT JOIN districts d ON d.district_id = s.district_id WHERE ${clause}`, values);
  const [products] = await pool.execute(
    `${productSelect} WHERE ${clause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
  return { products, total: count.total, limit, offset };
}

async function getProduct(productId) {
  const [rows] = await pool.execute(
    `${productSelect} WHERE p.product_id = ? AND p.archived_at IS NULL
     AND p.availability_status = 'available' AND p.available_quantity > 0
     AND LOWER(f.account_status) = 'active' LIMIT 1`, [productId]);
  return rows[0] || null;
}

async function createInquiry(buyerId, productId, quantity, message) {
  const [products] = await pool.execute(
    `SELECT product_id, available_quantity FROM products
     WHERE product_id = ? AND archived_at IS NULL AND availability_status = 'available'`, [productId]);
  if (!products.length) return { error: 'Product is not available', status: 404 };
  if (Number(quantity) > Number(products[0].available_quantity)) {
    return { error: 'Requested quantity exceeds current available stock', status: 409 };
  }
  const [result] = await pool.execute(
    `INSERT INTO inquiries (product_id, buyer_id, requested_quantity, message, inquiry_status)
     VALUES (?, ?, ?, ?, 'pending')`, [productId, buyerId, quantity, message || null]);
  return { id: result.insertId };
}

async function listBuyerInquiries(buyerId, { status, limit, offset }) {
  const where = ['i.buyer_id = ?'];
  const values = [buyerId];
  if (status) { where.push('i.inquiry_status = ?'); values.push(status); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM inquiries i WHERE ${clause}`, values);
  const [inquiries] = await pool.execute(
    `SELECT i.inquiry_id AS id, i.product_id AS productId, p.product_name AS productName,
      i.requested_quantity AS requestedQuantity, i.message,
      i.inquiry_status AS status, i.created_at AS submittedAt,
      f.full_name AS farmerName
     FROM inquiries i JOIN products p ON p.product_id = i.product_id
     JOIN farmer_profiles fp ON fp.farmer_id = p.farmer_id
     JOIN users f ON f.user_id = fp.user_id WHERE ${clause}
     ORDER BY i.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
  return { inquiries: inquiries.map((row) => ({ ...row, status: row.status === 'rejected' ? 'declined' : row.status })), total: count.total, limit, offset };
}

async function getBuyerInquiry(buyerId, inquiryId) {
  const [rows] = await pool.execute(
    `SELECT i.inquiry_id AS id, i.product_id AS productId, p.product_name AS productName,
      i.requested_quantity AS requestedQuantity, i.message, i.inquiry_status AS status,
      i.created_at AS submittedAt, f.full_name AS farmerName
     FROM inquiries i JOIN products p ON p.product_id = i.product_id
     JOIN farmer_profiles fp ON fp.farmer_id = p.farmer_id
     JOIN users f ON f.user_id = fp.user_id
     WHERE i.inquiry_id = ? AND i.buyer_id = ? LIMIT 1`, [inquiryId, buyerId]);
  if (!rows.length) return null;
  const [responses] = await pool.execute(
    `SELECT response_id AS id, response_message AS message, response_type AS type, responded_at AS respondedAt
     FROM inquiry_responses WHERE inquiry_id = ? ORDER BY responded_at`, [inquiryId]);
  const inquiry = rows[0];
  if (inquiry.status === 'rejected') inquiry.status = 'declined';
  inquiry.responses = responses;
  return inquiry;
}

module.exports = { listProducts, getProduct, createInquiry, listBuyerInquiries, getBuyerInquiry };
