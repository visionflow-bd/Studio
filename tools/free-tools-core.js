"use strict";
((root) => {
  const MAX_TEXT = 2 * 1024 * 1024;
  function parseTime(value) {
    const match = String(value).match(/^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[,.](\d{3})$/);
    if (!match) throw new Error("Use subtitle timestamps such as 00:01:02,500 or 01:02.500.");
    const ms = ((Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) + Number(match[4]);
    if (!Number.isSafeInteger(ms)) throw new Error("Subtitle timestamp is too large.");
    return ms;
  }
  function formatTime(ms, vtt) {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("Invalid subtitle time.");
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms % 3600000 / 60000)).padStart(2, "0")}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}${vtt ? "." : ","}${String(ms % 1000).padStart(3, "0")}`;
  }
  function convertSubtitles(raw, offsetSeconds, format) {
    if (!["srt", "vtt"].includes(format)) throw new Error("Choose SRT or WebVTT.");
    if (typeof raw !== "string" || raw.length > MAX_TEXT) throw new Error("Use a subtitle file smaller than 2 MB.");
    if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > 86400) throw new Error("Timing shift must be between -86400 and 86400 seconds.");
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("Paste or load subtitles to begin.");
    const offset = Math.round(offsetSeconds * 1000), cues = [], warnings = [];
    let skipped = 0, clamped = 0, metadata = 0, settingsLost = false;
    const blocks = text.split(/\n[ \t]*\n/).filter(block => block.trim());
    for (const [index, block] of blocks.entries()) {
      const lines = block.split("\n");
      if (index === 0 && /^WEBVTT(?:[ \t].*)?$/.test(lines[0])) {
        if (lines.slice(1).some(line => line.includes("-->"))) throw new Error("Add a blank line after WEBVTT.");
        if (lines.length > 1) metadata++; continue;
      }
      if (/^(NOTE(?:[ \t].*)?|STYLE|REGION)$/.test(lines[0])) { metadata++; continue; }
      const position = lines.findIndex(line => line.includes("-->"));
      if (position < 0 || position > 1) throw new Error(`Caption block ${index + 1} has no valid timing line. No captions were exported.`);
      const timing = lines[position].trim().match(/^(\S+)\s+-->\s+(\S+)(?:[ \t]+(.*))?$/);
      if (!timing) throw new Error(`Check the timing in caption block ${index + 1}.`);
      const start = parseTime(timing[1]), end = parseTime(timing[2]);
      const body = lines.slice(position + 1).join("\n").trim();
      if (end <= start || !body) throw new Error(`Caption block ${index + 1} needs text and an end time after its start.`);
      if (/<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/.test(body)) throw new Error("Inline karaoke timestamps are not supported. Use a plain caption file.");
      if (end + offset <= 0) { skipped++; continue; }
      if (start + offset < 0) clamped++;
      let settings = timing[3] || "";
      if (settings && format === "srt") settingsLost = true;
      if (/\bregion:/.test(settings)) { settings = settings.split(/\s+/).filter(item => !item.startsWith("region:")).join(" "); metadata++; }
      cues.push({start: Math.max(0, start + offset), end: end + offset, text: body, settings: format === "vtt" ? settings : ""});
      if (cues.length > 20000) throw new Error("Use at most 20,000 captions at a time.");
    }
    if (!cues.length) throw new Error("No captions remain. Check the file and timing shift.");
    if (skipped) warnings.push(`${skipped} captions before zero omitted.`);
    if (clamped) warnings.push(`${clamped} caption starts clipped to zero.`);
    if (metadata) warnings.push("WebVTT notes, style and region metadata are omitted.");
    if (settingsLost) warnings.push("SRT does not retain WebVTT layout settings.");
    const vtt = format === "vtt";
    const rendered = cues.map((cue, index) => `${vtt ? "" : `${index + 1}\n`}${formatTime(cue.start, vtt)} --> ${formatTime(cue.end, vtt)}${cue.settings ? ` ${cue.settings}` : ""}\n${cue.text}`);
    const header = vtt ? "WEBVTT\n\n" : "";
    return {count: cues.length, warnings, content: header + rendered.join("\n\n") + "\n", preview: header + rendered.slice(0, 8).join("\n\n") + (cues.length > 8 ? "\n\nPreview: first 8 captions only." : "")};
  }
  const isHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  function formatLink(raw, removeTracking = false) {
    let value = String(raw).trim();
    if (!value || value.length > 8192 || /[\s\\\u0000-\u001f\u007f]/.test(value)) throw new Error("Enter an HTTP or HTTPS link without spaces.");
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) throw new Error("Only HTTP and HTTPS links are supported.");
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !host.includes(".") || host.endsWith(".")) throw new Error("Enter a public website link without embedded credentials.");
    let platform = "Website", note = "Format checked only; availability and download permissions are not checked.";
    if (isHost(host, "youtube.com") || host === "youtu.be") {
      platform = "YouTube";
      const parts = url.pathname.split("/").filter(Boolean);
      const id = host === "youtu.be" ? parts[0] : url.pathname === "/watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : null;
      if (id && /^[\w-]{11}$/.test(id)) {
        const short = new URL(`https://youtu.be/${id}`);
        for (const key of ["t", "start", "end", "list", "index"]) if (url.searchParams.has(key)) short.searchParams.set(key, url.searchParams.get(key));
        short.hash = url.hash;
        return {url: short.toString(), platform, note: "Official YouTube short link. Video, timestamp and playlist context retained; no redirect account needed."};
      }
    } else if (isHost(host, "drive.google.com")) platform = "Google Drive";
    else if (isHost(host, "tiktok.com")) platform = "TikTok";
    else if (isHost(host, "instagram.com")) platform = "Instagram";
    else if (isHost(host, "facebook.com") || isHost(host, "fb.watch")) platform = "Facebook";
    if (removeTracking) {
      for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|dclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
      note += " Selected tracking parameters removed; check signed links before sharing.";
    }
    return {url: url.toString(), platform, note};
  }

  // ---- QR code (byte mode, ISO/IEC 18004). Pure browser code; nothing is uploaded.
  const QR_ECC = {L: [1, [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30], [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25]],
    M: [0, [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28], [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49]],
    Q: [3, [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30], [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68]],
    H: [2, [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30], [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]]};
  const MAX_QR_TEXT = 1200;
  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 255; }
  function rawModules(ver) { let r = (16 * ver + 128) * ver + 64; if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; } return r; }
  function dataCodewords(ver, ecl) { return Math.floor(rawModules(ver) / 8) - QR_ECC[ecl][1][ver] * QR_ECC[ecl][2][ver]; }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0); result[degree - 1] = 1; let root = 1;
    for (let i = 0; i < degree; i++) { for (let j = 0; j < degree; j++) { result[j] = gfMul(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; } root = gfMul(root, 2); }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) { const factor = b ^ result.shift(); result.push(0); divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); }); }
    return result;
  }
  function makeQr(text, ecl = "M", forcedMask = -1) {
    if (!QR_ECC[ecl]) throw new Error("Choose error correction L, M, Q or H.");
    const value = String(text ?? "");
    if (!value.trim()) throw new Error("Enter text or a link for the QR code.");
    if (value.length > MAX_QR_TEXT) throw new Error(`Use at most ${MAX_QR_TEXT} characters in one QR code.`);
    const bytes = Array.from(new TextEncoder().encode(value));
    let ver = 1;
    for (; ver <= 40; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver, ecl) * 8) break;
    if (ver > 40) throw new Error("This text is too long for one QR code. Shorten it or lower error correction.");
    const bits = [], push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) push(b, 8);
    const capacity = dataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capacity - bits.length)); push(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));
    const blocksCount = QR_ECC[ecl][2][ver], eccLen = QR_ECC[ecl][1][ver], raw = Math.floor(rawModules(ver) / 8);
    const shortBlocks = blocksCount - raw % blocksCount, shortLen = Math.floor(raw / blocksCount), divisor = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < blocksCount; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1)); k += dat.length;
      const ecc = rsRemainder(dat, divisor); if (i < shortBlocks) dat.push(0); blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((block, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(block[i]); });
    const size = ver * 4 + 17, modules = Array.from({length: size}, () => new Array(size).fill(false)), fn = Array.from({length: size}, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
    }
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      pos.forEach((x, i) => pos.forEach((y, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const drawFormat = mask => {
      const d = QR_ECC[ecl][0] << 3 | mask; let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = (d << 10 | rem) ^ 0x5412, bit = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = ver << 12 | rem;
      for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
    }
    for (let right = size - 1, i = 0; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) { modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    const maskFns = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFns[m](x, y)) modules[y][x] = !modules[y][x]; };
    const penalty = () => {
      let score = 0, dark = 0;
      for (let a = 0; a < size; a++) for (const line of [modules[a], modules.map(row => row[a])]) {
        let run = 1; for (let i = 1; i <= size; i++) { if (i < size && line[i] === line[i - 1]) run++; else { if (run >= 5) score += run - 2; run = 1; } }
        const s = line.map(Number).join(""); for (const p of ["10111010000", "00001011101"]) for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) score += 40;
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && modules[y][x] === modules[y][x + 1] && modules[y][x] === modules[y + 1][x] && modules[y][x] === modules[y + 1][x + 1]) score += 3;
      }
      return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let mask = forcedMask;
    if (mask < 0) {
      let best = Infinity;
      for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const p = penalty(); if (p < best) { best = p; mask = m; } applyMask(m); }
    }
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new Error("Invalid QR mask.");
    applyMask(mask); drawFormat(mask);
    return {version: ver, size, ecl, mask, bytes: bytes.length, modules};
  }
  function qrSvg(qr, quiet = 4) {
    const full = qr.size + quiet * 2; let path = "";
    qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>\n`;
  }

  // ---- Media check: aspect, size and platform fit from browser-read metadata.
  function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid file size.");
    const units = ["B", "KB", "MB", "GB"]; let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${unit ? value.toFixed(value >= 100 ? 0 : 1) : value} ${units[unit]}`;
  }
  const RATIOS = [["9:16", 9 / 16, "Vertical: Shorts, Reels, TikTok, Stories"], ["4:5", 4 / 5, "Portrait feed post"], ["1:1", 1, "Square feed post"],
    ["4:3", 4 / 3, "Classic / presentation"], ["16:9", 16 / 9, "Landscape: YouTube, web, TV"], ["21:9", 21 / 9, "Cinematic widescreen"]];
  function describeMedia({kind, width = 0, height = 0, duration = 0, bytes}) {
    if (!["image", "video", "audio"].includes(kind)) throw new Error("Choose an image, video or audio file.");
    const result = {kind, size: formatBytes(bytes), warnings: []};
    if (kind !== "audio") {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("The browser could not read this file's dimensions.");
      const d = gcd(width, height), ratio = width / height;
      const nearest = RATIOS.reduce((best, item) => Math.abs(Math.log(ratio / item[1])) < Math.abs(Math.log(ratio / best[1])) ? item : best);
      const exact = Math.abs(Math.log(ratio / nearest[1])) < 0.01;
      Object.assign(result, {width, height, exactRatio: `${width / d}:${height / d}`, nearest: nearest[0], fit: exact ? nearest[2] : `Close to ${nearest[0]}; crop or pad for ${nearest[2]}`,
        orientation: width === height ? "square" : width > height ? "landscape" : "portrait", megapixels: Math.round(width * height / 1e5) / 10});
      if (kind === "video" && (width % 2 || height % 2)) result.warnings.push("Odd width or height: many encoders need even dimensions.");
      if (Math.max(width, height) > 3840) result.warnings.push("Larger than 4K: consider downscaling for faster uploads.");
      if (Math.min(width, height) < 720 && kind === "video") result.warnings.push("Below 720p: may look soft on modern screens.");
    }
    if (kind !== "image") {
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("The browser could not read this file's duration.");
      result.duration = duration; result.durationText = `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`;
      result.bitrateKbps = Math.round(bytes * 8 / duration / 1000);
    }
    return result;
  }

  // ---- Script to timed captions (English and Bangla sentence marks).
  function scriptToCaptions(raw, {wordsPerMinute = 150, maxChars = 42, format = "srt", startSeconds = 0} = {}) {
    if (!["srt", "vtt"].includes(format)) throw new Error("Choose SRT or WebVTT.");
    if (typeof raw !== "string" || raw.length > MAX_TEXT) throw new Error("Use a script smaller than 2 MB.");
    if (!Number.isFinite(wordsPerMinute) || wordsPerMinute < 60 || wordsPerMinute > 300) throw new Error("Speaking speed must be 60-300 words per minute.");
    if (!Number.isInteger(maxChars) || maxChars < 16 || maxChars > 80) throw new Error("Characters per caption must be 16-80.");
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86400) throw new Error("Start time must be 0-86400 seconds.");
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("Paste a script to begin.");
    const sentences = text.split(/\n+|(?<=[.!?।॥])\s+/).map(item => item.trim()).filter(Boolean), chunks = [];
    for (const sentence of sentences) {
      let line = "";
      for (const word of sentence.split(/\s+/)) {
        if (line && (line + " " + word).length > maxChars) { chunks.push(line); line = word; } else line = line ? line + " " + word : word;
      }
      if (line) chunks.push(line);
    }
    if (chunks.length > 20000) throw new Error("Use at most 20,000 captions at a time.");
    const msPerWord = 60000 / wordsPerMinute; let clock = Math.round(startSeconds * 1000);
    const vtt = format === "vtt", cues = chunks.map((chunk, index) => {
      const length = Math.max(1000, Math.round(chunk.split(/\s+/).length * msPerWord)), start = clock; clock += length;
      return `${vtt ? "" : `${index + 1}\n`}${formatTime(start, vtt)} --> ${formatTime(clock, vtt)}\n${chunk}`;
    });
    const header = vtt ? "WEBVTT\n\n" : "";
    return {count: cues.length, durationSeconds: clock / 1000 - startSeconds, content: header + cues.join("\n\n") + "\n", preview: header + cues.slice(0, 8).join("\n\n") + (cues.length > 8 ? "\n\nPreview: first 8 captions only." : "")};
  }
  const api = Object.freeze({convertSubtitles, formatLink, makeQr, qrSvg, describeMedia, formatBytes, scriptToCaptions});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VisionFlowTools = api;
})(globalThis);
