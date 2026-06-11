const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true, index: true },
  leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  amount:       { type: Number, required: true },      // total amount due
  amountPaid:   { type: Number, default: 0 },          // amount paid so far
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial-paid', 'paid', 'refunded'],
    default: 'pending',
    index: true,
  },
  paymentDate:  { type: Date },
  dueDate:      { type: Date },
  paymentMethod:{ type: String, default: '' },         // credit card, check, wire
  transactionId:{ type: String, default: '' },
  notes:        { type: String, default: '' },
  program:      { type: String, default: '' },         // for revenue breakdown
}, { timestamps: true });

paymentSchema.index({ paymentStatus: 1, dueDate: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
