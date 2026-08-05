const express = require('express');
const router  = express.Router();
const StudentClass = require('../models/StudentClass');

// Get all classes
router.get('/', async (req, res) => {
  try {
    const classes = await StudentClass.find();
    res.json(classes);
  } catch (e) {
    if (e.message?.includes('does not exist')) {
       return res.status(503).json({ error: 'Schema classes not set up yet. Run supabase/schema_classes.sql', setupRequired: true });
    }
    res.status(500).json({ error: e.message });
  }
});

// Create a new class
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Class name is required' });
    const newClass = await StudentClass.create({ name: name.trim() });
    res.status(201).json(newClass);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get a class with its students
router.get('/:id', async (req, res) => {
  try {
    const cls = await StudentClass.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    const students = await StudentClass.getStudentsInClass(cls.id);
    res.json({ ...cls, students });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rename class
router.put('/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Class name is required' });
    const updated = await StudentClass.findByIdAndUpdate(req.params.id, { name: name.trim() });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete class
router.delete('/:id', async (req, res) => {
  try {
    await StudentClass.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add students to class
router.post('/:id/students', async (req, res) => {
  try {
    const { leadIds } = req.body;
    if (!Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }
    await StudentClass.addStudents(req.params.id, leadIds);
    res.json({ ok: true, message: `Added ${leadIds.length} students to class.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove student from class
router.delete('/:id/students/:leadId', async (req, res) => {
  try {
    await StudentClass.removeStudent(req.params.id, req.params.leadId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk remove students from class
router.post('/:id/students/remove', async (req, res) => {
  try {
    const { leadIds } = req.body;
    if (!Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }
    await StudentClass.removeStudents(req.params.id, leadIds);
    res.json({ ok: true, message: `Removed ${leadIds.length} students from class.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
