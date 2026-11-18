const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20, parts: 21, fieldNameSize: 100, fieldSize: 1024 * 1024, fieldNestingDepth: 3 },
  fileFilter(req, file, callback) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return callback(Object.assign(new Error('Upload a JPEG, PNG, or WebP image'), { status: 400 }));
    return callback(null, true);
  },
});

function uploadSingleImage(req, res, next) {
  upload.single('image')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError) error.status = 400;
      return next(error);
    }
    return next();
  });
}

module.exports = uploadSingleImage;
