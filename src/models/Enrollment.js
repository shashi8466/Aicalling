const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  studentName:  { type: String, required: true },
  grade:        { type: String },
  parentName:   { type: String },
  parentEmail:  { type: String, lowercase: true },
  parentPhone:  { type: String },
  program: {
    type: String,
    enum: ['SAT Prep', 'ACT Prep', 'AP Courses', 'College Admissions', 'PSAT', 'Other'],
    required: true,
  },
  examDate:     { type: Date },
  learningMode: {
    type: String,
    enum: ['online', 'in-person', 'hybrid', 'group', 'one-on-one'],
    default: 'online',
  },
  paymentPlan: {
    type: String,
    enum: ['full', '2-installments', '3-installments', '6-installments'],
    default: 'full',
  },
  programFee:    { type: Number, default: 0 },  // total program fee in USD
  enrollmentStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'active', 'completed', 'cancelled'],
    default: 'pending',
  },
  notes:        { type: String, default: '' },
  counselorId:  { type: String, default: 'shashi-kumar' },
}, { timestamps: true });

enrollmentSchema.index({ enrollmentStatus: 1 });
enrollmentSchema.index({ program: 1 });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
