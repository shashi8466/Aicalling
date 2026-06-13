const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  followupType: {
    type: String,
    enum: [
      // Week 1
      'email-day1', 'whatsapp-day1',
      'ai-call-day2',
      'success-stories-day3',
      'ai-call-day4',
      'email-day5',
      'ai-call-day6',
      'counselor-reminder-day7',
      // Week 2
      'email-day8',
      'success-stories-day9',
      'ai-call-day10',
      'email-day12',
      'counselor-reminder-day14',
      // Week 3
      'ai-call-week3',
      'success-stories-week3',
      'parent-discussion-week3',
      'enrollment-reminder-week3',
      // Week 4
      'ai-call-week4',
      'success-stories-week4',
      'program-benefits-week4',
      'limited-seat-week4',
      'counselor-reminder-week4',
      // Ongoing monthly cadence (recurring — re-scheduled after completion)
      'nurture-ai-call',
      'nurture-email',
      'nurture-success-stories',
      'nurture-counselor-reminder',
      'nurture-lead-review',
      // Legacy types (kept for backward compat)
      'ai-call-day3',
      'success-stories-day5',
      'counselor-reminder-day7',
      'enrollment-reminder-day10',
    ],
    required: true,
  },
  cycle: { type: Number, default: 0 }, // which monthly cycle (0 = first 4 weeks)
  scheduledDate: { type: Date, required: true, index: true },
  completed:     { type: Boolean, default: false, index: true },
  completedAt:   { type: Date },
  notes:         { type: String, default: '' },
  result:        { type: String, default: '' },  // outcome of the follow-up
}, { timestamps: true });

followUpSchema.index({ scheduledDate: 1, completed: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
