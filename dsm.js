#!/usr/bin/env node
// download_slack_media.js
// Requires: npm install adm-zip

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif'
]);
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm'
]);

function isMediaFilename(name) {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

function isMediaMimetype(mime) {
  if (!mime) return false;
  return mime.startsWith('image/') || mime.startsWith('video/');
}

function safeFilename(name) {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned || 'file';
}

function extFromMime(mime) {
  if (!mime) return '';
  const type = mime.split('/');
  if (type.length !== 2) return '';
  const sub = type[1].split(';')[0];
  return '.' + sub;
}

function cleanSlackUrl(rawUrl) {
  // Some exports include an expired ?token=... query param; strip it so we rely on the provided bearer token instead.
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete('token');
    url.searchParams.delete('t');
    url.searchParams.delete('pub_secret');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function walkExportDir(baseDir) {
  const jsonFiles = [];
  const binaryMediaFiles = [];

  async function walk(current) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase().endsWith('.json')) {
          jsonFiles.push(fullPath);
        } else if (isMediaFilename(entry.name)) {
          binaryMediaFiles.push(fullPath);
        }
      }
    }
  }

  await walk(baseDir);
  return { jsonFiles, binaryMediaFiles };
}

async function collectMediaFromJson(jsonPath) {
  const media = [];
  let content;
  try {
    content = await fs.promises.readFile(jsonPath, 'utf8');
  } catch {
    return media;
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return media;
  }

  if (!Array.isArray(data)) return media;

  for (const msg of data) {
    if (!msg || typeof msg !== 'object') continue;
    const files = msg.files || [];
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;

      const mime = f.mimetype;
      const name = f.name || f.title || f.id || 'file';
      const url = f.url_private_download || f.url_private;

      if (!url) continue;

      if (isMediaMimetype(mime) || isMediaFilename(name)) {
        media.push({
          url: cleanSlackUrl(url),
          name,
          mimetype: mime,
          id: f.id
        });
      }
    }
  }

  return media;
}

async function copyBinaryMedia(files, outputDir) {
  const targetRoot = path.join(outputDir, 'exported_files');
  await fs.promises.mkdir(targetRoot, { recursive: true });

  for (const src of files) {
    const relName = safeFilename(path.basename(src));
    const dst = path.join(targetRoot, relName);
    try {
      await fs.promises.copyFile(src, dst);
      console.log(`[COPY] ${src} -> ${dst}`);
    } catch (e) {
      console.error(`[COPY-ERROR] ${src}: ${e.message}`);
    }
  }
}

async function downloadMediaFromUrls(mediaEntries, token, outputDir) {
  if (!mediaEntries.length) return;

  if (!token) {
    console.log('[INFO] Media URLs found in JSON, but no --token provided. Skipping downloads.');
    return;
  }

  const targetRoot = path.join(outputDir, 'downloaded_from_urls');
  await fs.promises.mkdir(targetRoot, { recursive: true });

  const seen = new Set();

  for (const entry of mediaEntries) {
    const url = entry.url;
    if (seen.has(url)) continue;
    seen.add(url);

    let name = entry.name || entry.id || 'file';
    let ext = path.extname(name);
    if (!ext) {
      ext = extFromMime(entry.mimetype);
      if (ext) name += ext;
    }
    const outName = safeFilename(name);
    const dst = path.join(targetRoot, outName);

    console.log(`[DOWNLOAD] ${url} -> ${dst}`);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        console.error(`[DOWNLOAD-ERROR] ${url}: ${res.status} ${res.statusText}`);
        continue;
      }

      // No res.body.pipe here – just read into memory and write out
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.promises.writeFile(dst, buffer);
      console.log(`[OK] ${dst}`);
    } catch (e) {
      console.error(`[DOWNLOAD-ERROR] ${url}: ${e.message}`);
    }
  }
}


async function prepareExportDir(exportPath) {
  let stat;
  try {
    stat = await fs.promises.stat(exportPath);
  } catch {
    console.error(`Path not found: ${exportPath}`);
    process.exit(1);
  }

  if (stat.isDirectory()) return exportPath;

  if (stat.isFile() && path.extname(exportPath).toLowerCase() === '.zip') {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slack_export_'));
    console.log(`[INFO] Extracting ${exportPath} to ${tmpDir}`);
    const zip = new AdmZip(exportPath);
    zip.extractAllTo(tmpDir, true);
    return tmpDir;
  }

  console.error(`Path ${exportPath} is neither directory nor .zip file`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node download_slack_media.js <export_path> <output_dir> [--token TOKEN]');
    process.exit(1);
  }

  const exportPath = path.resolve(args[0]);
  const outputDir = path.resolve(args[1]);
  let token = '';

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--token' && i + 1 < args.length) {
      token = args[i + 1];
      i++;
    } else if (arg.startsWith('--token=')) {
      token = arg.slice('--token='.length);
    }
  }

  await fs.promises.mkdir(outputDir, { recursive: true });

  const baseDir = await prepareExportDir(exportPath);

  console.log(`[INFO] Walking export at ${baseDir}`);
  const { jsonFiles, binaryMediaFiles } = await walkExportDir(baseDir);
  console.log(`[INFO] Found ${jsonFiles.length} JSON files and ${binaryMediaFiles.length} media files in export.`);

  await copyBinaryMedia(binaryMediaFiles, outputDir);

  let allMediaEntries = [];
  for (const jf of jsonFiles) {
    const entries = await collectMediaFromJson(jf);
    if (entries.length) {
      console.log(`[INFO] ${jf}: ${entries.length} media URLs`);
      allMediaEntries = allMediaEntries.concat(entries);
    }
  }

  console.log(`[INFO] Total media URLs found in JSON: ${allMediaEntries.length}`);
  await downloadMediaFromUrls(allMediaEntries, token, outputDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
