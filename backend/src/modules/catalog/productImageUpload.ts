import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { AppError } from '../../utils/AppError.js';

export const productImagesDirectory = fileURLToPath(new URL('../../../uploads/product-images/', import.meta.url));

const imageTypes = {
  'image/jpeg': { extension: 'jpg', signature: (buffer: Buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: 'png', signature: (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: 'webp', signature: (buffer: Buffer) => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
} as const;

export const receiveProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!Object.hasOwn(imageTypes, file.mimetype)) {
      callback(new AppError(400, 'UNSUPPORTED_IMAGE_TYPE', 'Choose a JPEG, PNG, or WebP image.'));
      return;
    }
    callback(null, true);
  },
}).single('image');

export const saveProductImage: RequestHandler = async (req, res) => {
  const file = req.file;
  if (!file) throw new AppError(400, 'IMAGE_REQUIRED', 'Choose an image to upload.');

  const type = imageTypes[file.mimetype as keyof typeof imageTypes];
  if (!type || !type.signature(file.buffer)) {
    throw new AppError(400, 'INVALID_IMAGE', 'The selected file is not a valid JPEG, PNG, or WebP image.');
  }

  if (process.env.VERCEL) {
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    res.status(201).json({
      success: true,
      data: { imageUrl: dataUrl },
    });
    return;
  }

  try {
    const filename = `${randomUUID()}.${type.extension}`;
    await mkdir(productImagesDirectory, { recursive: true });
    await writeFile(join(productImagesDirectory, filename), file.buffer, { flag: 'wx' });

    res.status(201).json({
      success: true,
      data: { imageUrl: `/uploads/product-images/${filename}` },
    });
  } catch {
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    res.status(201).json({
      success: true,
      data: { imageUrl: dataUrl },
    });
  }
};
