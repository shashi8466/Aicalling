const mongoose = require('mongoose');

const callAttemptSchema = new mongoose.Schema({
  attemptNumber: Number,
  callSid:       String,
  startTime:     Date,
  endTime:       Date,
  duration:      Number,
  status:        String,           // completed | no-answer | busy | failed
  recordingUrl:  String,
  transcript:    String,           // full conversation text
  aiSummary:     String,
  sentiment:     String,           // positive | neutral | negative
}, { _id: true, timestamps: false });

const qualificationSchema = new mongoose.Schema({
  studentGrade:          String,
  interestedProgram:     String,
  currentScore:          String,
  targetScore:           String,
  targetExamDate:        String,
  preferredFormat:       String,   // one-on-one | group | online | in-person
  parentInvolvement:     String,   // high | medium | low
  budgetRange:           String,
  availability:          String,
  objections:            [String],
}, { _id: false });

const meetingSchema = new mongoose.Schema({
  googleEventId: String,
  meetLink:      String,
  scheduledAt:   Date,
  status:        { type: String, default: 'scheduled' },
  reminderSent:  { type: Boolean, default: false },
}, { _id: false });

const leadSchema = new mongoose.Schema({
  // From Google Sheets
  fullName:       { type: String, required: true },
  grade:          String,
  email:          { type: String, required: true, lowercase: true },
  phone:          { type: String, required: true },
  parentName:     String,
  parentEmail:    String,
  courseInterest: String,
  submissionDate: Date,
  sheetRowIndex:  Number,

  // CRM
  status: {
    type: String,
    enum: ['new','queued','calling','contacted','qualified',
           'meeting-scheduled','meeting-completed','enrolled','lost','do-not-call'],
    default: 'new',
  },

  // Lead score
  leadScore:    { type: Number, default: 0, min: 0, max: 100 },
  leadCategory: { type: String, enum: ['hot','warm','cold'], default: 'cold' },

  // Call history
  callAttempts:      [callAttemptSchema],
  totalCallAttempts: { type: Number, default: 0 },
  lastCallAt:        Date,
  nextRetryAt:       Date,

  // Qualification
  qualification: qualificationSchema,
  isQualified:   { type: Boolean, default: false },

  // Meeting
  meeting: meetingSchema,

  // Follow-up tracking
  emailsSent:    [{ type: String, sentAt: Date }],
  whatsappSent:  [{ type: String, sentAt: Date }],

  source: { type: String, default: 'google-sheets' },
  notes:  String,
}, { timestamps: true });

leadSchema.index({ email: 1 }, { unique: true });
leadSchema.index({ phone: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ leadScore: -1 });
leadSchema.index({ nextRetryAt: 1 });

module.exports = mongoose.model('Lead', leadSchema);
