// Placement comes from PreviewSceneGeometry, shared with the native scene.
export function drawStageVideo(context, source, geometry) {
  context.drawImage(source, ...geometry.outer);
  if (!geometry.inner) return;
  const [x, y, width, height] = geometry.clip, radius = Math.max(1, Math.min(width, height) / 2);
  context.save(); context.beginPath();
  for (let index = 0; index < 96; ++index) {
    const angle = index * Math.PI * 2 / 96;
    const px = x + width / 2 + radius * Math.cos(angle), py = y + height / 2 + radius * Math.sin(angle);
    if (index) context.lineTo(px, py); else context.moveTo(px, py);
  }
  context.closePath(); context.clip(); context.drawImage(source, ...geometry.inner); context.restore();
}
