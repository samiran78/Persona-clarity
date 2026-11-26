const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  name:      { type: String, required: true, maxlength: 80 },
  email:     { type: String, required: true, maxlength: 254 },
  message:   { type: String, required: true, maxlength: 1000 },
  sessionId: { type: String, required: true, maxlength: 64 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
