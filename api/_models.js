// The AI models the server functions call, in one place so /api/health checks exactly what /api/vision and
// /api/render use. Files in api/ that start with "_" are not routes on Vercel.

/** Claude model for room naming (api/vision.js). */
const visionModel = () => process.env.VISION_MODEL || 'claude-sonnet-5-5';

/** Gemini image models for renders (api/render.js), newest first; the first one the key can use wins. */
const renderModels = () => [process.env.RENDER_MODEL, 'gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'].filter(Boolean);

module.exports = { visionModel, renderModels };
