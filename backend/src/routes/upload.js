const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const MIME_TO_EXT = {
  'image/jpeg':    'jpg',
  'image/png':     'png',
  'image/gif':     'gif',
  'image/webp':    'webp',
  'image/svg+xml': 'svg',
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── POST /image — accept base64-encoded image and write to disk ──────────────

router.post('/image', (req, res) => {
  const { data, mimeType, filename } = req.body;

  if (!data)     return res.status(400).json({ error: 'data is required' });
  if (!mimeType) return res.status(400).json({ error: 'mimeType is required' });

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({
      error: 'Unsupported file type. Allowed: jpg, png, gif, webp, svg',
    });
  }

  // Strip optional data-URI prefix (data:image/png;base64,...)
  const base64Data = data.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'File exceeds 5 MB limit' });
  }

  const ext      = MIME_TO_EXT[mimeType];
  const basename = filename
    ? path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_-]/g, '_')
    : 'upload';
  const unique   = crypto.randomBytes(8).toString('hex');
  const saveName = `${basename}-${unique}.${ext}`;
  const savePath = path.join(UPLOADS_DIR, saveName);

  try {
    fs.writeFileSync(savePath, buffer);
  } catch (err) {
    console.error('[upload] write failed:', err);
    return res.status(500).json({ error: 'Failed to save file' });
  }

  res.status(201).json({ url: `/uploads/${saveName}` });
});

module.exports = router;
