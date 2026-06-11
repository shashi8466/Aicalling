const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  followupType: {
    type: String,
    enum: [
      'email-day1', 'whatsapp-day1', 'ai-call-day3',
      'success-stories-day5', 'counselor-reminder-day7', 'enrollment-reminder-day10',
    ],
    required: true,
  },
  scheduledDate: { type: Date, required: true, index: true },
  completed:     { type: Boolean, default: false, index: true },
  completedAt:   { type: Date },
  notes:         { type: String, default: '' },
  result:        { type: String, default: '' },  // outcome of the follow-up
}, { timestamps: true });

followUpSchema.index({ scheduledDate: 1, completed: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
