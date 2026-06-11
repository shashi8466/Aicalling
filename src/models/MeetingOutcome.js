const mongoose = require('mongoose');

const meetingOutcomeSchema = new mongoose.Schema({
  leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  meetingId:  { type: String }, // googleEventId or internal ref
  outcome: {
    type: String,
    enum: ['interested', 'need-follow-up', 'not-interested', 'parent-wants-discussion', 'ready-to-enroll'],
    required: true,
  },
  notes:       { type: String, default: '' },
  counselorId: { type: String, default: 'shashi-kumar' },
}, { timestamps: true });

meetingOutcomeSchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model('MeetingOutcome', meetingOutcomeSchema);
