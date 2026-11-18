const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const uploadRoot = path.resolve(__dirname, '..', 'uploads');

function detectImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function saveUploadedImage(file, folder = 'products') {
  if (!file) return null;
  if (!['products', 'profiles'].includes(folder)) throw new Error('Unsupported image folder');
  const extension = detectImage(file.buffer);
  if (!extension) throw Object.assign(new Error('Image contents are not a valid JPEG, PNG, or WebP file'), { status: 400 });
  const directory = path.join(uploadRoot, folder);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(directory, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${folder}/${filename}`;
}

async function removeUploadedImage(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/uploads/')) return;
  const imagePath = path.resolve(uploadRoot, imageUrl.slice('/uploads/'.length));
  if (!imagePath.startsWith(`${uploadRoot}${path.sep}`)) return;
  await fs.unlink(imagePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

module.exports = { saveUploadedImage, removeUploadedImage };
