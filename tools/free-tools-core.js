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
  const api = Object.freeze({convertSubtitles, formatLink});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VisionFlowTools = api;
})(globalThis);
