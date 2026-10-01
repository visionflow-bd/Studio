"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const {convertSubtitles, formatLink} = VisionFlowTools;
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
})();
