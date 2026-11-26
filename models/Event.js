const mongoose = require('mongoose');

const ALLOWED_TYPES = ['landed', 'fog_progress', 'node_open', 'form_started', 'form_submitted', 'page_complete'];

const eventSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, maxlength: 64 },
  type:      { type: String, required: true, enum: ALLOWED_TYPES },
  data:      { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Event', eventSchema);
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
