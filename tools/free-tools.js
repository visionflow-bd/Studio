"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const {convertSubtitles, formatLink, makeQr, qrSvg, describeMedia, scriptToCaptions} = VisionFlowTools;
  function download(name, blob) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  let subtitleResult = null, subtitleRead = 0;
  function updateSubtitles() {
    subtitleResult = null; $("subtitleDownload").disabled = true; $("subtitleOutput").textContent = "";
    try {
      subtitleResult = convertSubtitles($("subtitleInput").value, $("subtitleOffset").valueAsNumber, $("subtitleFormat").value);
      $("subtitleOutput").textContent = subtitleResult.preview;
      $("subtitleStatus").textContent = `${subtitleResult.count} captions ready. ${subtitleResult.warnings.join(" ")}`;
      $("subtitleDownload").disabled = false;
    } catch (error) { $("subtitleStatus").textContent = error.message; }
  }
  $("subtitleInput").addEventListener("input", () => { subtitleRead++; updateSubtitles(); });
  $("subtitleOffset").addEventListener("input", updateSubtitles);
  $("subtitleFormat").addEventListener("change", updateSubtitles);
  $("subtitlePreview").addEventListener("click", updateSubtitles);
  $("subtitleFile").addEventListener("change", async event => {
    const file = event.target.files[0], ticket = ++subtitleRead;
    if (!file) return;
    subtitleResult = null; $("subtitleDownload").disabled = true; $("subtitleOutput").textContent = "";
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Use a subtitle file smaller than 2 MB.");
      const text = await file.text();
      if (ticket !== subtitleRead) return;
      $("subtitleInput").value = text; updateSubtitles();
    } catch (error) { if (ticket === subtitleRead) $("subtitleStatus").textContent = error.message; }
  });
  $("subtitleDownload").addEventListener("click", () => {
    updateSubtitles(); if (!subtitleResult) return;
    const format = $("subtitleFormat").value;
    download(`vision-flow-subtitles.${format}`, new Blob([subtitleResult.content], {type: `${format === "vtt" ? "text/vtt" : "application/x-subrip"};charset=utf-8`}));
  });

  let image = null, imageUrl = null, imageTicket = 0;
  const imageTypes = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"};
  $("imageQuality").addEventListener("input", () => { $("imageQualityValue").textContent = `${$("imageQuality").value}%`; });
  $("imageFile").addEventListener("change", event => {
    const file = event.target.files[0]; if (!file) return;
    const ticket = ++imageTicket;
    image = null; $("imageDownload").disabled = true; $("imagePreview").replaceChildren();
    if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null;
    if (!imageTypes[file.type] || file.size > 12 * 1024 * 1024) { $("imageStatus").textContent = "Choose a PNG, JPEG or WebP up to 12 MB."; return; }
    const candidate = new Image(); candidate.alt = "Selected image preview";
    const url = imageUrl = URL.createObjectURL(file);
    $("imageStatus").textContent = "Reading image...";
    candidate.onload = () => {
      if (ticket !== imageTicket) return;
      if (!candidate.naturalWidth || candidate.naturalWidth * candidate.naturalHeight > 20000000) { URL.revokeObjectURL(url); imageUrl = null; $("imageStatus").textContent = "Choose an image up to 20 megapixels to keep this tool light."; return; }
      image = candidate; $("imagePreview").replaceChildren(candidate);
      $("imageStatus").textContent = `${candidate.naturalWidth} x ${candidate.naturalHeight} px / ${Math.round(file.size / 1024)} KB. Animated files export their first frame.`;
      $("imageDownload").disabled = false;
    };
    candidate.onerror = () => { if (ticket !== imageTicket) return; URL.revokeObjectURL(url); imageUrl = null; $("imageStatus").textContent = "This file could not be decoded. Choose another image."; };
    candidate.src = url;
  });
  $("imageDownload").addEventListener("click", async () => {
    if (!image) return;
    const source = image, ticket = imageTicket, width = $("imageWidth").valueAsNumber;
    if (!Number.isInteger(width) || width < 64 || width > 4096) { $("imageStatus").textContent = "Use a whole-number width between 64 and 4096."; return; }
    $("imageDownload").disabled = true;
    const canvas = document.createElement("canvas");
    try {
      const scale = Math.min(1, width / source.naturalWidth, 4096 / source.naturalHeight);
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext("2d"), format = $("imageFormat").value;
      if (!context || !imageTypes[format]) throw new Error("This browser cannot export this image format.");
      if (format === "image/jpeg") { context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, format, Number($("imageQuality").value) / 100));
      if (ticket !== imageTicket) return;
      if (!blob || !imageTypes[blob.type]) throw new Error("This browser could not export the image.");
      download(`vision-flow-image.${imageTypes[blob.type]}`, blob);
      $("imageStatus").textContent = `${canvas.width} x ${canvas.height} px / ${Math.round(blob.size / 1024)} KB exported.${blob.type !== format ? " Browser used " + imageTypes[blob.type].toUpperCase() + " as a fallback." : ""}`;
    } catch (error) { if (ticket === imageTicket) $("imageStatus").textContent = error.message; }
    finally { canvas.width = canvas.height = 0; if (ticket === imageTicket) $("imageDownload").disabled = !image; }
  });

  let cleanUrl = "";
  function resetLink() { cleanUrl = ""; $("linkCopy").disabled = true; $("linkCopy").textContent = "Copy URL"; $("linkResult").textContent = "Check your link to update the result."; }
  function checkLink() {
    resetLink();
    try {
      const result = formatLink($("linkInput").value, $("removeTracking").checked);
      cleanUrl = result.url;
      const heading = document.createElement("strong"), value = document.createElement("span"), note = document.createElement("p");
      heading.textContent = `${result.platform} link`; value.textContent = result.url; note.textContent = result.note;
      $("linkResult").replaceChildren(heading, value, note); $("linkCopy").disabled = false;
    } catch (error) { $("linkResult").textContent = error.message; }
  }
  $("linkInput").addEventListener("input", resetLink);
  $("removeTracking").addEventListener("change", resetLink);
  $("linkCheck").addEventListener("click", checkLink);
  $("linkInput").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); checkLink(); } });
  $("linkCopy").addEventListener("click", async () => {
    const value = cleanUrl; if (!value) return;
    try { await navigator.clipboard.writeText(value); if (cleanUrl === value) $("linkCopy").textContent = "Copied"; }
    catch { if (cleanUrl === value) $("linkResult").append(" Clipboard unavailable. Select and copy the URL above."); }
  });

  let qr = null;
  function resetQr() { qr = null; $("qrPng").disabled = $("qrSvg").disabled = true; }
  function makeQrCode() {
    resetQr();
    try {
      qr = makeQr($("qrInput").value, $("qrLevel").value);
      const quiet = 4, full = qr.size + quiet * 2, canvas = document.createElement("canvas"), scale = 8;
      canvas.width = canvas.height = full * scale; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Generated QR code");
      const context = canvas.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#000";
      qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
      $("qrPreview").replaceChildren(canvas);
      $("qrStatus").textContent = `QR version ${qr.version} (${qr.size} x ${qr.size}), ${qr.bytes} bytes, error correction ${qr.ecl}. Test-scan before printing.`;
      $("qrPng").disabled = $("qrSvg").disabled = false;
    } catch (error) { $("qrPreview").replaceChildren(); $("qrStatus").textContent = error.message; }
  }
  $("qrInput").addEventListener("input", resetQr);
  $("qrLevel").addEventListener("change", resetQr);
  $("qrMake").addEventListener("click", makeQrCode);
  $("qrSvg").addEventListener("click", () => { if (qr) download("vision-flow-qr.svg", new Blob([qrSvg(qr)], {type: "image/svg+xml"})); });
  $("qrPng").addEventListener("click", () => {
    if (!qr) return;
    const scale = $("qrScale").valueAsNumber;
    if (!Number.isInteger(scale) || scale < 2 || scale > 40) { $("qrStatus").textContent = "Use a whole-number size between 2 and 40."; return; }
    const source = qr, quiet = 4, canvas = document.createElement("canvas"); canvas.width = canvas.height = (source.size + quiet * 2) * scale;
    const context = canvas.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#000";
    source.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
    canvas.toBlob(blob => { if (blob) download("vision-flow-qr.png", blob); else $("qrStatus").textContent = "This browser could not export the PNG."; canvas.width = canvas.height = 0; }, "image/png");
  });

  let mediaTicket = 0, mediaUrl = null;
  $("mediaFile").addEventListener("change", event => {
    const file = event.target.files[0], ticket = ++mediaTicket;
    $("mediaResult").replaceChildren();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl = null;
    if (!file) return;
    const kind = ["image", "video", "audio"].find(type => file.type.startsWith(type + "/"));
    if (!kind) { $("mediaStatus").textContent = "Choose an image, video or audio file."; return; }
    if (file.size > 8 * 1024 * 1024 * 1024) { $("mediaStatus").textContent = "Choose a file up to 8 GB."; return; }
    $("mediaStatus").textContent = "Reading file details...";
    const url = mediaUrl = URL.createObjectURL(file);
    const finish = values => {
      if (ticket !== mediaTicket) return;
      URL.revokeObjectURL(url); if (mediaUrl === url) mediaUrl = null;
      try {
        const info = describeMedia({kind, bytes: file.size, ...values});
        const rows = [["Type", `${kind} (${file.type})`], ["File size", info.size]];
        if (info.width) rows.push(["Dimensions", `${info.width} x ${info.height} px (${info.megapixels} MP, ${info.orientation})`], ["Aspect ratio", `${info.exactRatio} - nearest ${info.nearest}`], ["Best fit", info.fit]);
        if (info.durationText) rows.push(["Duration", info.durationText], ["Average bitrate", `${info.bitrateKbps} kbps`]);
        $("mediaResult").replaceChildren(...rows.flatMap(([term, value]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = term; dd.textContent = value; return [dt, dd]; }));
        $("mediaStatus").textContent = info.warnings.length ? info.warnings.join(" ") : "Details read locally. Nothing was uploaded.";
      } catch (error) { $("mediaStatus").textContent = error.message; }
    };
    const failed = () => { if (ticket !== mediaTicket) return; URL.revokeObjectURL(url); if (mediaUrl === url) mediaUrl = null; $("mediaStatus").textContent = "This browser could not read this file. Try another format."; };
    if (kind === "image") { const img = new Image(); img.onload = () => finish({width: img.naturalWidth, height: img.naturalHeight}); img.onerror = failed; img.src = url; }
    else { const media = document.createElement(kind); media.preload = "metadata"; media.muted = true;
      media.onloadedmetadata = () => finish({width: media.videoWidth || 0, height: media.videoHeight || 0, duration: media.duration}); media.onerror = failed; media.src = url; }
  });

  let captionResult = null;
  function makeCaptions() {
    captionResult = null; $("captionDownload").disabled = true; $("captionOutput").textContent = "";
    try {
      captionResult = scriptToCaptions($("captionScript").value, {wordsPerMinute: $("captionWpm").valueAsNumber, maxChars: $("captionChars").valueAsNumber, format: $("captionFormat").value});
      $("captionOutput").textContent = captionResult.preview;
      $("captionStatus").textContent = `${captionResult.count} captions, about ${Math.round(captionResult.durationSeconds)} seconds. Timing is an estimate; align to your voiceover in the editor.`;
      $("captionDownload").disabled = false;
    } catch (error) { $("captionStatus").textContent = error.message; }
  }
  for (const id of ["captionScript", "captionWpm", "captionChars"]) $(id).addEventListener("input", () => { captionResult = null; $("captionDownload").disabled = true; });
  $("captionFormat").addEventListener("change", makeCaptions);
  $("captionMake").addEventListener("click", makeCaptions);
  $("captionDownload").addEventListener("click", () => {
    makeCaptions(); if (!captionResult) return;
    const format = $("captionFormat").value;
    download(`vision-flow-captions.${format}`, new Blob([captionResult.content], {type: `${format === "vtt" ? "text/vtt" : "application/x-subrip"};charset=utf-8`}));
  });
})();
