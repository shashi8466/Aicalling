const mongoose = require('mongoose');

const leadObjectionSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  objectionType: {
    type: String,
    enum: [
      'too-expensive', 'need-parent-approval', 'comparing-competitors',
      'exam-date-not-decided', 'need-more-information', 'already-have-tutor',
      'not-ready-yet', 'busy-schedule', 'other',
    ],
    required: true,
  },
  notes:       { type: String, default: '' },
  resolved:    { type: Boolean, default: false },
  resolvedAt:  { type: Date },
  resolvedNote:{ type: String, default: '' },
}, { timestamps: true });

leadObjectionSchema.index({ leadId: 1 });
leadObjectionSchema.index({ objectionType: 1 });

module.exports = mongoose.model('LeadObjection', leadObjectionSchema);
