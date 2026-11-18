const marketplace = require('../models/marketplaceModel');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error(`${label} must be a positive integer`), { status: 400 });
  return id;
}

function pageParams(query) {
  return {
    limit: Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100),
    offset: Math.max(Number.parseInt(query.offset, 10) || 0, 0),
  };
}

const listProducts = asyncHandler(async (req, res) => {
  const categoryId = req.query.categoryId ? parseId(req.query.categoryId, 'categoryId') : null;
  const data = await marketplace.listProducts({
    search: typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 150) : null,
    categoryId,
    district: typeof req.query.district === 'string' ? req.query.district.trim().slice(0, 100) : null,
    ...pageParams(req.query),
  });
  return res.json({ success: true, data });
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await marketplace.getProduct(parseId(req.params.productId, 'productId'));
  if (!product) return res.status(404).json({ success: false, message: 'Available product not found' });
  return res.json({ success: true, data: { product } });
});

const createInquiry = asyncHandler(async (req, res) => {
  const productId = parseId(req.params.productId, 'productId');
  const quantity = Number(req.body?.requestedQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(req.body?.requestedQuantity))) {
    return res.status(400).json({ success: false, message: 'requestedQuantity must be greater than zero with at most 2 decimal places' });
  }
  if (req.body?.message !== undefined && (typeof req.body.message !== 'string' || req.body.message.length > 5000)) {
    return res.status(400).json({ success: false, message: 'message must be at most 5000 characters' });
  }
  const result = await marketplace.createInquiry(req.user.id, productId, quantity, req.body.message?.trim());
  if (result.error) return res.status(result.status).json({ success: false, message: result.error });
  return res.status(201).json({ success: true, message: 'Inquiry submitted successfully', data: { inquiryId: result.id, status: 'pending' } });
});

const listInquiries = asyncHandler(async (req, res) => {
  const accepted = { pending: 'pending', accepted: 'accepted', declined: 'rejected', rejected: 'rejected', closed: 'closed' };
  const requested = req.query.status ? String(req.query.status).toLowerCase() : null;
  if (requested && !accepted[requested]) return res.status(400).json({ success: false, message: 'Invalid inquiry status' });
  const data = await marketplace.listBuyerInquiries(req.user.id, { status: requested ? accepted[requested] : null, ...pageParams(req.query) });
  return res.json({ success: true, data });
});

const getInquiry = asyncHandler(async (req, res) => {
  const inquiry = await marketplace.getBuyerInquiry(req.user.id, parseId(req.params.inquiryId, 'inquiryId'));
  if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found' });
  return res.json({ success: true, data: { inquiry } });
});

module.exports = { listProducts, getProduct, createInquiry, listInquiries, getInquiry };
