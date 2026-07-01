const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  // 3D Models / CAD
  'model/gltf-binary', 'model/gltf+json', 'application/octet-stream',
  'model/obj', 'model/stl', 'model/x.stl-ascii', 'model/x.stl-binary',
  'application/sla', 'application/x-3mf', 'application/vnd.ms-3mfdocument',
  // Videos
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
]);

const EXTENSION_OVERRIDES = {
  '.glb': 'glb', '.gltf': 'gltf', '.obj': 'obj', '.stl': 'stl', '.3mf': '3mf',
  '.mp4': 'mp4', '.webm': 'webm', '.mov': 'mov', '.avi': 'avi',
};

const MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg',
  'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

const MAX_BYTES = {
  image: 5 * 1024 * 1024,   // 5 MB
  model: 50 * 1024 * 1024,  // 50 MB for CAD files
  video: 200 * 1024 * 1024, // 200 MB for video
};

function getFileCategory(mimeType, ext) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (['.glb', '.gltf', '.obj', '.stl', '.3mf'].includes(ext)) return 'model';
  return 'image';
}

// ─── POST /image — accept base64-encoded file and write to disk ──────────────

router.post('/image', requireRole('operator'), (req, res) => {
  const { data, mimeType, filename } = req.body;

  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'data is required' });
  if (!mimeType) return res.status(400).json({ error: 'mimeType is required' });

  const origExt = filename ? path.extname(filename).toLowerCase() : '';
  const category = getFileCategory(mimeType, origExt);

  // For known extensions that may come with octet-stream MIME, allow them
  const isKnownModelExt = ['.glb', '.gltf', '.obj', '.stl', '.3mf'].includes(origExt);
  const isKnownVideoExt = ['.mp4', '.webm', '.mov', '.avi'].includes(origExt);

  if (!ALLOWED_MIME_TYPES.has(mimeType) && !isKnownModelExt && !isKnownVideoExt) {
    return res.status(400).json({
      error: 'Unsupported file type. Allowed: jpg, png, gif, webp, svg, glb, gltf, obj, stl, 3mf, mp4, webm, mov',
    });
  }

  const base64Data = data.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length === 0) {
    return res.status(400).json({ error: 'data must be valid base64' });
  }
  const maxBytes = MAX_BYTES[category];
  if (buffer.length > maxBytes) {
    return res.status(400).json({ error: `File exceeds ${maxBytes / 1024 / 1024} MB limit` });
  }

  // SVGs are XML documents that browsers will execute scripts in when served
  // from our own origin (/uploads/...) — a stored-XSS vector. Reject any SVG
  // containing active content.
  if (mimeType === 'image/svg+xml') {
    const svgText = buffer.toString('utf8');
    if (/<\s*script|\bon\w+\s*=|javascript:|<\s*foreignObject|href\s*=\s*["']?\s*data:/i.test(svgText)) {
      return res.status(400).json({ error: 'SVG contains active content (scripts/event handlers) and was rejected' });
    }
  }

  // Determine extension: prefer filename ext for models/videos, else MIME map
  let ext = EXTENSION_OVERRIDES[origExt];
  if (!ext) ext = MIME_TO_EXT[mimeType] || origExt.slice(1) || 'bin';

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

  res.status(201).json({ url: `/uploads/${saveName}`, category, filename: saveName });
});

module.exports = router;
